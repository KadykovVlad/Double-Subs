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
  await expect(panel.getByTestId('account-email')).toHaveText('learner@example.com');
  await expect(panel.getByTestId('account-plan')).toHaveText('PRO');
  // The plan is told once: no comparison of plans for who has the better one.
  await expect(panel.getByTestId('plan-pro')).toHaveCount(0);
  await expect(panel.getByTestId('plan-upgrade')).toHaveCount(0);
  const asked = api.requests.filter((r) => r.path !== '/sync');
  expect(asked.map((r) => `${r.method} ${r.path}`)).toEqual([
    'POST /auth/google',
    'GET /me',
    'GET /me', // the panel asks for the plan once more when it opens
  ]);
  expect(asked[1]!.auth).toBe('Bearer access-1');
});

test('signing in brings the words and the history kept on the server into this browser', async () => {
  const now = Date.now();
  api.synced = [
    {
      kind: 'words',
      key: 'en:serendipity',
      updatedAt: now,
      deleted: false,
      data: {
        key: 'en:serendipity',
        word: 'serendipity',
        lang: 'en',
        translation: 'счастливая случайность',
        context: 'Pure serendipity.',
        savedAt: now,
      },
    },
    {
      kind: 'history',
      key: 'https://example.com/film',
      updatedAt: now,
      deleted: false,
      data: {
        id: 'https://example.com/film',
        url: 'https://example.com/film',
        title: 'A film from another browser',
        host: 'example.com',
        firstAt: now,
        lastAt: now,
        position: 60,
        duration: 600,
      },
    },
  ];
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await openPanelTab(panel, 'words');
  await expect(panel.getByTestId('saved-word')).toContainText('serendipity');
  await openPanelTab(panel, 'history');
  // The page under the panel is in the history too.
  await expect(
    panel.getByTestId('history-item').filter({ hasText: 'A film from another browser' }),
  ).toBeVisible();
});

test('what this browser had before the sign-in goes to the server, and a new word follows', async () => {
  const saved = (key: string) => ({
    key,
    word: key.slice(3),
    lang: 'en',
    translation: null,
    context: 'A line.',
    savedAt: Date.now(),
  });
  await session.worker.evaluate(
    (word) => chrome.storage.local.set({ savedWords: [word] }),
    saved('en:before'),
  );
  const told = () =>
    api.requests
      .filter((r) => r.path === '/sync')
      .flatMap((r) => (r.body as { changes: Array<{ key: string }> }).changes.map((c) => c.key));

  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await expect.poll(told).toContain('en:before');
  // The sign-in and the panel each ask for a synchronisation: the new word must not ride on one of them.
  await panel.waitForTimeout(1500);

  await session.worker.evaluate(async (word) => {
    const { savedWords } = await chrome.storage.local.get('savedWords');
    await chrome.storage.local.set({ savedWords: [word, ...(savedWords as unknown[])] });
  }, saved('en:after'));
  await expect.poll(told, { timeout: 10_000 }).toContain('en:after');
});

test('signing in brings the settings of the account, and a changed setting goes back', async () => {
  const setting = (name: string, value: unknown) => ({
    kind: 'settings',
    key: name,
    updatedAt: Date.now(),
    deleted: false,
    data: { name, value },
  });
  api.synced = [
    setting('fontSize', 40),
    setting('theme', 'dark'),
    setting('languages', { learn: 'ko', native: 'ru' }),
    setting('uiLanguage', 'ru'),
  ];
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await expect(panel.locator('html')).toHaveAttribute('data-theme', 'dark');
  // The texts of the language are read by the background from the package.
  await expect(panel.getByRole('button', { name: 'Тема: тёмная' })).toBeVisible();
  const stored = () =>
    session.worker.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      return settings as { fontSize: number; learnLang: string; nativeLang: string };
    });
  await expect.poll(async () => (await stored()).fontSize).toBe(40);
  expect((await stored()).learnLang).toBe('ko');
  expect((await stored()).nativeLang).toBe('ru');

  // The change must not ride on another synchronisation: the sign-in and the panel each ask for one,
  // and clearing the storage before this test set the timer of a change.
  await panel.waitForTimeout(6000);
  await session.worker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings as object), barWidth: 90 } });
  });
  const told = () =>
    api.requests
      .filter((r) => r.path === '/sync')
      .flatMap((r) => (r.body as { changes: Array<{ key: string; data: unknown }> }).changes)
      .filter((c) => c.key === 'barWidth')
      .map((c) => (c.data as { value: number }).value);
  await expect.poll(told, { timeout: 10_000 }).toContain(90);
});

