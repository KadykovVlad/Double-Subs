import { expect, test, type Page } from '@playwright/test';
import {
  launchWithExtension,
  openPanelTab,
  openPopupFor,
  type ExtensionSession,
} from './extension';
import { startFixtureServer, type FixtureServer } from './server';

/** Stage 10: known sites start by themselves; the agent lets go of videos the page removes. */
let session: ExtensionSession;
let server: FixtureServer;
let counter = 0;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  server = await startFixtureServer('localhost');
  session = await launchWithExtension();
});

test.afterAll(async () => {
  await session.close();
  await server.close();
});

test.afterEach(async () => {
  await Promise.all(session.context.pages().map((page) => page.close()));
  await session.resetStorage();
  await expect.poll(registeredIds).toEqual([]);
});

// YouTube is seeded at start-up; the tests look at the other sites only.
const notYouTube = (list: string[]) => list.filter((id) => !id.includes('youtube'));
const allMatches = () =>
  session.worker.evaluate(async () =>
    (await chrome.scripting.getRegisteredContentScripts()).flatMap((s) => s.matches ?? []),
  );
const registeredIds = async () => notYouTube(await allMatches());
const known = async () =>
  notYouTube(
    await session.worker.evaluate(async () =>
      Object.keys(((await chrome.storage.local.get('knownSites')).knownSites ?? {}) as object),
    ),
  );

async function open(path: string): Promise<Page> {
  const page = await session.context.newPage();
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.location().url.endsWith('/favicon.ico'))
      consoleErrors.push(msg.text());
  });
  await page.goto(`${server.origin}/${path}?test=${++counter}`);
  return page;
}

async function seek(page: Page, time: number) {
  await page.locator('video').evaluate(
    (v: HTMLVideoElement, t: number) =>
      new Promise<void>((resolve) => {
        const go = () => {
          v.addEventListener('seeked', () => resolve(), { once: true });
          v.currentTime = t;
        };
        if (v.readyState >= 1) go();
        else v.addEventListener('loadedmetadata', go, { once: true });
      }),
    time,
  );
}

const lines = (page: Page) => ({
  host: page.locator('double-sub-overlay'),
  en: page.locator('double-sub-overlay .en'),
});

test('YouTube is a known site from the start', async () => {
  // Fresh browser, nothing cleared yet: seeding happens at start-up of the extension.
  const fresh = await launchWithExtension();
  try {
    await expect
      .poll(() =>
        fresh.worker.evaluate(async () =>
          Object.keys(((await chrome.storage.local.get('knownSites')).knownSites ?? {}) as object),
        ),
      )
      .toContain('https://www.youtube.com');
    await expect
      .poll(() =>
        fresh.worker.evaluate(async () =>
          (await chrome.scripting.getRegisteredContentScripts()).flatMap((s) => s.matches ?? []),
        ),
      )
      .toContain('https://www.youtube.com/*');
  } finally {
    await fresh.close();
  }
});

test('ticking "start automatically" makes the next visit find the player without the popup', async () => {
  const page = await open('shadow-video.html');
  const popup = await openPopupFor(session, page);
  await expect(lines(page).en).toHaveCount(1); // the popup started it as before
  await expect(popup.getByTestId('auto-start')).not.toBeChecked();

  await popup.getByTestId('auto-start').check();
  await expect.poll(known).toEqual([server.origin]);
  await expect.poll(registeredIds).toEqual(['http://localhost/*']);
  await openPanelTab(popup, 'settings');
  await expect(popup.getByTestId('known-site').filter({ hasText: 'localhost' })).toHaveCount(1);

  const next = await open('shadow-video.html'); // no popup this time
  await seek(next, 1.5);
  await expect(lines(next).en).toHaveText('Hello, Dexter.');
  expect(await next.locator('double-sub-overlay').count()).toBe(1);
});

