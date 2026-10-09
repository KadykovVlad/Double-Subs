import type {
  TranslationEnvelope,
  TranslationReply,
  TranslationRequest,
} from '../lib/translation-messages';
import { TranslationError, type TranslationService } from './session';

/** Talks to the offscreen document through the background (which creates the document if needed). */
async function ask<T>(request: TranslationRequest): Promise<T> {
  let reply: TranslationReply<T> | undefined;
  try {
    reply = (await browser.runtime.sendMessage({
      type: 'translation',
      request,
    } satisfies TranslationEnvelope)) as TranslationReply<T> | undefined;
  } catch {
    throw new TranslationError('failed');
  }
  if (!reply) throw new TranslationError('failed');
  if (!reply.ok) throw new TranslationError(reply.code);
  return reply.value;
}

export const offscreenTranslationService: TranslationService = {
  availability: (direction) => ask({ type: 'availability', direction }),
  translate: (direction, texts) => ask({ type: 'translate', direction, texts }),
  cacheGet: (key) => ask({ type: 'cache-get', key }),
  cachePut: (key, translations) =>
    ask<null>({ type: 'cache-put', key, translations }).then(() => undefined),
};
