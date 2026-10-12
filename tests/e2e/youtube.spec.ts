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
  await session.resetStorage(); // a known site or a setting of one test must not reach the next
});

interface Timing {
  step: string;
  t: number;
  [key: string]: unknown;
}

async function openVideo(videoId: string) {
  const page = await session.context.newPage();
  const reports = collectReports(page);
  const timings: Timing[] = [];
  const logs: string[] = []; // every line of Double Sub, in order
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith('[Double Sub]')) logs.push(text);
    if (text.startsWith(TIMING)) timings.push(JSON.parse(text.slice(TIMING.length)) as Timing);
  });
  // The languages of every subtitle request on the page, the player's and ours.
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/timedtext') requests.push(url.searchParams.get('lang')!);
  });
  await page.goto(`${server.origin}/fake-youtube.html?v=${videoId}&test=${++counter}`);
  return { page, reports, timings, requests, logs };
}

const TIMING = '[Double Sub] YouTube timing';

const ccPressed = (page: Page) =>
  page.locator('.ytp-subtitles-button').getAttribute('aria-pressed');
const ccRequests = (page: Page) =>
  page.evaluate(() => (window as { ccRequests?: number }).ccRequests ?? 0);
/** Every click on CC, ours or anyone's. */
const ccClicks = (page: Page) => page.evaluate(() => (window as { ccClicks?: number }).ccClicks);
/** Changes of the page that left YouTube's own captions visible once Double Sub was reading the player. */
const nativeSeen = (page: Page) =>
  page.evaluate(() => (window as { nativeSeen?: number }).nativeSeen);
const nativeCaptions = (page: Page) => page.locator('.ytp-caption-window-container');
const ccButton = (page: Page) => page.locator('.ytp-subtitles-button');
/** The fake YouTube becomes a site where Double Sub starts by itself, as YouTube is for the user. */
const makeKnown = () =>
  session.worker.evaluate(
    (origin) =>
      chrome.storage.local.set({
        knownSites: { [origin]: { origin, addedAt: 0, lastUsed: 0, preferredIndex: null } },
      }),
    server.origin,
  );
const navigateTo = (page: Page, id: string, ms?: number) =>
  page.evaluate(
    ([id, ms]) =>
      (window as unknown as { navigateTo: (id: string, ms?: number) => void }).navigateTo(id, ms),
    [id, ms] as const,
  );

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

test('a player that requests nothing while CC is off: CC is turned on once and left on, its captions never show', async () => {
  const { page, reports } = await openVideo('BOTH&silent=1');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  expect(reports.at(-1)!.tracks.map((t) => t.status)).toEqual(['loaded', 'loaded']);
  expect(await ccClicks(page)).toBe(1);
  expect(await ccPressed(page)).toBe('true');
  await expect(nativeCaptions(page)).toBeHidden();
  expect(await nativeSeen(page)).toBe(0);

  // The next video in the same page: CC is already on, nothing is pressed again.
  await navigateTo(page, 'ASR');
  await expect
    .poll(() => reports.at(-1)?.tracks.map((t) => [t.label, t.status]))
    .toEqual([
      ['English (auto-generated) (автосубтитры)', 'loaded'],
      ['English (auto-generated) (автоперевод YouTube → ru)', 'loaded'],
    ]);
  expect(await ccClicks(page)).toBe(1);
  expect(await ccPressed(page)).toBe('true');
  expect(await nativeSeen(page)).toBe(0);
});

