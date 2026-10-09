import { expect, test, type Page } from '@playwright/test';
import { glassAlpha } from '../../src/lib/settings';
import {
  launchWithExtension,
  openPanelTab,
  openPopupFor,
  type ExtensionSession,
} from './extension';
import { startFixtureServer, type FixtureServer } from './server';

/** The frosted-glass bar: its look, the voice button, play/pause, the settings panel and dragging. */
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

const bar = (page: Page) => ({
  bar: page.locator('double-sub-overlay .bar'),
  grip: page.locator('double-sub-overlay .grip'),
  sound: page.locator('double-sub-overlay .sound'),
  play: page.locator('double-sub-overlay .play'),
  gear: page.locator('double-sub-overlay .gear'),
  panel: page.locator('double-sub-overlay .panel'),
  en: page.locator('double-sub-overlay .en'),
  ru: page.locator('double-sub-overlay .ru'),
});

const stored = (key: string) =>
  session.worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);
const spoken = async () =>
  ((await stored('e2eSpoken')) ?? []) as Array<{ text: string; lang: string; voice?: string }>;
const setting = async (name: string) =>
  ((await stored('settings')) as Record<string, unknown> | undefined)?.[name];

async function seek(page: Page, time: number) {
  await page.locator('video').evaluate(
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

async function openPlayer(): Promise<{ page: Page; popup: Page }> {
  const page = await session.context.newPage();
  await page.goto(`${server.origin}/shadow-video.html?test=${++counter}`);
  await seek(page, 1.5);
  const popup = await openPopupFor(session, page);
  await expect(page.locator('double-sub-overlay .ru')).toHaveText('Привет, Декстер.');
  return { page, popup };
}

test('the bar is frosted glass: translucent with the video behind it blurred', async () => {
  const { page } = await openPlayer();
  const { bar: el } = bar(page);
  const look = await el.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      filter: style.backdropFilter,
      background: style.backgroundColor,
      radius: parseFloat(style.borderTopLeftRadius),
    };
  });
  expect(look.filter).toContain('blur');
  expect(look.background).toMatch(/^rgba\(.*0\.\d+\)$/); // translucent, not opaque
  expect(look.radius).toBeGreaterThan(20); // a pill
});

test('the bar shows only while there is text, and the controls are always inside it', async () => {
  const { page } = await openPlayer();
  const { bar: el, sound, play, gear, grip } = bar(page);
  await expect(el).toBeVisible();
  for (const control of [sound, play, gear, grip]) await expect(control).toBeVisible();

  await seek(page, 3.5); // between the cues
  await expect(el).toBeHidden();
  await seek(page, 5);
  await expect(el).toBeVisible();
});

test('the play button pauses and starts the video, and shows which of the two it will do', async () => {
  const { page } = await openPlayer();
  const { play } = bar(page);
  const paused = () => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused);
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await expect(play).toHaveAttribute('data-state', 'playing');
  const pauseIcon = await play.innerHTML();

  await play.click();
  await expect.poll(paused).toBe(true);
  await expect(play).toHaveAttribute('data-state', 'paused');
  expect(await play.innerHTML()).not.toBe(pauseIcon); // now the play triangle

  await play.click();
  await expect.poll(paused).toBe(false);
  await expect(play).toHaveAttribute('data-state', 'playing');
});

