import { SUBTITLE_LANGUAGES } from './languages';
import type { WordLang } from './words';

/** Page → background: say a word aloud with the system voice. */
export interface SpeakMessage {
  type: 'speak';
  text: string;
  lang: WordLang;
  /** A voice picked in the popup's list, to hear it; otherwise the saved choice is used. */
  voice?: string;
}

/** BCP 47 tags the system voices are looked up by (a plain code lets the system pick the region). */
const VOICE_REGION: Record<string, string> = { en: 'en-US', ru: 'ru-RU' };
export const voiceLang = (lang: WordLang) => VOICE_REGION[lang] ?? lang;

/** A little slower than normal speech: single words are easier to catch. */
export const SPEECH_RATE = 0.9;

/**
 * Speech goes through chrome.tts in the background. The page's own speechSynthesis stays silent
 * unless the user has just clicked in that very frame, which hovering never does.
 */
export function speakWord(text: string, lang: WordLang, voice?: string): void {
  void browser.runtime
    .sendMessage({ type: 'speak', text, lang, voice } satisfies SpeakMessage)
    .catch(() => {});
}

const MAX_SPOKEN_CHARS = 80;
const MAX_VOICE_NAME = 200;

/** What the background accepts as "say this": a short text, a known language, a plain voice name. */
export function isValidSpeakMessage(message: unknown): message is SpeakMessage {
  const m = message as Partial<SpeakMessage> | null;
  return (
    typeof m === 'object' &&
    m !== null &&
    m.type === 'speak' &&
    typeof m.text === 'string' &&
    m.text.length > 0 &&
    m.text.length <= MAX_SPOKEN_CHARS &&
    typeof m.lang === 'string' &&
    (SUBTITLE_LANGUAGES as readonly string[]).includes(m.lang) &&
    (m.voice === undefined || (typeof m.voice === 'string' && m.voice.length <= MAX_VOICE_NAME))
  );
}
