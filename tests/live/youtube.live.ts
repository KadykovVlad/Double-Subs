import { expect, test, type Page } from '@playwright/test';
import { launchWithExtension, type ExtensionSession } from '../e2e/extension';

/** The headless browser names itself HeadlessChrome; YouTube then gives empty subtitles even to its own player. */
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/**
 * The real YouTube, as a user meets it: open a video, wait, reload the page, wait. Prints every step
 * the extension logs, and fails when the subtitles are not on screen. `npm run test:live`.
 */
const VIDEOS = (process.env.YT_VIDEOS ?? '8WWrNbHvd44,Z2CZ8mkECpU,arj7oStGLkU').split(',');

let session: ExtensionSession;
test.beforeAll(async () => {
  session = await launchWithExtension({ userAgent: CHROME_UA }, [
    '--disable-blink-features=AutomationControlled',
  ]);
});
test.afterAll(async () => session.close());

function log(page: Page, lines: string[]) {
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[Double Sub]'))
      lines.push(`${new Date().toISOString().slice(14, 23)} ${text.slice(0, 220)}`);
  });
}

async function state(page: Page) {
  return page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('#movie_player video');
    return {
      readyState: video?.readyState,
      time: video ? Math.round(video.currentTime) : null,
      paused: video?.paused,
      ad: document.querySelector('#movie_player')?.classList.contains('ad-showing'),
      overlay: document.querySelectorAll('double-sub-overlay').length,
      chip:
        document.querySelector('double-sub-notice')?.shadowRoot?.querySelector('.text')
          ?.textContent ?? null,
      lines:
        document.querySelector('double-sub-overlay')?.shadowRoot?.textContent?.slice(0, 80) ?? null,
    };
  });
}

for (const id of VIDEOS) {
  test(`${id}: open, then reload`, async () => {
    const page = await session.context.newPage();
    const lines: string[] = [];
    log(page, lines);
    // The browser's network sometimes drops the first connection: try again.
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto(`https://www.youtube.com/watch?v=${id}`);
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await page.waitForTimeout(3000);
      }
    }
    await page.waitForTimeout(15_000);
    const first = await state(page);
    console.log(`\n=== ${id} first open`, JSON.stringify(first), '\n' + lines.join('\n'));

    lines.length = 0;
    await page.reload();
    await page.waitForTimeout(15_000);
    const reloaded = await state(page);
    console.log(`=== ${id} after reload`, JSON.stringify(reloaded), '\n' + lines.join('\n'));

    expect(first.overlay, 'subtitles on first open').toBe(1);
    expect(reloaded.overlay, 'subtitles after reload').toBe(1);
    await page.close();
  });
}
