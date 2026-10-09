import { isSubtitleUrl } from './scan';
import type { Cue } from './types';

// ---------------------------------------------------------------- parsing

const TIME = String.raw`(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})`;
const TIMING = new RegExp(`^\\s*${TIME}\\s*-->\\s*${TIME}`);

function seconds(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

/** Cues of a WebVTT or SubRip file. Anything that is not a timed block (header, notes, styles, numbers) is skipped. */
export function parseSubtitleFile(source: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of source.replace(/^﻿/, '').split(/\r?\n\r?\n+/)) {
    const lines = block.split(/\r?\n/);
    const at = lines.findIndex((line) => line.includes('-->'));
    if (at < 0 || at > 1 || /^(NOTE|STYLE|REGION)\b/.test(lines[0]!)) continue;
    const timing = TIMING.exec(lines[at]!);
    if (!timing) continue;
    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = timing;
    const text = lines
      .slice(at + 1)
      .join('\n')
      .trim();
    if (text) {
      cues.push({ start: seconds(h1, m1!, s1!, ms1!), end: seconds(h2, m2!, s2!, ms2!), text });
    }
  }
  return cues;
}

// ---------------------------------------------------------------- finding and loading

/** Files the page asked for that this module can read. */
const READABLE = /\.(vtt|srt)$/i;
const MAX_FILES = 6;
const MAX_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 8000;

/**
 * Addresses of subtitle files the page has already requested (Performance API), the newest first.
 * Some players keep their subtitles out of `video.textTracks` and draw them themselves; the file they
 * fetched is still there to read. YouTube's own subtitles are not files and have their own path.
 */
export function subtitleFileUrls(): string[] {
  const urls = new Set<string>();
  const entries = performance.getEntriesByType('resource');
  for (let i = entries.length - 1; i >= 0 && urls.size < MAX_FILES; i--) {
    const { name } = entries[i]!;
    if (!isSubtitleUrl(name)) continue;
    try {
      const { protocol, origin, pathname } = new URL(name);
      if ((protocol === 'http:' || protocol === 'https:') && READABLE.test(pathname)) {
        urls.add(origin + pathname + new URL(name).search);
      }
    } catch {
      // not an address
    }
  }
  return [...urls];
}

export interface SubtitleFile {
  url: string;
  cues: Cue[];
}

/**
 * Downloads and parses the files. Only addresses the page itself requested are fetched, with the
 * page's own rights (a file its server refuses to share is simply skipped), small ones only.
 */
export async function loadSubtitleFiles(
  urls: string[] = subtitleFileUrls(),
  fetchFile: typeof fetch = fetch,
): Promise<SubtitleFile[]> {
  const loaded = await Promise.all(
    urls.map(async (url): Promise<SubtitleFile | null> => {
      try {
        const response = await fetchFile(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) return null;
        const text = await response.text();
        if (text.length > MAX_BYTES) return null;
        const cues = parseSubtitleFile(text);
        return cues.length > 0 ? { url, cues } : null;
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((file): file is SubtitleFile => file !== null);
}

/** A short name for the report: the file name without the query. */
export function fileLabel(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
  } catch {
    return url;
  }
}
