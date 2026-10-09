export type WordLang = 'en' | 'ru';

export interface TextPart {
  text: string;
  /** A word you can hover; spaces, punctuation and numbers are not. */
  word: boolean;
}

const segmenters = new Map<WordLang, Intl.Segmenter>();

/**
 * Splits a line into words and the text between them. Intl.Segmenter knows word boundaries
 * ("don't" is one word, "well-known" is two) without a dictionary, in any language.
 */
export function splitWords(text: string, lang: WordLang): TextPart[] {
  let segmenter = segmenters.get(lang);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
    segmenters.set(lang, segmenter);
  }
  const parts: TextPart[] = [];
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    // Numbers are "word-like" for the segmenter but there is nothing to translate in them.
    parts.push({ text: segment, word: Boolean(isWordLike) && /\p{L}/u.test(segment) });
  }
  return parts;
}

/** Same key for "Don't", "don't" and "don’t": the saved-words list holds a word once. */
export function wordKey(word: string, lang: WordLang): string {
  const normalized = word
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^'+|'+$/g, '');
  return `${lang}:${normalized}`;
}

/**
 * Does `candidate` (a word of the other line) look like the translation of the hovered word?
 * Russian and English inflect, so only the beginning is compared: "привет" matches "приветствую".
 */
export function matchesTranslation(translation: string, candidate: string): boolean {
  const target = translation.toLowerCase().replace(/ё/g, 'е');
  const word = candidate.toLowerCase().replace(/ё/g, 'е');
  if (target.length < 3 || word.length < 3) return false;
  const stem = target.slice(0, Math.max(3, Math.min(target.length - 2, 6)));
  return word.startsWith(stem);
}

/** The word, marked for the translator so that its meaning in this sentence can be picked out of the result. */
export const markWord = (word: string) => `«${word}»`;

/**
 * The translator keeps quotation marks around a word, so the part between them is that word as it
 * is translated in this very sentence. Null when the marks did not survive.
 */
export function extractMarked(translated: string): string | null {
  const match = /[«“„"]\s*([^«»“”„"]{1,60}?)\s*[»”"]/.exec(translated);
  return match?.[1]?.trim() || null;
}
