import { newSrs, normalizeSrs, type Srs } from './srs';
import { wordKey, type WordLang } from './words';

export interface SavedWord {
  /** lang + normalised word, see wordKey(). */
  key: string;
  word: string;
  lang: WordLang;
  translation: string | null;
  /** The subtitle line the word was saved from. */
  context: string;
  savedAt: number;
  /** The word as it was in the film, when `word` is its dictionary form ("went" for "go"). */
  form?: string;
  /** From the dictionary: "verb: to move from one place to another". */
  definition?: string;
  /** Repetition schedule; a word saved before it existed gets one when it is first read. */
  srs?: Srs;
  /** Starred by the user. */
  favorite?: boolean;
}

/** The keys that mark a word as saved in the subtitles: the dictionary form and the form it was saved from. */
export function savedKeys(list: SavedWord[]): Set<string> {
  const keys = new Set<string>();
  for (const item of list) {
    keys.add(item.key);
    if (item.form) keys.add(wordKey(item.form, item.lang));
  }
  return keys;
}

/** Saves the word, or removes it when it is already in the list. */
export function toggleWord(list: SavedWord[], entry: SavedWord): SavedWord[] {
  return list.some((item) => item.key === entry.key)
    ? list.filter((item) => item.key !== entry.key)
    : [{ ...entry, srs: entry.srs ?? newSrs(entry.savedAt) }, ...list];
}

/** Tab-separated text (word, translation, context, dictionary meaning) that Anki and spreadsheets import as it is. */
export function toTsv(list: SavedWord[]): string {
  const clean = (text: string | null | undefined) => (text ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  return list
    .map((item) =>
      [item.word, item.translation, item.context, item.definition].map(clean).join('\t'),
    )
    .join('\n');
}

const KEY = 'savedWords';

export async function loadSavedWords(): Promise<SavedWord[]> {
  const stored = await browser.storage.local.get(KEY);
  return Array.isArray(stored[KEY]) ? (stored[KEY] as SavedWord[]).map(withSrs) : [];
}

const withSrs = (word: SavedWord): SavedWord => ({
  ...word,
  srs: normalizeSrs(word.srs, word.savedAt),
});

/** Replaces the schedule of one word (after an answer in the review). */
export async function updateSavedSrs(key: string, srs: Srs): Promise<void> {
  const list = await loadSavedWords();
  await browser.storage.local.set({
    [KEY]: list.map((item) => (item.key === key ? { ...item, srs } : item)),
  });
}

/** Stars the word, or takes the star off. */
export async function toggleFavorite(key: string): Promise<void> {
  const list = await loadSavedWords();
  await browser.storage.local.set({
    [KEY]: list.map((item) => (item.key === key ? { ...item, favorite: !item.favorite } : item)),
  });
}

/** The words whose word, form, translation or line has `query` (any case). */
export function filterWords(list: SavedWord[], query: string): SavedWord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((item) =>
    [item.word, item.form, item.translation, item.context].some((text) =>
      text?.toLowerCase().includes(needle),
    ),
  );
}

export async function toggleSavedWord(entry: SavedWord): Promise<void> {
  await browser.storage.local.set({ [KEY]: toggleWord(await loadSavedWords(), entry) });
}

export async function removeSavedWord(key: string): Promise<void> {
  await browser.storage.local.set({
    [KEY]: (await loadSavedWords()).filter((item) => item.key !== key),
  });
}

/** Calls `listener` with the whole list whenever it changes anywhere (popup, any frame). */
export function watchSavedWords(listener: (list: SavedWord[]) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && KEY in changes) {
      const value = changes[KEY]!.newValue;
      listener(Array.isArray(value) ? (value as SavedWord[]).map(withSrs) : []);
    }
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
