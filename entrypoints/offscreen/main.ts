import type { OffscreenRequest } from '../../src/lib/offscreen-messages';
import {
  benchmark,
  EN_RU,
  getTranslatorApi,
  probeTranslator,
  RU_EN,
} from '../../src/lib/translator';
import { openTranslationCache } from '../../src/translation/cache';
import { handleTranslationRequest } from '../../src/translation/handler';
import { TranslatorPool } from '../../src/translation/pool';

/**
 * Offscreen document: a hidden extension page that lives while the popup is closed. It is where the
 * built-in Translator API works for every site (stage 4): the background relays translation requests
 * here, and the translation cache lives in this page's own IndexedDB.
 */
/** Test build only: which stand-in translator the current request should use. */
let e2eMode: string | undefined;

const pool = new TranslatorPool(async () => {
  if (import.meta.env.VITE_DS_E2E) {
    // Playwright's Chromium has no language model.
    const { e2eTranslatorApi } = await import('../../src/translation/fake-api');
    const fake = e2eTranslatorApi(e2eMode);
    if (fake) return fake;
  }
  return getTranslatorApi();
});
const cache = openTranslationCache();

browser.runtime.onMessage.addListener((message: OffscreenRequest, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;

  switch (message.type) {
    case 'translation':
      e2eMode = message.e2eMode;
      void handleTranslationRequest(message.request, pool, cache).then(sendResponse);
      break;
    case 'probe':
      void probeTranslator('offscreen').then(sendResponse);
      break;
    case 'benchmark':
      void benchmark(
        'offscreen',
        message.texts,
        message.direction === 'en-ru' ? EN_RU : RU_EN,
      ).then(sendResponse);
      break;
  }
  return true; // async response
});
