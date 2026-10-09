import type { StartAgentMessage } from '../lib/messages';
import { loadKnownSites } from '../lib/known-sites';
import { hostsOf, matchKnownHost } from '../lib/site-match';

/**
 * Starts the agent in a frame on request of the probe (the small script on the user's sites). The
 * address is checked once more here, so only a known site can get the agent without a click.
 */
export class AgentLauncher {
  async launch(message: StartAgentMessage, sender: chrome.runtime.MessageSender): Promise<void> {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    if (
      message.type !== 'start-agent' ||
      tabId === undefined ||
      frameId === undefined ||
      !sender.url
    )
      return;

    const sites = await loadKnownSites();
    if (!matchKnownHost(new URL(sender.url).hostname, hostsOf(Object.keys(sites)))) return;
    await browser.scripting
      .executeScript({
        target: { tabId, frameIds: [frameId] },
        files: ['/auto-flag.js', '/agent.js'],
      })
      .catch(() => {});
  }
}
