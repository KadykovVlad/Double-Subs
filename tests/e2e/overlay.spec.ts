import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';
import {
  launchWithExtension,
  openPanelTab,
  openPopupFor,
  type ExtensionSession,
} from './extension';
import { startFixtureServer, type FixtureServer } from './server';

/** Stage 6: the dual-line overlay, its timing, fullscreen, settings and YouTube navigation. */
let session: ExtensionSession;
let servers: FixtureServer[] = [];
let pageOrigin: string;
let counter = 0;

test.beforeAll(async () => {
  const player = await startFixtureServer('localhost');
  const page = await startFixtureServer('localhost', { IFRAME_ORIGIN: player.origin });
  servers = [player, page];
  pageOrigin = page.origin;
  session = await launchWithExtension();
});

test.afterAll(async () => {
  await session.close();
  await Promise.all(servers.map((s) => s.close()));
});

test.afterEach(async () => {
  await Promise.all(session.context.pages().map((page) => page.close()));
  // Settings are shared by all tests through extension storage.
  await session.resetStorage();
});

async function open(path: string): Promise<Page> {
  const page = await session.context.newPage();
  const separator = path.includes('?') ? '&' : '?';
  await page.goto(`${pageOrigin}${path}${separator}test=${++counter}`);
  return page;
}

async function select(page: Page) {
  const popup = await openPopupFor(session, page);
  await expect(popup.getByTestId('status')).toHaveText('Субтитры найдены');
  return popup;
}

