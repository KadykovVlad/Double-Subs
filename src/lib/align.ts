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
 * of the speech, not a timing slip, and is left as it is.
 */
export const MAX_TIMING_SHIFT = 1;

/** A cue that overlaps a second cue of the other line by this share of the shorter one belongs to both. */
const SHARED_OVERLAP = 0.35;

export interface UnifiedLines {
  learn: Cue[];
  native: Cue[];
  /** How many pairs of cues had their timing made equal (a diagnostic for tests and the console). */
  adjusted: number;
}

/**
 * The checking layer between the two tracks: a pair of cues that say the same thing (each the other's
 * best match by overlap) is shown for the same time, from the earlier start to the later end, so one
 * line does not come first, or leave first, while the other lags a fraction of a second behind.
 * If the two differ by more than MAX_TIMING_SHIFT at an edge, the learnt cue's own edge rules there.
 * The window never grows into the neighbouring cue of the same line. Both lists sorted by start; the
 * inputs are not changed (cues that need nothing are shared).
 */
export function unifyTiming(learn: Cue[], native: Cue[]): UnifiedLines {
  const forward = alignByTime(learn, native);
  const backward = alignByTime(native, learn);
  const nativeIndex = new Map<Cue, number>();
  native.forEach((cue, index) => nativeIndex.set(cue, index));

  const learnOut = learn.slice();
  const nativeOut = native.slice();
  let adjusted = 0;

  forward.forEach(({ primary, secondary }, i) => {
    if (!secondary) return;
    const j = nativeIndex.get(secondary);
    // Mutual best matches only, and a clean one-to-one: a long cue that covers two short ones is not
    // stretched (or cut) to fit one of them.
    if (j === undefined || backward[j]?.secondary !== primary) return;
    const shares = (cue: Cue, others: Array<Cue | undefined>) =>
      others.some(
        (other) =>
          other !== undefined &&
          overlap(cue, other) >
            SHARED_OVERLAP * Math.min(cue.end - cue.start, other.end - other.start),
      );
    if (
      shares(secondary, [learn[i - 1], learn[i + 1]]) ||
      shares(primary, [native[j - 1], native[j + 1]])
    )
      return;

    const near = (a: number, b: number) => Math.abs(a - b) <= MAX_TIMING_SHIFT;
    const start = near(primary.start, secondary.start)
      ? Math.min(primary.start, secondary.start)
      : primary.start;
    const end = near(primary.end, secondary.end)
      ? Math.max(primary.end, secondary.end)
      : primary.end;

    // A cue is never stretched into its own neighbour (their unchanged timing); it only moves to the
    // pair's window, and no further than its neighbour allows.
    const moved = (cue: Cue, before: Cue | undefined, after: Cue | undefined): Cue => ({
      ...cue,
      start: Math.max(start, Math.min(cue.start, before?.end ?? -Infinity)),
      end: Math.min(end, Math.max(cue.end, after?.start ?? Infinity)),
    });
    const a = moved(primary, learn[i - 1], learn[i + 1]);
    const b = moved(secondary, native[j - 1], native[j + 1]);
    if (
      a.start === primary.start &&
      a.end === primary.end &&
      b.start === secondary.start &&
      b.end === secondary.end
    )
      return;

    learnOut[i] = a;
    nativeOut[j] = b;
    adjusted++;
  });

  return { learn: learnOut, native: nativeOut, adjusted };
}
