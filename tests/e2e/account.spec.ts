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
  await expect(panel.getByTestId('plan-pro').getByTestId('plan-current')).toHaveText(
    'Текущий план',
  );
  await expect(panel.getByTestId('plan-upgrade')).toHaveCount(0);
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
  // The plan cards: free is the current one; there is no payment yet, so the way to Pro says "soon".
  await expect(panel.getByTestId('plan-free').getByTestId('plan-current')).toBeVisible();
  await expect(panel.getByTestId('plan-pro')).toContainText('Сохранение слов');
  await expect(panel.getByTestId('plan-upgrade')).toBeDisabled();
  await expect(panel.getByTestId('plan-upgrade')).toContainText('скоро');
});

test('the contents of the settings scroll to a section and light it', async () => {
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await openPanelTab(panel, 'settings');
  await expect(panel.getByTestId('settings-nav-account')).toHaveAttribute('aria-current', 'true');
  await panel.getByTestId('settings-nav-history').click();
  await expect(panel.getByTestId('toggle-history')).toBeInViewport();
  await expect(panel.getByTestId('settings-nav-history')).toHaveAttribute('aria-current', 'true');
  await expect(panel.getByTestId('settings-nav-account')).not.toHaveAttribute('aria-current');
  // The last section: the page goes as far down as it can, and the section blinks.
  await expect(panel.locator('#set-history .card').first()).toHaveClass(/blink/);
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

// ---------------------------------------------------------------- a code by email, the Telegram bot, the ways in

test('a code by email: the letter is asked for in the language of the panel, the code signs in', async () => {
  const panel = await openPanel();
  await expect(panel.getByTestId('telegram-sign-in')).toHaveText('Войти через Telegram');
  await panel.getByTestId('email-input').fill('reader@example.com');
  await panel.getByTestId('email-send').click();
  await expect(panel.getByTestId('email-sent')).toHaveText(
    'Мы отправили код на reader@example.com. Введите его здесь:',
  );
  expect(api.requests.find((r) => r.path === '/auth/email/start')!.body).toEqual({
    email: 'reader@example.com',
    lang: 'ru',
  });

  // A wrong code is said so, and the form stays for another try.
  await panel.getByTestId('email-code').fill('000000');
  await panel.getByTestId('email-verify').click();
  await expect(panel.getByTestId('account-error')).toHaveText(
    'Неверный код. Проверьте письмо и попробуйте ещё раз.',
  );
  await expect(panel.getByTestId('gate')).toBeVisible();

  await panel.getByTestId('email-code').fill('123 456');
  await panel.getByTestId('email-verify').click();
  await expect(panel.getByTestId('gate')).toHaveCount(0);
  await openPanelTab(panel, 'settings');
  await expect(panel.getByTestId('account-email')).toHaveText('Вы вошли как reader@example.com');
  await expect(panel.getByTestId('method-email')).toContainText('reader@example.com');
});

test('the Telegram bot: its link opens in a tab, the panel waits, and signs in once Start is pressed', async () => {
  const panel = await openPanel();
  const bot = session.context.waitForEvent('page');
  await panel.getByTestId('telegram-sign-in').click();
  expect((await bot).url()).toBe(`${api.origin}/bot?start=${'L'.repeat(32)}`);
  await expect(panel.getByTestId('telegram-waiting')).toContainText('нажмите «Запустить» (Start)');
  // Asked again and again while the user is in Telegram.
  await expect
    .poll(() => api.requests.filter((r) => r.path === '/auth/telegram/poll').length)
    .toBeGreaterThan(2);
  expect(api.requests.find((r) => r.path === '/auth/telegram/poll')!.body).toEqual({
    loginId: 'L'.repeat(32),
    secret: 'S',
  });

  api.telegramConfirmed = true;
  await expect(panel.getByTestId('gate')).toHaveCount(0);
  await openPanelTab(panel, 'settings');
  await expect(panel.getByTestId('account-email')).toHaveText('Вы вошли как @learner');
});

test('waiting for Telegram goes on in a panel opened again (Telegram took the focus and it closed)', async () => {
  const first = await openPanel();
  await first.getByTestId('telegram-sign-in').click();
  await expect(first.getByTestId('telegram-waiting')).toBeVisible();
  await first.close();

  const again = await openPanel();
  await expect(again.getByTestId('telegram-waiting')).toBeVisible();
  api.telegramConfirmed = true;
  await expect(again.getByTestId('gate')).toHaveCount(0);
});

test('a wait for Telegram can be cancelled: the button comes back and nothing is asked any more', async () => {
  const panel = await openPanel();
  await panel.getByTestId('telegram-sign-in').click();
  await panel.getByTestId('telegram-cancel').click();
  await expect(panel.getByTestId('telegram-sign-in')).toBeVisible();
  const asked = api.requests.length;
  await panel.waitForTimeout(800);
  expect(api.requests.length).toBe(asked);
  expect(
    await session.worker.evaluate(
      async () => (await chrome.storage.local.get('telegramLogin')).telegramLogin,
    ),
  ).toBeUndefined();
});

test('ways in: an address and Telegram are added to a Google account, one is removed, the last one stays', async () => {
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await openPanelTab(panel, 'settings');
  await expect(panel.getByTestId('method-google')).toContainText('learner@example.com');
  // A single way in cannot be removed: no button for it.
  await expect(panel.getByTestId('method-remove-google')).toHaveCount(0);

  await panel.getByTestId('add-method').locator('summary').click();
  await expect(panel.getByTestId('add-google')).toHaveCount(0); // it has Google already
  await panel.getByTestId('email-input').fill('other@example.com');
  await panel.getByTestId('email-send').click();
  await panel.getByTestId('email-code').fill('123456');
  await panel.getByTestId('email-verify').click();
  await expect(panel.getByTestId('method-email')).toContainText('other@example.com');
  // Added while signed in: with the access token, and the session is the same.
  expect(api.requests.find((r) => r.path === '/auth/email/verify')!.auth).toBe('Bearer access-1');

  await panel.getByTestId('add-telegram').click();
  api.telegramConfirmed = true;
  await expect(panel.getByTestId('method-telegram')).toContainText('@learner');
  await expect(panel.getByTestId('add-method')).toHaveCount(0); // all three are there

  await panel.getByTestId('method-remove-google').click();
  await expect(panel.getByTestId('method-google')).toHaveCount(0);
  await panel.getByTestId('method-remove-email').click();
  await expect(panel.getByTestId('method-email')).toHaveCount(0);
  await expect(panel.getByTestId('method-remove-telegram')).toHaveCount(0);
  await expect(panel.getByTestId('account-email')).toHaveText('Вы вошли как @learner');
});
