import { expect, test } from '@playwright/test';
import {
  collectReports,
  launchWithExtension,
  openPanelTab,
  openPopupFor,
  type ExtensionSession,
} from './extension';
import { startFixtureServer, type FixtureServer } from './server';

let session: ExtensionSession;
let servers: FixtureServer[] = [];
let pageOrigin: string;

test.beforeAll(async () => {
  // Same host, another port: cross-origin, but covered by the e2e build's localhost access.
  const player = await startFixtureServer('localhost');
  // Another host: the extension has no access to it at all, like a real embedded player.
  const foreign = await startFixtureServer('127.0.0.1');
  const page = await startFixtureServer('localhost', {
    IFRAME_ORIGIN: player.origin,
    FOREIGN_ORIGIN: foreign.origin,
  });
  servers = [player, foreign, page];
  pageOrigin = page.origin;
  session = await launchWithExtension();
});

test.afterAll(async () => {
  await session.close();
  await Promise.all(servers.map((s) => s.close()));
});

test.afterEach(async () => {
  await Promise.all(session.context.pages().map((page) => page.close()));
});

let pageCounter = 0;

/** Every test page gets a unique URL: the popup helper finds its tab by URL. */
async function openPage(path: string) {
  const page = await session.context.newPage();
  const reports = collectReports(page);
  await page.goto(`${pageOrigin}${path}?test=${++pageCounter}`);
  return { page, reports };
}

test('player 1: finds the only player inside a cross-origin iframe and reads its four tracks', async () => {
  const { page, reports } = await openPage('/top-with-iframe.html');
  await expect(page.frameLocator('iframe').locator('video#player')).toBeAttached();

  const popup = await openPopupFor(session, page);
  await expect(popup.getByTestId('status')).toHaveText('Субтитры найдены');
  await expect(popup.getByTestId('track')).toHaveCount(4);

  // The hidden ad video next to the player was not offered as a second player.
  expect(reports).toHaveLength(1);
  const [report] = reports;
  expect(report!.frame).toMatch(/^iframe, http:\/\/localhost:/);
  expect(report!.tracks.map((t) => [t.label, t.status, t.cueCount])).toEqual([
    ['(Russian) forced', 'loaded', 1],
    ['(Russian) full', 'loaded', 3],
    ['(English) full', 'loaded', 3],
    ['(English) SDH', 'loaded', 3],
  ]);
  expect(report!.tracks.every((t) => t.mode === 'hidden')).toBe(true);

  // Language and type come from the text and the labels, not from the unreliable attributes.
  expect(report!.tracks.map((t) => [t.lang, t.type])).toEqual([
    ['unknown', 'forced'], // one Spanish line: too little text for a language
    ['ru', 'full'],
    ['en', 'full'],
    ['en', 'sdh'],
  ]);
  // Case A: English full (track 2) and Russian full (track 1); forced and SDH are left out.
  expect(report!.decision).toEqual({ case: 'A', en: 2, ru: 1, translateFrom: null });
  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  await expect(popup.getByTestId('track').nth(2)).toContainText('английская строка');
  await expect(popup.getByTestId('track').nth(1)).toContainText('русская строка');

  // The subtitle file the player fetched before we were injected is visible to us.
  await openPanelTab(popup, 'settings');
  await expect(popup.getByTestId('diag-subs')).toContainText('en-full.vtt');
});

test('player 2: a single forced track without kind and srclang', async () => {
  const { page, reports } = await openPage('/player-single-forced.html');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('status')).toHaveText('Подходящих субтитров нет');
  // Only a forced track: case C, nothing to show or translate.
  expect(reports[0]!.decision).toEqual({ case: 'C', en: null, ru: null, translateFrom: null });
  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'C');
  expect(reports[0]!.tracks).toEqual([
    expect.objectContaining({
      label: 'Рус. форсированные - 1',
      kind: 'subtitles',
      status: 'loaded',
      cueCount: 1,
    }),
  ]);
});

