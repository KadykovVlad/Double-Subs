import { expect, test, type Page } from '@playwright/test';
import {
  launchWithExtension,
  openPanelTab,
  openPopupFor,
  type ExtensionSession,
} from './extension';
import { startFixtureServer, type FixtureServer } from './server';

/** The side panel (tabs, review, history) and the chip that tells on the video what was found. */
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

async function openPage(path: string): Promise<Page> {
  const page = await session.context.newPage();
  await page.goto(`${server.origin}/${path}?test=${++counter}`);
  return page;
}

const seek = (page: Page, time: number) =>
  page.locator('video').evaluate(
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

const stored = <T>(key: string) =>
  session.worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k] as T, key);
const chip = (page: Page) => page.locator('double-sub-notice .chip');

// ---------------------------------------------------------------- the chip on the video

test('the chip on the video says that both subtitle tracks were found, then goes away', async () => {
  const page = await openPage('player-4tracks.html');
  await openPopupFor(session, page);
  await expect(chip(page)).toHaveText('Субтитры готовы · EN + RU');
  await expect(chip(page)).toBeHidden({ timeout: 9000 });
});

test('with one language the chip says which one was found and that the other is translated', async () => {
  const page = await openPage('shadow-video.html');
  await openPopupFor(session, page);
  await expect(chip(page)).toContainText('Субтитры готовы · EN, русский переведу');
  // Then it reports the translation, same place.
  await expect(chip(page)).toContainText('Перевод на русский готов');
});

test('without usable subtitles the chip says so', async () => {
  const page = await openPage('player-single-forced.html');
  await openPopupFor(session, page);
  await expect(chip(page)).toHaveText('Полных субтитров в плеере нет');
});

test('the chip does not take the mouse: the player under it stays clickable', async () => {
  const page = await openPage('player-4tracks.html');
  await openPopupFor(session, page);
  await expect(chip(page)).toBeVisible();
  const pointer = await chip(page).evaluate(
    (el) => getComputedStyle(el.closest('.box')!).pointerEvents,
  );
  expect(pointer).toBe('none');
});

// ---------------------------------------------------------------- the panel

test('the panel has four sections and moves between them', async () => {
  const page = await openPage('shadow-video.html');
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('status')).toHaveText('Субтитры найдены');

  await openPanelTab(panel, 'words');
  await expect(panel.getByTestId('saved-count')).toHaveText('Сохранённые слова (0)');
  await openPanelTab(panel, 'history');
  await expect(
    panel.getByText('История пока пуста').or(panel.getByTestId('history-list')),
  ).toBeVisible();
  await openPanelTab(panel, 'settings');
  await expect(panel.getByTestId('font-scale')).toBeVisible();
  await openPanelTab(panel, 'now');
  await expect(panel.getByTestId('decision')).toBeVisible();
  await expect(panel.getByTestId('tab-now')).toHaveAttribute('aria-selected', 'true');
});

test('a panel without a player shows what to do instead of a blank page', async () => {
  const page = await openPage('index.html');
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('status')).toBeVisible();
});

// ---------------------------------------------------------------- words: review

const seedWords = () =>
  session.worker.evaluate(() =>
    chrome.storage.local.set({
      savedWords: [
        {
          key: 'en:hello',
          word: 'Hello',
          lang: 'en',
          translation: 'привет',
          context: 'Hello, Dexter.',
          savedAt: 1,
        },
        {
          key: 'en:night',
          word: 'night',
          lang: 'en',
          translation: 'ночь',
          context: 'Tonight is the night.',
          savedAt: 2,
        },
      ],
    }),
  );

