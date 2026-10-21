import { expect, test, type Page } from '@playwright/test';
import {
  launchWithExtension,
  openPanelTab,
  openPopupFor,
  type ExtensionSession,
} from './extension';
import { startFakeApi, type FakeApi } from './fake-api';
import { startFixtureServer, type FixtureServer } from './server';

/** The sign-in screen before the panel, the plan from the server, and the account block of the settings. */
let session: ExtensionSession;
let fixtures: FixtureServer;
let counter = 0;

let api: FakeApi;

test.beforeAll(async () => {
  fixtures = await startFixtureServer('localhost');
  session = await launchWithExtension({ plan: 'free', signedIn: false });
});

test.afterAll(async () => {
  await session.close();
  await fixtures.close();
});

test.beforeEach(async () => {
  api = await startFakeApi();
  await session.worker.evaluate(
    (origin) => chrome.storage.local.set({ e2eApi: origin }),
    api.origin,
  );
});

test.afterEach(async () => {
  await Promise.all(session.context.pages().map((page) => page.close()));
  await session.resetStorage();
  await api.close();
});

/** The panel on a page with a video; nobody is signed in unless the test says so. */
async function openPanel(): Promise<Page> {
  const page = await session.context.newPage();
  await page.goto(`${fixtures.origin}/shadow-video.html?test=${++counter}`);
  return openPopupFor(session, page);
}

const planOf = () =>
  session.worker.evaluate(
    async () =>
      ((await chrome.storage.local.get('entitlements')).entitlements ?? null) as {
        plan: string;
      } | null,
  );

test('signed out: only the sign-in is offered, no tabs; signing in opens the panel and shows who and which plan', async () => {
  const panel = await openPanel();
  await expect(panel.getByTestId('gate')).toBeVisible();
  await expect(panel.getByTestId('sign-in')).toHaveText('Войти через Google');
  await expect(panel.getByTestId('tab-now')).toHaveCount(0);
  await expect(panel.getByTestId('tab-settings')).toHaveCount(0);

  await panel.getByTestId('sign-in').click();
  await expect(panel.getByTestId('gate')).toHaveCount(0);
  await expect(panel.getByTestId('tab-words')).toBeVisible();
  await openPanelTab(panel, 'settings');
  await expect(panel.getByTestId('account-email')).toHaveText('Вы вошли как learner@example.com');
  await expect(panel.getByTestId('account-plan')).toHaveText('План Pro');
  expect(api.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
    'POST /auth/google',
    'GET /me',
    'GET /me', // the panel asks for the plan once more when it opens
  ]);
  expect(api.requests[1]!.auth).toBe('Bearer access-1');
});

test('a free account stays free: no words tab, the plan says so', async () => {
  api.plan = 'free';
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await openPanelTab(panel, 'settings');
  await expect(panel.getByTestId('account-plan')).toHaveText('Бесплатный план');
  await expect(panel.getByTestId('tab-words')).toHaveCount(0);
});

test('signing out ends the session on the server and brings the sign-in screen back', async () => {
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await expect(panel.getByTestId('tab-words')).toBeVisible();
  await openPanelTab(panel, 'settings');

  await panel.getByTestId('sign-out').click();
  await expect(panel.getByTestId('gate')).toBeVisible();
  await expect(panel.getByTestId('tab-now')).toHaveCount(0);
  expect(await planOf()).toMatchObject({ plan: 'free' });
  await expect.poll(() => api.requests.some((r) => r.path === '/auth/logout')).toBe(true);
});

test('a refused sign-in says so and leaves the button to try again', async () => {
  api.failSignIn = true;
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await expect(panel.getByTestId('account-error')).toHaveText(
    'Не удалось войти. Попробуйте ещё раз.',
  );
  await expect(panel.getByTestId('sign-in')).toBeEnabled();
  await expect(panel.getByTestId('tab-now')).toHaveCount(0);
});

test('a server that cannot be reached says so differently', async () => {
  await api.close();
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await expect(panel.getByTestId('account-error')).toHaveText(
    'Нет связи с сервером. Попробуйте позже.',
  );
});

test('the plan is asked again when the panel opens: a payment made elsewhere shows up', async () => {
  await session.worker.evaluate(() =>
    chrome.storage.local.set({
      account: {
        email: 'learner@example.com',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + 3_600_000,
      },
      entitlements: { plan: 'free', proUntil: null },
    }),
  );
  const panel = await openPanel();
  await expect(panel.getByTestId('tab-words')).toBeVisible();
  expect(await planOf()).toMatchObject({ plan: 'pro' });
});
