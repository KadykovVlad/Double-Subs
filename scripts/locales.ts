// The language files: locales/<code>.json is a flat { key: text }. Chrome wants _locales/<code>/messages.json
// with { key: { message } }; the codes with a region are written with an underscore (pt-BR → pt_BR).
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The language the extension falls back to, and the one every other file is checked against. */
export const SOURCE_LANGUAGE = 'en';
export const LOCALES_DIR = fileURLToPath(new URL('../locales/', import.meta.url));

export type Messages = Record<string, string>;

export const chromeCode = (code: string) => code.replace('-', '_');

/** Every language file: [{ code: 'ru', messages: { key: text } }, ...] */
export function readLocales(): Array<{ code: string; messages: Messages }> {
  return readdirSync(LOCALES_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({
      code: basename(name, '.json'),
      messages: JSON.parse(readFileSync(join(LOCALES_DIR, name), 'utf8')) as Messages,
    }));
}

/** The content of _locales/<code>/messages.json, as small as it can be. */
export function chromeMessages(messages: Messages): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(messages).map(([key, message]) => [key, { message }])),
  );
}
