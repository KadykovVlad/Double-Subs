import { expect, test, type Page } from '@playwright/test';
import {
  collectReports,
  launchWithExtension,
  openPopupFor,
  type ExtensionSession,
} from './extension';
import { startFixtureServer, type FixtureServer } from './server';

/**
 * Stage 5 on a fake YouTube page (tests/e2e/fixtures/fake-youtube.html). Like YouTube, the fake
 * /api/timedtext returns an empty body unless the request carries the player's `pot` token, so these
 * tests only pass if the extension reuses the token from the player's own request.
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

test.afterEach(async () => {
  await Promise.all(session.context.pages().map((page) => page.close()));
});

async function openVideo(videoId: string) {
  const page = await session.context.newPage();
  const reports = collectReports(page);
  await page.goto(`${server.origin}/fake-youtube.html?v=${videoId}&test=${++counter}`);
  return { page, reports };
}

const ccPressed = (page: Page) =>
  page.locator('.ytp-subtitles-button').getAttribute('aria-pressed');
const ccRequests = (page: Page) =>
  page.evaluate(() => (window as { ccRequests?: number }).ccRequests ?? 0);

test('subtitles in English and Russian: both are shown as they are (case A)', async () => {
  const { page, reports } = await openVideo('BOTH');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('status')).toHaveText('Субтитры найдены');
  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');

  const [report] = reports;
  expect(report!.tracks.map((t) => [t.label, t.status, t.cueCount])).toEqual([
    ['English (субтитры)', 'loaded', 3],
    ['Русский (субтитры)', 'loaded', 3],
  ]);
  expect(report!.tracks[0]!.firstCue).toEqual({ start: 1, end: 3, text: 'Hello, Dexter.' });

  // The player's own request gave the token: CC was never touched.
  expect(await ccRequests(page)).toBe(0);
  expect(await ccPressed(page)).toBe('false');
});

test('only automatic English subtitles: Russian comes from YouTube translation', async () => {
  const { page, reports } = await openVideo('ASR');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  const [en, ru] = reports[0]!.tracks;
  expect(en).toMatchObject({
    label: 'English (auto-generated) (автосубтитры)',
    status: 'loaded',
    cueCount: 3,
  });
  // Word segments assembled into lines; the rolling line ends where the next one starts.
  expect(en!.firstCue).toEqual({ start: 1, end: 4, text: 'hello dexter' });
  expect(ru).toMatchObject({
    label: 'English (auto-generated) (автоперевод YouTube → ru)',
    status: 'loaded',
  });
  expect(ru!.firstCue!.text).toBe('Привет, Декстер.');
});

test('also captures a player that requests subtitles with fetch instead of XMLHttpRequest', async () => {
  const { page, reports } = await openVideo('BOTH&transport=fetch');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  expect(reports[0]!.tracks.map((t) => t.status)).toEqual(['loaded', 'loaded']);
});

test('a video without subtitles: case C, and CC is not touched', async () => {
  const { page, reports } = await openVideo('NONE');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'C');
  expect(reports[0]!.tracks).toEqual([]);
  expect(await ccRequests(page)).toBe(0);
});

test('when the user has turned subtitles on, their request is used: CC is not pressed again and stays on', async () => {
  const { page, reports } = await openVideo('BOTH');
  await page.locator('.ytp-subtitles-button').click();
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  expect(reports[0]!.tracks.map((t) => t.status)).toEqual(['loaded', 'loaded']);
  expect(await ccRequests(page)).toBe(1); // only the user's own press
  expect(await ccPressed(page)).toBe('true');
});

test("another extension's subtitle request without the token is not taken for the player's", async () => {
  const { page, reports } = await openVideo('BOTH&foreign=1');
  const warnings: string[] = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  await page.waitForTimeout(300); // the foreign request has been seen
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  expect(reports[0]!.tracks.map((t) => t.status)).toEqual(['loaded', 'loaded']);
  expect(await ccRequests(page)).toBe(0); // the player's own request gave the token, CC untouched
  // Straight away, not by the fallback that drops a template giving nothing.
  expect(warnings.filter((text) => text.includes('пустой ответ'))).toEqual([]);
});

test("YouTube's 503 is tried again and the subtitles still come", async () => {
  const { page, reports } = await openVideo('BOTH&flaky=2');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  expect(reports.at(-1)!.tracks.map((t) => t.status)).toEqual(['loaded', 'loaded']);
});

test("the player's first request without the token is used: CC is not touched", async () => {
  const { page } = await openVideo('BOTH&early=1');
  await page.waitForTimeout(300);
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  expect(await ccRequests(page)).toBe(0);
});

test('a player that requests nothing until CC is pressed: CC is pressed once and put back', async () => {
  const { page, reports } = await openVideo('BOTH&silent=1');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A', {
    timeout: 10_000,
  });
  expect(reports.at(-1)!.tracks.map((t) => t.status)).toEqual(['loaded', 'loaded']);
  expect(await ccRequests(page)).toBe(1);
  expect(await ccPressed(page)).toBe('false');
});

test('when YouTube gives nothing at all, the user is told to switch other subtitle extensions off', async () => {
  const { page } = await openVideo('BOTH&dead=1');
  const popup = await openPopupFor(session, page);

  // First a promise, since the player's request usually comes a moment later…
  await expect(page.locator('double-sub-notice .text')).toHaveText('Загружаю субтитры YouTube…');
  // …and the advice only when every try is spent.
  await expect(page.locator('double-sub-notice .text')).toHaveText(
    'YouTube не отдал субтитры · отключите другие расширения',
    { timeout: 20_000 },
  );
  await expect(popup.getByTestId('decision')).toHaveText(
    'YouTube не отдал субтитры. Отключите другие расширения для субтитров и обновите страницу.',
  );
});
