import {
  addKnownSite,
  loadKnownSites,
  loadMirrorsMode,
  MIRRORS_PATTERN,
  YOUTUBE_ORIGIN,
  type KnownSites,
} from '../lib/known-sites';
import { originPattern } from '../lib/scan';

/** The one script that is registered for the sites the user chose: it only asks "is this a known site?". */
export const PROBE_SCRIPT_ID = 'ds-auto-probe';
const OLD_SCRIPT_PREFIX = 'ds-auto-';
const SEEDED_KEY = 'knownSitesSeeded';

/** The pages the probe has to run on: the known sites themselves, or all sites when mirrors are switched on. */
export function desiredMatches(
  sites: KnownSites,
  mirrorsOn: boolean,
  hasAccess: (pattern: string) => boolean,
): string[] {
  const patterns = new Set<string>();
  if (mirrorsOn && hasAccess(MIRRORS_PATTERN)) patterns.add(MIRRORS_PATTERN);
  for (const site of Object.values(sites)) {
    const pattern = originPattern(site.origin);
    if (hasAccess(pattern)) patterns.add(pattern);
  }
  return [...patterns].sort();
}

/**
 * Keeps the registered content script in step with the list of known sites and the access the
 * user has given. Calls are queued, so two changes in a row never race each other.
 */
export class AutoScriptRegistry {
  private queue: Promise<unknown> = Promise.resolve();

  /** Brings the registration up to date; resolves when it is done. */
  sync(): Promise<void> {
    const run = () => this.apply();
    this.queue = this.queue
      .then(run, run)
      .catch((error) => console.warn('[Double Sub] could not sync automatic start', error));
    return this.queue as Promise<void>;
  }

  /** YouTube works out of the box: it is known from the first start until the user takes it off. */
  async seedYouTube(): Promise<void> {
    if ((await browser.storage.local.get(SEEDED_KEY))[SEEDED_KEY]) return;
    await addKnownSite(YOUTUBE_ORIGIN);
    await browser.storage.local.set({ [SEEDED_KEY]: true });
  }

  private async apply(): Promise<void> {
    const sites = await loadKnownSites();
    const mirrorsOn = await loadMirrorsMode();
    const patterns = [
      ...new Set([...Object.values(sites).map((s) => originPattern(s.origin)), MIRRORS_PATTERN]),
    ];
    const granted = new Set<string>();
    for (const pattern of patterns) {
      if (await browser.permissions.contains({ origins: [pattern] })) granted.add(pattern);
    }
    const matches = desiredMatches(sites, mirrorsOn, (pattern) => granted.has(pattern));

    const registered = await browser.scripting.getRegisteredContentScripts();
    const old = registered.filter(
      (script) => script.id.startsWith(OLD_SCRIPT_PREFIX) && script.id !== PROBE_SCRIPT_ID,
    );
    const probe = registered.find((script) => script.id === PROBE_SCRIPT_ID);
    const stale = [
      ...old.map((script) => script.id),
      ...(probe && matches.length === 0 ? [PROBE_SCRIPT_ID] : []),
    ];
    if (stale.length > 0) await browser.scripting.unregisterContentScripts({ ids: stale });
    if (matches.length === 0) return;

    const script = {
      id: PROBE_SCRIPT_ID,
      matches,
      js: ['/auto-probe.js'],
      allFrames: true,
      runAt: 'document_idle' as const,
      persistAcrossSessions: true,
    };
    if (!probe) await browser.scripting.registerContentScripts([script]);
    else if ([...(probe.matches ?? [])].sort().join('|') !== matches.join('|'))
      await browser.scripting.updateContentScripts([script]);
  }
}
