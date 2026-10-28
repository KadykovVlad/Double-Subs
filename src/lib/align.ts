import type { Cue } from './types';

export function overlap(a: Cue, b: Cue): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export interface AlignedPair {
  primary: Cue;
  /** The secondary cue that overlaps the primary one the most, or null when none overlaps. */
  secondary: Cue | null;
}

/**
 * Pairs every primary cue with a secondary cue by time. Two tracks of the same video rarely
 * share cue boundaries (case A), so pairing by index would drift; overlap does not.
 * Both lists must be sorted by start time.
 */
export function alignByTime(primary: Cue[], secondary: Cue[]): AlignedPair[] {
  let first = 0;
  return primary.map((cue) => {
    while (first < secondary.length && secondary[first]!.end <= cue.start) first++;

    let best: Cue | null = null;
    let bestOverlap = 0;
    for (let i = first; i < secondary.length && secondary[i]!.start < cue.end; i++) {
      const amount = overlap(cue, secondary[i]!);
      if (amount > bestOverlap) {
        best = secondary[i]!;
        bestOverlap = amount;
      }
    }
    return { primary: cue, secondary: best };
  });
}

/**
 * How far the start or the end of one line may be moved to meet the other. Two tracks of the same
 * dialogue cut it a little differently (a few tenths of a second); more than that is a different cut
 * of the speech, not a timing slip: there the learnt line's own edge rules.
 */
export const MAX_TIMING_SHIFT = 1;

/**
 * How long a line may stay on after the other one has gone: a translation is read after it is heard,
 * so at the end the lines differ by up to this much and both stay to the later end. At the start the
 * limit is MAX_TIMING_SHIFT: a line must not come before it is said.
 */
export const MAX_LINGER = 3;

/**
 * A pause this short inside one line, while the other line is on, is bridged: the cue stays up until
 * the next one comes (a speech cut in two on one track and whole on the other, or one long cue over
 * two short ones with a silence between). With the tracks' edges a second apart, such a silence can be
 * as long as four.
 */
export const MAX_BRIDGE = 4;

export interface UnifiedLines {
  learn: Cue[];
  native: Cue[];
  /** How many stretches of speech had their timing made equal (a diagnostic for tests and the console). */
  adjusted: number;
}

interface Item {
  cue: Cue;
  line: 0 | 1;
  index: number;
}

/**
 * The checking layer between the two tracks: the lines come and go together, never one alone.
 *
 * All the cues of both tracks that overlap one another (a chain of them is one) are one stretch of
 * speech, however the two tracks cut it: a cue to a cue, one cue over several, cuts that do not meet.
 * The stretch is shown for one window in both lines: from the earlier start when the two lines
 * differ by no more than MAX_TIMING_SHIFT there, to the later end when they differ by no more than
 * MAX_LINGER; at an edge where they differ more, the learnt line's edge rules (the own line is cut
 * or stretched to it). Inside the window each line's cues follow
 * one another: a pause of at most MAX_BRIDGE is bridged, so the line does not blink out while the
 * other one is still on. A cue outside the window, and a stretch that only one line has, are left as
 * they are. Both lists sorted by start; the inputs are not changed (cues that need nothing are shared).
 */
export function unifyTiming(learn: Cue[], native: Cue[]): UnifiedLines {
  const out: [Cue[], Cue[]] = [learn.slice(), native.slice()];
  let adjusted = 0;

  const items: Item[] = [
    ...learn.map((cue, index): Item => ({ cue, line: 0, index })),
    ...native.map((cue, index): Item => ({ cue, line: 1, index })),
  ]
    .filter((item) => item.cue.end > item.cue.start)
    .sort((a, b) => a.cue.start - b.cue.start || a.cue.end - b.cue.end);

  const near = (a: number, b: number) => Math.abs(a - b) <= MAX_TIMING_SHIFT;

  const settle = (stretch: Item[]) => {
    const lines = [0, 1].map((line) => stretch.filter((item) => item.line === line));
    if (lines[0]!.length === 0 || lines[1]!.length === 0) return;
    const bounds = lines.map((line) => ({
      start: Math.min(...line.map((item) => item.cue.start)),
      end: Math.max(...line.map((item) => item.cue.end)),
    }));
    const start = near(bounds[0]!.start, bounds[1]!.start)
      ? Math.min(bounds[0]!.start, bounds[1]!.start)
      : bounds[0]!.start;
    const end =
      Math.abs(bounds[0]!.end - bounds[1]!.end) <= MAX_LINGER
        ? Math.max(bounds[0]!.end, bounds[1]!.end)
        : bounds[0]!.end;

    let changed = false;
    for (const line of lines) {
      // The cues that reach into the window, in order; the rest keep their own timing.
      const inside = line.filter((item) => item.cue.end > start && item.cue.start < end);
      if (inside.length === 0) continue;
      const times = inside.map(({ cue }) => ({
        start: Math.max(cue.start, start),
        end: Math.min(cue.end, end),
      }));
      times[0]!.start = start;
      // The cue that lasts longest takes the end of the window (a short one inside a long one must not).
      let last = 0;
      inside.forEach((item, k) => {
        if (item.cue.end >= inside[last]!.cue.end) last = k;
      });
      times[last]!.end = end;
      for (let k = 0; k + 1 < times.length; k++) {
        const gap = times[k + 1]!.start - times[k]!.end;
        if (gap > 0 && gap <= MAX_BRIDGE) times[k]!.end = times[k + 1]!.start;
      }
      inside.forEach((item, k) => {
        const t = times[k]!;
        if (t.start === item.cue.start && t.end === item.cue.end) return;
        out[item.line][item.index] = { ...item.cue, start: t.start, end: t.end };
        changed = true;
      });
    }
    if (changed) adjusted++;
  };

  let stretch: Item[] = [];
  let stretchEnd = -Infinity;
  for (const item of items) {
    if (stretch.length > 0 && item.cue.start >= stretchEnd) {
      settle(stretch);
      stretch = [];
    }
    stretch.push(item);
    stretchEnd = stretch.length === 1 ? item.cue.end : Math.max(stretchEnd, item.cue.end);
  }
  settle(stretch);

  return { learn: out[0], native: out[1], adjusted };
}