test('removing the site stops the automatic start and takes its script away', async () => {
  const page = await open('shadow-video.html');
  const popup = await openPopupFor(session, page);
  await popup.getByTestId('auto-start').check();
  await expect.poll(registeredIds).toHaveLength(1);

  await openPanelTab(popup, 'settings');
  await popup
    .getByTestId('known-site')
    .filter({ hasText: 'localhost' })
    .getByTestId('forget-site')
    .click();
  await expect.poll(known).toEqual([]);
  await expect.poll(registeredIds).toEqual([]);

  const next = await open('shadow-video.html');
  await seek(next, 1.5);
  await next.waitForTimeout(3500); // longer than the agent's check interval
  await expect(lines(next).host).toHaveCount(0);
});

test('on a known site another episode in the same page is picked up, and nothing piles up', async () => {
  const first = await open('spa-player.html');
  const popup = await openPopupFor(session, first);
  await popup.getByTestId('auto-start').check();
  await expect.poll(registeredIds).toHaveLength(1);

  const page = await open('spa-player.html');
  await seek(page, 1.5);
  await expect(lines(page).en).toHaveText('Hello, Dexter.');

  for (let episode = 2; episode <= 6; episode++) {
    await page.evaluate(() => (window as unknown as { swap: () => void }).swap());
    await expect(page.locator('video')).toHaveAttribute('data-episode', String(episode));
    await seek(page, 5);
    // The overlay shows the line of the NEW video (the old one was removed and could never reach this
    // cue), and there is exactly one overlay.
    await expect(lines(page).en).toHaveText('Tonight is the night.', { timeout: 8000 });
    await expect(lines(page).host).toHaveCount(1);
  }
  expect(consoleErrors).toEqual([]);
});

test('a video removed from the page takes the overlay with it', async () => {
  const page = await open('spa-player.html');
  const popup = await openPopupFor(session, page);
  await expect(lines(page).en).toHaveCount(1);
  void popup;
  await page.locator('video').evaluate((v) => v.remove());
  await expect(lines(page).host).toHaveCount(0, { timeout: 5000 });
});

test('another episode loaded into the same <video> gets its own lines', async () => {
  const page = await open('spa-player.html');
  const popup = await openPopupFor(session, page);
  await seek(page, 1.5);
  await expect(lines(page).en).toHaveText('Hello, Dexter.');
  void popup;

  await page.evaluate(() =>
    (window as unknown as { nextEpisodeInPlace: () => void }).nextEpisodeInPlace(),
  );
  await seek(page, 1.5);
  await expect(lines(page).en).toHaveText('I know what you did last night.', { timeout: 10_000 });
  await expect(lines(page).host).toHaveCount(1);
});

test('soak: dozens of episodes in a row leave no overlays, nodes or listeners behind', async () => {
  test.setTimeout(120_000);
  const first = await open('spa-player.html');
  const popup = await openPopupFor(session, first);
  await popup.getByTestId('auto-start').check();
  await expect.poll(registeredIds).toHaveLength(1);

  const page = await open('spa-player.html');
  const cdp = await session.context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const get = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
    return { nodes: get('Nodes'), listeners: get('JSEventListeners') };
  };
  const episode = async (n: number) => {
    await page.evaluate(() => (window as unknown as { swap: () => void }).swap());
    await expect(page.locator('video')).toHaveAttribute('data-episode', String(n));
    // The cue alternates, so a stale overlay of the removed video can never show the right line.
    await seek(page, n % 2 ? 5 : 1.5);
    await expect(lines(page).en).toHaveText(n % 2 ? 'Tonight is the night.' : 'Hello, Dexter.', {
      timeout: 8000,
    });
  };

  for (let n = 2; n <= 6; n++) await episode(n); // warm-up: caches and first-time work
  const before = await metrics();
  for (let n = 7; n <= 46; n++) await episode(n);
  const after = await metrics();

  await expect(lines(page).host).toHaveCount(1);
  expect(after.nodes - before.nodes).toBeLessThan(30);
  expect(after.listeners - before.listeners).toBeLessThan(30);
  expect(consoleErrors).toEqual([]);
});

// ---------------------------------------------------------------- mirrors: the name stays, the address changes

