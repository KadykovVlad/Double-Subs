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

// ------------------------------------------------------------ the two lines never go separate ways

/** A small seeded generator: the same "random" tracks on every run. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The speech of a film as two tracks: the same utterances, cut a little (or very) differently. */
function tracksOf(seed: number, jitter: number) {
  const rand = random(seed);
  const between = (a: number, b: number) => a + rand() * (b - a);
  type Track = Array<{ start: number; end: number; text: string }>;
  const learn: Track = [];
  const native: Track = [];
  const lastEnd = { L: 0, N: 0 };
  let at = 5;
  for (let n = 0; n < 80; n++) {
    const start = at;
    const end = start + between(1, 5);
    const track = (list: Track, name: 'L' | 'N') => {
      // A track's own cues come one after another, whatever the cut.
      const s = Math.max(start + between(-jitter, jitter), lastEnd[name]);
      const e = Math.max(s + 0.6, end + between(-jitter, jitter));
      if (rand() < 0.3) {
        // This track cuts the utterance in two, with a pause of its own.
        const middle = between(s + 0.2, e - 0.3);
        const resume = Math.min(middle + between(0.05, 0.9), e - 0.1);
        list.push({ start: s, end: middle, text: `${name}${n}a` });
        list.push({ start: resume, end: e, text: `${name}${n}b` });
      } else list.push({ start: s, end: e, text: `${name}${n}` });
      lastEnd[name] = e;
    };
    track(learn, 'L');
    track(native, 'N');
    // A pause between utterances; sometimes none at all (the next begins at once).
    at = Math.max(end, lastEnd.L, lastEnd.N) + (rand() < 0.2 ? 0 : between(0.4, 4));
  }
  return { learn, native };
}

describe('createLineResolver: never one line alone while the other track has its half of the speech', () => {
  // Edges of the two tracks a second apart or less: what two sources of one film really differ by.
  for (const jitter of [0.3, 0.6, 1]) {
    it(`tracks cut with edges apart by up to ${jitter} s`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const { learn, native } = tracksOf(seed * 7919 + Math.round(jitter * 10), jitter);
        const resolve = createLineResolver({ learn, native });
        const overlapping: Array<[number, number]> = [];
        for (const l of learn)
          for (const n of native)
            if (Math.min(l.end, n.end) > Math.max(l.start, n.start))
              overlapping.push([Math.min(l.start, n.start), Math.max(l.end, n.end)]);
        const end = Math.max(learn.at(-1)!.end, native.at(-1)!.end);
        for (let t = 0; t < end + 1; t += 0.01) {
          const lines = resolve(t);
          if ((lines.learn === null) === (lines.native === null)) continue;
          // Exactly one line is on: it must not be a stretch where the two tracks speak together.
          const together = overlapping.find(([from, to]) => t >= from && t < to);
          expect(
            together,
            `seed ${seed}, jitter ${jitter}: at ${t.toFixed(2)} only ${lines.learn ? 'learn' : 'native'} is on`,
          ).toBeUndefined();
        }
      }
    });
  }
});

describe('createLineResolver: the case of a real film', () => {
  it('the own cue of two speakers outlasts the two learnt ones: both leave together', () => {
    const learn = [
      cue(10, 12, '- I have never seen white crows.'),
      cue(12.2, 13.4, '- Look harder.'),
    ];
    const native = [cue(10.1, 14.6, '- Я не видела белых ворон. - Смотрите лучше.')];
    const resolve = createLineResolver({ learn, native });
    for (const t of [10.05, 11, 12.1, 13, 14.5]) {
      const lines = resolve(t);
      expect(lines.learn, `learn at ${t}`).not.toBeNull();
      expect(lines.native, `native at ${t}`).not.toBeNull();
    }
    expect(resolve(14.7)).toEqual({ learn: null, native: null });
    expect(resolve(9.9)).toEqual({ learn: null, native: null });
  });
});
