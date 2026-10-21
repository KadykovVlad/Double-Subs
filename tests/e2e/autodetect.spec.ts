import { expect, test, type Page } from '@playwright/test';
import {
  launchWithExtension,
  openPanelTab,
  openPopupFor,
  type ExtensionSession,
} from './extension';
import { startFixtureServer, type FixtureServer } from './server';

/**
 * Full automatic detection: with the access to all sites allowed (the switch "start by itself on every
 * site") the subtitles start on any page with a video, without a ticked site and without the panel,
 * and follow the player when it is replaced or reloaded while the page stays.
 */
let session: ExtensionSession;
let server: FixtureServer;
let counter = 0;

test.beforeAll(async () => {
  server = await startFixtureServer('localhost');
  session = await launchWithExtension();
});

test.afterAll(async () => {
  await session.close();
  await server.close();
});

test.beforeEach(async () => {
  // The user allowed all sites on the welcome page (the test build holds the access in its manifest).
  await session.worker.evaluate(() => chrome.storage.local.set({ mirrorsMode: true }));
  await expect
    .poll(() =>
      session.worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).flatMap((s) => s.matches ?? []),
      ),
    )
    .toContain('http://*.localhost/*');
});

test.afterEach(async () => {
  await Promise.all(session.context.pages().map((page) => page.close()));
  await session.resetStorage();
});

const overlay = (scope: Page | ReturnType<Page['frameLocator']>) =>
  scope.locator('double-sub-overlay');
const lineOf = (scope: Page | ReturnType<Page['frameLocator']>) =>
  scope.locator('double-sub-overlay .en');

async function open(path: string): Promise<Page> {
  const page = await session.context.newPage();
  await page.goto(`${server.origin}/${path}?test=${++counter}`);
  return page;
}

const seekAll = (page: Page, time: number) =>
  Promise.all(
    page.frames().map((frame) =>
      frame
        .locator('video')
        .evaluateAll(
          (videos: HTMLVideoElement[], t: number) =>
            Promise.all(
              videos.map(
                (v) =>
                  new Promise<void>((resolve) => {
                    const go = () => {
                      v.addEventListener('seeked', () => resolve(), { once: true });
                      v.currentTime = t;
                    };
                    if (v.readyState >= 1) go();
                    else v.addEventListener('loadedmetadata', go, { once: true });
                  }),
              ),
            ),
          time,
        )
        .catch(() => {}),
    ),
  );

test('a site that was never ticked starts by itself, with no panel and no click', async () => {
  const page = await open('spa-player.html');
  await seekAll(page, 1.5);
  await expect(lineOf(page)).toHaveText('Hello, Dexter.');
});

test('the next episode in the very same <video> (a new source) is picked up by itself', async () => {
  const page = await open('spa-player.html');
  await seekAll(page, 1.5);
  await expect(lineOf(page)).toHaveText('Hello, Dexter.');

  await page.evaluate(() =>
    (window as unknown as { nextEpisodeInPlace: () => void }).nextEpisodeInPlace(),
  );
  await seekAll(page, 1.5);
  await expect(lineOf(page)).toHaveText('I know what you did last night.', { timeout: 10_000 });
  await expect(overlay(page)).toHaveCount(1);
});

test('the player is made again several times: the lines follow it each time, one overlay', async () => {
  const page = await open('spa-player.html');
  await seekAll(page, 1.5);
  await expect(lineOf(page)).toHaveText('Hello, Dexter.');
  for (let episode = 2; episode <= 4; episode++) {
    await page.evaluate(() => (window as unknown as { swap: () => void }).swap());
    await expect(page.locator('video')).toHaveAttribute('data-episode', String(episode));
    await seekAll(page, 5);
    await expect(lineOf(page)).toHaveText('Tonight is the night.', { timeout: 8000 });
    await expect(overlay(page)).toHaveCount(1);
  }
});

test('the old element stays in the page, hidden, and a new player is shown: the new one is taken', async () => {
  const page = await open('hidden-old-player.html');
  await seekAll(page, 1.5);
  await expect(lineOf(page)).toHaveText('Hello, Dexter.');

  await page.evaluate(() => (window as unknown as { mountSecond: () => void }).mountSecond());
  await seekAll(page, 1.5);
  // The lines of the new player's own track, on the new element.
  await expect(lineOf(page)).toHaveText('I know what you did last night.', { timeout: 10_000 });
  await expect(overlay(page)).toHaveCount(1);
});