test('words are due at once, the tab says how many, and a review moves them on', async () => {
  await seedWords();
  const page = await openPage('shadow-video.html');
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('due-badge')).toHaveText('2');

  await openPanelTab(panel, 'words');
  await expect(panel.getByTestId('due-count')).toHaveText('2');
  await panel.getByTestId('start-review').click();

  await expect(panel.getByTestId('review-word')).toHaveText('Hello'); // the oldest first
  await expect(panel.getByTestId('review-progress')).toHaveText('1 из 2');
  await expect(panel.getByTestId('review-answer')).toHaveCount(0); // not before asked
  await panel.getByTestId('review-show').click();
  await expect(panel.getByTestId('review-answer')).toHaveText('привет');
  await panel.getByTestId('rate-good').click();

  await expect(panel.getByTestId('review-word')).toHaveText('night');
  await expect(panel.getByTestId('review-progress')).toHaveText('2 из 2');
  await panel.getByTestId('review-show').click();
  await panel.getByTestId('rate-again').click();

  await expect(panel.getByText('Повторение закончено')).toBeVisible();
  await panel.getByTestId('review-close').click();
  await expect(panel.getByTestId('due-count')).toHaveText('0');
  await expect(panel.getByTestId('start-review')).toBeDisabled();

  const words =
    await stored<Array<{ key: string; srs: { interval: number; due: number; lapses: number } }>>(
      'savedWords',
    );
  const hello = words.find((w) => w.key === 'en:hello')!;
  const night = words.find((w) => w.key === 'en:night')!;
  expect(hello.srs.interval).toBe(1); // "good": back in a day
  expect(night.srs.lapses).toBe(1); // "again": back in ten minutes
  expect(night.srs.due).toBeGreaterThan(Date.now());
  expect(night.srs.due).toBeLessThan(Date.now() + 11 * 60 * 1000);
});

test('the review shows the sentence of the word with the word marked', async () => {
  await seedWords();
  const page = await openPage('shadow-video.html');
  const panel = await openPopupFor(session, page);
  await openPanelTab(panel, 'words');
  await panel.getByTestId('start-review').click();
  await expect(panel.locator('.review-ctx mark')).toHaveText('Hello');
});

// ---------------------------------------------------------------- history

test('what is being watched goes to the history with its place, and can be removed', async () => {
  const page = await openPage('shadow-video.html');
  await seek(page, 5);
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('status')).toHaveText('Субтитры найдены');

  await expect.poll(async () => (await stored<unknown[]>('history'))?.length).toBe(1);
  const [entry] =
    await stored<Array<{ host: string; position: number; duration: number }>>('history');
  expect(entry!.host).toContain('localhost');
  expect(entry!.duration).toBeGreaterThan(0);
  expect(entry!.position).toBeGreaterThan(3);

  await openPanelTab(panel, 'history');
  await expect(panel.getByTestId('history-item')).toHaveCount(1);
  await expect(panel.getByTestId('history-item')).toContainText('localhost');
  await panel.getByRole('button', { name: /^Убрать/ }).click();
  await expect(panel.getByTestId('history-item')).toHaveCount(0);
});

test('with the setting off nothing is remembered', async () => {
  await session.worker.evaluate(() =>
    chrome.storage.local.set({ settings: { keepHistory: false } }),
  );
  const page = await openPage('shadow-video.html');
  await seek(page, 5);
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('status')).toHaveText('Субтитры найдены');
  await page.waitForTimeout(2500); // longer than the test build's saving interval
  expect((await stored<unknown[]>('history')) ?? []).toHaveLength(0);
});

test('"clear history" empties the list', async () => {
  const page = await openPage('shadow-video.html');
  const panel = await openPopupFor(session, page);
  await expect.poll(async () => (await stored<unknown[]>('history'))?.length).toBe(1);
  await openPanelTab(panel, 'history');
  await panel.getByTestId('clear-history').click();
  await expect(panel.getByTestId('history-item')).toHaveCount(0);
  await expect(panel.getByText('История пока пуста')).toBeVisible();
});

// ---------------------------------------------------------------- whole phrases on both lines

const FULL_EN =
  'But for some reason, he wants to be here, freezing his ass off, instead of at home.';
const lineTexts = (page: Page) => ({
  en: page.locator('double-sub-overlay .en'),
  ru: page.locator('double-sub-overlay .ru'),
});

test('tracks cut in different places: both lines hold the whole phrase through its whole time', async () => {
  const page = await openPage('split-sentences.html');
  await seek(page, 1.5); // the first half of the English cut
  await openPopupFor(session, page);
  const { en, ru } = lineTexts(page);
  await expect(en).toHaveText(FULL_EN);
  await expect(ru).toHaveText(
    'Но почему-то он предпочитает морозить задницу здесь, а не сидеть дома.',
  );

  await seek(page, 4); // the second half: the same two lines, not a half
  await expect(en).toHaveText(FULL_EN);
  await expect(ru).toHaveText(
    'Но почему-то он предпочитает морозить задницу здесь, а не сидеть дома.',
  );

  await seek(page, 8); // an ordinary pair is untouched
  await expect(en).toHaveText('I am fine.');
  await expect(ru).toHaveText('Я в порядке.');
});

