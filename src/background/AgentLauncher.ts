import type { InjectTikTokMainMessage, StartAgentMessage } from '../lib/messages';
import { isTikTokHost } from '../lib/tiktok';
import { loadAccount } from '../lib/account';
import {
  isSiteExcluded,
  loadExcludedSites,
  loadKnownSites,
  MIRRORS_PATTERN,
  loadMirrorsMode,
} from '../lib/known-sites';
import { hostsOf, matchKnownHost } from '../lib/site-match';

/**
 * Starts the agent in a frame on request of the probe (the small script that waits for a video). The
 * address is checked once more here: the agent comes without a click only to a site the user has, or
 * to any site when they allowed that, and never to a site they switched off.
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
    if (!(await loadAccount())) return; // the extension works for signed-in users only

    // The frame that asks and the page it is in (a player usually sits in a frame of another site).
    if (isSiteExcluded(await loadExcludedSites(), [sender.url, sender.tab?.url])) return;
    const everywhere =
      (await loadMirrorsMode()) &&
      (await browser.permissions.contains({ origins: [MIRRORS_PATTERN] }));
    const sites = await loadKnownSites();
    if (!everywhere && !matchKnownHost(new URL(sender.url).hostname, hostsOf(Object.keys(sites))))
      return;
    await browser.scripting
      .executeScript({
        target: { tabId, frameIds: [frameId] },
        files: ['/auto-flag.js', '/agent.js'],
      })
      .catch(() => {});
  }

  /**
   * TikTok's page-world script, for a page that has the agent but not the script (opened before the
   * site was registered, or the agent was started from the side panel). Only on TikTok itself.
   */
  async injectTikTokMain(
    message: InjectTikTokMainMessage,
    sender: chrome.runtime.MessageSender,
  ): Promise<void> {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    if (message.type !== 'inject-tiktok-main' || tabId === undefined || frameId === undefined)
      return;
    if (!sender.url || !isTikTokHost(new URL(sender.url).hostname)) return;
    if (!(await loadAccount())) return;
    await browser.scripting
      .executeScript({
        target: { tabId, frameIds: [frameId] },
        files: ['/tiktok-main.js'],
        world: 'MAIN',
      })
      .catch(() => {});
  }
}