/** The fixture server under another name: Chrome resolves every *.localhost to this computer. */
const asHost = (host: string, path: string) =>
  server.origin.replace('//localhost', `//${host}`) + path;

async function openAt(url: string): Promise<Page> {
  const page = await session.context.newPage();
  await page.goto(`${url}?test=${++counter}`);
  return page;
}

test('a mirror of a known site is recognised by its name and the subtitles start by themselves', async () => {
  const known = await openAt(asHost('ga.lordfilm5.localhost', '/shadow-video.html'));
  const panel = await openPopupFor(session, known);
  await expect(panel.getByTestId('status')).toHaveText('Субтитры найдены');
  await panel.getByTestId('auto-start').check();
  await panel.getByTestId('mirrors').check();
  await expect.poll(allMatches).toContain('http://*.localhost/*');

  // Another address, the same name: no popup, no click.
  const mirror = await openAt(asHost('new-lordfilm.localhost', '/shadow-video.html'));
  await seek(mirror, 1.5);
  await expect(lines(mirror).en).toHaveText('Hello, Dexter.');
  // The chip tells that the subtitles are ready (and then, at once, that the translation is).
  await expect(mirror.locator('double-sub-notice .chip')).toHaveText(
    /Субтитры готовы|Перевод на русский готов/,
  );
});

test('a site with another name is left alone', async () => {
  const known = await openAt(asHost('ga.lordfilm5.localhost', '/shadow-video.html'));
  const panel = await openPopupFor(session, known);
  await panel.getByTestId('auto-start').check();
  await panel.getByTestId('mirrors').check();
  await expect.poll(allMatches).toContain('http://*.localhost/*');

  const other = await openAt(asHost('some-other-site.localhost', '/shadow-video.html'));
  await seek(other, 1.5);
  await other.waitForTimeout(3000);
  await expect(lines(other).host).toHaveCount(0);
  await expect(other.locator('double-sub-notice')).toHaveCount(0);
});

test('without the mirrors switch only the exact address starts by itself', async () => {
  const known = await openAt(asHost('ga.lordfilm5.localhost', '/shadow-video.html'));
  const panel = await openPopupFor(session, known);
  await panel.getByTestId('auto-start').check();
  await expect.poll(allMatches).toContain('http://ga.lordfilm5.localhost/*');
  expect(await allMatches()).not.toContain('http://*.localhost/*');

  const mirror = await openAt(asHost('new-lordfilm.localhost', '/shadow-video.html'));
  await seek(mirror, 1.5);
  await mirror.waitForTimeout(3000);
  await expect(lines(mirror).host).toHaveCount(0);
});

test('the switch for mirrors can be turned off again', async () => {
  const known = await openAt(asHost('ga.lordfilm5.localhost', '/shadow-video.html'));
  const panel = await openPopupFor(session, known);
  await panel.getByTestId('auto-start').check();
  await panel.getByTestId('mirrors').check();
  await expect.poll(allMatches).toContain('http://*.localhost/*');
  await panel.getByTestId('mirrors').uncheck();
  await expect.poll(allMatches).not.toContain('http://*.localhost/*');
});

test('an ad first, the film later: the chip waits, then the subtitles come by themselves', async () => {
  const page = await open('ad-then-film.html');
  const popup = await openPopupFor(session, page);
  await popup
    .getByTestId('auto-start')
    .check()
    .catch(() => {});
  await expect(page.locator('double-sub-notice .text')).toHaveText(
    'Жду начала видео · ищу субтитры',
    { timeout: 10_000 },
  );
  await expect(lines(page).host).toHaveCount(0);

  await page.evaluate(() => (window as unknown as { startFilm: () => void }).startFilm());
  await seek(page, 1.5);
  await expect(lines(page).en).toHaveText('Hello, Dexter.', { timeout: 10_000 });
  await expect(page.locator('double-sub-notice .text')).toHaveText('Субтитры готовы · EN + RU');
  await expect(lines(page).host).toHaveCount(1);
});
