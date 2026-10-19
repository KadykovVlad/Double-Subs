/**
 * TikTok (stage 11л). Its videos have no <track>: TikTok recognises the speech itself and gives every
 * video that has some a WebVTT file, listed in the data of the video (`video.subtitleInfos`, and the
 * same address in `video.claInfo.captionInfos`). That data comes with the page
 * (__UNIVERSAL_DATA_FOR_REHYDRATION__) and with the answers of its feed (/api/recommend/item_list/,
 * a profile, a search...). The page-world script (entrypoints/tiktok-main.ts) reads both and tells
 * the extension; the player of a video sits in `div#xgwrapper-<n>-<video id>`.
 */

/** Messages of the page-world script. */
export const TIKTOK_MAIN_SOURCE = 'double-sub-tt-main';
/** Messages to the page-world script. */
export const TIKTOK_REQUEST_SOURCE = 'double-sub-tt-request';

/** One subtitle file of a video. */
export interface TikTokCaption {
  url: string;
  /** "rus-RU", "eng-US": TikTok's guess of the language (often wrong: the text decides, see analysis). */
  language: string;
  /** "ASR": recognised from the speech. */
  source: string;
}

/** What TikTok says about one video: its subtitle files (none: it found no speech to recognise). */
export interface TikTokItem {
  id: string;
  captions: TikTokCaption[];
}

export type TikTokMainMessage =
  | { source: typeof TIKTOK_MAIN_SOURCE; type: 'items'; items: TikTokItem[] }
  | { source: typeof TIKTOK_MAIN_SOURCE; type: 'hello' };

export type TikTokRequestMessage = { source: typeof TIKTOK_REQUEST_SOURCE; type: 'items' };

export function isTikTokHost(hostname: string): boolean {
  if (hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com')) return true;
  // The test build: the fake TikTok page is served under this name.
  return Boolean(import.meta.env?.VITE_DS_E2E) && hostname.endsWith('tiktok.localhost');
}

/** A match pattern ("https://www.tiktok.com/*") of a TikTok address. */
export function isTikTokPattern(pattern: string): boolean {
  const host = /^[^:]+:\/\/([^/]+)\//.exec(pattern)?.[1]?.replace(/^\*\./, '');
  return Boolean(host) && isTikTokHost(host!);
}

/** The id of the video a player shows: from its wrapper "xgwrapper-0-7685187890472602887". */
export function idOfWrapper(id: string): string | null {
  return /^xgwrapper-\d+-(\d{6,})$/.exec(id)?.[1] ?? null;
}

/** The id of the video of a page address: /@user/video/7685187890472602887. */
export function idOfPath(pathname: string): string | null {
  return /\/video\/(\d{6,})/.exec(pathname)?.[1] ?? null;
}

const MAX_DEPTH = 12;

interface RawCaption {
  Url?: unknown;
  url?: unknown;
  urlList?: unknown;
  LanguageCodeName?: unknown;
  language?: unknown;
  Source?: unknown;
  Format?: unknown;
  captionFormat?: unknown;
  isAutoGen?: unknown;
}

/** TikTok's files are on https; the test build serves its fake ones from *.localhost. */
function fileAddress(url: string): boolean {
  if (url.startsWith('https://')) return true;
  return Boolean(import.meta.env?.VITE_DS_E2E) && /^http:\/\/[\w.-]*localhost[:/]/.test(url);
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');

function captionsOf(video: Record<string, unknown>): TikTokCaption[] {
  const legacy = Array.isArray(video.subtitleInfos) ? (video.subtitleInfos as RawCaption[]) : [];
  const cla = video.claInfo as { captionInfos?: unknown } | undefined;
  const fresh = Array.isArray(cla?.captionInfos) ? (cla.captionInfos as RawCaption[]) : [];
  const captions: TikTokCaption[] = [];
  const seen = new Set<string>();
  const add = (url: string, language: string, source: string, format: string) => {
    if (!fileAddress(url) || seen.has(url)) return;
    if (format && format.toLowerCase() !== 'webvtt') return;
    seen.add(url);
    captions.push({ url, language, source });
  };
  for (const c of legacy) add(str(c.Url), str(c.LanguageCodeName), str(c.Source), str(c.Format));
  for (const c of fresh)
    add(
      str(c.url) || str(Array.isArray(c.urlList) ? c.urlList[0] : ''),
      str(c.language),
      c.isAutoGen === true ? 'ASR' : str(c.Source),
      str(c.captionFormat),
    );
  return captions;
}

/**
 * Every video in a piece of TikTok's data (a feed answer, the page's own data): an object with a
 * numeric string `id` and a `video` object. Videos without subtitle files are given too, with none,
 * so that the extension knows not to wait for them.
 */
export function itemsOf(data: unknown): TikTokItem[] {
  const items = new Map<string, TikTokItem>();
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const { id, video } = record;
    if (typeof id === 'string' && /^\d{6,}$/.test(id) && video && typeof video === 'object') {
      const captions = captionsOf(video as Record<string, unknown>);
      const known = items.get(id);
      if (!known || known.captions.length < captions.length) items.set(id, { id, captions });
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  walk(data, 0);
  return [...items.values()];
}
