import { loadAccount } from '../src/lib/account';
import { frameAddresses, isSiteExcluded, loadExcludedSites } from '../src/lib/known-sites';
import type { StartAgentMessage } from '../src/lib/messages';

/**
 * Registered for the sites the extension may work on (all of them when the user allowed that): costs
 * almost nothing. It waits for a <video> to appear in this frame, and when one does has the agent
 * started here. Which sites it runs on is the registration's business (AutoScriptRegistry); the
 * background checks the address once more before it starts the agent.
 */
const SHADOW_CHECK_FAST_MS = 3000;
const SHADOW_CHECK_SLOW_MS = 15_000;
const FAST_PERIOD_MS = 60_000;

/** Does this element's open shadow root (or one inside it) hold a <video>? */
function shadowHasVideo(host: Element): boolean {
  const root = host.shadowRoot;
  if (!root) return false;
  if (root.querySelector('video')) return true;
  for (const element of root.querySelectorAll('*')) if (shadowHasVideo(element)) return true;
  return false;
}

/** A <video> in the shadow roots of this document. Asked only when there is none in the plain DOM, and not too often. */
function videoInShadowRoots(): boolean {
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
  let seen = 0;
  for (let node = walker.nextNode(); node && seen < 20_000; node = walker.nextNode(), seen++)
    if (shadowHasVideo(node as Element)) return true;
  return false;
}

export default defineUnlistedScript(async () => {
  try {
    if (!(await loadAccount())) return;
    // A site the user switched off: neither the page nor the frame it is in.
    if (isSiteExcluded(await loadExcludedSites(), frameAddresses())) return;

    const videos = document.getElementsByTagName('video'); // a live list: free to ask
    let done = false;
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const start = () => {
      if (done) return;
      done = true;
      observer?.disconnect();
      clearTimeout(timer);
      window.removeEventListener('play', check, true);
      window.removeEventListener('loadstart', check, true);
      void browser.runtime
        .sendMessage({ type: 'start-agent' } satisfies StartAgentMessage)
        .catch(() => {});
    };
    function check() {
      if (videos.length > 0) start();
    }
    const checkShadow = () => {
      if (done) return;
      if (videos.length > 0 || videoInShadowRoots()) return start();
      const period =
        Date.now() - startedAt < FAST_PERIOD_MS ? SHADOW_CHECK_FAST_MS : SHADOW_CHECK_SLOW_MS;
      timer = setTimeout(checkShadow, period);
    };

    if (videos.length > 0) return start();
    // The player comes later: a script adds it, or the page makes it after a click.
    observer = new MutationObserver(check);
    observer.observe(document, { childList: true, subtree: true });
    window.addEventListener('play', check, true);
    window.addEventListener('loadstart', check, true);
    timer = setTimeout(checkShadow, SHADOW_CHECK_FAST_MS);
  } catch {
    // The extension was reloaded under this page: nothing to do.
  }
});
