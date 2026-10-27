import { describe, expect, it } from 'vitest';
import { activeCueIndex, createLineResolver } from '../src/lib/cue-index';

const cue = (start: number, end: number, text: string) => ({ start, end, text });

describe('activeCueIndex', () => {
  const cues = [cue(1, 3, 'a'), cue(4, 6.5, 'b'), cue(7, 9, 'c')];

  it('finds the cue on screen', () => {
    expect(activeCueIndex(cues, 1)).toBe(0);
    expect(activeCueIndex(cues, 2.99)).toBe(0);
    expect(activeCueIndex(cues, 5)).toBe(1);
    expect(activeCueIndex(cues, 8.5)).toBe(2);
  });

  it('returns -1 before, between and after cues (end is exclusive)', () => {
    expect(activeCueIndex(cues, 0.5)).toBe(-1);
    expect(activeCueIndex(cues, 3)).toBe(-1);
    expect(activeCueIndex(cues, 6.7)).toBe(-1);
    expect(activeCueIndex(cues, 20)).toBe(-1);
    expect(activeCueIndex([], 1)).toBe(-1);
  });

  it('finds a long cue that started earlier and overlaps a later one', () => {
    const overlapping = [cue(0, 10, 'long'), cue(2, 3, 'short')];
    expect(activeCueIndex(overlapping, 2.5)).toBe(1);
    expect(activeCueIndex(overlapping, 5)).toBe(0);
  });

  it('is fast enough for a whole episode', () => {
    const many = Array.from({ length: 2000 }, (_, i) => cue(i * 3, i * 3 + 2, String(i)));
    expect(activeCueIndex(many, 3000.5)).toBe(1000);
  });
});

describe('createLineResolver', () => {
  const en = [cue(1, 3, 'Hello'), cue(4, 6.5, 'Tonight'), cue(10, 12, 'Only English')];
  const ru = [cue(1.1, 3.1, 'Привет'), cue(4.1, 6.4, 'Сегодня'), cue(7, 8, 'Только русский')];
  const resolve = createLineResolver({ learn: en, native: ru });

  it('shows the Russian cue paired with the English one, so both change together', () => {
    // At 1.0 s the Russian cue has not started yet (1.1 s), but its English pair is on screen.
    expect(resolve(1.0)).toEqual({ learn: 'Hello', native: 'Привет' });
    // At 6.45 s the Russian cue has already ended (6.4 s), the English one is still on.
    expect(resolve(6.45)).toEqual({ learn: 'Tonight', native: 'Сегодня' });
  });

  it('between English cues the Russian line follows its own timing', () => {
    expect(resolve(7.5)).toEqual({ learn: null, native: 'Только русский' });
    expect(resolve(9)).toEqual({ learn: null, native: null });
  });

  it('an English cue without a Russian pair shows nothing below', () => {
    expect(resolve(11)).toEqual({ learn: 'Only English', native: null });
  });

  it('works with a single line (case B before translation)', () => {
    expect(createLineResolver({ learn: en, native: null })(5)).toEqual({
      learn: 'Tonight',
      native: null,
    });
    expect(createLineResolver({ learn: null, native: ru })(5)).toEqual({
      learn: null,
      native: 'Сегодня',
    });
  });
});

describe('createLineResolver: lines that come and go together', () => {
  it('a line that the other track starts a fraction earlier does not show alone', () => {
    const learn = [cue(10, 12, 'Hello')];
    const native = [cue(9.7, 12.4, 'Привет')];
    const resolve = createLineResolver({ learn, native });
    expect(resolve(9.8)).toEqual({ learn: 'Hello', native: 'Привет' }); // not the Russian alone
    expect(resolve(12.2)).toEqual({ learn: 'Hello', native: 'Привет' }); // not the Russian alone at the end
    expect(resolve(12.5)).toEqual({ learn: null, native: null });
  });

  it('the learnt line that ends first stays while the own one is still on', () => {
    const learn = [cue(1, 2.5, 'Hello')];
    const native = [cue(1, 3, 'Привет')];
    const resolve = createLineResolver({ learn, native });
    expect(resolve(2.8)).toEqual({ learn: 'Hello', native: 'Привет' });
  });
});
