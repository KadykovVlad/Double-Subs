import { describe, expect, it } from 'vitest';
import {
  buildSession,
  checkTyped,
  clozeOf,
  exerciseFor,
  MAX_NEW,
  MAX_SESSION,
  retryLater,
  RETRY_AFTER,
  shuffle,
  wrongChoices,
} from '../src/lib/review';
import type { SavedWord } from '../src/lib/saved-words';
import type { Srs } from '../src/lib/srs';

const word = (name: string, srs: Partial<Srs> = {}, extra: Partial<SavedWord> = {}): SavedWord => ({
  key: `en:${name}`,
  word: name,
  lang: 'en' as SavedWord['lang'],
  translation: `перевод ${name}`,
  context: `They say ${name} every day.`,
  savedAt: 1,
  srs: { due: 1, interval: 0, ease: 2.5, reps: 0, lapses: 0, ...srs },
  ...extra,
});

const pool = ['a', 'b', 'c', 'd'].map((name) => word(name));

describe('the exercise a word gets', () => {
  it('a new word is recognised among others', () => {
    expect(exerciseFor(word('new'), pool)).toBe('choose');
  });

  it('with too few other words to choose from, it is recalled', () => {
    expect(exerciseFor(word('new'), pool.slice(0, 2))).toBe('recall');
  });

  it('a word forgotten starts over from recognising', () => {
    expect(exerciseFor(word('old', { reps: 0, lapses: 2, interval: 3 }), pool)).toBe('choose');
  });

  it('after the first right answers it is recalled from nothing', () => {
    expect(exerciseFor(word('w', { reps: 1 }), pool)).toBe('recall');
    expect(exerciseFor(word('w', { reps: 2 }), pool)).toBe('recall');
  });

  it('a word well on its way is produced', () => {
    expect(exerciseFor(word('w', { reps: 3 }), pool)).toBe('type');
  });

  it('a word not found in its sentence cannot have a gap: recalled', () => {
    expect(exerciseFor(word('w', { reps: 5 }, { context: 'Nothing here.' }), pool)).toBe('recall');
  });

  it('a word with no translation can only be recalled', () => {
    expect(exerciseFor(word('w', {}, { translation: null }), pool)).toBe('recall');
    expect(exerciseFor(word('w', { reps: 5 }, { translation: null }), pool)).toBe('recall');
  });
});

describe('the wrong choices', () => {
  it('are three other translations, never the right one or a repeat', () => {
    const same = word('same', {}, { translation: 'перевод a' });
    // They are drawn at random: often enough to meet every way it could go.
    for (let i = 0; i < 100; i++) {
      const choices = wrongChoices(word('w', {}, { translation: 'перевод a' }), [...pool, same]);
      expect(choices).toHaveLength(3);
      expect(choices).not.toContain('перевод a');
      expect(new Set(choices).size).toBe(3);
    }
  });

  it('come from the same language, and skip words with no translation', () => {
    const other = word('fr', {}, { lang: 'fr' as SavedWord['lang'] });
    const empty = word('empty', {}, { translation: null });
    expect(wrongChoices(word('w'), [other, empty])).toEqual([]);
  });

  it('shuffling keeps everything', () => {
    expect(shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('the gap in the sentence', () => {
  it('takes the form that was heard, as a whole word', () => {
    expect(clozeOf(word('go', {}, { form: 'went', context: 'She went home, unwent.' }))).toEqual({
      before: 'She ',
      heard: 'went',
      after: ' home, unwent.',
    });
  });

  it('keeps the case of the sentence', () => {
    expect(clozeOf(word('hello', {}, { context: 'Hello there.' }))?.heard).toBe('Hello');
  });

  it('does not take a part of another word', () => {
    expect(clozeOf(word('art', {}, { context: 'A smart start.' }))).toBeNull();
  });

  it('a word with signs of a regular expression is only a word', () => {
    expect(clozeOf(word('c++', {}, { context: 'I write c++ daily.' }))?.heard).toBe('c++');
  });
});

describe('a typed answer', () => {
  const went = word('go', {}, { form: 'went' });

  it('both the form heard and the dictionary form are right, in any case', () => {
    expect(checkTyped('went', went)).toBe('right');
    expect(checkTyped(' GO ', went)).toBe('right');
  });

  it('accents and apostrophes do not matter', () => {
    expect(checkTyped('cafe', word('café'))).toBe('right');
    expect(checkTyped('don’t', word("don't"))).toBe('right');
  });

  it('one slip in a longer word is almost', () => {
    expect(checkTyped('wonderfull', word('wonderful'))).toBe('almost');
    expect(checkTyped('wonderfal', word('wonderful'))).toBe('almost');
  });

  it('one slip in a short word is another word', () => {
    expect(checkTyped('cat', word('car'))).toBe('wrong');
  });

  it('two slips are wrong', () => {
    expect(checkTyped('wandarful', word('wonderful'))).toBe('wrong');
  });
});

describe('a session', () => {
  const fresh = Array.from({ length: 30 }, (_, i) => word(`new${i}`));
  const old = Array.from({ length: 30 }, (_, i) => word(`old${i}`, { reps: 2, interval: 3 }));

  it('takes only so many new words at once', () => {
    expect(buildSession(fresh)).toHaveLength(MAX_NEW);
  });

  it('has an end', () => {
    expect(buildSession([...old, ...fresh])).toHaveLength(MAX_SESSION);
  });

  it('mixes the new among the old, the old going first', () => {
    const names = buildSession([...old.slice(0, 4), ...fresh.slice(0, 2)]).map((w) => w.word);
    expect(names).toEqual(['old0', 'old1', 'new0', 'old2', 'old3', 'new1']);
  });

  it('a word forgotten is put back a few cards on, or at the end', () => {
    const queue = old.slice(0, 6);
    const again = retryLater(queue, 0, queue[0]!);
    expect(again[1 + RETRY_AFTER]).toBe(queue[0]);
    expect(again).toHaveLength(7);
    expect(retryLater(queue, 5, queue[5]!).at(-1)).toBe(queue[5]);
  });
});
