import type { Decision } from './analysis';
import type { Cue, Inspection, TrackReport, VideoReport } from './types';
import { t, type MessageKey } from './i18n';

/**
 * YouTube subtitles (stage 5). Pure helpers; the page side lives in src/youtube/.
 *
 * Since 2025 YouTube answers /api/timedtext with an empty body unless the request carries the
 * player's proof-of-origin token (`pot`). We cannot make that token, so we copy it (and the other
 * client parameters) from a request the player made itself.
 */

/** window.postMessage sources between the MAIN-world script and the extension's isolated world. */
export const MAIN_SOURCE = 'double-sub-yt-main';
export const REQUEST_SOURCE = 'double-sub-yt-request';

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  /** 'asr' for automatic speech recognition, null for subtitles made by people. */
  kind: 'asr' | null;
  name: string;
  isTranslatable: boolean;
}

export type MainMessage =
  | { source: typeof MAIN_SOURCE; type: 'timedtext'; url: string; body: string }
  | { source: typeof MAIN_SOURCE; type: 'tracks'; videoId: string | null; tracks: CaptionTrack[] }
  | { source: typeof MAIN_SOURCE; type: 'fetched'; id: string; status: number; body: string };

/**
 * Isolated world → page world. A subtitle file is fetched by the page itself: YouTube answers the
 * page's own request (with the visitor's session) where it answers a content script's with nothing.
 */
export type RequestMessage =
  | { source: typeof REQUEST_SOURCE; type: 'tracks' }
  | { source: typeof REQUEST_SOURCE; type: 'fetch'; id: string; url: string };

const YT = 'https://www.youtube.com';

export function isTimedtextUrl(url: string): boolean {
  try {
    return new URL(url, YT).pathname === '/api/timedtext';
  } catch {
    return false;
  }
}

/**
 * A timedtext request made by YouTube's own player: it carries the client parameters (`c`, `cver`).
 * Other extensions on the page request subtitles too, without them, and must never become our
 * template. The player's first request after a page load often has no proof-of-origin token (`pot`)
 * yet and still gets the subtitles; one with the token is better (see hasToken).
 */
export function isPlayerTemplate(url: string): boolean {
  try {
    const params = new URL(url, YT).searchParams;
    return Boolean(params.get('c')) && Boolean(params.get('cver'));
  } catch {
    return false;
  }
}

export function hasToken(url: string): boolean {
  try {
    return Boolean(new URL(url, YT).searchParams.get('pot'));
  } catch {
    return false;
  }
}

