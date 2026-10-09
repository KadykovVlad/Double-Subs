import { alignByTime } from './align';
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
  en: string | null;
  ru: string | null;
}

/**
 * Texts of both lines at a moment. While an English cue is on screen, the Russian line shows the
 * cue paired with it, so both lines change together even when the tracks' timings differ. Between
 * English cues the Russian line follows its own timing.
 */
export function createLineResolver(lines: SubtitleLines): (time: number) => LineTexts {
  const en = lines.en ?? [];
  const ru = lines.ru ?? [];
  const pairs = en.length > 0 && ru.length > 0 ? alignByTime(en, ru) : null;
  const ruAt = (time: number) => {
    const i = activeCueIndex(ru, time);
    return i >= 0 ? ru[i]!.text : null;
  };

  return (time) => {
    const i = activeCueIndex(en, time);
    if (i < 0) return { en: null, ru: ruAt(time) };
    return { en: en[i]!.text, ru: pairs?.[i]?.secondary?.text ?? ruAt(time) };
  };
}
