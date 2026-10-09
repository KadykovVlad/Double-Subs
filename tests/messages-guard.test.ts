import { describe, expect, it } from 'vitest';
import { isValidSpeakMessage } from '../src/lib/speech';
import { isValidTranslationRequest } from '../src/lib/translation-messages';

describe('isValidSpeakMessage', () => {
  it('accepts a short word in a known language', () => {
    expect(isValidSpeakMessage({ type: 'speak', text: 'Hello', lang: 'en' })).toBe(true);
    expect(
      isValidSpeakMessage({ type: 'speak', text: 'Привет', lang: 'ru', voice: 'Milena' }),
    ).toBe(true);
  });
  it('refuses everything else', () => {
    expect(isValidSpeakMessage(null)).toBe(false);
    expect(isValidSpeakMessage({ type: 'speak', text: '', lang: 'en' })).toBe(false);
    expect(isValidSpeakMessage({ type: 'speak', text: 'x'.repeat(500), lang: 'en' })).toBe(false);
    expect(isValidSpeakMessage({ type: 'speak', text: 'Hi', lang: 'fr' })).toBe(false);
    expect(isValidSpeakMessage({ type: 'speak', text: 'Hi', lang: 'en', voice: 5 })).toBe(false);
  });
});

describe('isValidTranslationRequest', () => {
  it('accepts what the agent sends', () => {
    expect(isValidTranslationRequest({ type: 'availability', direction: 'en-ru' })).toBe(true);
    expect(
      isValidTranslationRequest({ type: 'translate', direction: 'ru-en', texts: ['Привет'] }),
    ).toBe(true);
    expect(isValidTranslationRequest({ type: 'cache-get', key: 'abc' })).toBe(true);
    expect(
      isValidTranslationRequest({ type: 'cache-put', key: 'abc', translations: ['a', ''] }),
    ).toBe(true);
    // A whole episode is cached at once.
    expect(
      isValidTranslationRequest({
        type: 'cache-put',
        key: 'abc',
        translations: Array(2500).fill('a'),
      }),
    ).toBe(true);
  });
  it('refuses wrong shapes and huge payloads', () => {
    expect(isValidTranslationRequest(undefined)).toBe(false);
    expect(isValidTranslationRequest({ type: 'translate', direction: 'fr-en', texts: [] })).toBe(
      false,
    );
    expect(isValidTranslationRequest({ type: 'translate', direction: 'en-ru', texts: [1] })).toBe(
      false,
    );
    expect(
      isValidTranslationRequest({
        type: 'translate',
        direction: 'en-ru',
        texts: Array(500).fill('a'),
      }),
    ).toBe(false);
    expect(
      isValidTranslationRequest({
        type: 'translate',
        direction: 'en-ru',
        texts: ['x'.repeat(5000)],
      }),
    ).toBe(false);
    expect(isValidTranslationRequest({ type: 'other' })).toBe(false);
  });
});