test('a player in a shadow root that is replaced is found again', async () => {
  const page = await open('shadow-video.html');
  await seekAll(page, 1.5);
  await expect(lineOf(page)).toHaveText('Hello, Dexter.');

  await page.evaluate(() => {
    const root = document.getElementById('host')!.shadowRoot!;
    root.innerHTML =
      '<video crossorigin="anonymous" src="clip.webm" width="480" height="270">' +
      '<track kind="subtitles" label="English" srclang="en" src="en-slow.vtt"></video>';
  });
  await seekAll(page, 1.5);
  await expect(lineOf(page)).toHaveText('I know what you did last night.', { timeout: 10_000 });
  await expect(overlay(page)).toHaveCount(1);
});

test('the player frame gets a new address (the next episode) while the page stays: the new document starts by itself', async () => {
  const page = await open('iframe-host.html');
  const frame = () => page.frameLocator('#player');
  await seekAll(page, 1.5);
  await expect(lineOf(frame())).toHaveText('Hello, Dexter.');

  await page.evaluate(() =>
    (window as unknown as { nextEpisode: (n: number) => void }).nextEpisode(2),
  );
  await expect.poll(() => page.frames().some((f) => f.url().includes('ep=2'))).toBe(true);
  await seekAll(page, 1.5);
  await expect(lineOf(frame())).toHaveText('Hello, Dexter.', { timeout: 10_000 });
  await expect(overlay(frame())).toHaveCount(1);
});

test('the player frame reloads its own document in place: it starts by itself again', async () => {
  const page = await open('iframe-host.html');
  const frame = () => page.frameLocator('#player');
  await seekAll(page, 1.5);
  await expect(lineOf(frame())).toHaveText('Hello, Dexter.');

  await page.evaluate(() => (window as unknown as { reloadPlayer: () => void }).reloadPlayer());
  await page.waitForTimeout(500);
  await seekAll(page, 1.5);
  await expect(lineOf(frame())).toHaveText('Hello, Dexter.', { timeout: 10_000 });
  await expect(overlay(frame())).toHaveCount(1);
});

test('a player in a frame made by a script (srcdoc) is found too', async () => {
  const page = await open('srcdoc-host.html');
  await page.evaluate(() => (window as unknown as { mountFrame: () => void }).mountFrame());
  await seekAll(page, 1.5);
  await expect(lineOf(page.frameLocator('#player'))).toHaveText('Hello, Dexter.', {
    timeout: 10_000,
  });
});

test('a site the user switched off is left alone, and works again when switched on', async () => {
  await session.worker.evaluate(() => chrome.storage.local.set({ excludedSites: ['localhost'] }));
  const off = await open('spa-player.html');
  await seekAll(off, 1.5);
  await off.waitForTimeout(3000); // longer than the agent's check interval
  await expect(overlay(off)).toHaveCount(0);

  await session.worker.evaluate(() => chrome.storage.local.set({ excludedSites: [] }));
  const on = await open('spa-player.html');
  await seekAll(on, 1.5);
  await expect(lineOf(on)).toHaveText('Hello, Dexter.');
});

test('the "Work on this site" switch of the panel: off takes the lines away and lists the site; on brings them back', async () => {
  const page = await open('spa-player.html');
  await seekAll(page, 1.5);
  await expect(lineOf(page)).toHaveText('Hello, Dexter.');

  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('site-on')).toBeChecked();
  await panel.getByTestId('site-on').uncheck();
  await expect(overlay(page)).toHaveCount(0);

  await openPanelTab(panel, 'settings');
  await expect(panel.getByTestId('switched-off-site')).toHaveText('localhost');
  await panel.getByTestId('include-site').click();
  await expect(panel.getByTestId('switched-off-site')).toHaveCount(0);
  const excluded = await session.worker.evaluate(
    async () => (await chrome.storage.local.get('excludedSites')).excludedSites,
  );
  expect(excluded).toEqual([]);
});
