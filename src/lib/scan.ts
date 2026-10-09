import type { FrameScan, IframeInfo, VideoInfo } from './messages';
import type { TranslationStatus } from './translation-messages';
import type { VideoReport } from './types';

/** Smaller boxes are previews, ads or trackers rather than a player. */
export const MIN_PLAYER_WIDTH = 200;
export const MIN_PLAYER_HEIGHT = 100;

export interface BoxStyle {
  width: number;
  height: number;
  display: string;
  visibility: string;
  opacity: string;
}

export function isVisibleBox(box: BoxStyle): boolean {
  return (
    box.display !== 'none' &&
    box.visibility !== 'hidden' &&
    Number(box.opacity) > 0 &&
    box.width >= MIN_PLAYER_WIDTH &&
    box.height >= MIN_PLAYER_HEIGHT
  );
}

/** Origin of an http(s) URL; null for about:blank, javascript:, data: and invalid URLs. */
export function toOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Match pattern for a host permission request. Match patterns cannot contain a port. */
export function originPattern(origin: string): string {
  const { protocol, hostname } = new URL(origin);
  return `${protocol}//${hostname}/*`;
}

const SUBTITLE_URL = /\.(vtt|srt|ttml|dfxp|ass|ssa)(\?|#|$)|[/?&]timedtext\b/i;

export function isSubtitleUrl(url: string): boolean {
  try {
    const { pathname, search } = new URL(url);
    return SUBTITLE_URL.test(pathname + search);
  } catch {
    return false;
  }
}

export interface FrameScanResult {
  frameId: number;
  scan: FrameScan;
}

export interface PlayerCandidate {
  frameId: number;
  origin: string;
  video: VideoInfo;
}

export interface ScanSummary {
  /** Visible videos in every frame we could reach. */
  players: PlayerCandidate[];
  /** Visible iframes we could not inject into (one entry per origin): they need a permission. */
  unreached: IframeInfo[];
  selected: {
    frameId: number;
    origin: string;
    report: VideoReport;
    translation: TranslationStatus | null;
  } | null;
  subtitleResources: string[];
}

export function summarizeScans(results: FrameScanResult[]): ScanSummary {
  const reached = new Set(results.map((r) => r.scan.origin));

  const players: PlayerCandidate[] = results.flatMap(({ frameId, scan }) =>
    scan.videos
      .filter((video) => video.visible)
      .map((video) => ({ frameId, origin: scan.origin, video })),
  );

  const unreachedByOrigin = new Map<string, IframeInfo>();
  for (const { scan } of results) {
    for (const iframe of scan.iframes) {
      if (iframe.visible && !reached.has(iframe.origin) && !unreachedByOrigin.has(iframe.origin)) {
        unreachedByOrigin.set(iframe.origin, iframe);
      }
    }
  }

  const withSelection = results.find((r) => r.scan.selected !== null);
  const selected = withSelection
    ? {
        frameId: withSelection.frameId,
        origin: withSelection.scan.origin,
        report: withSelection.scan.selected!,
        translation: withSelection.scan.translation,
      }
    : null;

  return {
    players,
    unreached: [...unreachedByOrigin.values()],
    selected,
    subtitleResources: [...new Set(results.flatMap((r) => r.scan.subtitleResources))],
  };
}
