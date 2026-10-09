import { expect, test, type Page } from '@playwright/test';
import { launchWithExtension, openPopupFor, type ExtensionSession } from './extension';
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
  await expect(badge).toHaveText('Перевод на русский готов');
  await expect(popup.getByTestId('translation')).toContainText('Русская строка: перевод Chrome.');
  await expect(badge).toBeHidden({ timeout: 8000 }); // a finished translation leaves the badge after a few seconds

  // All three cues were translated, not only the visible one.
  await seekTo(first, '#host video', 5);
  await expect(ru).toHaveText('Сегодня та самая ночь.');
  await first.close();

  // The same subtitles on another page: the cache answers, nothing is translated again.
  const second = await open('/shadow-video.html');
  await seekTo(second, '#host video', 1.5);
  const secondPopup = await openPopupFor(session, second);
  await expect(overlay(second).ru).toHaveText('Привет, Декстер.');
  await expect(overlay(second).badge).toHaveText('Перевод на русский готов (из кэша)');
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
  await expect(popup.getByTestId('decision')).toContainText('английские переведём');
});

test('Russian only: the English line is translated', async () => {
  await setTranslatorMode('fake');
  const page = await open('/ru-only.html');
  await seekTo(page, 'video', 1.5);
  const popup = await openPopupFor(session, page);

  await expect(popup.getByTestId('translation')).toContainText('Английская строка: перевод Chrome');
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
  await expect(badge).toHaveText('Перевод на русский готов');
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
