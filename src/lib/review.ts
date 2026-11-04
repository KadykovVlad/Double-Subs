import type { SavedWord } from './saved-words';

/**
 * How a word is practised. Memory grows from being made to work, as far as it can succeed: a word
 * starts as recognition, goes on to recall from nothing, and ends as producing the word in its sentence.
 * The sentence from the film is the strongest cue, so a recall card keeps it back until the answer.
 */
export type Exercise = 'choose' | 'recall' | 'type';

/** Right answers after which a word is produced rather than recalled. */
const TYPE_FROM_REPS = 3;
const WRONG_CHOICES = 3;

/** Short sessions, often: more new words than this at once only crowd each other out. */
export const MAX_NEW = 8;
export const MAX_SESSION = 20;
/** A forgotten word comes back after this many other cards: soon, but not from a memory of a moment ago. */
export const RETRY_AFTER = 3;

const isNew = (word: SavedWord) => word.srs!.reps === 0 && word.srs!.lapses === 0;

/** Who to practise now: what is waiting comes first, the new words are mixed in among it. */
export function buildSession(due: SavedWord[]): SavedWord[] {
  const old = due.filter((word) => !isNew(word));
  const fresh = due.filter(isNew).slice(0, MAX_NEW);
  const session: SavedWord[] = [];
  while (old.length > 0 || fresh.length > 0) {
    session.push(...old.splice(0, 2), ...fresh.splice(0, 1));
  }
  return session.slice(0, MAX_SESSION);
}

/** The queue with a forgotten word put back a few cards ahead. */
export function retryLater(queue: SavedWord[], index: number, word: SavedWord): SavedWord[] {
  const at = Math.min(queue.length, index + 1 + RETRY_AFTER);
  return [...queue.slice(0, at), word, ...queue.slice(at)];
}

/** The film's sentence around the word, or null when the word cannot be found in it as a whole word. */
export function clozeOf(word: SavedWord): { before: string; heard: string; after: string } | null {
  const heard = word.form ?? word.word;
  const escaped = heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').exec(
    word.context,
  );
  if (!found) return null;
  return {
    before: word.context.slice(0, found.index),
    heard: found[0],
    after: word.context.slice(found.index + found[0].length),
  };
}

/** Other translations to choose from: saved in the same language, none the same as the right one. */
export function wrongChoices(word: SavedWord, pool: SavedWord[], pick = Math.random): string[] {
  const others = [
    ...new Set(
      pool
        .filter((other) => other.lang === word.lang && other.key !== word.key)
        .map((other) => other.translation)
        .filter((text): text is string => !!text && text !== word.translation),
    ),
  ];
  return shuffle(others, pick).slice(0, WRONG_CHOICES);
}

export function shuffle<T>(list: T[], pick = Math.random): T[] {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(pick() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** The exercise a word is ready for; what it lacks for a harder or an easier one decides too. */
export function exerciseFor(word: SavedWord, pool: SavedWord[]): Exercise {
  if (!word.translation) return 'recall';
  if (word.srs!.reps >= TYPE_FROM_REPS) return clozeOf(word) ? 'type' : 'recall';
  if (word.srs!.reps > 0) return 'recall';
  return wrongChoices(word, pool).length >= WRONG_CHOICES ? 'choose' : 'recall';
}

export type Typed = 'right' | 'almost' | 'wrong';

const plain = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’`]/g, "'").trim().toLowerCase();

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        row[j]! + 1,
        next[j - 1]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length]!;
}

/** The form heard in the film and the dictionary form both count; one slip in a longer word is a typo. */
export function checkTyped(input: string, word: SavedWord): Typed {
  const given = plain(input);
  const accepted = [word.form, word.word].filter((text): text is string => !!text).map(plain);
  if (accepted.includes(given)) return 'right';
  return accepted.some((text) => text.length >= 5 && distance(given, text) === 1)
    ? 'almost'
    : 'wrong';
}
