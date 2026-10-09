import { expect, test, type Page } from '@playwright/test';
import {
  launchWithExtension,
  openPanelTab,
  openPopupFor,
  type ExtensionSession,
} from './extension';
import { startFixtureServer, type FixtureServer } from './server';

/** Stage 8: hover a subtitle word for its translation, pause while hovering, click to save. */
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

const overlay = (page: Page) => ({
  enWord: (text: string) =>
    page.locator('double-sub-overlay .en .w', { hasText: new RegExp(`^${text}$`) }),
  ruWord: (text: string) =>
    page.locator('double-sub-overlay .ru .w', { hasText: new RegExp(`^${text}$`) }),
  tip: page.locator('double-sub-overlay .tip'),
  tipText: page.locator('double-sub-overlay .tip-text'),
});

/** The tip is on screen and says `text` (a hidden tip must not count: it would hide a missing hover). */
async function expectTip(page: Page, text: string) {
  await expect(overlay(page).tip).toBeVisible();
  await expect(overlay(page).tipText).toHaveText(text);
}

const savedWords = () =>
  session.worker.evaluate(
    async () =>
      ((await chrome.storage.local.get('savedWords')).savedWords ?? []) as Array<
        Record<string, unknown>
      >,
  );

/** The English line "Hello, Dexter." and its Russian translation are on screen, the video is at 1.5 s. */
async function openPlayer(path = '/shadow-video.html'): Promise<{ page: Page; popup: Page }> {
  const page = await session.context.newPage();
  await page.goto(`${server.origin}${path}?test=${++counter}`);
  await page.locator('video').evaluate(
    (v: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        const go = () => {
          v.addEventListener('seeked', () => resolve(), { once: true });
          v.currentTime = 1.5;
        };
        if (v.readyState >= 1) go();
        else v.addEventListener('loadedmetadata', go, { once: true });
      }),
  );
  const popup = await openPopupFor(session, page);
  await expect(page.locator('double-sub-overlay .ru')).toHaveText('Привет, Декстер.');
  return { page, popup };
}

const isPaused = (page: Page) => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused);
const play = (page: Page) =>
  page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });

test('hover: the tip shows the translation and the matching word of the other line is highlighted', async () => {
  const { page } = await openPlayer();
  const { enWord, ruWord, tip } = overlay(page);

  await enWord('Hello').hover();
  await expectTip(page, 'привет');
  await expect(tip).toContainText('Hello');
  await expect(tip).toContainText('Клик — сохранить слово');
  await expect(ruWord('Привет')).toHaveClass(/match/);
  await expect(ruWord('Декстер')).not.toHaveClass(/match/);

  await page.mouse.move(5, 5);
  await expect(tip).toBeHidden();
  await expect(ruWord('Привет')).not.toHaveClass(/match/);
});

test('sweeping the pointer across a word without stopping shows nothing', async () => {
  const { page } = await openPlayer();
  const box = (await overlay(page).enWord('Hello').boundingBox())!;
  const y = box.y + box.height / 2;

  // Stay on the word for much less than the hover delay (150 ms): nothing may appear yet. A delay
  // of zero would already show the tip at this point.
  await page.mouse.move(box.x + 2, y);
  await page.waitForTimeout(30);
  await expect(overlay(page).tip).toBeHidden();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  await expect(overlay(page).tip).toBeHidden();
  expect(await isPaused(page)).toBe(true); // nothing was paused or resumed either
});

test('hover pauses a playing video and resumes it when the pointer leaves', async () => {
  const { page } = await openPlayer();
  await play(page);
  expect(await isPaused(page)).toBe(false);

  await overlay(page).enWord('Hello').hover();
  await expect.poll(() => isPaused(page)).toBe(true);
  await expectTip(page, 'привет');

  await page.mouse.move(5, 5);
  await expect.poll(() => isPaused(page)).toBe(false);
});

