import en from '../../locales/en.json';

/** Every text of the interface has a key in locales/en.json; a missing key is a compile error. */
export type MessageKey = keyof typeof en;

type Messages = Record<string, string>;

/** The languages written right to left. */
const RTL = new Set(['ar', 'he', 'fa']);

let language = 'en';
let messages: Messages = en;

/**
 * Switches the interface to `code` (its texts are `texts`, the file of locales/). English is built in, so
 * nothing has to be loaded for it, and a text missing from another file shows in English.
 */
export function setUiLanguage(code: string, texts: Messages | null): void {
  language = texts ? code : 'en';
  messages = texts ?? en;
}

export const uiLanguage = () => language;

/**
 * The text for `key` in the language the user chose (English at first). `$1`, `$2` in the text are
 * replaced by `substitutions`.
 */
export function t(key: MessageKey, ...substitutions: Array<string | number>): string {
  const text = messages[key] || (en as Messages)[key] || key;
  return text.replace(/\$(\d)/g, (_, n: string) => String(substitutions[Number(n) - 1] ?? ''));
}

/** For texts that are put into innerHTML or into an attribute: no translation can inject markup. */
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** "rtl" for Arabic, Hebrew, Persian; "ltr" otherwise. */
export function textDirection(): 'ltr' | 'rtl' {
  return RTL.has(language) ? 'rtl' : 'ltr';
}
