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
