import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import {
  launchWithExtension,
  openPanelTab,
  openPopupFor,
  type ExtensionSession,
} from './extension';
import { startFixtureServer, type FixtureServer } from './server';

/** The account block of the settings: sign in with Google, the plan from the server, sign out. */
let session: ExtensionSession;
let fixtures: FixtureServer;
let counter = 0;

/** A stand-in for the Worker: what it answers, and what it was asked. */
interface FakeApi {
  origin: string;
  plan: 'free' | 'pro';
  failSignIn: boolean;
  requests: Array<{ method: string; path: string; auth: string | undefined }>;
  close(): Promise<void>;
}

async function startFakeApi(): Promise<FakeApi> {
  const api: FakeApi = {
    origin: '',
    plan: 'pro',
    failSignIn: false,
    requests: [],
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type',
      });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204, {});
    api.requests.push({ method: req.method ?? '', path, auth: req.headers.authorization });
    if (path === '/auth/google') {
      if (api.failSignIn) return send(401, { error: 'bad_google_token' });
      return send(200, {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + 3_600_000,
      });
    }
    if (path === '/me')
      return send(200, { email: 'learner@example.com', plan: api.plan, proUntil: null });
    if (path === '/auth/logout') return send(200, { ok: true });
    send(404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  api.origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  return api;
}

let api: FakeApi;

test.beforeAll(async () => {
  fixtures = await startFixtureServer('localhost');
  session = await launchWithExtension({ plan: 'free' });
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

async function openSettings(): Promise<Page> {
  const page = await session.context.newPage();
  await page.goto(`${fixtures.origin}/shadow-video.html?test=${++counter}`);
  const panel = await openPopupFor(session, page);
  await openPanelTab(panel, 'settings');
  return panel;
}

const planOf = () =>
  session.worker.evaluate(
    async () =>
      ((await chrome.storage.local.get('entitlements')).entitlements ?? null) as {
        plan: string;
      } | null,
  );

test('signed out: a sign-in button and no words tab; signing in shows who and which plan, and opens the words', async () => {
  const panel = await openSettings();
  await expect(panel.getByTestId('sign-in')).toHaveText('Войти через Google');
  await expect(panel.getByTestId('tab-words')).toHaveCount(0);

  await panel.getByTestId('sign-in').click();
  await expect(panel.getByTestId('account-email')).toHaveText('Вы вошли как learner@example.com');
  await expect(panel.getByTestId('account-plan')).toHaveText('План Pro');
  await expect(panel.getByTestId('tab-words')).toBeVisible();
  await expect(panel.getByTestId('sign-in')).toHaveCount(0);
  expect(api.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
    'POST /auth/google',
    'GET /me',
  ]);
  expect(api.requests[1]!.auth).toBe('Bearer access-1');
});

test('a free account stays free: no words tab, the plan says so', async () => {
  api.plan = 'free';
  const panel = await openSettings();
  await panel.getByTestId('sign-in').click();
  await expect(panel.getByTestId('account-plan')).toHaveText('Бесплатный план');
  await expect(panel.getByTestId('tab-words')).toHaveCount(0);
});

test('signing out ends the session on the server, takes the words tab away and offers the sign-in again', async () => {
  const panel = await openSettings();
  await panel.getByTestId('sign-in').click();
  await expect(panel.getByTestId('tab-words')).toBeVisible();

  await panel.getByTestId('sign-out').click();
  await expect(panel.getByTestId('sign-in')).toBeVisible();
  await expect(panel.getByTestId('tab-words')).toHaveCount(0);
  expect(await planOf()).toMatchObject({ plan: 'free' });
  await expect.poll(() => api.requests.some((r) => r.path === '/auth/logout')).toBe(true);
});

test('a refused sign-in says so and leaves the button to try again', async () => {
  api.failSignIn = true;
  const panel = await openSettings();
  await panel.getByTestId('sign-in').click();
  await expect(panel.getByTestId('account-error')).toHaveText(
    'Не удалось войти. Попробуйте ещё раз.',
  );
  await expect(panel.getByTestId('sign-in')).toBeEnabled();
  await expect(panel.getByTestId('tab-words')).toHaveCount(0);
});

test('a server that cannot be reached says so differently', async () => {
  await api.close();
  const panel = await openSettings();
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
  const panel = await openSettings();
  await expect(panel.getByTestId('tab-words')).toBeVisible();
  expect(await planOf()).toMatchObject({ plan: 'pro' });
});
