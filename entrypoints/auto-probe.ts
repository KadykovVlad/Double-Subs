import { loadKnownSites } from '../src/lib/known-sites';
import type { StartAgentMessage } from '../src/lib/messages';
import { hostsOf, matchKnownHost } from '../src/lib/site-match';

/**
 * Registered for the user's sites (and for all sites when mirrors are on): costs almost nothing.
 * It only asks whether this address is one the user has, and if so has the agent started here.
 */
export default defineUnlistedScript(async () => {
  try {
    const sites = await loadKnownSites();
    if (!matchKnownHost(location.hostname, hostsOf(Object.keys(sites)))) return;
    await browser.runtime.sendMessage({ type: 'start-agent' } satisfies StartAgentMessage);
  } catch {
    // The extension was reloaded under this page: nothing to do.
  }
});
