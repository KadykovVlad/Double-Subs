import { setUiLanguage } from './i18n';

/**
 * The languages of the interface: the files of locales/ (a test keeps the two lists equal). The names are
 * not stored: Intl writes each language in itself.
 */
export const UI_LANGUAGES = [
  'am', 'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'es-419', 'et', 'fa', 'fi', 'fil', 'fr', 'gu',
  'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'ms', 'nl', 'no', 'pl', 'pt-BR',
  'pt-PT', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW',
] as const; // prettier-ignore

export const DEFAULT_UI_LANGUAGE = 'en';

/** The language the user chose, with its texts, so that every part of the extension reads it from one place. */
const KEY = 'uiLanguage';

interface Stored {
  code: string;
  messages: Record<string, string> | null;
}

/** A language in itself: "Deutsch", "日本語". */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}

const folder = (code: string) => code.replace('-', '_');

/** Reads the file of a language from the package (Chrome keeps it in _locales; only the panel may ask for it). */
async function fetchMessages(code: string): Promise<Record<string, string>> {
  const response = await fetch(
    browser.runtime.getURL(`/_locales/${folder(code)}/messages.json` as '/'),
  );
  const raw = (await response.json()) as Record<string, { message: string }>;
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value.message]));
}

function apply(stored: Stored | undefined): void {
  setUiLanguage(stored?.code ?? DEFAULT_UI_LANGUAGE, stored?.messages ?? null);
}

/** Spanish of the Americas has its own file; the rest of Spanish is the one of Spain. */
const SPANISH_AMERICAS = new Set(
  'AR BO CL CO CR CU DO EC GT HN MX NI PA PE PR PY SV US UY VE 419'.split(' '),
);
/** Codes a browser may report that the files of locales/ name differently. */
const ALIASES: Record<string, string> = {
  nb: 'no',
  nn: 'no',
  iw: 'he',
  tl: 'fil',
  pt: 'pt-BR',
  zh: 'zh-CN',
};

/**
 * The language of the interface for a user who has not chosen one: the language of the browser
 * ("ru-RU" → "ru", "pt-PT" → "pt-PT", "es-MX" → "es-419"), English when it is not among ours.
 */
export function detectUiLanguage(browserLanguage: string): string {
  const [base = '', region = ''] = browserLanguage.replace('_', '-').split('-');
  const lower = base.toLowerCase();
  const upper = region.toUpperCase();
  const known = (code: string) => (UI_LANGUAGES as readonly string[]).includes(code);
  if (lower === 'es' && SPANISH_AMERICAS.has(upper)) return 'es-419';
  if (lower === 'zh' && (upper === 'TW' || upper === 'HK' || upper === 'MO')) return 'zh-TW';
  const full = region ? `${lower}-${upper}` : lower;
  if (known(full)) return full;
  const alias = ALIASES[lower];
  if (alias && known(alias)) return alias;
  return known(lower) ? lower : DEFAULT_UI_LANGUAGE;
}

/**
 * For the pages of the extension that show the interface: a user who has never chosen a language gets
 * the one of the browser (saved, so the other pages and the page's agent follow). Only these pages ask,
 * because only they may read the language files of the package.
 */
export async function ensureUiLanguage(): Promise<void> {
  try {
    const got = await browser.storage.local.get(KEY);
    if (got[KEY]) return;
    const code = detectUiLanguage(browser.i18n.getUILanguage());
    if (code !== DEFAULT_UI_LANGUAGE) await chooseUiLanguage(code);
  } catch {
    // no language file or no storage: the interface stays English until the user chooses
  }
}

/** At the start of a page of the extension or of the agent: from now on `t()` speaks the chosen language. */
export async function loadUiLanguage(): Promise<void> {
  try {
    const got = await browser.storage.local.get(KEY);
    apply(got[KEY] as Stored | undefined);
  } catch {
    apply(undefined);
  }
}

/** Called when the user chooses a language in the panel: every open page follows through `watchUiLanguage`. */
export async function chooseUiLanguage(code: string): Promise<void> {
  const messages = code === DEFAULT_UI_LANGUAGE ? null : await fetchMessages(code);
  await browser.storage.local.set({ [KEY]: { code, messages } satisfies Stored });
  apply({ code, messages });
}

/** `listener` runs after another page changed the language (and `t()` already speaks it). */
export function watchUiLanguage(listener: (code: string) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area !== 'local' || !changes[KEY]) return;
    const stored = changes[KEY].newValue as Stored | undefined;
    apply(stored);
    listener(stored?.code ?? DEFAULT_UI_LANGUAGE);
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
