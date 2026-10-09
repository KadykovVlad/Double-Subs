import { analyzeTracks } from './analysis';
import type { Cue, Inspection, TrackReport, TrackStatus } from './types';

interface CueLike {
  startTime: number;
  endTime: number;
  text?: unknown;
}

interface TextTrackLike {
  cues: ArrayLike<CueLike> | null;
}

/** Kinds that can carry dialogue. Chapters, metadata (thumbnails) and descriptions are skipped. */
const SUBTITLE_KINDS = new Set(['subtitles', 'captions']);

export function isSubtitleTrack(track: Pick<TextTrack, 'kind'>): boolean {
  return SUBTITLE_KINDS.has(track.kind);
}

export function readCues(track: TextTrackLike): Cue[] {
  const cues = track.cues;
  if (!cues) return [];
  const result: Cue[] = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    // DataCue and similar have no text, VTTCue always has a string.
    if (cue && typeof cue.text === 'string') {
      result.push({ start: cue.startTime, end: cue.endTime, text: cue.text });
    }
  }
  return result;
}

/**
 * A `disabled` track is never downloaded by the browser. `hidden` loads the cues without
 * rendering them. A track the site already shows (`showing`) is left alone.
 */
function activateTrack(track: TextTrack): void {
  if (track.mode === 'disabled') track.mode = 'hidden';
}

const POLL_INTERVAL_MS = 250;

/** Finds the `<track>` element that owns a TextTrack (script-added tracks have none). */
function findTrackElement(video: HTMLVideoElement, track: TextTrack): HTMLTrackElement | null {
  for (const el of video.querySelectorAll('track')) {
    if (el.track === track) return el;
  }
  return null;
}

function statusFromCues(track: TextTrack): TrackStatus {
  return readCues(track).length > 0 ? 'loaded' : 'empty';
}

// HTMLTrackElement.readyState values.
const TRACK_LOADED = 2;
const TRACK_ERROR = 3;

function waitForTrack(
  video: HTMLVideoElement,
  track: TextTrack,
  timeoutMs: number,
): Promise<TrackStatus> {
  const element = findTrackElement(video, track);

  return new Promise((resolve) => {
    let settled = false;
    const cleanups: Array<() => void> = [];

    const finish = (status: TrackStatus) => {
      if (settled) return;
      settled = true;
      cleanups.forEach((fn) => fn());
      resolve(status);
    };

    if (element) {
      if (element.readyState === TRACK_LOADED) return finish(statusFromCues(track));
      if (element.readyState === TRACK_ERROR) return finish('error');

      const onLoad = () => finish(statusFromCues(track));
      const onError = () => finish('error');
      element.addEventListener('load', onLoad);
      element.addEventListener('error', onError);
      cleanups.push(
        () => element.removeEventListener('load', onLoad),
        () => element.removeEventListener('error', onError),
      );
    } else {
      // Tracks created with video.addTextTrack() have no load event: poll for cues.
      const timer = setInterval(() => {
        if (readCues(track).length > 0) finish('loaded');
      }, POLL_INTERVAL_MS);
      cleanups.push(() => clearInterval(timer));
    }

    const timeout = setTimeout(() => finish('timeout'), timeoutMs);
    cleanups.push(() => clearTimeout(timeout));
  });
}

interface LoadedTrack {
  label: string;
  language: string;
  kind: string;
  mode: string;
  status: TrackStatus;
  cues: Cue[];
}

function snapshot(track: TextTrack, status: TrackStatus): LoadedTrack {
  return {
    label: track.label,
    language: track.language,
    kind: track.kind,
    mode: track.mode,
    status,
    cues: readCues(track),
  };
}

async function loadTrack(
  video: HTMLVideoElement,
  track: TextTrack,
  timeoutMs: number,
): Promise<LoadedTrack> {
  activateTrack(track);
  return snapshot(track, await waitForTrack(video, track, timeoutMs));
}

/**
 * Once one track has its cues, the others get this long to catch up; a slow or dead one then no
 * longer holds the subtitles back. The player watcher notices cues that arrive later and reads again.
 */
const STRAGGLER_GRACE_MS = 1500;

/** Loads the tracks; gives up on the stragglers a moment after the first one is ready. */
async function loadTracks(
  video: HTMLVideoElement,
  tracks: TextTrack[],
  timeoutMs: number,
): Promise<LoadedTrack[]> {
  const results: Array<LoadedTrack | undefined> = [];
  let giveUp: () => void = () => {};
  const grace = new Promise<void>((resolve) => (giveUp = resolve));
  let timer: ReturnType<typeof setTimeout> | undefined;

  const all = Promise.all(
    tracks.map((track, i) =>
      loadTrack(video, track, timeoutMs).then((loaded) => {
        results[i] = loaded;
        if (loaded.status === 'loaded' && timer === undefined) {
          timer = setTimeout(giveUp, STRAGGLER_GRACE_MS);
        }
      }),
    ),
  );
  await Promise.race([all, grace]);
  clearTimeout(timer);
  return tracks.map((track, i) => results[i] ?? snapshot(track, 'timeout'));
}

/** Subtitles that are not in `video.textTracks` (files the page fetched itself), looked for when the tracks are not enough. */
export type ExtraSource = () => Promise<Array<{ label: string; cues: Cue[] }>>;

/**
 * Loads and analyses the video's subtitle tracks: the report for the panel, the cues for the overlay.
 * When the tracks do not give both languages, `extra` is asked for more (subtitle files of players
 * that draw their own); what it brings joins the tracks and only helps, it never replaces them.
 */
export async function inspectVideo(
  video: HTMLVideoElement,
  extra?: ExtraSource,
  timeoutMs = 5000,
): Promise<Inspection> {
  const loaded = await loadTracks(
    video,
    Array.from(video.textTracks).filter(isSubtitleTrack),
    timeoutMs,
  );
  const durationSec = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;

  let result = analyse(loaded, durationSec);
  if (extra && result.decision.case !== 'A') {
    const files = await extra().catch(() => []);
    if (files.length > 0) {
      const withFiles = [
        ...loaded,
        ...files.map(({ label, cues }): LoadedTrack => ({
          label,
          language: '',
          kind: 'file',
          mode: 'file',
          status: 'loaded',
          cues,
        })),
      ];
      const better = analyse(withFiles, durationSec);
      // Keep the plain tracks unless the files really add a language.
      if (better.decision.case < result.decision.case) result = better;
    }
  }
  return result.inspection;
}

function analyse(loaded: LoadedTrack[], durationSec: number | null) {
  const { tracks: analysis, decision } = analyzeTracks(
    loaded.map(({ label, cues }) => ({ label, cues })),
    { durationSec },
  );
  const report = {
    decision,
    tracks: loaded.map((track, i): TrackReport => ({
      label: track.label,
      language: track.language,
      kind: track.kind,
      mode: track.mode,
      status: track.status,
      cueCount: track.cues.length,
      firstCue: track.cues[0] ?? null,
      lastCue: track.cues[track.cues.length - 1] ?? null,
      lang: analysis[i]!.lang,
      type: analysis[i]!.type,
      usableCueCount: analysis[i]!.cues.length,
    })),
  };
  const inspection: Inspection = {
    report,
    lines: {
      en: decision.en !== null ? analysis[decision.en]!.cues : null,
      ru: decision.ru !== null ? analysis[decision.ru]!.cues : null,
    },
  };
  return { decision, inspection };
}
