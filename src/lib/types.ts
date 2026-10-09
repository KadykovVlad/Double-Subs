import type { Decision, Lang, TrackType } from './analysis';

/** One subtitle line. Times are in seconds of the video timeline. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

/**
 * - loaded: cues were read
 * - empty: the file loaded but has no cues
 * - timeout: the track did not finish loading in time
 * - error: the browser failed to load the track file
 */
export type TrackStatus = 'loaded' | 'empty' | 'timeout' | 'error';

export interface TrackReport {
  label: string;
  language: string;
  kind: string;
  mode: string;
  status: TrackStatus;
  cueCount: number;
  firstCue: Cue | null;
  lastCue: Cue | null;
  /** Detected from the text; the label and attributes of the site are not trusted. */
  lang: Lang;
  type: TrackType;
  /** Cues left after cleaning (markup, and for SDH sound descriptions, removed). */
  usableCueCount: number;
}

export interface VideoReport {
  tracks: TrackReport[];
  /** Which tracks to show (indices into `tracks`) and whether a translation is needed. */
  decision: Decision;
}

/** The cues of the two lines to show; null when the language is not available (yet). */
export interface SubtitleLines {
  en: Cue[] | null;
  ru: Cue[] | null;
}

/** What inspecting a video gives: the report for the popup and the cues for the overlay. */
export interface Inspection {
  report: VideoReport;
  lines: SubtitleLines;
}
