import type { WordInfo } from './dictionary';

/** Page → background: what does the dictionary know about this word? */
export interface LookupWordMessage {
  type: 'lookup-word';
  word: string;
}

const MAX_WORD_CHARS = 40;

export function isValidLookupMessage(message: unknown): message is LookupWordMessage {
  const m = message as Partial<LookupWordMessage> | null;
  return (
    typeof m === 'object' &&
    m !== null &&
    m.type === 'lookup-word' &&
    typeof m.word === 'string' &&
    m.word.length > 0 &&
    m.word.length <= MAX_WORD_CHARS
  );
}

/** The dictionary lives in the background (the file is big): pages ask it. Null: unknown word, or no answer. */
export async function lookupWord(word: string): Promise<WordInfo | null> {
  try {
    return (
      ((await browser.runtime.sendMessage({
        type: 'lookup-word',
        word,
      } satisfies LookupWordMessage)) as WordInfo | null) ?? null
    );
  } catch {
    return null;
  }
}
