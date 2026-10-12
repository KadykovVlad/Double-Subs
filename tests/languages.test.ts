import { describe, expect, it } from 'vitest';
import { analyzeTracks, trackLanguage } from '../src/lib/analysis';
import {
  baseLang,
  DEFAULT_PAIR,
  languageName,
  normalizePair,
  sameLanguage,
  sampleWord,
  SUBTITLE_LANGUAGES,
} from '../src/lib/languages';
import { normalizeSettings } from '../src/lib/settings';
import { directionOf, translatorOptions } from '../src/lib/translator';
import type { Cue } from '../src/lib/types';

describe('language codes', () => {
  it('compare by the base language, regions and old codes included', () => {
    expect(baseLang('en-US')).toBe('en');
    expect(baseLang('pt_BR')).toBe('pt');
    expect(baseLang('iw')).toBe('he');
    expect(sameLanguage('en-GB', 'en')).toBe(true);
    expect(sameLanguage('en', 'ru')).toBe(false);
  });

  it('every language offered is a plain code the translator can be given', () => {
    for (const code of SUBTITLE_LANGUAGES) expect(code).toMatch(/^[a-z]{2,3}$/);
  });

  it('every language offered has a greeting to try its voice with', () => {
    for (const code of SUBTITLE_LANGUAGES) expect(sampleWord(code).length, code).toBeGreaterThan(1);
    expect(sampleWord('ko-KR')).toBe('안녕하세요');
    expect(sampleWord('xx')).toBe('xx'); // unknown: the code itself
  });

  it('are named in the language of the interface', () => {
    expect(languageName('en', 'ru')).toBe('английский');
    expect(languageName('ru', 'en')).toBe('Russian');
    expect(languageName('de-DE', 'ru')).toBe('немецкий');
  });
});

describe('the pair of languages', () => {
  it('is English and Russian until the user chooses', () => {
    expect(normalizeSettings({})).toMatchObject({ learnLang: 'en', nativeLang: 'ru' });
    expect(DEFAULT_PAIR).toEqual({ learn: 'en', native: 'ru' });
  });

  it('keeps a valid choice and refuses an unknown or doubled one', () => {
    expect(normalizePair('de', 'fr')).toEqual({ learn: 'de', native: 'fr' });
    expect(normalizePair('de', 'de')).toEqual(DEFAULT_PAIR);
    expect(normalizePair('xx', 'fr')).toEqual(DEFAULT_PAIR);
    expect(normalizeSettings({ learnLang: 'ja', nativeLang: 'uk' })).toMatchObject({
      learnLang: 'ja',
      nativeLang: 'uk',
    });
  });
});

describe('translation directions', () => {
  it('any two different languages offered', () => {
    expect(directionOf('en-US', 'de')).toBe('en-de');
    expect(translatorOptions('en-de')).toEqual({ sourceLanguage: 'en', targetLanguage: 'de' });
    expect(translatorOptions('en-en')).toBeNull();
    expect(translatorOptions('en-xx')).toBeNull();
    expect(translatorOptions('en-de-fr')).toBeNull();
  });
});

describe('the language of a track on a site', () => {
  it('the text decides for English and Russian, whatever the site says', () => {
    expect(trackLanguage('en', 'ru')).toBe('en');
    expect(trackLanguage('ru', 'en')).toBe('ru');
    expect(trackLanguage('other', 'en')).toBe('other'); // a "English" label on a non-English text
  });

  it('where the text only says "not those", the language the site gives is believed', () => {
    expect(trackLanguage('other', 'de')).toBe('de');
    expect(trackLanguage('other', 'pt-BR')).toBe('pt');
    expect(trackLanguage('other', undefined)).toBe('other');
    expect(trackLanguage('unknown', 'de')).toBe('unknown'); // too little text: still not used
  });

  it('Cyrillic that the site calls Ukrainian is Ukrainian', () => {
    expect(trackLanguage('ru', 'uk')).toBe('uk');
    expect(trackLanguage('ru', 'de')).toBe('ru');
  });

  const cues = (text: string, n = 12): Cue[] =>
    Array.from({ length: n }, (_, i) => ({ start: i * 3, end: i * 3 + 2, text: `${text} ${i}` }));

  it('picks the tracks of the chosen pair', () => {
    const german = cues('Ich weiß nicht, was du meinst, aber wir gehen heute Abend');
    const english = cues('I do not know what you mean, but we are going tonight');
    const russian = cues('Я не знаю, что ты имеешь в виду, но мы идём сегодня');
    const tracks = [
      { label: 'Русский', cues: russian, declared: 'ru' },
      { label: 'Deutsch', cues: german, declared: 'de' },
      { label: 'English', cues: english, declared: 'en' },
    ];
    expect(
      analyzeTracks(tracks, { durationSec: null, pair: { learn: 'de', native: 'en' } }).decision,
    ).toEqual({ case: 'A', learn: 1, native: 2, translateFrom: null });
    // The pair it started with is unchanged.
    expect(analyzeTracks(tracks, { durationSec: null }).decision).toEqual({
      case: 'A',
      learn: 2,
      native: 0,
      translateFrom: null,
    });
  });
});
