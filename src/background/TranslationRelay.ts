import { ensureOffscreen } from '../lib/offscreen';
import type { OffscreenRequest } from '../lib/offscreen-messages';
import {
  isValidTranslationRequest,
  type TranslationEnvelope,
  type TranslationReply,
} from '../lib/translation-messages';

/**
 * The agent in a web page cannot talk to the offscreen document directly, and the document may not
 * exist yet (Chrome closes it after a while): create it if needed, then pass the request on.
 */
export class TranslationRelay {
  async relay(envelope: TranslationEnvelope): Promise<TranslationReply<unknown>> {
    if (!isValidTranslationRequest(envelope.request)) return { ok: false, code: 'failed' };
    try {
      await ensureOffscreen();
      // Test build only: the stand-in translator mode lives in storage, which offscreen cannot read.
      const e2eMode = import.meta.env.VITE_DS_E2E
        ? ((await browser.storage.local.get('e2eTranslator')).e2eTranslator as string | undefined)
        : undefined;
      return (await browser.runtime.sendMessage({
        target: 'offscreen',
        type: 'translation',
        request: envelope.request,
        e2eMode,
      } satisfies OffscreenRequest)) as TranslationReply<unknown>;
    } catch {
      return { ok: false, code: 'failed' };
    }
  }
}
