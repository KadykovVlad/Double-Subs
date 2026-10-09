import type { AgentRequest, FrameScan, FrameTranslatorProbe, IframeInfo } from '../lib/messages';
import { originPattern, summarizeScans, type FrameScanResult, type ScanSummary } from '../lib/scan';
import type { TranslationStatus } from '../lib/translation-messages';
import type { VideoReport } from '../lib/types';
import { t } from '../lib/i18n';

const AGENT_FILE = '/agent.js';

/** Raw facts for the prototype checks in PLAN.md (stage 2b). Shown in the popup. */
export interface Diagnostics {
  /** null when injection into all frames succeeded. */
  allFramesError: string | null;
  frames: Array<{ frameId: number; origin: string; videos: number; visibleVideos: number }>;
  subtitleResources: string[];
}

export type PopupBody =
  | { kind: 'working'; text: string }
  | { kind: 'restricted'; message: string }
  /** No access to this page yet: the user has to click the extension's icon on it (activeTab). */
  | { kind: 'needsClick' }
  /** Several players, and we were not asked to start pick mode (the user only switched tabs). */
  | { kind: 'several'; count: number }
  | { kind: 'error'; message: string }
  | {
      kind: 'selected';
      origin: string;
      frameId: number;
      report: VideoReport;
      translation: TranslationStatus | null;
      /** Other visible videos on the page: a hint when the selected one has no usable subtitles. */
      others: number;
    }
  | { kind: 'picking'; count: number }
  | { kind: 'needsPermission'; iframes: IframeInfo[]; playersFound: number }
  | { kind: 'denied'; origin: string }
  | { kind: 'nothing' };

/** What every state carries besides its own facts. */
export interface StateBase {
  diagnostics: Diagnostics | null;
  /** The address of the page (null when the browser does not tell it: no access yet). */
  pageUrl: string | null;
}

export type PopupState = PopupBody & StateBase;
type DetectedState = PopupBody & { diagnostics: Diagnostics | null };

/** `?tabId=` lets the e2e tests open the panel as a normal tab aimed at another tab. */
export const hasFixedTab = () => new URLSearchParams(location.search).has('tabId');

export async function getTargetTabId(): Promise<number> {
  const param = new URLSearchParams(location.search).get('tabId');
  if (param) return Number(param);
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error(t('err_no_tab'));
  return tab.id;
}

const pageUrlOf = (tabId: number) =>
  browser.tabs.get(tabId).then(
    (tab) => tab.url ?? null,
    () => null,
  );

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendToFrame<T>(tabId: number, frameId: number, message: AgentRequest): Promise<T> {
  return browser.tabs.sendMessage(tabId, message, { frameId }) as Promise<T>;
}

/**
 * The top frame goes first: if even that fails, the page is off limits (chrome://, Web Store)
 * or activeTab was not granted. Then every frame we have access to.
 */
async function injectAgent(
  tabId: number,
): Promise<{ frameIds: number[]; allFramesError: string | null }> {
  await browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [AGENT_FILE] });
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [AGENT_FILE],
    });
    return { frameIds: [...new Set([0, ...results.map((r) => r.frameId)])], allFramesError: null };
  } catch (error) {
    return { frameIds: [0], allFramesError: errorText(error) };
  }
}

async function scanFrames(tabId: number, frameIds: number[]): Promise<FrameScanResult[]> {
  const results = await Promise.all(
    frameIds.map(async (frameId) => {
      try {
        const scan = await sendToFrame<FrameScan>(tabId, frameId, { type: 'scan' });
        return scan ? { frameId, scan } : null;
      } catch {
        return null; // frame navigated away or was removed
      }
    }),
  );
  return results.filter((r): r is FrameScanResult => r !== null);
}

function diagnosticsOf(
  scans: FrameScanResult[],
  summary: ScanSummary,
  allFramesError: string | null,
): Diagnostics {
  return {
    allFramesError,
    frames: scans.map(({ frameId, scan }) => ({
      frameId,
      origin: scan.origin,
      videos: scan.videos.length,
      visibleVideos: scan.videos.filter((v) => v.visible).length,
    })),
    subtitleResources: summary.subtitleResources,
  };
}

async function startPickInFrames(tabId: number, summary: ScanSummary): Promise<void> {
  const frameIds = [...new Set(summary.players.map((p) => p.frameId))];
  await Promise.all(frameIds.map((frameId) => sendToFrame(tabId, frameId, { type: 'startPick' })));
}

