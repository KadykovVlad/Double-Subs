import type { WordLang } from './words';
import { t, type MessageKey } from './i18n';

/** The voice setting that means "a different voice for every word". */
export const RANDOM_VOICE = '*random*';

/** What chrome.tts tells about a voice. */
export interface VoiceInfo {
  voiceName?: string;
  lang?: string;
  /** Online voices send the text to a server; the ones built into the system do not. */
  remote?: boolean;
}

export interface VoiceOption {
  name: string;
  /** "United States", "United Kingdom" (in the user's language): where the accent is from. */
  accent: string;
  remote: boolean;
}

const ACCENTS: Record<string, MessageKey> = {
  'en-us': 'accent_us',
  'en-gb': 'accent_gb',
  'en-au': 'accent_au',
  'en-ca': 'accent_ca',
  'en-ie': 'accent_ie',
  'en-in': 'accent_in',
  'en-za': 'accent_za',
  'en-sc': 'accent_sc',
  'en-nz': 'accent_nz',
  'ru-ru': 'accent_ru',
};

const accentOf = (lang: string) => {
  const key = ACCENTS[lang.toLowerCase().replace('_', '-')];
  return key ? t(key) : lang;
};

/**
 * The voices of one language for the picker: built-in ones first, then online ones, each group by
 * accent and name. A voice listed twice (some systems do that) appears once.
 */
export function voiceOptions(voices: VoiceInfo[], lang: WordLang): VoiceOption[] {
  const seen = new Set<string>();
  const options: VoiceOption[] = [];
  for (const voice of voices) {
    if (
      !voice.voiceName ||
      !voice.lang?.toLowerCase().startsWith(lang) ||
      seen.has(voice.voiceName)
    )
      continue;
    seen.add(voice.voiceName);
    options.push({
      name: voice.voiceName,
      accent: accentOf(voice.lang),
      remote: Boolean(voice.remote),
    });
  }
  return options.sort(
    (a, b) =>
      Number(a.remote) - Number(b.remote) ||
      a.accent.localeCompare(b.accent) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * The voice to say a word with. A saved name is used as it is; nothing saved: the first built-in voice
 * (an online one only when the user picked it); "random": any built-in voice, a different one each time.
 */
export function chooseVoice(
  saved: string,
  voices: VoiceInfo[],
  lang: WordLang,
  random: () => number = Math.random,
): string | undefined {
  const local = voiceOptions(voices, lang).filter((v) => !v.remote);
  if (saved === RANDOM_VOICE)
    return local.length > 0 ? local[Math.floor(random() * local.length)]!.name : undefined;
  return saved || local[0]?.name;
}

/** Where to get more voices: it depends on the system. */
export function moreVoicesHint(userAgent: string): string {
  if (/Mac/i.test(userAgent)) return t('voices_more_mac');
  if (/Windows/i.test(userAgent)) return t('voices_more_windows');
  return t('voices_more_other');
}

/** The voices of the system; the test build can replace them (Playwright's Chromium has none). */
export async function loadVoices(): Promise<VoiceInfo[]> {
  if (import.meta.env.VITE_DS_E2E) {
    const { e2eVoices } = await browser.storage.local.get('e2eVoices');
    if (Array.isArray(e2eVoices)) return e2eVoices as VoiceInfo[];
  }
  return (await browser.tts.getVoices().catch(() => [])) as VoiceInfo[];
}
