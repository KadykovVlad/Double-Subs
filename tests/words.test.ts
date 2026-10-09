import { describe, expect, it } from 'vitest';
import { savedKeys, toggleWord, toTsv, type SavedWord } from '../src/lib/saved-words';
import { extractMarked, markWord, matchesTranslation, splitWords, wordKey } from '../src/lib/words';

const wordsOf = (text: string, lang: 'en' | 'ru') =>
  splitWords(text, lang)
    .filter((p) => p.word)
    .map((p) => p.text);

describe('splitWords', () => {
  it('splits English into words and keeps punctuation and spaces as plain text', () => {
    expect(splitWords('Hello, Dexter.', 'en')).toEqual([
      { text: 'Hello', word: true },
      { text: ',', word: false },
      { text: ' ', word: false },
      { text: 'Dexter', word: true },
      { text: '.', word: false },
    ]);
  });

  it('keeps contractions together and splits hyphenated words', () => {
    expect(wordsOf("I don't know the well-known guy", 'en')).toEqual([
      'I',
      "don't",
      'know',
      'the',
      'well',
      'known',
      'guy',
    ]);
    expect(wordsOf('It’s fine', 'en')).toEqual(['It’s', 'fine']);
  });

  it('works for Russian', () => {
    expect(wordsOf('Я не тот, кем ты меня считаешь.', 'ru')).toEqual([
      'Я',
      'не',
      'тот',
      'кем',
      'ты',
      'меня',
      'считаешь',
    ]);
  });

  it('does not offer numbers for translation', () => {
    expect(wordsOf('At 8 o’clock, 2 times', 'en')).toEqual(['At', 'o’clock', 'times']);
  });

  it('gives the text back unchanged when the parts are joined', () => {
    const text = '- Hi!\n- Wait... you mean the guy from the diner?';
    expect(
      splitWords(text, 'en')
        .map((p) => p.text)
        .join(''),
    ).toBe(text);
  });

  it('handles an empty string', () => {
    expect(splitWords('', 'en')).toEqual([]);
  });
});

describe('wordKey', () => {
  it('ignores case, curly apostrophes and quotes around the word', () => {
    expect(wordKey("Don't", 'en')).toBe("en:don't");
    expect(wordKey('don’t', 'en')).toBe("en:don't");
    expect(wordKey("'hello'", 'en')).toBe('en:hello');
  });

  it('keeps languages apart', () => {
    expect(wordKey('кот', 'ru')).toBe('ru:кот');
    expect(wordKey('кот', 'ru')).not.toBe(wordKey('кот', 'en'));
  });
});

describe('matchesTranslation', () => {
  it('compares word beginnings, because both languages inflect', () => {
    expect(matchesTranslation('привет', 'Привет')).toBe(true);
    expect(matchesTranslation('привет', 'приветствую')).toBe(true);
    expect(matchesTranslation('сказал', 'сказала')).toBe(true);
    expect(matchesTranslation('берёт', 'берет')).toBe(true); // ё and е are the same here
  });

  it('does not match unrelated or too short words', () => {
    expect(matchesTranslation('привет', 'пока')).toBe(false);
    expect(matchesTranslation('да', 'дарить')).toBe(false);
    expect(matchesTranslation('ночь', 'на')).toBe(false);
  });
});

describe('saved words', () => {
  const entry = (word: string, context = 'a line'): SavedWord => ({
    key: wordKey(word, 'en'),
    word,
    lang: 'en',
    translation: 'перевод',
    context,
    savedAt: 1,
  });

  it('toggleWord adds a new word first and removes a saved one', () => {
    const one = toggleWord([], entry('hello'));
    const two = toggleWord(one, entry('night'));
    expect(two.map((w) => w.word)).toEqual(['night', 'hello']);
    expect(toggleWord(two, entry('Hello')).map((w) => w.word)).toEqual(['night']); // same key, other case
  });

  it('toTsv makes one line per word with tabs only between columns', () => {
    const list = [entry('hello', 'Hello,\tDexter.\n'), { ...entry('night'), translation: null }];
    expect(toTsv(list)).toBe('hello\tперевод\tHello, Dexter.\t\nnight\t\ta line\t');
  });

  it('toTsv adds the dictionary meaning as the last column', () => {
    expect(toTsv([{ ...entry('go'), definition: 'глаг. to move' }])).toBe(
      'go\tперевод\ta line\tглаг. to move',
    );
  });

  it('a form of a saved word counts as saved: both the dictionary word and the form that was met', () => {
    const list: SavedWord[] = [{ ...entry('go'), form: 'went' }];
    expect([...savedKeys(list)].sort()).toEqual(['en:go', 'en:went']);
  });
});

describe('meaning in context', () => {
  it('marks a word and finds it again in the translation', () => {
    expect(markWord('lit')).toBe('«lit»');
    expect(extractMarked('Он «зажёг» огонь.')).toBe('зажёг');
    expect(extractMarked('He "lit" the fire.')).toBe('lit');
    expect(extractMarked('Он “ зажёг ” огонь')).toBe('зажёг');
  });

  it('gives null when the marks did not survive the translation', () => {
    expect(extractMarked('Он зажёг огонь.')).toBeNull();
    expect(extractMarked('«»')).toBeNull();
  });
});
