import type { Direction } from './offscreen-messages';

export type { Direction };

export type TranslationRequest =
  | { type: 'availability'; direction: Direction }
  | { type: 'translate'; direction: Direction; texts: string[] }
  | { type: 'cache-get'; key: string }
  | { type: 'cache-put'; key: string; translations: string[] };

/**
 * - needs-model: the language model is not on this computer yet; Chrome downloads it only after a click
 * - unavailable: no Translator API, or this language pair is not supported
 * - failed: a request failed (the offscreen document may have been closed); worth retrying
 */
export type TranslationErrorCode = 'needs-model' | 'unavailable' | 'failed';

export type TranslationReply<T> =
  { ok: true; value: T } | { ok: false; code: TranslationErrorCode; detail?: string };

/** Agent → background. The background makes sure the offscreen document exists and relays the request. */
export interface TranslationEnvelope {
  type: 'translation';
  request: TranslationRequest;
}

export type ModelAvailability = 'available' | 'needs-model' | 'unavailable';

export type TranslationStatus =
  | { state: 'translating'; done: number; total: number }
  | { state: 'done'; total: number; fromCache: boolean }
  | { state: 'needs-model' }
  | { state: 'unavailable' }
  | { state: 'error'; done: number; total: number };

/** The agent tells the popup that something it shows (selection, translation progress) changed. */
export interface StatusMessage {
  type: 'status';
}

const MAX_TEXTS = 200;
/** The cache keeps one string per cue of a whole episode. */
const MAX_CACHED = 20_000;
const MAX_TEXT_CHARS = 2000;

/** Shape and size check for what reaches the translator: only our own scripts send it, but it costs nothing. */
export function isValidTranslationRequest(request: unknown): request is TranslationRequest {
  const r = request as Partial<Record<string, unknown>> | null;
  if (typeof r !== 'object' || r === null) return false;
  const texts = (value: unknown, max = MAX_TEXTS): value is string[] =>
    Array.isArray(value) &&
    value.length <= max &&
    value.every((t) => typeof t === 'string' && t.length <= MAX_TEXT_CHARS);
  const direction = r.direction === 'en-ru' || r.direction === 'ru-en';
  switch (r.type) {
    case 'availability':
      return direction;
    case 'translate':
      return direction && texts(r.texts);
    case 'cache-get':
      return typeof r.key === 'string' && r.key.length <= 200;
    case 'cache-put':
      return typeof r.key === 'string' && r.key.length <= 200 && texts(r.translations, MAX_CACHED);
    default:
      return false;
  }
}
