import { describe, expect, it } from 'vitest';
import { isSubtitleTrack, readCues } from '../src/lib/tracks';

describe('readCues', () => {
  it('returns an empty list while the track is not loaded (cues is null)', () => {
    expect(readCues({ cues: null })).toEqual([]);
  });

  it('maps cues to {start, end, text}', () => {
    const cues = [
      { startTime: 1, endTime: 2.5, text: 'Hello' },
      { startTime: 3, endTime: 4, text: 'World' },
    ];
    expect(readCues({ cues })).toEqual([
      { start: 1, end: 2.5, text: 'Hello' },
      { start: 3, end: 4, text: 'World' },
    ]);
  });

  it('skips cues without string text (e.g. DataCue)', () => {
    const cues = [
      { startTime: 0, endTime: 1 },
      { startTime: 1, endTime: 2, text: 'ok' },
    ];
    expect(readCues({ cues })).toEqual([{ start: 1, end: 2, text: 'ok' }]);
  });
});

describe('isSubtitleTrack', () => {
  it('accepts subtitles and captions only', () => {
    expect(isSubtitleTrack({ kind: 'subtitles' })).toBe(true);
    expect(isSubtitleTrack({ kind: 'captions' })).toBe(true);
    expect(isSubtitleTrack({ kind: 'metadata' })).toBe(false);
    expect(isSubtitleTrack({ kind: 'chapters' })).toBe(false);
  });
});
