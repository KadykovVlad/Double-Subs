import { describe, expect, it } from 'vitest';
import { alignByTime, unifyTiming } from '../src/lib/align';
import type { Cue } from '../src/lib/types';

const cue = (start: number, end: number, text: string): Cue => ({ start, end, text });

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

describe('unifyTiming: the two lines come and go together', () => {
  it('a pair is shown from the earlier start to the later end, in both lines', () => {
    const learn = [cue(10, 12, 'Hello')];
    const native = [cue(9.7, 12.4, 'Привет')];
    const out = unifyTiming(learn, native);
    expect(out.learn).toEqual([cue(9.7, 12.4, 'Hello')]);
    expect(out.native).toEqual([cue(9.7, 12.4, 'Привет')]);
    expect(out.adjusted).toBe(1);
  });

  it('does not change the lists it was given, and shares cues that need nothing', () => {
    const learn = [cue(1, 3, 'a'), cue(5, 7, 'b')];
    const native = [cue(1.2, 3.1, 'А'), cue(5, 7, 'Б')];
    const before = JSON.stringify([learn, native]);
    const out = unifyTiming(learn, native);
    expect(JSON.stringify([learn, native])).toBe(before);
    expect(out.learn[1]).toBe(learn[1]); // already equal: the same object
    expect(out.native[1]).toBe(native[1]);
    expect(out.adjusted).toBe(1);
  });

  it('an edge that differs by more than a second is a different cut: the learnt cue rules there', () => {
    const learn = [cue(10, 12, 'Hello')];
    const native = [cue(8, 12.3, 'Привет')]; // 2 s early, 0.3 s late
    const out = unifyTiming(learn, native);
    // The start is not met (the own line does not appear 2 s before the learnt one); the end is.
    expect(out.native[0]).toEqual(cue(10, 12.3, 'Привет'));
    expect(out.learn[0]).toEqual(cue(10, 12.3, 'Hello'));
  });

  it('the end: a line may stay up to three seconds after the other, both leave together; more is cut', () => {
    // The own line is read after it is heard: it outlasts the learnt cue by 2.5 s, both stay to its end.
    expect(unifyTiming([cue(10, 12, 'Hello')], [cue(10, 14.5, 'Привет')]).learn).toEqual([
      cue(10, 14.5, 'Hello'),
    ]);
    // Four seconds more is a different cut: the learnt line's end rules, the own cue is cut at it.
    expect(unifyTiming([cue(10, 12, 'Hello')], [cue(10, 16, 'Привет')]).native).toEqual([
      cue(10, 12, 'Привет'),
    ]);
  });

  it('never stretches a cue into its neighbour', () => {
    const learn = [cue(1, 3, 'a'), cue(3.1, 5, 'b')];
    const native = [cue(1, 3.6, 'А'), cue(3.8, 5.2, 'Б')];
    const out = unifyTiming(learn, native);
    // "a" cannot run on into "b" (3.1); the own cue keeps its own end.
    expect(out.learn[0]!.end).toBeLessThanOrEqual(3.1);
    for (const line of [out.learn, out.native])
      for (let i = 1; i < line.length; i++)
        expect(line[i]!.start).toBeGreaterThanOrEqual(Math.min(line[i - 1]!.end, line[i]!.start));
  });

  it('a long cue over two short ones: the edges are shared, the short cues do not run into each other', () => {
    const learn = [cue(1, 3, 'a'), cue(3, 5, 'b')];
    const native = [cue(0.9, 5.1, 'АБ')];
    const out = unifyTiming(learn, native);
    expect(out.learn.map((c) => [c.start, c.end])).toEqual([
      [0.9, 3],
      [3, 5.1],
    ]);
    expect(out.native).toEqual([cue(0.9, 5.1, 'АБ')]);
  });

  it('two speakers in one cue of one line, two cues in the other: both lines leave together', () => {
    // "- I have never seen white crows. - Look harder." as two cues, the Russian one as a single cue.
    const learn = [
      cue(10, 12, '- I have never seen white crows.'),
      cue(12.2, 13.4, '- Look harder.'),
    ];
    const native = [cue(10.1, 14.6, '- Я не видела белых ворон. - Смотрите лучше.')];
    const out = unifyTiming(learn, native);
    // The own line used to stay up alone for the 1.2 s after the learnt one went (and 0.1 s before it came).
    expect(out.learn[0]!.start).toBe(out.native[0]!.start);
    expect(Math.max(...out.learn.map((c) => c.end))).toBe(out.native[0]!.end);
    // The pause between the two learnt cues is bridged: the learnt line is up all the while.
    expect(out.learn[0]!.end).toBe(out.learn[1]!.start);
  });

  it('a pause longer than the bridge is a pause: the line is off in it', () => {
    const learn = [cue(1, 2, 'Yes.'), cue(8, 9, 'No.')]; // six seconds of silence
    const native = [cue(1, 9, 'Да. ... Нет.')];
    expect(unifyTiming(learn, native).learn.map((c) => [c.start, c.end])).toEqual([
      [1, 2],
      [8, 9],
    ]);
  });

  it('a short cue inside a long one of the same line does not take the end of the window', () => {
    const learn = [cue(0, 10, 'long'), cue(2, 3, 'short')];
    const native = [cue(0, 10.5, 'длинная')];
    const out = unifyTiming(learn, native);
    expect(out.learn[0]!.end).toBe(10.5);
    expect(out.learn[1]).toEqual(cue(2, 3, 'short'));
  });

  it('lines without a partner are left alone', () => {
    const learn = [cue(1, 2, 'a'), cue(20, 22, 'z')];
    const native = [cue(10, 11, 'Н')];
    const out = unifyTiming(learn, native);
    expect(out.learn).toEqual(learn);
    expect(out.native).toEqual(native);
    expect(out.adjusted).toBe(0);
  });
});