test('one language only: the cut sentence is translated whole, not in halves', async () => {
  const page = await openPage('split-english-only.html');
  await seek(page, 1.5);
  await openPopupFor(session, page);
  const { en, ru } = lineTexts(page);
  await expect(en).toHaveText(FULL_EN);
  // The stand-in translator marks what it was given: the whole sentence went in as one text.
  await expect(ru).toContainText('freezing his ass off, instead of at home.');
  await expect(ru).toContainText('But for some reason');
});

// ---------------------------------------------------------------- where things are shown

test('the chip is in the right corner of the video', async () => {
  const page = await openPage('player-4tracks.html');
  await openPopupFor(session, page);
  await expect(chip(page)).toBeVisible();
  const video = (await page.locator('video#player').boundingBox())!;
  const box = (await chip(page).boundingBox())!;
  expect(box.x + box.width / 2).toBeGreaterThan(video.x + video.width / 2); // in the right half
  expect(video.x + video.width - (box.x + box.width)).toBeLessThan(24); // by the right edge
});

test('"Now" shows the address of the page, and so does the history', async () => {
  const page = await openPage('shadow-video.html');
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('page-url')).toContainText('localhost');
  await expect(panel.getByTestId('page-url')).toContainText('shadow-video.html');
  await expect(panel.getByTestId('page-url')).not.toContainText('http://');

  await expect.poll(async () => (await stored<unknown[]>('history'))?.length).toBe(1);
  await openPanelTab(panel, 'history');
  await expect(panel.getByTestId('history-url')).toContainText('shadow-video.html');
  await expect(panel.getByTestId('history-url')).toHaveAttribute('href', /shadow-video\.html/);
});

// ---------------------------------------------------------------- voices for the words

const ENGLISH_VOICES = [
  ['Samantha', 'en-US'],
  ['Alex', 'en-US'],
  ['Allison', 'en-US'],
  ['Ava', 'en-US'],
  ['Tom', 'en-US'],
  ['Susan', 'en-US'],
  ['Daniel', 'en-GB'],
  ['Kate', 'en-GB'],
  ['Oliver', 'en-GB'],
  ['Karen', 'en-AU'],
  ['Lee', 'en-AU'],
  ['Moira', 'en-IE'],
  ['Rishi', 'en-IN'],
  ['Tessa', 'en-ZA'],
].map(([voiceName, lang]) => ({ voiceName, lang, remote: false }));
const VOICES = [
  ...ENGLISH_VOICES,
  { voiceName: 'Google US English', lang: 'en-US', remote: true },
  { voiceName: 'Milena', lang: 'ru-RU', remote: false },
  { voiceName: 'Google русский', lang: 'ru-RU', remote: true },
];

const seedVoices = () =>
  session.worker.evaluate((voices) => chrome.storage.local.set({ e2eVoices: voices }), VOICES);
const spokenVoices = async () =>
  ((await stored<Array<{ voice: string }>>('e2eSpoken')) ?? []).map((s) => s.voice);

test('fourteen English voices are on offer, grouped by accent, with the online one set apart', async () => {
  await seedVoices();
  const page = await openPage('shadow-video.html');
  const panel = await openPopupFor(session, page);
  await openPanelTab(panel, 'settings');

  const select = panel.getByTestId('voice-en');
  await expect(select.locator('optgroup[label="США"] option')).toHaveCount(6);
  await expect(select.locator('optgroup[label="Великобритания"] option')).toHaveCount(3);
  await expect(select.locator('optgroup[label^="Онлайн"] option')).toHaveText([
    'Google US English',
  ]);
  // 14 built-in voices + "auto" + "random" + 1 online one.
  await expect(select.locator('option')).toHaveCount(14 + 2 + 1);
  await expect(panel.getByText('встроенных голосов: 14')).toBeVisible();
  await expect(panel.getByTestId('voice-hint-en')).toHaveCount(0); // enough voices: no hint
  await expect(panel.getByTestId('voice-hint-ru')).toContainText('голосов'); // Russian has one: tell how to add more
});

