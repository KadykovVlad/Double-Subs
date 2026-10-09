import { describe, expect, it } from 'vitest';
import {
  Dictionary,
  posName,
  shortDefinition,
  stemCandidates,
  type DictionaryData,
} from '../src/lib/dictionary';
import { isValidLookupMessage } from '../src/lib/dictionary-messages';

const data: DictionaryData = {
  forms: { went: 'go', gone: 'go', mice: 'mouse', running: 'run' },
  entries: {
    go: {
      i: '/ɡoʊ/',
      s: [
        ['verb', 'To move from one place to another.', 'To leave.'],
        ['noun', 'An attempt.'],
      ],
    },
    mouse: { s: [['noun', 'A small rodent.']] },
    run: { i: '/ɹʌn/', s: [['verb', 'To move quickly on foot.']] },
    stop: { s: [['verb', 'To cease.']] },
    wolf: { s: [['noun', 'A wild canine.']] },
    try: { s: [['verb', 'To attempt.']] },
  },
};
const dictionary = new Dictionary(data);

describe('Dictionary.lookup', () => {
  it('gives the dictionary form of an inflected word, with its meaning', () => {
    const info = dictionary.lookup('went')!;
    expect(info).toMatchObject({ lemma: 'go', inflected: true, ipa: '/ɡoʊ/' });
    expect(info.senses[0]).toEqual({
      pos: 'verb',
      meanings: ['To move from one place to another.', 'To leave.'],
    });
  });

  it('a dictionary word is its own form', () => {
    expect(dictionary.lookup('go')).toMatchObject({ lemma: 'go', inflected: false });
  });

  it('ignores case and the shape of the apostrophe, and gives null for the unknown', () => {
    expect(dictionary.lookup('WENT')!.lemma).toBe('go');
    expect(dictionary.lookup('zzzz')).toBeNull();
    expect(dictionary.lookup('')).toBeNull();
  });

  it('finds the form a rare word is missing by its ending, but only if the dictionary has that word', () => {
    expect(dictionary.lookup('wolves')).toBeNull(); // irregular: not guessable
    expect(dictionary.lookup('wolfs')!.lemma).toBe('wolf');
    expect(dictionary.lookup('stopped')!.lemma).toBe('stop');
    expect(dictionary.lookup('tried')!.lemma).toBe('try');
    expect(dictionary.lookup("wolf's")!.lemma).toBe('wolf');
  });
});

describe('contractions', () => {
  it('are explained, in either apostrophe, though the file does not hold them', () => {
    expect(dictionary.lookup("don't")!.senses).toEqual([
      { pos: 'contraction', meanings: ['do not'] },
    ]);
    expect(dictionary.lookup('I’m')!.senses[0]!.meanings).toEqual(['I am']);
    expect(dictionary.lookup("don't")!.inflected).toBe(false);
  });
});

describe('stemCandidates', () => {
  it('lists the plausible bases, never the word itself', () => {
    expect(stemCandidates('running')).toContain('run');
    expect(stemCandidates('hoping')).toContain('hope');
    expect(stemCandidates('cities')).toContain('city');
    expect(stemCandidates('go')).toEqual([]);
  });
});

describe('what the card shows', () => {
  it('names parts of speech in Russian and keeps unknown ones as they are', () => {
    expect(posName('verb')).toBe('глаг.');
    expect(posName('weird')).toBe('weird');
  });

  it('the short definition is the first meaning of the first part of speech', () => {
    expect(shortDefinition(dictionary.lookup('went')!)).toBe(
      'глаг. To move from one place to another.',
    );
  });
});

describe('lookup message', () => {
  it('accepts a short word and nothing else', () => {
    expect(isValidLookupMessage({ type: 'lookup-word', word: 'went' })).toBe(true);
    expect(isValidLookupMessage({ type: 'lookup-word', word: '' })).toBe(false);
    expect(isValidLookupMessage({ type: 'lookup-word', word: 'x'.repeat(41) })).toBe(false);
    expect(isValidLookupMessage({ type: 'lookup-word', word: 5 })).toBe(false);
    expect(isValidLookupMessage({ type: 'speak', word: 'a' })).toBe(false);
    expect(isValidLookupMessage(null)).toBe(false);
  });
});