test('a video the user paused stays paused after hovering; the setting turns the pause off', async () => {
  const { page, popup } = await openPlayer();
  expect(await isPaused(page)).toBe(true);
  await overlay(page).enWord('Hello').hover();
  await expectTip(page, 'привет');
  await page.mouse.move(5, 5);
  await expect(overlay(page).tip).toBeHidden();
  expect(await isPaused(page)).toBe(true); // not started by us

  await popup.getByTestId('toggle-pause').uncheck();
  await play(page);
  await overlay(page).enWord('Hello').hover();
  await expectTip(page, 'привет');
  expect(await isPaused(page)).toBe(false); // no pause with the setting off
});

test('click saves the word, underlines it, lists it in the popup, and a second click removes it', async () => {
  const { page, popup } = await openPlayer();
  // A click on a word must not reach the page (in fullscreen the overlay sits inside the player).
  await page.evaluate(() => {
    (window as unknown as { pageClicks: number }).pageClicks = 0;
    document.addEventListener(
      'click',
      () => (window as unknown as { pageClicks: number }).pageClicks++,
    );
  });

  const word = overlay(page).enWord('Hello');
  await word.hover();
  await expectTip(page, 'привет'); // the translation is known before saving
  await expect(overlay(page).tip.locator('.tip-ctx-text')).toHaveText('здравствуй');
  await word.click();

  await expect(word).toHaveClass(/saved/);
  await expect(overlay(page).tip).toContainText('Сохранено · клик — убрать');
  expect(await page.evaluate(() => (window as unknown as { pageClicks: number }).pageClicks)).toBe(
    0,
  );
  expect(await savedWords()).toEqual([
    expect.objectContaining({
      key: 'en:hello',
      word: 'Hello',
      lang: 'en',
      translation: 'здравствуй · привет',
      context: 'Hello, Dexter.',
    }),
  ]);

  // The popup that was already open learns about it.
  await openPanelTab(popup, 'words');
  await expect(popup.getByTestId('saved-count')).toHaveText('Сохранённые слова (1)');
  await expect(popup.getByTestId('saved-word')).toContainText('Hello — здравствуй · привет');

  await word.click();
  await expect(word).not.toHaveClass(/saved/);
  expect(await savedWords()).toEqual([]);
  await expect(popup.getByTestId('saved-count')).toHaveText('Сохранённые слова (0)');
});

test('removing a word in the popup removes the underline on the page', async () => {
  const { page, popup } = await openPlayer();
  const word = overlay(page).enWord('Hello');
  await word.hover();
  await expectTip(page, 'привет');
  await word.click();
  await expect(word).toHaveClass(/saved/);

  await openPanelTab(popup, 'words');
  await popup.getByTitle('Убрать').click();
  await expect(word).not.toHaveClass(/saved/);
});

test('saved words are copied for Anki as tab-separated text', async () => {
  const { page, popup } = await openPlayer();
  // Playwright cannot grant clipboard access to an extension page: catch what the popup writes.
  await popup.evaluate(() => {
    navigator.clipboard.writeText = async (text: string) =>
      void ((window as unknown as { copied: string }).copied = text);
  });
  const word = overlay(page).enWord('Hello');
  await word.hover();
  await expectTip(page, 'привет');
  await expect(overlay(page).tip.locator('.tip-ctx-text')).toHaveText('здравствуй');
  await expect(overlay(page).tip.locator('.tip-dict').first()).toBeVisible(); // the dictionary has answered
  await word.click();

  await openPanelTab(popup, 'words');
  await popup.getByTestId('copy-words').click();
  await expect(popup.getByTestId('copy-words')).toHaveText('Скопировано');
  expect(await popup.evaluate(() => (window as unknown as { copied: string }).copied)).toMatch(
    /^Hello\tздравствуй · привет\tHello, Dexter\.\t\S.+$/,
  ); // the last column: the dictionary meaning
});