test("CC on by the user's YouTube setting: it stays on, its captions never show, the player's own answer is used", async () => {
  const { page, reports, timings, requests } = await openVideo('BOTH&autocc=1&silent=1');
  await expect(nativeCaptions(page)).toBeVisible(); // before Double Sub, YouTube shows its own
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  expect(reports.at(-1)!.tracks.map((t) => [t.status, t.cueCount])).toEqual([
    ['loaded', 3],
    ['loaded', 3],
  ]);
  expect(await ccClicks(page)).toBe(0);
  expect(await ccPressed(page)).toBe('true');
  await expect(nativeCaptions(page)).toBeHidden();
  expect(await nativeSeen(page)).toBe(0);

  // English came in the player's own answer and was not requested again; Russian with its token.
  const handed = timings.filter((t) => t.step === 'handed-over');
  expect(handed.map((t) => t.lines)).toEqual([
    [
      { lang: 'en||', cues: 3, fromPlayer: true },
      { lang: 'ru||', cues: 3, fromPlayer: false },
    ],
  ]);
  expect(timings.map((t) => t.step)).toEqual(['first-request', 'first-answer', 'handed-over']);
  expect(requests.sort()).toEqual(['en', 'ru']); // the player's English, our Russian: nothing twice
  console.log('timing on the fake YouTube:', JSON.stringify(timings));
});

test("turning our subtitles off does not bring YouTube's own back, and CC is left alone", async () => {
  const { page } = await openVideo('BOTH&autocc=1');
  const popup = await openPopupFor(session, page);
  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  await expect(nativeCaptions(page)).toBeHidden();
  await expect(ccButton(page)).toBeHidden();

  await popup.getByTestId('toggle-overlay').uncheck();
  await expect(page.locator('double-sub-overlay .en')).toBeHidden();
  await page.waitForTimeout(300);
  await expect(nativeCaptions(page)).toBeHidden();
  await expect(ccButton(page)).toBeHidden();
  expect(await nativeSeen(page)).toBe(0);
  await popup.getByTestId('toggle-overlay').check();
  await expect(nativeCaptions(page)).toBeHidden();
  await expect(ccButton(page)).toBeHidden();
  expect(await ccClicks(page)).toBe(0);
  expect(await ccPressed(page)).toBe('true');
});

test("our switch takes the CC button's place, and it, the panel and the cross follow each other", async () => {
  const { page } = await openVideo('BOTH&autocc=1');
  const popup = await openPopupFor(session, page);
  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  await page
    .locator('#movie_player video')
    .evaluate((v: HTMLVideoElement) => (v.currentTime = 1.5));
  const toggle = page.getByTestId('yt-toggle');
  const en = page.locator('double-sub-overlay .en');
  const panelSwitch = popup.getByTestId('toggle-overlay');

  // Right where the hidden CC button is, and on.
  await expect(toggle).toBeVisible();
  expect(await toggle.evaluate((el) => el.previousElementSibling?.className)).toBe(
    'ytp-subtitles-button',
  );
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('title', 'Выключить субтитры');
  await expect(en).toHaveText('Hello, Dexter.');
  // On: the icon is filled, a white box with black lines.
  const look = () =>
    toggle.evaluate((el) => ({
      box: getComputedStyle(el.querySelector('rect')!).fill,
      lines: getComputedStyle(el.querySelector('path')!).stroke,
    }));
  expect(await look()).toEqual({ box: 'rgb(255, 255, 255)', lines: 'rgb(0, 0, 0)' });

  // Our switch turns ours off: the panel follows; on YouTube there is no round button on the video.
  await toggle.click();
  await expect(en).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveAttribute('title', 'Показать субтитры');
  expect((await look()).box).toBe('none'); // off: only the outline, as before
  await expect(panelSwitch).not.toBeChecked();
  await expect(page.locator('double-sub-overlay .restore')).toBeHidden();
  await expect(nativeCaptions(page)).toBeHidden();

  // The panel turns them on: our switch follows.
  await panelSwitch.check();
  await expect(en).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  // The cross on the bar turns them off: both follow.
  await en.hover();
  await page.locator('double-sub-overlay .close').click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(panelSwitch).not.toBeChecked();
  await toggle.click();
  await expect(en).toBeVisible();
  await expect(panelSwitch).toBeChecked();
  expect(await ccClicks(page)).toBe(0);
});

