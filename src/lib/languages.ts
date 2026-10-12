import type { Role } from './analysis';

/** The two languages of the subtitles: the one the user learns (the upper line) and their own one. */
export interface LanguagePair {
  learn: string;
  native: string;
}

/** Until the user chooses: English to learn, Russian as their own (the pair the extension started with). */
export const DEFAULT_PAIR: LanguagePair = { learn: 'en', native: 'ru' };

/**
 * The languages that can be chosen: those Chrome's built-in translator knows (so that a missing
 * line can always be translated on the device). Base codes, no region.
 */
export const SUBTITLE_LANGUAGES = [
  'ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id',
  'it', 'ja', 'kn', 'ko', 'lt', 'mr', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'ta',
  'te', 'th', 'tr', 'uk', 'vi', 'zh',
] as const; // prettier-ignore

/** Old codes some sites (YouTube among them) still use. */
const ALIASES: Record<string, string> = { iw: 'he', in: 'id', nb: 'no', fil: 'tl' };

/** "en-US", "en_GB", "EN" → "en"; "iw" → "he". */
export function baseLang(code: string): string {
  const base = code.toLowerCase().split(/[-_]/)[0] ?? '';
  return ALIASES[base] ?? base;
}

export const sameLanguage = (a: string, b: string) => baseLang(a) === baseLang(b);

export const otherRole = (role: Role): Role => (role === 'learn' ? 'native' : 'learn');

/** A stored pair, checked: known languages, and two different ones; anything else gives the default. */
export function normalizePair(learn: unknown, native: unknown): LanguagePair {
  const known = (code: unknown): code is string =>
    typeof code === 'string' && (SUBTITLE_LANGUAGES as readonly string[]).includes(code);
  return known(learn) && known(native) && learn !== native ? { learn, native } : DEFAULT_PAIR;
}

/** "EN", "RU": how a language is written on the chip on the video. */
export const shortName = (code: string) => baseLang(code).toUpperCase();

/** The name of a language in another language ("английский"), falling back to its code. */
export function languageName(code: string, inLanguage: string): string {
  try {
    const names = new Intl.DisplayNames([inLanguage, 'en'], { type: 'language' });
    return names.of(baseLang(code)) ?? code;
  } catch {
    return code;
  }
}

/** A greeting to say when the user tries a voice, in every language that can be chosen. */
const SAMPLE_WORDS: Record<string, string> = {
  ar: 'مرحبا', bg: 'Здравей', bn: 'নমস্কার', cs: 'Ahoj', da: 'Hej', de: 'Hallo', el: 'Γεια σου',
  en: 'Hello, world', es: 'Hola', fi: 'Hei', fr: 'Bonjour', he: 'שלום', hi: 'नमस्ते', hr: 'Bok',
  hu: 'Szia', id: 'Halo', it: 'Ciao', ja: 'こんにちは', kn: 'ನಮಸ್ಕಾರ', ko: '안녕하세요', lt: 'Labas',
  mr: 'नमस्कार', nl: 'Hallo', no: 'Hei', pl: 'Cześć', pt: 'Olá', ro: 'Salut', ru: 'Привет, мир',
  sk: 'Ahoj', sl: 'Živjo', sv: 'Hej', ta: 'வணக்கம்', te: 'నమస్కారం', th: 'สวัสดี', tr: 'Merhaba',
  uk: 'Привіт', vi: 'Xin chào', zh: '你好',
}; // prettier-ignore

/** The word to try a voice with; for a language without a greeting, its name in that language. */
export function sampleWord(code: string): string {
  const base = baseLang(code);
  return SAMPLE_WORDS[base] ?? languageName(base, base);
}
