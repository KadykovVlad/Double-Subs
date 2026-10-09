import type { Cue } from '../lib/types';
import type {
  Direction,
  ModelAvailability,
  TranslationErrorCode,
  TranslationStatus,
} from '../lib/translation-messages';
import { currentCueIndex, nextChunkStart } from './chunks';
import { fingerprint } from './fingerprint';
import { polishTranslation, toTranslatorText } from './polish';

/** What the session needs from the outside; the real one talks to the offscreen document. */
export interface TranslationService {
  availability(direction: Direction): Promise<ModelAvailability>;
  /** One translation per text, in order; an empty string for a text that could not be translated. */
  translate(direction: Direction, texts: string[]): Promise<string[]>;
  cacheGet(key: string): Promise<string[] | null>;
  cachePut(key: string, translations: string[]): Promise<void>;
}

export class TranslationError extends Error {
  constructor(readonly code: TranslationErrorCode) {
    super(code);
  }
}

export interface TranslationUpdate {
  /** The translated cues so far: same timing as the source cues, in order. */
  cues: Cue[];
  status: TranslationStatus;
}

export interface TranslationOptions {
  source: Cue[];
  direction: Direction;
  /** Current playback time: the chunk around it is translated first. */
  getTime: () => number;
  service: TranslationService;
  onUpdate: (update: TranslationUpdate) => void;
  signal?: AbortSignal;
  /** About 0.3 s of translator time per chunk, so the first lines appear at once. */
  chunkSize?: number;
  /** Pause between retries; tests pass 0. */
  retryDelayMs?: number;
}

const DEFAULT_CHUNK_SIZE = 20;
const ATTEMPTS_PER_CHUNK = 3;
const FAILED_CHUNKS_BEFORE_GIVING_UP = 3;
/** The cache is written every few chunks, not after each one: it holds a whole episode. */
const CHUNKS_PER_CACHE_WRITE = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Translates `source` chunk by chunk, nearest to the playback position first, saving progress in
 * the cache. Resolves when everything is translated, the work was stopped, or it cannot go on
 * (the final state is the last `onUpdate`).
 */
export async function runTranslation(options: TranslationOptions): Promise<void> {
  const { source, direction, getTime, service, onUpdate, signal } = options;
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const retryDelayMs = options.retryDelayMs ?? 300;
  const total = source.length;

  /** '' = not translated (yet). */
  const translations: string[] = new Array<string>(total).fill('');
  const failed = new Set<number>();
  const texts = source.map((cue) => toTranslatorText(cue.text));
  const doneCount = () => translations.filter((text) => text !== '').length;

  const translatedCues = (): Cue[] =>
    source.flatMap((cue, i) =>
      translations[i] ? [{ start: cue.start, end: cue.end, text: translations[i]! }] : [],
    );
  const emit = (status: TranslationStatus) => onUpdate({ cues: translatedCues(), status });

  if (total === 0) return emit({ state: 'done', total: 0, fromCache: false });

  const key = await fingerprint(texts, direction);
  let unsaved = 0;
  const save = async () => {
    if (unsaved === 0) return;
    unsaved = 0;
    await service.cachePut(key, translations).catch(() => {});
  };

  const cached = await service.cacheGet(key).catch(() => null);
  if (cached && cached.length === total) {
    cached.forEach((text, i) => (translations[i] = text));
  }
  if (doneCount() === total) return emit({ state: 'done', total, fromCache: true });
  emit({ state: 'translating', done: doneCount(), total });

  const availability = await service
    .availability(direction)
    .catch((): ModelAvailability => 'unavailable');
  if (availability !== 'available') {
    return emit({ state: availability === 'needs-model' ? 'needs-model' : 'unavailable' });
  }

  const pending = (i: number) => translations[i] === '' && !failed.has(i) && texts[i] !== '';
  // Cues with no text at all need no translation.
  texts.forEach((text, i) => {
    if (text === '') failed.add(i);
  });

  let failedChunks = 0;
  let chunksSinceSave = 0;

  try {
    while (!signal?.aborted) {
      const start = nextChunkStart(pending, total, chunkSize, currentCueIndex(source, getTime()));
      if (start === null) break;
      const indexes = Array.from(
        { length: Math.min(chunkSize, total - start) },
        (_, k) => start + k,
      ).filter(pending);

      let result: string[] | null = null;
      for (
        let attempt = 0;
        attempt < ATTEMPTS_PER_CHUNK && !result && !signal?.aborted;
        attempt++
      ) {
        try {
          result = await service.translate(
            direction,
            indexes.map((i) => texts[i]!),
          );
        } catch (error) {
          if (error instanceof TranslationError && error.code !== 'failed') {
            await save();
            return emit({ state: error.code === 'needs-model' ? 'needs-model' : 'unavailable' });
          }
          if (attempt < ATTEMPTS_PER_CHUNK - 1) await sleep(retryDelayMs);
        }
      }
      if (signal?.aborted) break;

      if (!result || result.length !== indexes.length) {
        indexes.forEach((i) => failed.add(i));
        if (++failedChunks >= FAILED_CHUNKS_BEFORE_GIVING_UP) {
          await save();
          return emit({ state: 'error', done: doneCount(), total });
        }
        continue;
      }
      failedChunks = 0;

      for (const [k, i] of indexes.entries()) {
        let text = result[k] ?? '';
        if (text === '') {
          // One line the translator skipped: try it alone before giving up on it.
          text = (await service.translate(direction, [texts[i]!]).catch(() => ['']))[0] ?? '';
        }
        if (text === '') failed.add(i);
        else translations[i] = polishTranslation(text);
      }

      unsaved++;
      if (++chunksSinceSave >= CHUNKS_PER_CACHE_WRITE) {
        chunksSinceSave = 0;
        await save();
      }
      emit({ state: 'translating', done: doneCount(), total });
    }
  } finally {
    await save();
  }

  if (signal?.aborted) return;
  // A line or two the translator rejected is not worth an error; nothing translated at all is.
  const translatable = texts.filter((text) => text !== '').length;
  const nothingTranslated = translatable > 0 && doneCount() === 0;
  emit(
    nothingTranslated
      ? { state: 'error', done: 0, total }
      : { state: 'done', total, fromCache: false },
  );
}
