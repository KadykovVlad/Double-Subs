import { expect, test, type Page } from '@playwright/test';
import { launchWithExtension, openPopupFor, type ExtensionSession } from './extension';
import { startFixtureServer, type FixtureServer } from './server';

/** Stage 11л: TikTok's own subtitle files (tests/e2e/fixtures/fake-tiktok.html, under www.tiktok.localhost). */
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

test.afterEach(async () => {
  await Promise.all(session.context.pages().map((page) => page.close()));
  await session.resetStorage();
});

const tiktokOrigin = () => server.origin.replace('//localhost', '//www.tiktok.localhost');

/** TikTok becomes one of the user's sites (with access), as the panel does: its page-world script is registered. */
async function makeKnown() {
  const origin = tiktokOrigin();
  await session.worker.evaluate(
    (origin) =>
      chrome.storage.local.set({
        knownSites: { [origin]: { origin, addedAt: 0, lastUsed: 0, preferredIndex: null } },
      }),
    origin,
  );
  await expect
    .poll(() =>
      session.worker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id),
      ),
    )
    .toContain('ds-tiktok-main');
}

async function open(path: string): Promise<Page> {
  const page = await session.context.newPage();
  await page.goto(`${tiktokOrigin()}${path}?test=${++counter}`);
  return page;
}

/** The video at the top of the feed, at 1.5 s (where the first cue of every file is). */
const atTop = (page: Page) =>
  page.evaluate(() => {
    const video = [...document.querySelectorAll('video')].find(
      (v) => v.getBoundingClientRect().top === 0,
    )!;
    video.currentTime = 1.5;
    video.pause(); // still: the cue stays on screen
  });

const learn = (page: Page) => page.locator('double-sub-overlay .en');
const native = (page: Page) => page.locator('double-sub-overlay .ru');

test('on a TikTok site the user has, its own subtitle file is read and shown, its own captions hidden', async () => {
  await makeKnown();
  const page = await open('/foryou');
  await atTop(page);
  // The English file of the first video (no <track>, an address without an extension); Russian translated.
  await expect(learn(page)).toHaveText('Hello, Dexter.');
  await expect(native(page)).toHaveText('Привет, Декстер.');
  await expect(page.locator('.css-1x-DivVideoClosedCaption')).toBeHidden();
});

test('scrolling the feed: the next video in the other <video> gets its own lines, and one without speech none', async () => {
  await makeKnown();
  const page = await open('/foryou');
  await atTop(page);
  await expect(learn(page)).toHaveText('Hello, Dexter.');

  // The next video (Russian only), in the second <video>, from the feed answer.
  await page.evaluate(() => (window as unknown as { next: () => void }).next());
  await atTop(page);
  await expect(native(page)).toHaveText('Привет, Декстер.');
  await expect(learn(page)).toHaveText('[ru] Привет, Декстер.'); // translated on the device (the stand-in marks it)

  // The next one has no speech: no lines of the one before stay on it.
  await page.evaluate(() => (window as unknown as { next: () => void }).next());
  await atTop(page);
  await expect(page.locator('double-sub-notice .text')).toHaveText('Субтитров в плеере не найдено');
  await expect(native(page)).toBeHidden();
});

test('started from the side panel on TikTok (not one of the sites yet): the page-world script is injected and the file read', async () => {
  const page = await open('/@someone/video/1110000111');
  await openPopupFor(session, page);
  await atTop(page);
  await expect(learn(page)).toHaveText('Hello, Dexter.');
});

test('the page-world script is registered for TikTok while it is one of the sites, and goes when it is taken off', async () => {
  await makeKnown(); // waits for ds-tiktok-main
  const scripts = () =>
    session.worker.evaluate(async () =>
      (await chrome.scripting.getRegisteredContentScripts()).map((s) => ({
        id: s.id,
        matches: s.matches,
        world: s.world,
        runAt: s.runAt,
      })),
    );
  const tiktok = (await scripts()).find((s) => s.id === 'ds-tiktok-main');
  expect(tiktok).toEqual({
    id: 'ds-tiktok-main',
    matches: ['http://www.tiktok.localhost/*'],
    world: 'MAIN',
    runAt: 'document_start',
  });
  await session.worker.evaluate(() => chrome.storage.local.set({ knownSites: {} }));
  await expect.poll(async () => (await scripts()).map((s) => s.id)).not.toContain('ds-tiktok-main');
});