test('the sound button turns the word voice on and off, and a hovered word is said aloud only while it is on', async () => {
  const { page, popup } = await openPlayer();
  const { sound } = bar(page);
  const word = page.locator('double-sub-overlay .en .w', { hasText: /^Hello$/ });
  await expect(sound).toHaveAttribute('aria-pressed', 'true');

  await word.hover();
  await expect.poll(spoken).toEqual([{ text: 'Hello', lang: 'en', voice: '' }]);
  await page.mouse.move(5, 5);
  await expect(page.locator('double-sub-overlay .tip')).toBeHidden();

  await sound.click(); // mute
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  expect(await setting('speakWords')).toBe(false);
  await expect(popup.getByTestId('toggle-speak')).not.toBeChecked(); // the popup follows
  await word.hover();
  await expect(page.locator('double-sub-overlay .tip-text')).toHaveText('привет');
  expect(await spoken()).toHaveLength(1); // nothing new

  await page.mouse.move(5, 5);
  await sound.click(); // unmute
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await page.locator('double-sub-overlay .ru .w', { hasText: /^Декстер$/ }).hover();
  await expect.poll(spoken).toEqual([
    { text: 'Hello', lang: 'en', voice: '' },
    { text: 'Декстер', lang: 'ru', voice: '' }, // Russian words get the Russian voice
  ]);
});

test('the voice switch in the popup is reflected on the bar', async () => {
  const { page, popup } = await openPlayer();
  await popup.getByTestId('toggle-speak').uncheck();
  await expect(bar(page).sound).toHaveAttribute('aria-pressed', 'false');
});

test('the gear opens a settings panel; its controls change size and switches at once and are stored', async () => {
  const { page } = await openPlayer();
  const { gear, panel, en } = bar(page);
  await expect(panel).toBeHidden();
  await gear.click();
  await expect(panel).toBeVisible();
  await expect(gear).toHaveAttribute('aria-expanded', 'true');

  const fontSize = () => en.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const before = await fontSize();
  await panel.locator('[data-key="fontSize"][data-step="1"]').click();
  await expect(panel.locator('[data-value="fontSize"]')).toHaveText(`${before + 1} px`);
  await expect.poll(fontSize).toBe(before + 1);
  expect(await setting('fontSize')).toBe(before + 1);

  // The translation line, the width and the glass are separate settings.
  const ruSize = () => bar(page).ru.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const enSizeNow = await fontSize();
  const ruBefore = await ruSize();
  await panel.locator('[data-key="translationSize"][data-step="1"]').click();
  await expect.poll(ruSize).toBe(ruBefore + 1);
  expect(await fontSize()).toBe(enSizeNow);
  expect(await setting('translationSize')).toBe(ruBefore + 1);

  const barWidth = () => bar(page).bar.evaluate((el) => el.getBoundingClientRect().width);
  const widthBefore = await barWidth();
  await panel.locator('[data-key="barWidth"][data-step="1"]').click();
  await expect.poll(barWidth).toBeGreaterThan(widthBefore + 1);
  expect(await setting('barWidth')).toBe(75);

  await panel.locator('[data-key="barOpacity"][data-step="1"]').click();
  expect(await setting('barOpacity')).toBe(0.6);
  await expect
    .poll(() => bar(page).bar.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toContain(String(glassAlpha(0.6)));

  await panel.locator('[data-switch="pauseOnHover"]').click();
  await expect(panel.locator('[data-switch="pauseOnHover"]')).toHaveAttribute(
    'aria-checked',
    'false',
  );
  expect(await setting('pauseOnHover')).toBe(false);

  await panel.locator('[data-switch="hoverTranslate"]').click();
  expect(await setting('hoverTranslate')).toBe(false);
  await expect(page.locator('double-sub-overlay .w')).toHaveCount(0); // plain text again
  await panel.locator('[data-switch="hoverTranslate"]').click();
  await expect(page.locator('double-sub-overlay .en .w')).toHaveCount(2);
});

test('the panel closes with Escape, with the gear and with a click elsewhere; it keeps the bar on screen while open', async () => {
  const { page } = await openPlayer();
  const { gear, panel, bar: el } = bar(page);

  await gear.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  await gear.click();
  await gear.click();
  await expect(panel).toBeHidden();

  await gear.click();
  await page.mouse.click(5, 5);
  await expect(panel).toBeHidden();

  await gear.click();
  await seek(page, 3.5); // between the cues: the bar must stay for the panel
  await expect(el).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(el).toBeHidden();
});

test('dragging the handle moves the bar inside the video and the position is stored; reset brings it back', async () => {
  const { page } = await openPlayer();
  const { bar: el, grip, gear, panel } = bar(page);
  const video = (await page.locator('video').boundingBox())!;
  const before = (await el.boundingBox())!;
  const handle = (await grip.boundingBox())!;
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 200, start.y - 120, { steps: 6 });
  await page.mouse.up();

  const after = (await el.boundingBox())!;
  expect(after.y).toBeLessThan(before.y - 50); // moved up
  expect(after.x).toBeLessThan(before.x); // and left
  expect(after.x).toBeGreaterThanOrEqual(video.x - 1); // but not out of the video
  expect(after.y).toBeGreaterThanOrEqual(video.y - 1);
  await expect.poll(() => setting('bottomOffset')).toBeGreaterThan(10);
  expect(await setting('offsetX')).toBeLessThan(0);

  await gear.click();
  await panel.locator('[data-reset]').click();
  await expect
    .poll(async () => Math.round(((await el.boundingBox())!.y - before.y) * 10) / 10)
    .toBeCloseTo(0, 0);
  expect(await setting('offsetX')).toBe(0);
  expect(await setting('bottomOffset')).toBe(10);
});

