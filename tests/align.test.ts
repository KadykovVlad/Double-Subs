import { describe, expect, it } from 'vitest';
import { alignByTime } from '../src/lib/align';

const cue = (start: number, end: number, text: string) => ({ start, end, text });

describe('alignByTime', () => {
  it('pairs cues whose boundaries do not match exactly', () => {
    const en = [cue(1, 3, 'Hello'), cue(4, 6.5, 'Tonight'), cue(7, 9, 'Not who')];
    const ru = [cue(1.1, 3.1, 'Привет'), cue(4.1, 6.4, 'Сегодня'), cue(7, 9.2, 'Не тот')];
    expect(alignByTime(en, ru).map((p) => p.secondary?.text)).toEqual([
      'Привет',
      'Сегодня',
      'Не тот',
    ]);
  });

  it('takes the cue with the largest overlap', () => {
    const en = [cue(0, 4, 'Long line')];
    const ru = [cue(0, 1, 'short'), cue(1, 4, 'longer')];
    expect(alignByTime(en, ru)[0]!.secondary?.text).toBe('longer');
  });

  it('leaves a cue unpaired when nothing overlaps it', () => {
    const en = [cue(0, 1, 'a'), cue(5, 6, 'b')];
    const ru = [cue(0, 1, 'а')];
    expect(alignByTime(en, ru).map((p) => p.secondary?.text ?? null)).toEqual(['а', null]);
  });

  it('handles empty lists', () => {
    expect(alignByTime([], [cue(0, 1, 'x')])).toEqual([]);
    expect(alignByTime([cue(0, 1, 'x')], [])).toEqual([
      { primary: cue(0, 1, 'x'), secondary: null },
    ]);
  });
});