test('picking a voice stores it and says a sample with it; the preview button repeats it', async () => {
  await seedVoices();
  const page = await openPage('shadow-video.html');
  const panel = await openPopupFor(session, page);
  await openPanelTab(panel, 'settings');

  await panel.getByTestId('voice-en').selectOption('Daniel');
  await expect
    .poll(async () => ((await stored<{ voiceEn: string }>('settings')) ?? { voiceEn: '' }).voiceEn)
    .toBe('Daniel');
  await expect.poll(spokenVoices).toEqual(['Daniel']);
  await panel.getByTestId('voice-preview-en').click();
  await expect.poll(spokenVoices).toEqual(['Daniel', 'Daniel']);
});

test('"a different voice every word" really changes the voice, and only to built-in ones', async () => {
  await seedVoices();
  await session.worker.evaluate(() =>
    chrome.storage.local.set({ settings: { voiceEn: '*random*' } }),
  );
  const page = await openPage('shadow-video.html');
  const panel = await openPopupFor(session, page);
  for (let i = 0; i < 14; i++) {
    await panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'speak', text: 'Hello', lang: 'en' }),
    );
  }
  await expect.poll(async () => (await spokenVoices()).length).toBe(14);
  const voices = await spokenVoices();
  const builtIn = new Set(ENGLISH_VOICES.map((v) => v.voiceName));
  expect(voices.every((v) => builtIn.has(v))).toBe(true);
  expect(new Set(voices).size).toBeGreaterThan(3);
});

// ---------------------------------------------------------------- "remember this site?"

const known = () =>
  session.worker.evaluate(async () =>
    Object.keys(((await chrome.storage.local.get('knownSites')).knownSites ?? {}) as object),
  );
const matches = () =>
  session.worker.evaluate(async () =>
    (await chrome.scripting.getRegisteredContentScripts()).flatMap((s) => s.matches ?? []),
  );

test('a new site with a video: the panel offers to remember it, and one click does it', async () => {
  const page = await openPage('shadow-video.html');
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('status')).toHaveText('Субтитры найдены');
  await expect(panel.getByTestId('remember-title')).toContainText('localhost');

  await panel.getByTestId('remember-yes').click();
  await expect
    .poll(async () => (await known()).filter((o) => o.includes('localhost')))
    .toHaveLength(1);
  await expect
    .poll(async () => (await matches()).filter((m) => m === 'http://localhost/*'))
    .toHaveLength(1);
  await expect(panel.getByTestId('remember-title')).toHaveCount(0); // the offer is gone
  await expect(panel.getByTestId('auto-start')).toBeChecked(); // and the switch shows it
});

test('the offer does not wait for a player to be chosen: it is there from the first moment on the page', async () => {
  const page = await openPage('two-videos.html'); // several players: the user has not chosen one yet
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('status')).toContainText('Выберите плеер');
  await expect(panel.getByTestId('remember-yes')).toBeVisible();
});

test('"Not now" hides it for now, "Do not offer again" for good', async () => {
  const page = await openPage('shadow-video.html');
  const panel = await openPopupFor(session, page);
  await panel.getByTestId('remember-later').click();
  await expect(panel.getByTestId('remember-title')).toHaveCount(0);
  expect(await known()).not.toContain(server.origin);

  const again = await openPopupFor(session, page); // another visit to the panel: asked again
  await expect(again.getByTestId('remember-title')).toBeVisible();
  await again.getByTestId('remember-never').click();
  await expect(again.getByTestId('remember-title')).toHaveCount(0);
  await expect.poll(() => stored<string[]>('rememberDismissed')).toContain(server.origin);

  const third = await openPopupFor(session, page);
  await expect(third.getByTestId('status')).toBeVisible();
  await expect(third.getByTestId('remember-title')).toHaveCount(0);
});

test('a site that is remembered is not offered again, and taking it off brings the offer back', async () => {
  const page = await openPage('shadow-video.html');
  const panel = await openPopupFor(session, page);
  await panel.getByTestId('remember-yes').click();
  await expect(panel.getByTestId('remember-title')).toHaveCount(0);
  await panel.getByTestId('auto-start').uncheck();
  await expect(panel.getByTestId('remember-title')).toBeVisible();
});
