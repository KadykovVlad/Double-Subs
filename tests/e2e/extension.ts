import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VideoReport } from '../../src/lib/types';

// DS_EXTENSION_DIR: another build, e.g. the store build for the live checks on the real YouTube.
const EXTENSION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
  process.env.DS_EXTENSION_DIR ?? '.output-e2e',
  'chrome-mv3',
);

export type FrameReport = VideoReport & { frame: string };

export interface ExtensionSession {
  context: BrowserContext;
  extensionId: string;
  worker: Worker;
  /** Empties the storage between tests; the language of the interface chosen for the session stays. */
  resetStorage: () => Promise<void>;
  close: () => Promise<void>;
}

/** Chromium with the e2e build of the extension loaded (headless=new supports extensions). */
export async function launchWithExtension(
  options: { userAgent?: string; headless?: boolean; language?: string } = {},
  extraArgs: string[] = [],
): Promise<ExtensionSession> {
  const { language = 'ru', ...launchOptions } = options;
  const userDataDir = await mkdtemp(join(tmpdir(), 'double-sub-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    ...launchOptions,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      ...extraArgs,
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // The interface is English until the user chooses; the tests choose their language the way the panel does.
  const messages =
    language === 'en'
      ? null
      : JSON.parse(
          await readFile(
            join(dirname(fileURLToPath(import.meta.url)), '../../locales', `${language}.json`),
            'utf8',
          ),
        );
  const seed = () =>
    worker.evaluate((stored) => chrome.storage.local.set({ uiLanguage: stored }), {
      code: language,
      messages,
    });
  await seed();
  return {
    context,
    worker,
    extensionId: new URL(worker.url()).host,
    resetStorage: async () => {
      await worker.evaluate(() => chrome.storage.local.clear());
      await seed();
    },
    close: async () => {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Opens the side panel as a normal tab aimed at `page` (Playwright cannot click the toolbar icon).
 * The e2e build has host access to localhost, which stands in for the activeTab grant.
 */
export async function openPopupFor(session: ExtensionSession, page: Page): Promise<Page> {
  const tabId = await session.worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url === url)?.id;
  }, page.url());
  if (tabId === undefined) throw new Error(`No tab for ${page.url()}`);

  const popup = await session.context.newPage();
  await popup.goto(`chrome-extension://${session.extensionId}/sidepanel.html?tabId=${tabId}`);
  return popup;
}

const REPORT_PREFIX = '[Double Sub] video-report';

/** Collects the agent's video reports from the console of a page and all its frames. */
export function collectReports(page: Page): FrameReport[] {
  const reports: FrameReport[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith(REPORT_PREFIX)) {
      reports.push(JSON.parse(text.slice(REPORT_PREFIX.length).trim()) as FrameReport);
    }
  });
  return reports;
}

/** The panel has tabs; the controls the tests need live on one of them. */
export async function openPanelTab(
  panel: Page,
  tab: 'now' | 'words' | 'history' | 'settings',
): Promise<void> {
  await panel.getByTestId(`tab-${tab}`).click();
}