export function videoIdOf(url: string): string | null {
  try {
    return new URL(url, YT).searchParams.get('v');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- player response

/** The part of YouTube's player response we read. Everything is optional: it is not our API. */
export interface YtCaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
  isTranslatable?: boolean;
}

export function normalizeTracks(raw: YtCaptionTrack[] | undefined): CaptionTrack[] {
  return (raw ?? []).flatMap((track) => {
    if (!track.baseUrl || !track.languageCode) return [];
    const name =
      track.name?.simpleText ?? track.name?.runs?.map((run) => run.text ?? '').join('') ?? '';
    return [
      {
        baseUrl: track.baseUrl,
        languageCode: track.languageCode,
        kind: track.kind === 'asr' ? 'asr' : null,
        name: name || track.languageCode,
        isTranslatable: track.isTranslatable === true,
      },
    ];
  });
}

// ---------------------------------------------------------------- which tracks

export interface TrackPick {
  track: CaptionTrack;
  /** Target language of YouTube's own machine translation, or null for the track as is. */
  tlang: 'en' | 'ru' | null;
  source: 'manual' | 'auto' | 'youtube-translation';
}

export interface YouTubePlan {
  en: TrackPick | null;
  ru: TrackPick | null;
}

const baseLang = (code: string) => code.toLowerCase().split(/[-_]/)[0];

/** Subtitles made by people beat automatic ones; en-US, en-GB etc. all count as English. */
function bestTrack(tracks: CaptionTrack[], lang: 'en' | 'ru'): CaptionTrack | null {
  const ofLang = tracks.filter((track) => baseLang(track.languageCode) === lang);
  return ofLang.find((track) => track.kind === null) ?? ofLang[0] ?? null;
}

const asIs = (track: CaptionTrack): TrackPick => ({
  track,
  tlang: null,
  source: track.kind === 'asr' ? 'auto' : 'manual',
});

/**
 * English and Russian lines for a video. A missing language comes from YouTube's own translation
 * of the other one: free and server-side, so better than the on-device translator.
 */
export function planTracks(tracks: CaptionTrack[]): YouTubePlan {
  const en = bestTrack(tracks, 'en');
  const ru = bestTrack(tracks, 'ru');
  const translatable = (track: CaptionTrack | null) => (track?.isTranslatable ? track : null);
  const base =
    translatable(en) ??
    translatable(ru) ??
    tracks.find((track) => track.isTranslatable && track.kind === null) ??
    tracks.find((track) => track.isTranslatable) ??
    null;

  return {
    en: en ? asIs(en) : base ? { track: base, tlang: 'en', source: 'youtube-translation' } : null,
    ru: ru ? asIs(ru) : base ? { track: base, tlang: 'ru', source: 'youtube-translation' } : null,
  };
}

/** Parameters that say which track to load; everything else (pot, client info) is copied. */
const TRACK_PARAMS = new Set(['v', 'lang', 'kind', 'name', 'tlang', 'fmt']);

export const isYouTubeHost = (hostname: string) =>
  hostname === 'youtube.com' || hostname.endsWith('.youtube.com');

/**
 * URL for a picked track: the track's own baseUrl plus the client parameters from a request the
 * player made (`template`), including the `pot` token without which YouTube returns nothing.
 */
export function buildTrackUrl(template: string, pick: TrackPick): string {
  const url = new URL(pick.track.baseUrl, YT);
  // The player response is the page's to write: never send the player's token anywhere but YouTube.
  // The test build also talks to the local fake YouTube.
  const testHost = Boolean(import.meta.env?.VITE_DS_E2E) && url.hostname === 'localhost';
  if (!testHost && (url.protocol !== 'https:' || !isYouTubeHost(url.hostname))) {
    throw new Error('Subtitle URL is not on YouTube');
  }
  for (const [key, value] of new URL(template, YT).searchParams) {
    if (!TRACK_PARAMS.has(key) && !url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  url.searchParams.set('fmt', 'json3');
  if (pick.tlang) url.searchParams.set('tlang', pick.tlang);
  else url.searchParams.delete('tlang');
  return url.toString();
}

// ---------------------------------------------------------------- json3

interface Json3Segment {
  utf8?: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  /** Set on events that only append a line break to the previous one (automatic subtitles). */
  aAppend?: number;
  segs?: Json3Segment[];
}

const DEFAULT_DURATION_MS = 2000;

/**
 * Cues from YouTube's json3 format. In automatic subtitles every event stays on screen while the
 * next one rolls in, so `rolling` ends each cue where the next one starts.
 */
export function parseJson3(body: string, options: { rolling: boolean }): Cue[] {
  let events: Json3Event[];
  try {
    events = (JSON.parse(body) as { events?: Json3Event[] }).events ?? [];
  } catch {
    return [];
  }

  const textEvents = events
    .filter((event) => typeof event.tStartMs === 'number' && event.segs && !event.aAppend)
    .map((event) => ({
      start: event.tStartMs!,
      duration: event.dDurationMs ?? DEFAULT_DURATION_MS,
      text: event
        .segs!.map((seg) => seg.utf8 ?? '')
        .join('')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .join('\n'),
    }))
    .filter((event) => event.text.length > 0)
    .sort((a, b) => a.start - b.start);

  return textEvents.map((event, i) => {
    const next = textEvents[i + 1];
    const end =
      options.rolling && next
        ? Math.min(event.start + event.duration, next.start)
        : event.start + event.duration;
    return { start: event.start / 1000, end: end / 1000, text: event.text };
  });
}

// ---------------------------------------------------------------- report

export interface LoadedPick {
  pick: TrackPick;
  /** null when the request failed. */
  cues: Cue[] | null;
}

const SOURCE_LABEL: Record<TrackPick['source'], MessageKey> = {
  manual: 'yt_manual',
  auto: 'yt_auto',
  'youtube-translation': 'yt_translation',
};

function trackReport(loaded: LoadedPick, lang: 'en' | 'ru'): TrackReport {
  const cues = loaded.cues ?? [];
  const { track, tlang, source } = loaded.pick;
  return {
    label: `${track.name} (${t(SOURCE_LABEL[source])}${tlang ? ` → ${tlang}` : ''})`,
    language: tlang ?? track.languageCode,
    kind: 'subtitles',
    mode: 'youtube',
    status: loaded.cues === null ? 'error' : cues.length > 0 ? 'loaded' : 'empty',
    cueCount: cues.length,
    firstCue: cues[0] ?? null,
    lastCue: cues[cues.length - 1] ?? null,
    lang,
    type: cues.length > 0 ? 'full' : 'empty',
    usableCueCount: cues.length,
  };
}

/** The same report shape as for <track> players, so the popup shows YouTube the same way. */
export function buildYouTubeReport(en: LoadedPick | null, ru: LoadedPick | null): VideoReport {
  const tracks: TrackReport[] = [];
  const enIndex = en ? tracks.push(trackReport(en, 'en')) - 1 : null;
  const ruIndex = ru ? tracks.push(trackReport(ru, 'ru')) - 1 : null;
  const usable = (i: number | null) => (i !== null && tracks[i]!.status === 'loaded' ? i : null);

  const enOk = usable(enIndex);
  const ruOk = usable(ruIndex);
  let decision: Decision;
  if (enOk !== null && ruOk !== null)
    decision = { case: 'A', en: enOk, ru: ruOk, translateFrom: null };
  else if (enOk !== null) decision = { case: 'B', en: enOk, ru: null, translateFrom: 'en' };
  else if (ruOk !== null) decision = { case: 'B', en: null, ru: ruOk, translateFrom: 'ru' };
  else decision = { case: 'C', en: null, ru: null, translateFrom: null };

  return { tracks, decision };
}

/**
 * YouTube has subtitles for the video but gave none of them: most often another subtitle extension
 * gets in the way (the user is told to turn it off: chip_youtube_blocked, youtube_blocked_text).
 */
export function youtubeBlocked(report: VideoReport): boolean {
  return (
    report.decision.case === 'C' &&
    report.tracks.length > 0 &&
    report.tracks.every((track) => track.mode === 'youtube' && track.status !== 'loaded')
  );
}

/** Report plus the cues of the lines it decided to show. */
export function buildYouTubeInspection(en: LoadedPick | null, ru: LoadedPick | null): Inspection {
  const report = buildYouTubeReport(en, ru);
  const cuesOf = (index: number | null) => {
    if (index === null) return null;
    const loaded = index === 0 && en ? en : ru;
    return loaded?.cues ?? null;
  };
  return { report, lines: { en: cuesOf(report.decision.en), ru: cuesOf(report.decision.ru) } };
}
