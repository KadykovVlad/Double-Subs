import { expect, test, type Page } from '@playwright/test';
import { launchWithExtension, openPopupFor, type ExtensionSession } from './extension';
import { SUBTITLE_LANGUAGES } from '../../src/lib/languages';
import { startFixtureServer, type FixtureServer } from './server';

/**
 * Stage 7: translating the missing line (case B). The e2e build swaps the built-in translator for a
 * stand-in (src/translation/fake-api.ts), because Chromium here has no language model; everything else
 * - background relay, offscreen document, chunks, cache, badge, popup - is the real code.
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
  await session.resetStorage();
});

const setTranslatorMode = (mode: 'fake' | 'slow' | 'needs-model') =>
  session.worker.evaluate((value) => chrome.storage.local.set({ e2eTranslator: value }), mode);

async function open(path: string): Promise<Page> {
  const page = await session.context.newPage();
  await page.goto(`${server.origin}${path}?test=${++counter}`);
  return page;
}

async function seekTo(page: Page, selector: string, time: number) {
  await page.locator(selector).evaluate(
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

const overlay = (page: Page) => ({
  en: page.locator('double-sub-overlay .en'),
  ru: page.locator('double-sub-overlay .ru'),
  badge: page.locator('double-sub-notice .chip'),
});

test('English only: the Russian line is translated, then the same subtitles come from the cache', async () => {
  const first = await open('/shadow-video.html');
  await seekTo(first, '#host video', 1.5);
  const popup = await openPopupFor(session, first);

  const { en, ru, badge } = overlay(first);
  await expect(en).toHaveText('Hello, Dexter.');
  await expect(ru).toHaveText('Привет, Декстер.'); // the stand-in answers in lower case; polish capitalises
  await expect(popup.getByTestId('translation')).toContainText('Русский: перевод Chrome.');
  await expect(badge).toBeHidden(); // a finished translation announces nothing and takes the progress badge away

  // All three cues were translated, not only the visible one.
  await seekTo(first, '#host video', 5);
  await expect(ru).toHaveText('Сегодня та самая ночь.');
  await first.close();

  // The same subtitles on another page: the cache answers, nothing is translated again.
  const second = await open('/shadow-video.html');
  await seekTo(second, '#host video', 1.5);
  const secondPopup = await openPopupFor(session, second);
  await expect(overlay(second).ru).toHaveText('Привет, Декстер.');
  await expect(overlay(second).badge).toBeHidden(); // from the cache: no announcement either
  await expect(secondPopup.getByTestId('translation')).toContainText('(из кэша)');
});

test('without the language model: one line, a note on the video and a download button in the popup', async () => {
  await setTranslatorMode('needs-model');
  const page = await open('/ru-only.html');
  await seekTo(page, 'video', 1.5);
  const popup = await openPopupFor(session, page);

  const { en, ru, badge } = overlay(page);
  await expect(ru).toHaveText('Привет, Декстер.'); // the Russian line is the source here
  await expect(en).toBeHidden();
  await expect(badge).toContainText('Нужна модель перевода');
  await expect(popup.getByTestId('translation')).toHaveAttribute('data-state', 'needs-model');
  await expect(popup.getByTestId('download-model')).toBeVisible();
  await expect(popup.getByTestId('decision')).toContainText('перевод на английский сделаем сами');
});

test('Russian only: the English line is translated', async () => {
  await setTranslatorMode('fake');
  const page = await open('/ru-only.html');
  await seekTo(page, 'video', 1.5);
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('translation')).toContainText('Английский: перевод Chrome');
  await expect(overlay(page).ru).toHaveText('Привет, Декстер.');
  await expect(overlay(page).en).toHaveText('[ru] Привет, Декстер.'); // the stand-in marks what it was given
});

test('a slow translator: progress is shown on the video and in the popup, and the line appears when ready', async () => {
  await setTranslatorMode('slow');
  // Subtitles no earlier test translated, so the cache cannot answer.
  const page = await open('/en-slow.html');
  await seekTo(page, 'video', 1.5);
  const popup = await openPopupFor(session, page);

  const { en, ru, badge } = overlay(page);
  await expect(en).toHaveText('I know what you did last night.'); // the source line does not wait for the translation
  await expect(ru).toBeHidden();
  await expect(badge).toContainText('Перевожу на русский…');
  await expect(popup.getByTestId('translation')).toHaveAttribute('data-state', 'translating');
  await expect(ru).toHaveText('[ru] I know what you did last night.', { timeout: 10_000 }); // 3 lines at 250 ms each
  await expect(badge).toBeHidden(); // done: the progress badge is gone, nothing takes its place
});

test('a player without tracks that fetched subtitle files itself: both lines come from the files', async () => {
  await setTranslatorMode('fake');
  const page = await open('/own-captions.html');
  await seekTo(page, 'video', 1.5);
  await openPopupFor(session, page);

  const { en, ru } = overlay(page);
  await expect(en).toHaveText('Hello, Dexter.');
  await expect(ru).toHaveText('Привет, Декстер.'); // read from the file, not translated by the stand-in
});

// ---------------------------------------------------------------- every language

/** The languages of the lists but Russian (the own language here) and English (the tests above). */
const OTHER_LANGUAGES = SUBTITLE_LANGUAGES.filter((code) => code !== 'ru' && code !== 'en');

// The page has one line only: Russian in one test, English in the other. The other line is made by the
// translator, into the language chosen; each language of the lists is chosen once, in turn as the
// learnt one (the missing line is translated from the Russian one) and as the own one (from English).
OTHER_LANGUAGES.forEach((code, index) => {
  const asLearnt = index % 2 === 0;
  test(`${code} as the ${asLearnt ? 'learnt' : 'own'} language: the missing line is translated into it`, async () => {
    await setTranslatorMode('fake');
    await session.worker.evaluate(
      (settings) => chrome.storage.local.set({ settings }),
      asLearnt ? { learnLang: code, nativeLang: 'ru' } : { learnLang: 'en', nativeLang: code },
    );
    const page = await open(asLearnt ? '/ru-only.html' : '/shadow-video.html');
    await seekTo(page, 'video', 1.5);
    await openPopupFor(session, page);
    const { en, ru } = overlay(page);
    if (asLearnt) {
      await expect(ru).toHaveText('Привет, Декстер.'); // the own line is the page's
      await expect(en).toHaveText(`[${code}] Привет, Декстер.`); // the learnt line is made by the translator
    } else {
      await expect(en).toHaveText('Hello, Dexter.');
      await expect(ru).toHaveText(`[${code}] Hello, Dexter.`);
    }
  });
});
