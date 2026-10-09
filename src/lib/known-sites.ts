import { hostsOf, matchKnownHost } from './site-match';

/**
 * Sites the user has chosen to start on their own. Keyed by the origin of the frame that holds the
 * player (a player embedded from another site is its own origin). For now it lives in the browser's
 * storage; an account that syncs it comes later.
 */
export interface KnownSite {
  origin: string;
  addedAt: number;
  lastUsed: number;
  /** The video the user picked in a frame of this origin: its position among the frame's videos. */
  preferredIndex: number | null;
}

export type KnownSites = Record<string, KnownSite>;

const KEY = 'knownSites';

export const YOUTUBE_ORIGIN = 'https://www.youtube.com';

/**
 * The access that lets the extension recognise the user's sites under other addresses (mirrors).
 * The test build uses the sub-domains of localhost, which Chrome resolves to this computer.
 */
export const MIRRORS_PATTERN = import.meta.env?.VITE_DS_E2E ? 'http://*.localhost/*' : '*://*/*';
const MIRRORS_KEY = 'mirrorsMode';

export async function loadMirrorsMode(): Promise<boolean> {
  return (await browser.storage.local.get(MIRRORS_KEY))[MIRRORS_KEY] === true;
}

export const setMirrorsMode = (on: boolean) => browser.storage.local.set({ [MIRRORS_KEY]: on });

export function watchMirrorsMode(listener: (on: boolean) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && MIRRORS_KEY in changes)
      listener(changes[MIRRORS_KEY]!.newValue === true);
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

export function normalizeKnownSites(raw: unknown): KnownSites {
  const result: KnownSites = {};
  if (typeof raw !== 'object' || raw === null) return result;
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const site = value as Partial<KnownSite>;
    if (typeof site.origin !== 'string' || !/^https?:\/\//.test(site.origin)) continue;
    result[site.origin] = {
      origin: site.origin,
      addedAt: typeof site.addedAt === 'number' ? site.addedAt : 0,
      lastUsed: typeof site.lastUsed === 'number' ? site.lastUsed : 0,
      preferredIndex:
        typeof site.preferredIndex === 'number' && site.preferredIndex >= 0
          ? site.preferredIndex
          : null,
    };
  }
  return result;
}

export async function loadKnownSites(): Promise<KnownSites> {
  const stored = await browser.storage.local.get(KEY);
  return normalizeKnownSites(stored[KEY]);
}

const save = (sites: KnownSites) => browser.storage.local.set({ [KEY]: sites });

/** Puts the sites on the list in one write (separate writes at the same time would overwrite each other). */
export async function addKnownSites(origins: string[]): Promise<void> {
  const sites = await loadKnownSites();
  const now = Date.now();
  for (const origin of origins) {
    sites[origin] = {
      origin,
      addedAt: sites[origin]?.addedAt ?? now,
      lastUsed: now,
      preferredIndex: sites[origin]?.preferredIndex ?? null,
    };
  }
  await save(sites);
}

export const addKnownSite = (origin: string) => addKnownSites([origin]);

export async function removeKnownSite(origin: string): Promise<void> {
  const sites = await loadKnownSites();
  delete sites[origin];
  await save(sites);
}

/** Remembers which video of the site's player frame the user picked; only for sites already known. */
export async function rememberPickedPlayer(origin: string, index: number): Promise<void> {
  const sites = await loadKnownSites();
  const site = sites[origin];
  if (!site || site.preferredIndex === index) return;
  sites[origin] = { ...site, preferredIndex: index, lastUsed: Date.now() };
  await save(sites);
}

export function watchKnownSites(listener: (sites: KnownSites) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && KEY in changes) listener(normalizeKnownSites(changes[KEY]!.newValue));
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

/**
 * Which videos of a frame to start with: the one picked before if it is still there, otherwise
 * the biggest visible one. Tiny videos (previews, ad pixels) are never chosen.
 */
export const MIN_AUTO_WIDTH = 200;
export const MIN_AUTO_HEIGHT = 110;

export interface AutoCandidate {
  index: number;
  width: number;
  height: number;
}

export function chooseAutoPlayer(
  candidates: AutoCandidate[],
  preferredIndex: number | null,
): number | null {
  const big = candidates.filter((c) => c.width >= MIN_AUTO_WIDTH && c.height >= MIN_AUTO_HEIGHT);
  if (big.length === 0) return null;
  const preferred = big.find((c) => c.index === preferredIndex);
  if (preferred) return preferred.index;
  return big.reduce((best, c) => (c.width * c.height > best.width * best.height ? c : best)).index;
}

// ---------------------------------------------------------------- offering to remember a site

const DISMISSED_KEY = 'rememberDismissed';
const MAX_DISMISSED = 200;

/** Sites the user asked not to be asked about again. */
export async function loadDismissed(): Promise<string[]> {
  const stored = (await browser.storage.local.get(DISMISSED_KEY))[DISMISSED_KEY];
  return Array.isArray(stored) ? stored.filter((o): o is string => typeof o === 'string') : [];
}

export async function dismissOffer(origins: string[]): Promise<void> {
  const merged = [...new Set([...origins, ...(await loadDismissed())])].slice(0, MAX_DISMISSED);
  await browser.storage.local.set({ [DISMISSED_KEY]: merged });
}

export function watchDismissed(listener: (origins: string[]) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && DISMISSED_KEY in changes) {
      const value = changes[DISMISSED_KEY]!.newValue;
      listener(Array.isArray(value) ? (value as string[]) : []);
    }
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

/** The origin of an address, for web pages only (not chrome://, not files). */
export function webOrigin(url: string | null | undefined): string | null {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

export interface OfferContext {
  known: KnownSites;
  dismissed: string[];
  /** Mirrors are on: a site that carries the name of a known one is known too. */
  mirrorsOn: boolean;
}

/**
 * What to offer to remember: the page and, when the player sits in a frame of another site, that site
 * too (the agent runs in the frame of the player, so that site is the one that has to be known).
 * Nothing for sites already known, taken off the list or refused.
 */
export function originsToOffer(
  pageUrl: string | null,
  playerOrigin: string | null,
  context: OfferContext,
): string[] {
  const knownHosts = hostsOf(Object.keys(context.known));
  const wanted = [webOrigin(pageUrl), webOrigin(playerOrigin)].filter(
    (o): o is string => o !== null,
  );
  return [...new Set(wanted)].filter((origin) => {
    if (origin in context.known || context.dismissed.includes(origin)) return false;
    return !(context.mirrorsOn && matchKnownHost(new URL(origin).hostname, knownHosts));
  });
}
