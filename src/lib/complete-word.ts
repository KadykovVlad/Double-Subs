import { posName, type WordInfo } from './dictionary';
import { sameLanguage } from './languages';
import { clozeOf } from './review';
import type { SavedWord } from './saved-words';
import { bestTranslation, extractMarked, markWord } from './words';

export interface CompletingTools {
  /** Into the user's language; rejects when the translator cannot. */
  translate(text: string, from: string): Promise<string>;
  /** Null when the dictionary does not know the word. */
  lookup(word: string): Promise<WordInfo | null>;
}

/** The dictionary is English only: nothing to explain a word of another language with. */
const hasDictionary = (word: SavedWord) => word.lang === 'en';

/**
 * A word may be saved before its translation has come, and the dictionary explains in English. What
 * the word still lacks in the user's own language is filled in later; their own language needs nothing.
 */
export function needsCompleting(word: SavedWord, native: string): boolean {
  if (sameLanguage(word.lang, native)) return false;
  return !word.translation || (hasDictionary(word) && word.definitionLang !== native);
}

async function translationOf(word: SavedWord, tools: CompletingTools): Promise<string | null> {
  const heard = clozeOf(word);
  const inSentence = heard
    ? await tools
        .translate(`${heard.before}${markWord(heard.heard)}${heard.after}`, word.lang)
        .then(extractMarked)
        .catch(() => null)
    : null;
  const alone = await tools.translate(word.word, word.lang).catch(() => null);
  return bestTranslation(inSentence, alone);
}

/** What to write into the word; what could not be found stays for the next time. */
export async function completeWord(
  word: SavedWord,
  native: string,
  tools: CompletingTools,
): Promise<Partial<SavedWord>> {
  const patch: Partial<SavedWord> = {};
  if (!word.translation) {
    const translation = await translationOf(word, tools);
    if (translation) patch.translation = translation;
  }
  if (hasDictionary(word) && word.definitionLang !== native) {
    const sense = (await tools.lookup(word.word))?.senses[0];
    const meaning = sense?.meanings[0];
    if (!sense || !meaning) patch.definitionLang = native;
    else {
      const translated = await tools.translate(meaning, word.lang).catch(() => null);
      if (translated) {
        patch.definition = `${posName(sense.pos)} ${translated}`;
        patch.definitionLang = native;
      }
    }
  }
  return patch;
}