test('a player embedded from a site without access: asks for that origin only', async () => {
  const { page } = await openPage('/top-with-foreign-iframe.html');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('status')).toHaveText('Нужен доступ к плееру.');
  // One button for the player; the 1×1 tracking iframe from the same origin is not a player.
  await expect(popup.getByTestId('grant')).toHaveCount(1);
  await expect(popup.getByTestId('grant')).toHaveText(/^Разрешить 127\.0\.0\.1:\d+$/);
});

test('several videos: pick mode, the click selects one and closes pick mode', async () => {
  const { page, reports } = await openPage('/two-videos.html');
  const popup = await openPopupFor(session, page);

  // Two visible videos; the hidden one is ignored.
  await expect(popup.getByTestId('status')).toHaveText(
    'Найдено видео: 2. Выберите плеер на странице.',
  );

  await page.bringToFront();
  // The real popup closes itself in pick mode, so the page explains what to do.
  await expect(page.locator('double-sub-picker .hint')).toContainText('кликните по нужному видео');
  const boxes = page.locator('double-sub-picker [data-ds-pick]');
  await expect(boxes).toHaveCount(2);
  await boxes.nth(1).click();

  await expect.poll(() => reports.length).toBe(1);
  expect(reports[0]!.tracks[0]).toMatchObject({ label: 'Video B', status: 'loaded', cueCount: 3 });
  await expect(page.locator('double-sub-picker')).toHaveCount(0);
  // The open popup refreshes to the selection instead of starting pick mode again.
  await expect(popup.getByTestId('status')).toHaveText('Субтитры найдены');
  await expect(popup.getByTestId('track')).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(page.locator('double-sub-picker')).toHaveCount(0);
});

test('Esc on the page leaves pick mode', async () => {
  const { page } = await openPage('/two-videos.html');
  const popup = await openPopupFor(session, page);
  await expect(popup.getByTestId('status')).toContainText('Выберите плеер');

  await page.bringToFront();
  await expect(page.locator('double-sub-picker')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('double-sub-picker')).toHaveCount(0);
});

test('reopening the popup shows the earlier selection instead of selecting again', async () => {
  const { page, reports } = await openPage('/player-single-forced.html');
  const first = await openPopupFor(session, page);
  await expect(first.getByTestId('status')).toHaveText('Подходящих субтитров нет');
  await first.close();
  expect(reports).toHaveLength(1);

  const popup = await openPopupFor(session, page);
  await expect(popup.getByTestId('status')).toHaveText('Подходящих субтитров нет');
  await expect(popup.getByTestId('track')).toHaveCount(1);
  expect(reports).toHaveLength(1); // no second selection
});

test('finds a video inside an open shadow root', async () => {
  const { page, reports } = await openPage('/shadow-video.html');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('status')).toHaveText('Субтитры найдены');
  expect(reports[0]!.tracks[0]).toMatchObject({ label: 'English', status: 'loaded', cueCount: 3 });
  // A lone English track: case B, the Russian line has to be translated.
  expect(reports[0]!.decision).toEqual({ case: 'B', en: 0, ru: null, translateFrom: 'en' });
  await expect(popup.getByTestId('decision')).toContainText('русские переведём');
});

test('a page without video offers to search again or reload', async () => {
  const { page } = await openPage('/index.html');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('status')).toHaveText('Видео на странице не найдено.');
  await expect(
    popup.getByRole('button', { name: 'Перезагрузить страницу и поискать с начала' }),
  ).toBeVisible();
});

test('a player from another site: both the page and the player are offered, and both are remembered', async () => {
  const { page } = await openPage('/top-with-iframe.html');
  await expect(page.frameLocator('iframe').locator('video#player')).toBeAttached();
  const popup = await openPopupFor(session, page);
  await expect(popup.getByTestId('status')).toHaveText('Субтитры найдены');
  await expect(popup.getByTestId('remember-title')).toContainText(' и ');

  await popup.getByTestId('remember-yes').click();
  await expect(popup.getByTestId('remember-title')).toHaveCount(0);
  const known = await session.worker.evaluate(async () =>
    Object.keys(((await chrome.storage.local.get('knownSites')).knownSites ?? {}) as object),
  );
  expect(known.filter((o) => o.includes('localhost'))).toHaveLength(2);
  await session.resetStorage();
});
