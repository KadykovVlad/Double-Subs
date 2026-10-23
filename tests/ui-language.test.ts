import { describe, expect, it } from 'vitest';
import { detectUiLanguage, UI_LANGUAGES } from '../src/lib/ui-language';

describe('the language of the interface for a user who has not chosen', () => {
  it.each([
    ['ru', 'ru'],
    ['ru-RU', 'ru'],
    ['en-GB', 'en'],
    ['pt-BR', 'pt-BR'],
    ['pt-PT', 'pt-PT'],
    ['pt', 'pt-BR'],
    ['zh-CN', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh', 'zh-CN'],
    ['es-ES', 'es'],
    ['es-MX', 'es-419'],
    ['es-419', 'es-419'],
    ['nb', 'no'],
    ['nb-NO', 'no'],
    ['iw', 'he'],
    ['tl', 'fil'],
    ['uk_UA', 'uk'],
    ['xx', 'en'],
    ['', 'en'],
  ])('%s → %s', (browser, expected) => {
    expect(detectUiLanguage(browser)).toBe(expected);
  });

  it('always answers with a language that has a file', () => {
    for (const code of ['de-AT', 'fr-CA', 'ar-EG', 'sr-Latn', 'sw-KE'])
      expect(UI_LANGUAGES as readonly string[]).toContain(detectUiLanguage(code));
  });
});