test('a change in the lists of sites or in the watchlist goes to the server by itself', async () => {
  test.setTimeout(110_000);
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  // No synchronisation of the sign-in or of the panel, and no timer from clearing the storage, is left.
  await panel.waitForTimeout(6000);
  const told = () =>
    api.requests
      .filter((r) => r.path === '/sync')
      .flatMap((r) => (r.body as { changes: Array<{ key: string }> }).changes.map((c) => c.key));
  const origin = 'https://films.example';
  const site = { origin, addedAt: Date.now(), lastUsed: 1, preferredIndex: null };
  const changes: Array<[Record<string, unknown>, string]> = [
    [{ panelPalette: 'plum' }, 'palette'],
    [{ knownSites: { [origin]: site } }, `known:${origin}`],
    [{ excludedSites: ['films.example'] }, 'off:films.example'],
    [{ rememberDismissed: [origin] }, `never:${origin}`],
    [
      { watchlist: [{ url: `${origin}/series`, title: 'A series', addedAt: 1 }] },
      `${origin}/series`,
    ],
  ];
  for (const [change, key] of changes) {
    await session.worker.evaluate((items) => chrome.storage.local.set(items), change);
    await expect.poll(told, { timeout: 10_000 }).toContain(key);
  }
});

test('the texts of the language are read again: a version with new ones does not speak English in them', async () => {
  // Saved when the language was chosen, by a version that had no "ways in" yet.
  await session.worker.evaluate(() =>
    chrome.storage.local.set({
      uiLanguage: { code: 'ru', messages: { account_title: 'Аккаунт' } },
    }),
  );
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await openPanelTab(panel, 'settings');
  await expect(panel.locator('.methods-title')).toHaveText('Способы входа');
});

test('a way in by email starts from the address the account already has', async () => {
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await openPanelTab(panel, 'settings');
  await panel.getByTestId('add-method').locator('summary').click();
  await expect(panel.getByTestId('add-method').getByTestId('email-input')).toHaveValue(
    'learner@example.com',
  );
});

test('videos: put aside by a click and by a link, once, and taken off', async () => {
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await panel.getByTestId('tab-video').click();
  // Pro starts on what was put aside.
  await expect(panel.getByTestId('video-saved')).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByTestId('saved-list')).toHaveCount(0);

  await panel.getByTestId('saved-add-page').click();
  await expect(panel.getByTestId('saved-item')).toHaveCount(1);
  await expect(panel.getByTestId('saved-item')).toContainText('localhost');
  await panel.getByTestId('saved-add-page').click();
  await expect(panel.getByTestId('saved-notice')).toHaveText('Уже в отложенных');
  await expect(panel.getByTestId('saved-item')).toHaveCount(1);

  await panel.getByTestId('saved-add-link').locator('summary').click();
  await panel.getByTestId('saved-url').fill('javascript:alert(1)');
  await panel.getByTestId('saved-submit').click();
  await expect(panel.getByTestId('saved-notice')).toContainText('http');
  await panel.getByTestId('saved-url').fill('films.example/series');
  await panel.getByTestId('saved-title').fill('A series');
  await panel.getByTestId('saved-submit').click();
  await expect(panel.getByTestId('saved-item')).toHaveCount(2);
  await expect(panel.getByTestId('saved-item').first()).toContainText('A series');
  await expect(panel.getByTestId('saved-url')).toHaveValue('');

  await panel.getByTestId('saved-item').first().getByTestId('saved-remove').click();
  await expect(panel.getByTestId('saved-item')).toHaveCount(1);
});

