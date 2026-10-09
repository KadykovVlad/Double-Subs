import type {
  TranslationErrorCode,
  TranslationReply,
  TranslationRequest,
} from '../lib/translation-messages';
import type { TranslationCache } from './cache';
import type { TranslatorPool } from './pool';
import { TranslationError } from './session';

/** Answers one translation request; never throws, so the sender always gets a reply. */
export async function handleTranslationRequest(
  request: TranslationRequest,
  pool: TranslatorPool,
  cache: TranslationCache,
): Promise<TranslationReply<unknown>> {
  try {
    switch (request.type) {
      case 'availability':
        return { ok: true, value: await pool.availability(request.direction) };
      case 'translate':
        return { ok: true, value: await pool.translate(request.direction, request.texts) };
      case 'cache-get':
        return { ok: true, value: await cache.get(request.key) };
      case 'cache-put':
        await cache.put(request.key, request.translations);
        return { ok: true, value: null };
    }
  } catch (error) {
    const code: TranslationErrorCode = error instanceof TranslationError ? error.code : 'failed';
    // The text of an unexpected error helps to tell what broke; known codes need none.
    return error instanceof TranslationError
      ? { ok: false, code }
      : { ok: false, code, detail: String(error) };
  }
}
