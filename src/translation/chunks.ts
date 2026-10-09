import type { Cue } from '../lib/types';

/** Index of the cue on screen at `time`, or of the next one; the last index when the video is past all cues. */
export function currentCueIndex(cues: Cue[], time: number): number {
  let low = 0;
  let high = cues.length - 1;
  let result = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid]!.end > time) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return Math.max(0, result);
}

/**
 * Start index of the next chunk to translate: the chunk with the current cue first, then the ones
 * after it, then (wrapping around) the ones before. Chunks without a pending cue are skipped.
 * Called again before every chunk, so a seek re-prioritises at once.
 */
export function nextChunkStart(
  pending: (index: number) => boolean,
  total: number,
  chunkSize: number,
  currentIndex: number,
): number | null {
  if (total === 0) return null;
  const chunks = Math.ceil(total / chunkSize);
  const currentChunk = Math.floor(currentIndex / chunkSize);
  for (let offset = 0; offset < chunks; offset++) {
    const start = ((currentChunk + offset) % chunks) * chunkSize;
    for (let i = start; i < Math.min(start + chunkSize, total); i++) {
      if (pending(i)) return start;
    }
  }
  return null;
}