test('another video while the first one is still loading: only the new one is shown', async () => {
  // The first video's request never comes in time; YouTube switches to another one meanwhile.
  const { page, reports } = await openVideo('BOTH&autocc=1&late=60000');
  await openPopupFor(session, page);
  await page.waitForFunction(() => (window as { dsReading?: boolean }).dsReading === true);
  const before = reports.length;
  await navigateTo(page, 'ASR', 100);

  const asr = [
    ['English (auto-generated) (автосубтитры)', 'loaded'],
    ['English (auto-generated) (автоперевод YouTube → ru)', 'loaded'],
  ];
  await expect.poll(() => reports.at(-1)?.tracks.map((t) => [t.label, t.status])).toEqual(asr);
  // The old video's look ends later, with nothing: it is thrown away, not reported or shown.
  await page.waitForTimeout(2000);
  expect(reports.slice(before).map((r) => r.tracks.map((t) => [t.label, t.status]))).toEqual([asr]);
  expect(await ccClicks(page)).toBe(0);
  expect(await nativeSeen(page)).toBe(0);
});

test('a site that starts by itself, CC off: CC is turned on at once, its button and captions never show', async () => {
  await makeKnown();
  const { page, reports, timings, logs } = await openVideo('BOTH&silent=1');

  // No popup: Double Sub starts by itself, as on YouTube.
  await expect
    .poll(() => reports.at(-1)?.tracks.map((t) => [t.status, t.cueCount]))
    .toEqual([
      ['loaded', 3],
      ['loaded', 3],
    ]);
  expect(await ccClicks(page)).toBe(1);
  expect(await ccPressed(page)).toBe('true');
  await expect(ccButton(page)).toBeHidden();
  await expect(nativeCaptions(page)).toBeHidden();
  expect(await nativeSeen(page)).toBe(0);

  // CC went on before the agent came, and the lines were read before it asked for them.
  const steps = timings.map((t) => t.step);
  expect(steps.slice(0, 4)).toEqual(['cc-on', 'first-request', 'first-answer', 'handed-over']);
  const index = (part: string) => logs.findIndex((line) => line.includes(part));
  expect(index('"step":"cc-on"')).toBeGreaterThanOrEqual(0);
  expect(index('"step":"cc-on"')).toBeLessThan(index('agent ready'));
  console.log('early start on the fake YouTube:', JSON.stringify(timings));
});

test('a player not ready for the first click, slow to show CC on: clicked again only until it asks, never turned off', async () => {
  await makeKnown();
  const { page, reports } = await openVideo('BOTH&silent=1&coldcc=200&lagaria=500');

  await expect
    .poll(() => reports.at(-1)?.tracks.map((t) => t.status))
    .toEqual(['loaded', 'loaded']);
  await page.waitForTimeout(1000); // longer than the button's lag and a few of our looks
  expect(await ccPressed(page)).toBe('true');
  expect(await ccRequests(page)).toBe(1);
  expect(await nativeSeen(page)).toBe(0);
});

test('the player asked but YouTube gave it nothing: CC is not clicked again (it would go off)', async () => {
  await makeKnown();
  const { page } = await openVideo('BOTH&silent=1&coldcc=200&lagaria=500&stale=1');

  await expect.poll(() => ccRequests(page)).toBe(1);
  await page.waitForTimeout(2500); // all our looks, and the agent's
  expect(await ccPressed(page)).toBe('true');
  expect(await ccRequests(page)).toBe(1);
  expect(await ccClicks(page)).toBeLessThanOrEqual(2); // the lost one and the one that worked
});

test('a site that starts by itself, with our subtitles off: CC is not touched, YouTube shows nothing either', async () => {
  await makeKnown();
  await session.worker.evaluate(() => chrome.storage.local.set({ settings: { enabled: false } }));
  const { page } = await openVideo('BOTH&autocc=1');

  await page.waitForTimeout(1500);
  expect(await ccClicks(page)).toBe(0);
  await expect(ccButton(page)).toBeHidden();
  await expect(nativeCaptions(page)).toBeHidden();
});

