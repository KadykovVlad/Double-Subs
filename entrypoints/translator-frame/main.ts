import { TRANSLATOR_FRAME_SOURCE } from '../../src/lib/offscreen-messages';
import { probeTranslator } from '../../src/lib/translator';

/**
 * An extension page the agent embeds into the web page with allow="translator".
 * Prototype question: does it get the Translator API where a content script does not
 * (a player in a cross-origin iframe)? Reports back to the frame that created it.
 */
void probeTranslator('extension iframe').then((probe) => {
  window.parent.postMessage({ source: TRANSLATOR_FRAME_SOURCE, probe }, '*');
});