/**
 * What happens when the popup opens:
 * 1 visible video → select it; several → pick mode on the page;
 * a visible cross-origin iframe we cannot reach → ask for access to its origin.
 * `passive` only reports the current selection (used when the agent says a pick finished).
 */
export async function detect(
  tabId: number,
  options: { forcePick?: boolean; passive?: boolean; noPick?: boolean } = {},
): Promise<PopupState> {
  const [state, pageUrl] = await Promise.all([detectState(tabId, options), pageUrlOf(tabId)]);
  return { ...state, pageUrl };
}

async function detectState(
  tabId: number,
  options: { forcePick?: boolean; passive?: boolean; noPick?: boolean },
): Promise<DetectedState> {
  let injection: Awaited<ReturnType<typeof injectAgent>>;
  try {
    injection = await injectAgent(tabId);
  } catch (error) {
    // Without access the browser does not even tell us the address of the tab.
    const url = await browser.tabs.get(tabId).then(
      (tab) => tab.url,
      () => undefined,
    );
    if (url === undefined) return { kind: 'needsClick', diagnostics: null };
    return { kind: 'restricted', message: errorText(error), diagnostics: null };
  }

  const scans = await scanFrames(tabId, injection.frameIds);
  const summary = summarizeScans(scans);
  const diagnostics = diagnosticsOf(scans, summary, injection.allFramesError);

  if (options.forcePick && summary.players.length > 0) {
    await startPickInFrames(tabId, summary);
    return { kind: 'picking', count: summary.players.length, diagnostics };
  }
  if (summary.selected) {
    const { origin, frameId, report, translation } = summary.selected;
    const others = Math.max(0, summary.players.length - 1);
    return { kind: 'selected', origin, frameId, report, translation, others, diagnostics };
  }
  if (options.passive) {
    // Status refresh only: never select or start pick mode on our own.
    return { kind: 'nothing', diagnostics };
  }
  if (summary.unreached.length > 0) {
    return {
      kind: 'needsPermission',
      iframes: summary.unreached,
      playersFound: summary.players.length,
      diagnostics,
    };
  }
  if (summary.players.length === 1) {
    const player = summary.players[0]!;
    const report = await sendToFrame<VideoReport>(tabId, player.frameId, {
      type: 'select',
      index: player.video.index,
    });
    return {
      kind: 'selected',
      origin: player.origin,
      frameId: player.frameId,
      report,
      translation: null,
      others: 0,
      diagnostics,
    };
  }
  if (summary.players.length > 1 && options.noPick) {
    return { kind: 'several', count: summary.players.length, diagnostics };
  }
  if (summary.players.length > 1) {
    await startPickInFrames(tabId, summary);
    return { kind: 'picking', count: summary.players.length, diagnostics };
  }
  return { kind: 'nothing', diagnostics };
}

/**
 * Must be called synchronously from a click handler in the popup: permissions.request
 * needs a user gesture in an extension page (a click inside the web page does not count).
 */
export function requestAccess(origin: string): Promise<boolean> {
  return browser.permissions.request({ origins: [originPattern(origin)] });
}

export async function cancelPick(tabId: number): Promise<void> {
  await browser.tabs
    .sendMessage(tabId, { type: 'stopPick' } satisfies AgentRequest)
    .catch(() => {});
}

/** Fallback: reload the tab so a player that loads subtitles early can be caught from the start. */
export async function reloadAndDetect(tabId: number): Promise<PopupState> {
  await new Promise<void>((resolve) => {
    const listener = (updatedId: number, info: { status?: string }) => {
      if (updatedId === tabId && info.status === 'complete') {
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    browser.tabs.onUpdated.addListener(listener);
    void browser.tabs.reload(tabId);
  });
  return detect(tabId);
}

/** Stage 4 prototype: where the Translator API works in the frames of the page. */
export async function probeTranslatorInFrames(
  tabId: number,
  frameIds: number[],
): Promise<FrameTranslatorProbe[]> {
  const results = await Promise.all(
    frameIds.map((frameId) =>
      sendToFrame<FrameTranslatorProbe>(tabId, frameId, { type: 'probeTranslator' }).catch(
        () => null,
      ),
    ),
  );
  return results.filter((r): r is FrameTranslatorProbe => r !== null);
}

export function openTranslatorLab(): void {
  void browser.tabs.create({ url: browser.runtime.getURL('/translator-lab.html') });
}

/** After the model is downloaded: the agent starts translating again. */
export async function retryTranslation(tabId: number, frameId: number): Promise<void> {
  await sendToFrame(tabId, frameId, { type: 'retryTranslation' }).catch(() => {});
}