test("automatic subtitles whose YouTube translation needs the player's token: waited for, not translated on the device", async () => {
  // The player's first request has no token yet (YouTube translates nothing for it); the one with the token comes later.
  const { page, reports } = await openVideo('ASR&early=1&late=800');
  const chips: string[] = [];
  const poll = setInterval(() => {
    void page
      .locator('double-sub-notice .text')
      .textContent({ timeout: 100 })
      .then((text) => text && chips.at(-1) !== text && chips.push(text))
      .catch(() => {});
  }, 50);
  try {
    const popup = await openPopupFor(session, page);
    await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A', {
      timeout: 10_000,
    });
    expect(reports.at(-1)!.tracks.map((t) => [t.label, t.status])).toEqual([
      ['English (auto-generated) (автосубтитры)', 'loaded'],
      ['English (auto-generated) (автоперевод YouTube → ru)', 'loaded'],
    ]);
    // The chip says that subtitles are ready, not a translation stuck halfway.
    await expect(page.locator('double-sub-notice .text')).toHaveText('Субтитры готовы · EN + RU');
  } finally {
    clearInterval(poll);
  }
  expect(chips.filter((text) => /Перевожу|Перевод/.test(text))).toEqual([]);
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

// ---------------------------------------------------------------- Shorts (tests/e2e/fixtures/fake-shorts.html)

async function openShort(id: string, query = '') {
  const page = await session.context.newPage();
  const reports = collectReports(page);
  await page.goto(`${server.origin}/shorts/${id}?test=${++counter}${query}`);
  return { page, reports };
}

const clicksOn = (page: Page, counter: 'ccClicks' | 'watchCcClicks') =>
  page.evaluate((name) => (window as unknown as Record<string, number>)[name], counter);
const statuses = (reports: { tracks: { label: string; status: string }[] }[]) =>
  reports.at(-1)?.tracks.map((t) => [t.label, t.status]);
const BOTH_LOADED = [
  ['English (субтитры)', 'loaded'],
  ['Русский (субтитры)', 'loaded'],
];

