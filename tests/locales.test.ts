import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UI_LANGUAGES } from '../src/lib/ui-language';
import { chromeCode, chromeMessages, readLocales, SOURCE_LANGUAGE } from '../scripts/locales';

const locales = readLocales();
const source = locales.find((locale) => locale.code === SOURCE_LANGUAGE)!;
const keys = Object.keys(source.messages);
const placeholders = (text: string) => [...new Set(text.match(/\$\d/g) ?? [])].sort();

/** The interface languages Chrome knows (the folder names of _locales). */
const CHROME_LOCALES = new Set(
  'ar am bg bn ca cs da de el en en_AU en_GB en_US es es_419 et fa fi fil fr gu he hi hr hu id it ja kn ko lt lv ml mr ms nl no pl pt_BR pt_PT ro ru sk sl sr sv sw ta te th tr uk vi zh_CN zh_TW'.split(
    ' ',
  ),
);

describe('language files', () => {
  it('are named like Chrome names its languages', () => {
    for (const { code } of locales) expect(CHROME_LOCALES.has(chromeCode(code)), code).toBe(true);
  });

  it('are all offered in the language list of the panel, and only they', () => {
    expect([...UI_LANGUAGES].sort()).toEqual(locales.map((l) => l.code).sort());
  });

  it('English (the fallback) and Russian (the tests) exist', () => {
    expect(locales.map((l) => l.code)).toEqual(expect.arrayContaining(['en', 'ru']));
  });

  it.each(
    locales.filter((l) => l.code !== SOURCE_LANGUAGE).map((l) => [l.code, l.messages] as const),
  )(
    '%s has every text of the English file, no more, with the same $1 $2 places',
    (code, messages) => {
      expect(Object.keys(messages).sort(), code).toEqual([...keys].sort());
      for (const key of keys) {
        expect(messages[key]!.trim(), `${code}.${key}`).not.toBe('');
        expect(placeholders(messages[key]!), `${code}.${key}`).toEqual(
          placeholders(source.messages[key]!),
        );
      }
    },
  );

  it('keep the name and the store description within what the store allows', () => {
    for (const { code, messages } of locales) {
      expect(messages.extName!.length, code).toBeLessThanOrEqual(45);
      expect(messages.extDescription!.length, code).toBeLessThanOrEqual(132);
    }
  });

  it('stay small: one language is read at run time, and it is a few KB', () => {
    for (const { code, messages } of locales)
      expect(chromeMessages(messages).length, code).toBeLessThan(40_000);
  });

  it('have no text that no code asks for', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(join(__dirname, '../src'));
    walk(join(__dirname, '../entrypoints'));
    const code = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    const unused = keys.filter(
      (key) => !key.startsWith('ext') && !code.includes(`'${key}'`) && !code.includes(`"${key}"`),
    );
    expect(unused).toEqual([]);
  });
});