test('videos on a free account: the history comes first, putting aside is a Pro feature', async () => {
  api.plan = 'free';
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await panel.getByTestId('tab-video').click();
  await expect(panel.getByTestId('video-history')).toHaveAttribute('aria-selected', 'true');

  await panel.getByTestId('video-saved').click();
  await panel.getByTestId('saved-add-page').click();
  await expect(panel.locator('.toast.pro')).toContainText('Отложенные');
  await expect(panel.getByTestId('saved-item')).toHaveCount(0);
});

test('a site that came from the account without access: the panel says so and asks on a click', async () => {
  const other = 'https://films.example';
  api.synced = [
    {
      kind: 'sites',
      key: `known:${other}`,
      updatedAt: Date.now(),
      deleted: false,
      data: {
        list: 'known',
        id: other,
        site: { origin: other, addedAt: 1, lastUsed: 1, preferredIndex: null },
      },
    },
  ];
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await openPanelTab(panel, 'settings');
  await expect(panel.getByTestId('known-site').filter({ hasText: 'films.example' })).toBeVisible();
  await expect(panel.getByTestId('sites-access')).toContainText('1');

  // Chrome's own question cannot be answered from a test: the click must ask it for that site.
  await panel.evaluate(() => {
    const asked: unknown[] = [];
    Object.assign(window, { asked });
    chrome.permissions.request = (async (request: unknown) => {
      asked.push(request);
      return true;
    }) as typeof chrome.permissions.request;
  });
  await panel.getByTestId('sites-allow').click();
  expect(await panel.evaluate(() => (window as unknown as { asked: unknown[] }).asked)).toEqual([
    { origins: ['https://films.example/*'] },
  ]);
});

test('on a site of the list without access here: not shown as working, and offered again', async () => {
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await expect(panel.getByTestId('remember-title')).toBeVisible();
  await panel.evaluate(() => {
    const real = chrome.permissions.contains.bind(chrome.permissions);
    chrome.permissions.contains = (async (query: chrome.permissions.Permissions) =>
      query.origins?.[0]?.includes('localhost')
        ? false
        : real(query)) as typeof chrome.permissions.contains;
  });
  await session.worker.evaluate(
    (origin) =>
      chrome.storage.local.set({
        knownSites: { [origin]: { origin, addedAt: 1, lastUsed: 1, preferredIndex: null } },
      }),
    fixtures.origin,
  );
  await expect(panel.getByTestId('auto-start')).not.toBeChecked();
  await expect(panel.getByTestId('remember-title')).toBeVisible();
});

test('a free account stays free: no words tab, the plan says so', async () => {
  api.plan = 'free';
  const panel = await openPanel();
  await panel.getByTestId('sign-in').click();
  await openPanelTab(panel, 'settings');
  await expect(panel.getByTestId('account-plan')).toHaveText('FREE');
  await expect(panel.getByTestId('tab-words')).toHaveCount(0);
  // Only what can be had is shown; there is no payment yet, so the way to Pro says "soon".
  await expect(panel.getByTestId('plan-free')).toHaveCount(0);
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
  await expect(panel.getByTestId('account-email')).toHaveText('reader@example.com');
  await expect(panel.getByTestId('method-email')).toHaveText('Почта');
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
  await expect(panel.getByTestId('account-email')).toHaveText('@learner');
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
  await panel.waitForTimeout(500); // a poll that was already on its way may still land
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
  // The address the account goes by is written once.
  await expect(panel.getByTestId('method-google')).toHaveText('Google');
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

  await expect(panel.getByTestId('method-remove-google')).toHaveText('Выйти');
  await panel.getByTestId('method-remove-google').click();
  await expect(panel.getByTestId('method-google')).toHaveCount(0);
  await panel.getByTestId('method-remove-email').click();
  await expect(panel.getByTestId('method-email')).toHaveCount(0);
  await expect(panel.getByTestId('method-remove-telegram')).toHaveCount(0);
  await expect(panel.getByTestId('account-email')).toHaveText('@learner');
});