test("a Short: our lines over it, its own captions and CC button hidden, our switch in the button's place", async () => {
  const { page, reports } = await openShort('BOTH');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  expect(statuses(reports)).toEqual(BOTH_LOADED);
  await page
    .locator('#shorts-player video')
    .evaluate((v: HTMLVideoElement) => (v.currentTime = 1.5));
  await expect(page.locator('double-sub-overlay .en')).toHaveText('Hello, Dexter.');
  await expect(page.locator('double-sub-overlay .ru')).toHaveText('Привет, Декстер.');

  await expect(page.locator('#shorts-player .ytp-caption-window-container')).toBeHidden();
  await expect(page.locator('ytm-closed-captioning-button button')).toBeHidden();
  const toggle = page.getByTestId('yt-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveClass(/shorts/);
  expect(await toggle.evaluate((el) => el.previousElementSibling?.tagName)).toBe(
    'YTM-CLOSED-CAPTIONING-BUTTON',
  );
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // As big as the Short's other buttons, so its icon sits in the middle of the row.
  expect(await toggle.boundingBox()).toMatchObject({ width: 48, height: 48 });

  // The chip goes to the bottom centre: YouTube's buttons are at the top of a Short.
  const [chip, video] = await Promise.all([
    page.locator('double-sub-notice .chip').boundingBox(),
    page.locator('#shorts-player video').boundingBox(),
  ]);
  expect(video!.y + video!.height - (chip!.y + chip!.height)).toBeCloseTo(12, 0);
  expect(chip!.x + chip!.width / 2).toBeCloseTo(video!.x + video!.width / 2, 0);
  // CC was on already: nothing pressed, and the hidden watch player is never touched.
  expect(await clicksOn(page, 'ccClicks')).toBe(0);
  expect(await clicksOn(page, 'watchCcClicks')).toBe(0);
});

test("a Short with CC off, on a site that starts by itself: the Short's CC is turned on once, never the watch player's", async () => {
  await makeKnown();
  const { page, reports } = await openShort('BOTH', '&cc=off');

  await expect.poll(() => statuses(reports)).toEqual(BOTH_LOADED);
  expect(await clicksOn(page, 'ccClicks')).toBe(1);
  await expect(page.locator('ytm-closed-captioning-button button')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await clicksOn(page, 'watchCcClicks')).toBe(0);
  await expect(page.locator('#shorts-player .ytp-caption-window-container')).toBeHidden();
});

test('scrolling to the next Short: its lines replace the previous ones, nothing is pressed again', async () => {
  await makeKnown();
  const { page, reports } = await openShort('BOTH');
  await expect.poll(() => statuses(reports)).toEqual(BOTH_LOADED);

  await navigateTo(page, 'ASR');
  await expect
    .poll(() => statuses(reports))
    .toEqual([
      ['English (auto-generated) (автосубтитры)', 'loaded'],
      ['English (auto-generated) (автоперевод YouTube → ru)', 'loaded'],
    ]);
  await page
    .locator('#shorts-player video')
    .evaluate((v: HTMLVideoElement) => (v.currentTime = 1.5));
  await expect(page.locator('double-sub-overlay .en')).toHaveText('hello dexter');
  expect(await clicksOn(page, 'ccClicks')).toBe(0);
  expect(await clicksOn(page, 'watchCcClicks')).toBe(0);
  await expect(page.getByTestId('yt-toggle')).toBeVisible();
});

test('from a video to Shorts without reloading: the lines move onto the Short, off the hidden player', async () => {
  await makeKnown();
  const page = await session.context.newPage();
  const reports = collectReports(page);
  await page.goto(`${server.origin}/watch?v=BOTH&test=${++counter}`);
  await expect.poll(() => statuses(reports)).toEqual(BOTH_LOADED);
  // On the watch page the chip stays where it was, at the top.
  const [watchChip, watchVideo] = await Promise.all([
    page.locator('double-sub-notice .chip').boundingBox(),
    page.locator('#movie_player video').boundingBox(),
  ]);
  expect(watchChip!.y - watchVideo!.y).toBeCloseTo(12, 0);

  await page.evaluate(() =>
    (window as unknown as { goToShorts: (id: string) => void }).goToShorts('ASR'),
  );
  await expect
    .poll(() => statuses(reports))
    .toEqual([
      ['English (auto-generated) (автосубтитры)', 'loaded'],
      ['English (auto-generated) (автоперевод YouTube → ru)', 'loaded'],
    ]);
  const short = page.locator('#shorts-player video');
  await short.evaluate((v: HTMLVideoElement) => (v.currentTime = 1.5));
  await expect(page.locator('double-sub-overlay .en')).toHaveText('hello dexter');
  // Over the Short, not over the watch player hidden in the page.
  const [bar, shortBox] = await Promise.all([
    page.locator('double-sub-overlay .bar').boundingBox(),
    short.boundingBox(),
  ]);
  expect(bar!.width).toBeGreaterThan(0);
  expect(bar!.x).toBeGreaterThanOrEqual(shortBox!.x);
  expect(bar!.x + bar!.width).toBeLessThanOrEqual(shortBox!.x + shortBox!.width);
  await expect(page.getByTestId('yt-toggle')).toHaveClass(/shorts/);
  expect(await clicksOn(page, 'ccClicks')).toBe(0);
  expect(await clicksOn(page, 'watchCcClicks')).toBe(0);
});

test("from YouTube's home page to a Short: the Short is taken, not the preview a card played", async () => {
  await makeKnown();
  const page = await session.context.newPage();
  const reports = collectReports(page);
  // The home page: a card plays its preview under the pointer, nothing else is on screen.
  await page.goto(`${server.origin}/watch?v=BOTH&home=1&test=${++counter}`);
  await page.waitForTimeout(1500); // the automatic start has had its look at the page
  await expect(page.locator('double-sub-notice')).toHaveCount(0); // the preview is not taken
  await page.evaluate(() =>
    (window as unknown as { goToShorts: (id: string) => void }).goToShorts('ASR'),
  );
  await expect
    .poll(() => statuses(reports))
    .toEqual([
      ['English (auto-generated) (автосубтитры)', 'loaded'],
      ['English (auto-generated) (автоперевод YouTube → ru)', 'loaded'],
    ]);
  // Ours in the CC button's place in the Short's controls, YouTube's CC and captions hidden.
  await expect(page.getByTestId('yt-toggle')).toHaveClass(/shorts/);
  await expect(page.locator('ytm-closed-captioning-button')).toBeHidden();
  await expect(page.locator('#shorts-player .ytp-caption-window-container')).toBeHidden();
  const short = page.locator('#shorts-player video');
  await short.evaluate((v: HTMLVideoElement) => (v.currentTime = 1.5));
  await expect(page.locator('double-sub-overlay .en')).toHaveText('hello dexter');
});

// ---------------------------------------------------------------- the languages the user chose

const chooseLanguages = (learnLang: string, nativeLang: string) =>
  session.worker.evaluate((settings) => chrome.storage.local.set({ settings }), {
    learnLang,
    nativeLang,
  });
const seekTo = (page: Page, time: number) =>
  page
    .locator('#movie_player video')
    .evaluate((v: HTMLVideoElement, t) => (v.currentTime = t), time);
const learnLine = (page: Page) => page.locator('double-sub-overlay .en');
const nativeLine = (page: Page) => page.locator('double-sub-overlay .ru');

test("another pair: English to learn and German as the own language, German from YouTube's translation", async () => {
  await chooseLanguages('en', 'de');
  const { page, reports } = await openVideo('BOTH');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  // The Russian track of the video is not wanted: German comes from YouTube's translation of the English.
  expect(reports.at(-1)!.tracks.map((t) => [t.label, t.status, t.lang])).toEqual([
    ['English (субтитры)', 'loaded', 'en'],
    ['English (автоперевод YouTube → de)', 'loaded', 'de'],
  ]);
  await seekTo(page, 1.5);
  await expect(learnLine(page)).toHaveText('Hello, Dexter.');
  await expect(nativeLine(page)).toHaveText('Hallo, Dexter.');
  await expect(nativeLine(page)).toHaveAttribute('lang', 'de');
  await expect(page.locator('double-sub-notice .text')).toHaveText('Субтитры готовы · EN + DE');
  await expect(popup.locator('.chips .chip')).toHaveText(['EN', 'DE']);
});

test("languages changed in the panel: the lines are read again at once, and choosing the other line's language swaps them", async () => {
  const { page, reports } = await openVideo('BOTH');
  const popup = await openPopupFor(session, page);
  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  await seekTo(page, 1.5);
  await expect(nativeLine(page)).toHaveText('Привет, Декстер.');

  // The choice is at the top of "Now", no need to leave it.
  await popup.getByTestId('native-lang').selectOption('de');
  await expect(nativeLine(page)).toHaveText('Hallo, Dexter.');
  await expect(learnLine(page)).toHaveText('Hello, Dexter.');

  // German to learn, which is the own language now: the two swap, English becomes the own one.
  await popup.getByTestId('learn-lang').selectOption('de');
  await expect(popup.getByTestId('native-lang')).toHaveValue('en');
  await expect(learnLine(page)).toHaveText('Hallo, Dexter.');
  await expect(nativeLine(page)).toHaveText('Hello, Dexter.');
  expect(reports.at(-1)!.tracks.map((t) => t.lang)).toEqual(['de', 'en']);
});

test("the player's first request has no token: it is asked for the track, the other line comes at once, not translated on the device", async () => {
  // A token-less first request (YouTube translates nothing for it); the request with the token would never come by itself.
  const { page, reports } = await openVideo('ASR&early=1&late=60000');
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('decision')).toHaveAttribute('data-case', 'A');
  expect(reports.at(-1)!.tracks.map((t) => [t.label, t.status])).toEqual([
    ['English (auto-generated) (автосубтитры)', 'loaded'],
    ['English (auto-generated) (автоперевод YouTube → ru)', 'loaded'],
  ]);
  // Once, for the track whose line was missing (the translation is made from it).
  expect(
    await page.evaluate(() => (window as unknown as { setOptionCalls: unknown[] }).setOptionCalls),
  ).toEqual([{ module: 'captions', option: 'track', value: { languageCode: 'en', kind: 'asr' } }]);
  await expect(page.locator('double-sub-notice .text')).toHaveText('Субтитры готовы · EN + RU');
});
