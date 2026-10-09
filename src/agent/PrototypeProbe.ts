import { describeFrame } from '../lib/frame';
import type { FrameTranslatorProbe } from '../lib/messages';
import { TRANSLATOR_FRAME_SOURCE } from '../lib/offscreen-messages';
import { probeTranslator, type TranslatorProbe } from '../lib/translator';

/**
 * Stage 4 prototype check, for the test and dev builds only: where does the Translator API work in
 * this frame? Embeds an invisible extension page with allow="translator" and waits for its answer,
 * because a content script in a cross-origin player may be denied the API by permissions policy.
 */
export class TranslatorProbeService {
  async run(): Promise<FrameTranslatorProbe> {
    const frame = describeFrame(window);
    const [contentScript, extensionFrame] = await Promise.all([
      probeTranslator(`content script: ${frame}`),
      this.probeViaExtensionFrame(),
    ]);
    return { frame, contentScript, extensionFrame };
  }

  private probeViaExtensionFrame(timeoutMs = 5000): Promise<TranslatorProbe | null> {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.allow = 'translator';
      iframe.src = browser.runtime.getURL('/translator-frame.html');
      iframe.style.cssText =
        'position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;border:0;pointer-events:none;';

      const finish = (probe: TranslatorProbe | null) => {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        iframe.remove();
        resolve(probe);
      };
      const onMessage = (event: MessageEvent) => {
        if (
          event.source === iframe.contentWindow &&
          event.data?.source === TRANSLATOR_FRAME_SOURCE
        ) {
          finish(event.data.probe as TranslatorProbe);
        }
      };
      window.addEventListener('message', onMessage);
      const timer = setTimeout(() => finish(null), timeoutMs);
      document.documentElement.append(iframe);
    });
  }
}