async function seek(video: Locator, time: number) {
  await video.evaluate(
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

const lines = (scope: Page | FrameLocator) => ({
  en: scope.locator('double-sub-overlay .en'),
  ru: scope.locator('double-sub-overlay .ru'),
  box: scope.locator('double-sub-overlay .box'),
});

test('player 1 in a cross-origin iframe: both lines follow the video time', async () => {
  const page = await open('/top-with-iframe.html');
  const frame = page.frameLocator('iframe');
  const video = frame.locator('video#player');
  await select(page);

  const { en, ru, box } = lines(frame);
  await seek(video, 1.5);
  await expect(en).toHaveText('Hello, Dexter.');
  await expect(ru).toHaveText('Привет, Декстер.');

  await seek(video, 5);
  await expect(en).toHaveText('Tonight is the night.'); // <i> markup cleaned
  await expect(ru).toHaveText('Сегодня та самая ночь.');

  await seek(video, 3.5); // between cues
  await expect(en).toBeHidden();
  await expect(ru).toBeHidden();

  // The overlay sits exactly over the video.
  const [videoBox, overlayBox] = await Promise.all([video.boundingBox(), box.boundingBox()]);
  expect(Math.abs(videoBox!.x - overlayBox!.x)).toBeLessThan(2);
  expect(Math.abs(videoBox!.width - overlayBox!.width)).toBeLessThan(2);
});

test('while the video plays, the lines change on their own', async () => {
  const page = await open('/top-with-iframe.html');
  const frame = page.frameLocator('iframe');
  const video = frame.locator('video#player');
  await select(page);
  await page.bringToFront();

  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  const { en } = lines(frame);
  await expect(en).toHaveText('Hello, Dexter.', { timeout: 5000 });
  await expect(en).toHaveText('Tonight is the night.', { timeout: 6000 });
});

test("fullscreen: the overlay moves into the player's fullscreen container", async () => {
  const page = await open('/top-with-iframe.html');
  const frame = page.frameLocator('iframe');
  const video = frame.locator('video#player');
  await select(page);
  await page.bringToFront();
  await seek(video, 1.5);

  await frame.locator('#fullscreen').click();
  await expect(frame.locator('#stage > double-sub-overlay')).toHaveCount(1);
  await expect(lines(frame).en).toHaveText('Hello, Dexter.');
  await expect(lines(frame).en).toBeVisible();

  await frame.locator('video#player').evaluate(() => document.exitFullscreen());
  await expect(frame.locator('#stage > double-sub-overlay')).toHaveCount(0);
  await expect(lines(frame).en).toBeVisible();
});

test('settings from the popup apply at once: size, position, on/off', async () => {
  const page = await open('/top-with-iframe.html');
  const frame = page.frameLocator('iframe');
  await seek(frame.locator('video#player'), 1.5);
  const popup = await select(page);
  const { en } = lines(frame);
  await expect(en).toHaveText('Hello, Dexter.');

  const fontSize = () => en.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const bottom = () => en.evaluate((el) => getComputedStyle(el.closest('.bar')!).bottom);
  const before = await fontSize();
  const bottomBefore = await bottom();

  await openPanelTab(popup, 'settings');
  await popup.getByTestId('font-bigger').click();
  await expect(popup.getByTestId('font-scale')).toHaveText(`${before + 1} px`);
  await expect.poll(fontSize).toBe(before + 1);

  await popup.getByTestId('lines-higher').click();
  await expect.poll(bottom).not.toBe(bottomBefore);

  await openPanelTab(popup, 'now');
  await popup.getByTestId('toggle-overlay').uncheck();
  await expect(en).toBeHidden();
  await popup.getByTestId('toggle-overlay').check();
  await expect(en).toBeVisible();
});

test('case B (English only): the second line is translated; the native "showing" track is switched to hidden', async () => {
  const page = await open('/shadow-video.html');
  const video = page.locator('#host video');
  // The site shows its own subtitles natively.
  await video.evaluate((v: HTMLVideoElement) => (v.textTracks[0]!.mode = 'showing'));
  await seek(video, 1.5);
  await select(page);

  const { en, ru } = lines(page);
  await expect(en).toHaveText('Hello, Dexter.');
  // Translated on the device (the e2e build uses a stand-in translator); capitalised by the polish step.
  await expect(ru).toHaveText('Привет, Декстер.');
  expect(await video.evaluate((v: HTMLVideoElement) => v.textTracks[0]!.mode)).toBe('hidden');
});

test("YouTube: lines over the player, YouTube's own captions hidden, next video picked up", async () => {
  const page = await open('/fake-youtube.html?v=BOTH');
  const video = page.locator('#movie_player video');
  await seek(video, 1.5);
  await select(page);

  const { en, ru } = lines(page);
  await expect(en).toHaveText('Hello, Dexter.');
  await expect(ru).toHaveText('Привет, Декстер.');
  await expect(page.locator('.ytp-caption-window-container')).toBeHidden();

  // YouTube switches to a video with automatic subtitles only, without reloading the page.
  await page.evaluate(() =>
    (window as unknown as { navigateTo: (id: string) => void }).navigateTo('ASR'),
  );
  await seek(video, 1.5);
  await expect(en).toHaveText('hello dexter', { timeout: 10_000 });
  await expect(ru).toHaveText('Привет, Декстер.');
});

test('the round cross on the bar turns the subtitles off; the side panel shows it and turns them on', async () => {
  const page = await open('/shadow-video.html');
  const video = page.locator('#host video');
  // The site shows its own subtitles natively: ours replace them while on, and give them back when off.
  await video.evaluate((v: HTMLVideoElement) => (v.textTracks[0]!.mode = 'showing'));
  await seek(video, 1.5);
  const popup = await select(page);
  const { en } = lines(page);
  await expect(en).toHaveText('Hello, Dexter.');
  const siteTrack = () => video.evaluate((v: HTMLVideoElement) => v.textTracks[0]!.mode);
  expect(await siteTrack()).toBe('hidden');

  // The cross sits in the top-right corner of the bar.
  const close = page.locator('double-sub-overlay .close');
  const bar = await page.locator('double-sub-overlay .bar').boundingBox();
  const cross = await close.boundingBox();
  expect(cross!.x + cross!.width / 2).toBeGreaterThan(bar!.x + bar!.width - 20);
  expect(cross!.y + cross!.height / 2).toBeLessThan(bar!.y + 20);

  await en.hover(); // the bar is under the pointer, as for a real click
  await close.click();
  await expect(en).toBeHidden();
  await expect.poll(siteTrack).toBe('showing'); // the site's own subtitles are back
  await expect(popup.getByTestId('toggle-overlay')).not.toBeChecked();

  // Our round button stays at the bottom of the player and brings the subtitles back.
  const restore = page.locator('double-sub-overlay .restore');
  await expect(restore).toBeVisible();
  await expect(restore).toHaveAttribute('title', 'Показать субтитры');
  await restore.click();
  await expect(en).toBeVisible();
  await expect(restore).toBeHidden();
  await expect.poll(siteTrack).toBe('hidden');
  await expect(popup.getByTestId('toggle-overlay')).toBeChecked();

  // And the switch in the panel does the same.
  await en.hover();
  await close.click();
  await expect(en).toBeHidden();
  await popup.getByTestId('toggle-overlay').check();
  await expect(en).toBeVisible();
  await expect.poll(siteTrack).toBe('hidden');
});

test('the language of the interface is chosen in the panel, in the page too', async () => {
  const page = await open('/shadow-video.html');
  await seek(page.locator('#host video'), 1.5);
  const popup = await select(page);
  await expect(lines(page).en).toHaveText('Hello, Dexter.');
  const picker = popup.getByTestId('ui-language');
  await expect(picker).toHaveValue('ru');
  await picker.selectOption('en');
  await expect(popup.getByTestId('tab-settings')).toHaveText('Settings');
  await expect(popup.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('double-sub-overlay .close')).toHaveAttribute(
    'title',
    'Turn off the subtitles',
  );
  await picker.selectOption('ar');
  await expect(popup.locator('html')).toHaveAttribute('dir', 'rtl');
  await picker.selectOption('ru');
  await expect(popup.getByTestId('tab-settings')).toHaveText('Настройки');
});