test('the Russian line is hoverable too: its words are translated into English', async () => {
  const { page } = await openPlayer();
  await overlay(page).ruWord('Декстер').hover();
  await expectTip(page, '[ru] Декстер'); // the stand-in marks what it was given
});

test('with hover translation off the lines are plain text again, and on again they are words', async () => {
  const { page, popup } = await openPlayer();
  await expect(page.locator('double-sub-overlay .en .w')).toHaveCount(2);

  await popup.getByTestId('toggle-hover').uncheck();
  await expect(page.locator('double-sub-overlay .w')).toHaveCount(0);
  await expect(page.locator('double-sub-overlay .en')).toHaveText('Hello, Dexter.');

  await popup.getByTestId('toggle-hover').check();
  await expect(page.locator('double-sub-overlay .en .w')).toHaveCount(2);
});

test('without the language model the tip says so', async () => {
  await session.worker.evaluate(() => chrome.storage.local.set({ e2eTranslator: 'needs-model' }));
  const page = await session.context.newPage();
  await page.goto(`${server.origin}/ru-only.html?test=${++counter}`);
  await page.locator('video').evaluate(
    (v: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        const go = () => {
          v.addEventListener('seeked', () => resolve(), { once: true });
          v.currentTime = 1.5;
        };
        if (v.readyState >= 1) go();
        else v.addEventListener('loadedmetadata', go, { once: true });
      }),
  );
  await openPopupFor(session, page);
  await expect(page.locator('double-sub-overlay .ru')).toHaveText('Привет, Декстер.');

  await overlay(page).ruWord('Привет').hover();
  await expect(overlay(page).tipText).toContainText('Нужна модель перевода');
});

test('the tip shows both the meaning in the sentence and the plain meaning of the word', async () => {
  const { page } = await openPlayer();
  const { enWord, tip } = overlay(page);

  await enWord('Hello').hover();
  await expectTip(page, 'привет'); // the plain meaning
  await expect(tip.locator('.tip-ctx-text')).toHaveText('здравствуй'); // in "Hello, Dexter."
  await expect(tip.locator('.tip-label')).toHaveText(['В контексте', 'Значение слова']);
});

test('when both meanings are the same the tip shows one line', async () => {
  const { page } = await openPlayer();
  const { enWord, tip } = overlay(page);

  await enWord('Dexter').hover();
  await expectTip(page, 'Декстер');
  await expect(tip.locator('.tip-ctx-text')).toHaveCount(0);
  await expect(tip.locator('.tip-label')).toHaveText(['Перевод']);
});

test('the tip gives the dictionary form and the meaning, and a form of a saved word counts as saved', async () => {
  const { page, popup } = await openPlayer();
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.currentTime = 5;
  });
  const { enWord, tip } = overlay(page);

  await enWord('is').hover();
  await expect(tip.locator('.tip-lemma')).toHaveText('→ be');
  await expect(tip.locator('.tip-dict').first()).toContainText('глаг.');
  await enWord('is').click();

  // Saved once, as the dictionary word; the form that was met is kept with it.
  await expect.poll(savedWords).toEqual([
    expect.objectContaining({
      key: 'en:be',
      word: 'be',
      form: 'is',
      context: 'Tonight is the night.',
    }),
  ]);
  await expect(enWord('is')).toHaveClass(/saved/);
  await openPanelTab(popup, 'words');
  await expect(popup.getByTestId('saved-word')).toContainText('be (is)');
  await expect(popup.getByTestId('word-definition')).toBeVisible();

  // Another form of the same word, in another line, is already saved: the tip says so, and a click removes it.
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.currentTime = 8;
  });
  await expect(page.locator('double-sub-overlay .en')).toContainText("I'm not who you think I am.");
  await enWord('am').hover();
  await expect(tip).toContainText('Сохранено · клик — убрать');
  await expect(enWord('am')).toHaveClass(/saved/);
  await enWord('am').click();
  await expect.poll(savedWords).toEqual([]);
});
