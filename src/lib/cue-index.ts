import { alignByTime, unifyTiming } from './align';
import type { Cue, SubtitleLines } from './types';

/** How far back to look for a cue that started earlier but is still on screen (overlapping cues). */
const OVERLAP_LOOKBACK = 5;

/** Index of the cue on screen at `time` (seconds), or -1. `cues` must be sorted by start. */
export function activeCueIndex(cues: Cue[], time: number): number {
  let low = 0;
  let high = cues.length - 1;
  let lastStarted = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid]!.start <= time) {
      lastStarted = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  for (let i = lastStarted; i >= 0 && i > lastStarted - OVERLAP_LOOKBACK; i--) {
    if (cues[i]!.end > time) return i;
  }
  return -1;
}

export interface LineTexts {
  learn: string | null;
  native: string | null;
}

/**
 * Texts of both lines at a moment. While a cue of the learning line is on screen, the native line
 * shows the cue paired with it, so both lines change together even when the tracks' timings differ.
 * Between those cues the native line follows its own timing.
 */
export function createLineResolver(lines: SubtitleLines): (time: number) => LineTexts {
  // Two tracks cut the same speech a little differently: pairs that say the same thing are given one
  // timing first, so the lines come and go together.
  const both = (lines.learn?.length ?? 0) > 0 && (lines.native?.length ?? 0) > 0;
  const unified = both ? unifyTiming(lines.learn!, lines.native!) : null;
  const learn = unified?.learn ?? lines.learn ?? [];
  const native = unified?.native ?? lines.native ?? [];
  const pairs = both ? alignByTime(learn, native) : null;
  const nativeAt = (time: number) => {
    const i = activeCueIndex(native, time);
    return i >= 0 ? native[i]!.text : null;
  };

  return (time) => {
    const i = activeCueIndex(learn, time);
    if (i < 0) return { learn: null, native: nativeAt(time) };
    return { learn: learn[i]!.text, native: pairs?.[i]?.secondary?.text ?? nativeAt(time) };
  };
}
