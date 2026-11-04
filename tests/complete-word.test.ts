import { describe, expect, it, vi } from 'vitest';
import { completeWord, needsCompleting, type CompletingTools } from '../src/lib/complete-word';
import type { WordInfo } from '../src/lib/dictionary';
import type { SavedWord } from '../src/lib/saved-words';

const word = (extra: Partial<SavedWord> = {}): SavedWord => ({
  key: 'en:shower',
  word: 'shower',
  lang: 'en' as SavedWord['lang'],
  translation: null,
  context: "I'm gonna shower.",
  savedAt: 1,
  ...extra,
});

const info = { senses: [{ pos: 'noun', meanings: ['A brief fall of rain.'] }] } as WordInfo;

const tools = (over: Partial<CompletingTools> = {}): CompletingTools => ({
  translate: vi.fn(async (text: string) =>
    text.includes('«') ? 'Я пойду «помоюсь».' : text === 'shower' ? 'душ' : 'Короткий дождь.',
  ),
  lookup: vi.fn(async () => info),
  ...over,
});

describe('what a word lacks', () => {
  it('a word without a translation, or explained in English', () => {
    expect(needsCompleting(word(), 'ru')).toBe(true);
    expect(needsCompleting(word({ translation: 'душ' }), 'ru')).toBe(true);
  });

  it('a word with both in the own language lacks nothing', () => {
    expect(needsCompleting(word({ translation: 'душ', definitionLang: 'ru' }), 'ru')).toBe(false);
  });

  it('another own language explains it again', () => {
    expect(needsCompleting(word({ translation: 'душ', definitionLang: 'ru' }), 'de')).toBe(true);
  });

  it('a word of the own language needs nothing, it is known', () => {
    expect(needsCompleting(word({ lang: 'ru' as SavedWord['lang'] }), 'ru')).toBe(false);
  });

  it('with no dictionary for the language only the translation counts', () => {
    const french = { lang: 'fr' as SavedWord['lang'] };
    expect(needsCompleting(word({ ...french, translation: 'душ' }), 'ru')).toBe(false);
    expect(needsCompleting(word(french), 'ru')).toBe(true);
  });
});

describe('completing a word', () => {
  it('gives the meaning in the sentence and the plain one, and the explanation in the own language', async () => {
    expect(await completeWord(word(), 'ru', tools())).toEqual({
      translation: 'помоюсь · душ',
      definition: 'сущ. Короткий дождь.',
      definitionLang: 'ru',
    });
  });

  it('takes the word from the sentence by the form that was heard', async () => {
    const translate = vi.fn(async () => 'x');
    await completeWord(word({ form: 'went', word: 'go', context: 'She went.' }), 'ru', {
      ...tools(),
      translate,
    });
    expect(translate).toHaveBeenCalledWith('She «went».', 'en');
  });

  it('a translation that is there stays', async () => {
    const patch = await completeWord(word({ translation: 'душ' }), 'ru', tools());
    expect(patch).not.toHaveProperty('translation');
  });

  it('with the sentence lost the plain translation is enough', async () => {
    const patch = await completeWord(word({ context: 'Nothing here.' }), 'ru', tools());
    expect(patch.translation).toBe('душ');
  });

  it('a word the dictionary does not know is not asked again', async () => {
    const patch = await completeWord(word({ translation: 'душ' }), 'ru', {
      ...tools(),
      lookup: async () => null,
    });
    expect(patch).toEqual({ definitionLang: 'ru' });
  });

  it('with no translator nothing is written, so it is tried again next time', async () => {
    const patch = await completeWord(word({ definition: 'сущ. A brief fall.' }), 'ru', {
      ...tools(),
      translate: async () => {
        throw new Error('no model');
      },
    });
    expect(patch).toEqual({});
  });
});
