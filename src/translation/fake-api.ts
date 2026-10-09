import type { TranslatorInstance, TranslatorStatic } from '../lib/translator';

/**
 * A stand-in for the built-in translator, used by the e2e build only: Playwright's Chromium has no
 * language model and downloading one needs a click. The mode ('fake' by default, 'slow', 'needs-model'
 * or 'real') is kept in extension storage by the test; the background reads it and passes it along,
 * because offscreen documents have no access to the storage API.
 */
const DICTIONARY: Record<string, string> = {
  'Hello, Dexter.': 'привет, Декстер.', // lower case on purpose: the polish step must capitalise it
  'Tonight is the night.': 'сегодня та самая ночь.',
  "I'm not who you think I am.": 'я не тот, кем ты меня считаешь.',
  // Single words, for the hover tests.
  Hello: 'привет',
  Dexter: 'Декстер',
  night: 'ночь',
  // The same words marked inside their sentence (meaning in context).
  '«Hello», Dexter.': '«здравствуй», Декстер.',
  'Hello, «Dexter».': 'привет, «Декстер».',
};

const SLOW_DELAY_MS = 250;

const instance = (delayMs: number): TranslatorInstance => ({
  async translate(text) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return DICTIONARY[text] ?? `[ru] ${text}`;
  },
  destroy() {},
});

const api = (availability: 'available' | 'downloadable', delayMs = 0): TranslatorStatic => {
  const translator = instance(delayMs);
  return { availability: async () => availability, create: async () => translator };
};

const APIS = {
  fake: api('available'),
  slow: api('available', SLOW_DELAY_MS),
  'needs-model': api('downloadable'),
};

export function e2eTranslatorApi(mode: string | undefined): TranslatorStatic | null {
  if (mode === 'real') return null;
  return APIS[mode as keyof typeof APIS] ?? APIS.fake;
}