test('clicks on the bar do not reach the page', async () => {
  const { page } = await openPlayer();
  await page.evaluate(() => {
    (window as unknown as { pageClicks: number }).pageClicks = 0;
    document.addEventListener(
      'click',
      () => (window as unknown as { pageClicks: number }).pageClicks++,
    );
  });
  const { sound, gear } = bar(page);
  await sound.click();
  await gear.click();
  await page.locator('double-sub-overlay [data-key="fontSize"][data-step="1"]').click();
  expect(await page.evaluate(() => (window as unknown as { pageClicks: number }).pageClicks)).toBe(
    0,
  );
});

test('the chosen voice is used for hovered words, per language', async () => {
  const { page } = await openPlayer();
  await session.worker.evaluate(() =>
    chrome.storage.local.set({ settings: { voiceEn: 'Test English', voiceRu: 'Test Russian' } }),
  );
  await page.locator('double-sub-overlay .en .w', { hasText: /^Hello$/ }).hover();
  await expect.poll(spoken).toEqual([{ text: 'Hello', lang: 'en', voice: 'Test English' }]);
});

test('the popup sliders change the translation size, width and glass of the bar on the page', async () => {
  const { page, popup } = await openPlayer();
  const { bar: barEl, ru } = bar(page);
  const ruSize = () => ru.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const width = () => barEl.evaluate((el) => el.getBoundingClientRect().width);
  const ruBefore = await ruSize();
  const widthBefore = await width();

  void ruBefore;
  await openPanelTab(popup, 'settings');
  await popup.getByTestId('translation-size').fill('30');
  await expect.poll(ruSize).toBe(30);
  await popup.getByTestId('bar-width').fill('90');
  await expect.poll(width).toBeGreaterThan(widthBefore + 10);
  await popup.getByTestId('bar-opacity').fill('90');
  await expect
    .poll(() => barEl.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toContain(String(glassAlpha(0.9)));
  expect(await setting('barWidth')).toBe(90);
  expect(await setting('barOpacity')).toBe(0.9);
});

test('the bar keeps its width from line to line, so changing the width does not make it jump', async () => {
  const { page } = await openPlayer();
  const width = () => bar(page).bar.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  const first = await width();
  await seek(page, 5);
  await expect(bar(page).bar).toBeVisible();
  expect(await width()).toBe(first);
});

test('full opacity is still frosted glass, not a solid plate', async () => {
  const { page, popup } = await openPlayer();
  await openPanelTab(popup, 'settings');
  await popup.getByTestId('bar-opacity').fill('100');
  await expect
    .poll(() =>
      bar(page).bar.evaluate((el) =>
        parseFloat(getComputedStyle(el).backgroundColor.split(',')[3] ?? '1'),
      ),
    )
    .toBeCloseTo(glassAlpha(1), 2);
  expect(glassAlpha(1)).toBeLessThan(0.9);
});

test('the buttons are small relative to the subtitles', async () => {
  const { page } = await openPlayer();
  const play = await bar(page).play.boundingBox();
  const bar0 = await bar(page).bar.boundingBox();
  expect(play!.width).toBeLessThanOrEqual(46);
  expect(play!.width).toBeLessThan(bar0!.height);
});

test('the edges light up on hover and dragging them resizes the bar; the top edge scales the text', async () => {
  const { page } = await openPlayer();
  const edge = page.locator('double-sub-overlay .edge.r');
  const glow = () => edge.evaluate((el) => getComputedStyle(el, '::after').opacity);
  expect(await glow()).toBe('0');
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(glow).toBe('1');

  const width = () => bar(page).bar.evaluate((el) => el.getBoundingClientRect().width);
  const before = await width();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(width).toBeGreaterThan(before + 20);
  expect(Number(await setting('barWidth'))).toBeGreaterThan(70);

  const top = page.locator('double-sub-overlay .edge.t');
  const topBox = (await top.boundingBox())!;
  const fontSize = () => bar(page).en.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const fontBefore = await fontSize();
  await page.mouse.move(topBox.x + topBox.width / 2, topBox.y + topBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(topBox.x + topBox.width / 2, topBox.y + topBox.height / 2 - 20, {
    steps: 5,
  });
  await page.mouse.up();
  await expect.poll(fontSize).toBeGreaterThan(fontBefore + 1);
  expect(Number(await setting('fontSize'))).toBeGreaterThan(22);
  expect(Number(await setting('translationSize'))).toBeGreaterThan(18);
});

test('the panel is split into blocks and the colours of both lines can be chosen', async () => {
  const { page } = await openPlayer();
  const { gear, panel, en, ru } = bar(page);
  await gear.click();
  await expect(panel.locator('.sect-title')).toHaveText([
    'Субтитры для изучения',
    'Субтитры на родном языке',
    'Окно',
    'Слова',
  ]);

  await panel.locator('[data-key="colorEn"][data-swatch="#fff3a0"]').click();
  await expect
    .poll(() => en.evaluate((el) => getComputedStyle(el).color))
    .toBe('rgb(255, 243, 160)');
  await panel.locator('[data-key="colorRu"][data-swatch="#9be7ff"]').click();
  await expect
    .poll(() => ru.evaluate((el) => getComputedStyle(el).color))
    .toBe('rgb(155, 231, 255)');
  expect(await setting('colorEn')).toBe('#fff3a0');
});

test('"More styles" opens the advanced block: font, effect, glass; "Back" returns, reset restores', async () => {
  const { page } = await openPlayer();
  const { gear, panel, en, bar: barEl } = bar(page);
  await gear.click();
  await panel.locator('[data-more]').click();
  await expect(panel.locator('[data-select="fontFamily"]')).toBeVisible();
  await expect(panel.locator('[data-back]')).toBeVisible();

  await panel.locator('[data-select="fontFamily"]').selectOption('serif');
  await expect
    .poll(() => en.evaluate((el) => getComputedStyle(el).fontFamily))
    .toContain('Georgia');
  await panel.locator('[data-select="textEffect"]').selectOption('outline');
  await expect
    .poll(() => en.evaluate((el) => getComputedStyle(el).textShadow))
    .toContain('rgb(0, 0, 0)');
  await panel.locator('[data-select="fontWeight"]').selectOption('700');
  await expect.poll(() => en.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('700');
  await panel.locator('[data-key="glassBlur"][data-step="-1"]').click();
  await expect
    .poll(() => barEl.evaluate((el) => getComputedStyle(el).backdropFilter))
    .toContain('blur(24px)');
  await panel.locator('[data-key="glassRadius"][data-step="-1"]').click();
  await expect
    .poll(() => barEl.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius)))
    .toBeLessThan((await barEl.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) * 1.7);
  await panel.locator('[data-swatch="#1c1c22"]').click();
  await expect
    .poll(() => barEl.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toContain('28, 28, 34');
  expect(await setting('fontFamily')).toBe('serif');
  // The glass colour is the colour of the settings window too.
  await expect
    .poll(() => panel.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toContain('28, 28, 34');

  await panel.locator('[data-reset-styles]').click();
  await expect.poll(() => setting('fontFamily')).toBe('system');
  expect(await setting('textEffect')).toBe('shadow');
  await panel.locator('[data-back]').click();
  await expect(panel.locator('.sect-title').first()).toHaveText('Субтитры для изучения');
});

test('the popup has the same blocks, text colours and the "More styles" block', async () => {
  const { page, popup } = await openPlayer();
  await openPanelTab(popup, 'settings');
  await expect(popup.locator('.section-title')).toHaveText([
    'Субтитры для изучения',
    'Субтитры на родном языке',
    'Окно',
    'Знакомые сайты',
    'История',
  ]);
  await openPanelTab(popup, 'settings');
  await popup.getByTestId('color-en-9be7ff').click();
  await expect
    .poll(() => bar(page).en.evaluate((el) => getComputedStyle(el).color))
    .toBe('rgb(155, 231, 255)');
  await popup.locator('.more-styles summary').click();
  await popup.getByTestId('font-family').selectOption('mono');
  await expect
    .poll(() => bar(page).en.evaluate((el) => getComputedStyle(el).fontFamily))
    .toContain('monospace');
});

test('a cue broken into lines fills the width of the bar instead of keeping its own line breaks', async () => {
  const { page } = await openPlayer();
  const { en } = bar(page);
  const heights = await en.evaluate((el) => {
    const measure = (text: string) => {
      el.textContent = text;
      return el.getBoundingClientRect().height;
    };
    return { one: measure('Hello there'), broken: measure('Hello\nthere') };
  });
  expect(heights.broken).toBe(heights.one);
});

test('the panel closes on a click on the subtitles or the page, but not on a click inside the panel', async () => {
  const { page } = await openPlayer();
  const { gear, panel, en } = bar(page);
  await gear.click();
  await panel.locator('.sect-title').first().click();
  await expect(panel).toBeVisible();
  await en.click();
  await expect(panel).toBeHidden();
});

test('lines fade out between cues, and the bar does not redo its layout every frame while playing', async () => {
  const { page } = await openPlayer();
  const { bar: el, en } = bar(page);
  await seek(page, 3.5);
  await expect(el).toBeHidden();
  await expect(en).toHaveText('', { useInnerText: false });

  await seek(page, 1.5);
  await expect(el).toBeVisible();
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    v.loop = false;
    return v.play();
  });
  await seek(page, 1.2); // still inside the first cue while playing
  // The test build counts layouts on the host element; nothing changes here, so there should be next to none.
  const layouts = () =>
    page
      .locator('double-sub-overlay')
      .evaluate((host) => Number((host as HTMLElement).dataset.layouts));
  const before = await layouts();
  await page.waitForTimeout(500);
  const writes = (await layouts()) - before;
  expect(writes).toBeLessThan(8); // a layout every frame would be hundreds
});

test('text sizes are in pixels with a floor of 10 px, and the drag handle is small', async () => {
  const { page, popup } = await openPlayer();
  const { en, ru, grip } = bar(page);
  await openPanelTab(popup, 'settings');
  await expect(popup.getByTestId('font-scale')).toHaveText('22 px');
  await session.worker.evaluate(() =>
    chrome.storage.local.set({ settings: { fontSize: 3, translationSize: 1 } }),
  );
  await expect.poll(() => en.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(10);
  await expect.poll(() => ru.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(10);
  const handle = await grip.locator('svg').boundingBox();
  expect(handle!.height).toBeLessThanOrEqual(22);
  expect(handle!.width).toBeLessThanOrEqual(14);
});
