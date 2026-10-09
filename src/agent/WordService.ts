import { lookupWord } from '../lib/dictionary-messages';
import { shortDefinition, type WordInfo } from '../lib/dictionary';
import { toggleSavedWord } from '../lib/saved-words';
import { speakWord } from '../lib/speech';
import { extractMarked, wordKey, type WordLang } from '../lib/words';
import type { WordTools, WordTranslation } from '../overlay/words-ui';
import { offscreenTranslationService } from '../translation/client';
import type { TranslationErrorCode } from '../lib/translation-messages';
import { TranslationError } from '../translation/session';

const CACHE_LIMIT = 500;

/**
 * What hovering and clicking a word does: translate it (alone and inside its sentence), say it aloud,
 * save it. A word or sentence is translated once per page.
 */
export class WordService implements WordTools {
  private readonly cache = new Map<string, string>();
  private readonly lookups = new Map<string, Promise<WordInfo | null>>();

  async translate(word: string, lang: WordLang): Promise<WordTranslation> {
    const direction = lang === 'en' ? 'en-ru' : 'ru-en';
    const result = await this.ask(`${direction}:${word.toLowerCase()}`, direction, word);
    return 'error' in result || !result.text
      ? { ok: false, reason: 'error' in result ? result.error : 'failed' }
      : { ok: true, text: result.text };
  }

  /** The word translated inside its sentence: the word is marked, and found again in the result. */
  async translateInContext(
    _word: string,
    lang: WordLang,
    markedSentence: string,
  ): Promise<WordTranslation> {
    const direction = lang === 'en' ? 'en-ru' : 'ru-en';
    const result = await this.ask(`ctx:${direction}:${markedSentence}`, direction, markedSentence);
    if ('error' in result) return { ok: false, reason: result.error };
    const meaning = extractMarked(result.text);
    return meaning ? { ok: true, text: meaning } : { ok: false, reason: 'failed' };
  }

  /** The dictionary form and meaning of an English word (the dictionary is English only). Once per word. */
  lookup(word: string, lang: WordLang): Promise<WordInfo | null> {
    if (lang !== 'en') return Promise.resolve(null);
    const key = word.toLowerCase();
    let known = this.lookups.get(key);
    if (!known) {
      known = lookupWord(word);
      if (this.lookups.size > CACHE_LIMIT) this.lookups.clear();
      this.lookups.set(key, known);
    }
    return known;
  }

  speak(word: string, lang: WordLang): void {
    speakWord(word, lang);
  }

  /** One entry per dictionary word: "went" and "going" are saved as "go" (and the form that was met is kept). */
  toggleSaved({
    word,
    lang,
    translation,
    context,
    info,
  }: Parameters<WordTools['toggleSaved']>[0]): void {
    const base = info?.inflected ? info.lemma : word;
    const entry = {
      key: wordKey(base, lang),
      word: base,
      lang,
      translation,
      context,
      savedAt: Date.now(),
      ...(info?.inflected ? { form: word } : {}),
      ...(info ? { definition: shortDefinition(info) ?? undefined } : {}),
    };
    void toggleSavedWord(entry).catch(() => {});
  }

  /** The translation, from the cache or from the translator; the error code when it did not work. */
  private async ask(
    cacheKey: string,
    direction: 'en-ru' | 'ru-en',
    text: string,
  ): Promise<{ text: string } | { error: TranslationErrorCode }> {
    const known = this.cache.get(cacheKey);
    if (known !== undefined) return { text: known };
    try {
      const translated = (await offscreenTranslationService.translate(direction, [text]))[0] ?? '';
      if (this.cache.size > CACHE_LIMIT) this.cache.clear();
      this.cache.set(cacheKey, translated);
      return { text: translated };
    } catch (error) {
      return { error: error instanceof TranslationError ? error.code : 'failed' };
    }
  }
}
