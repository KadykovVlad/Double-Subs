import {
  excludedHostOf,
  forgetAccess,
  loadDismissed,
  loadExcludedSites,
  loadKnownSites,
  normalizeKnownSites,
  saveSiteLists,
  webOrigin,
  type KnownSite,
  type KnownSites,
} from './known-sites';

/**
 * The user's decisions about sites that follow the account, one thing each on the server: a site on the
 * list, a site switched off, a site not to be offered again. The access to a site stays in the browser
 * (Chrome does not share it), and so does "on every site", which is only that access.
 */
export type SyncedSite =
  { list: 'known'; id: string; site: KnownSite } | { list: 'off' | 'never'; id: string };

export const siteKey = ({ list, id }: SyncedSite) => `${list}:${id}`;

/** A site on the list knows when it was added; the other lists keep no time, so a thing new here is of now. */
export const siteTime = (item: SyncedSite) =>
  item.list === 'known' ? item.site.addedAt : Date.now();

export async function loadSyncedSites(): Promise<SyncedSite[]> {
  const known = Object.values(await loadKnownSites());
  return [
    ...known.map((site): SyncedSite => ({ list: 'known', id: site.origin, site })),
    ...(await loadExcludedSites()).map((id): SyncedSite => ({ list: 'off', id })),
    ...(await loadDismissed()).map((id): SyncedSite => ({ list: 'never', id })),
  ];
}

/** A thing from the server; null when it is not one. */
export function parseSyncedSite(data: unknown): SyncedSite | null {
  const { list, id, site } = (data ?? {}) as { list?: unknown; id?: unknown; site?: unknown };
  if (typeof id !== 'string') return null;
  if (list === 'off') return excludedHostOf(`https://${id}`) === id ? { list, id } : null;
  if (webOrigin(id) !== id) return null;
  if (list === 'never') return { list, id };
  const parsed = list === 'known' ? normalizeKnownSites({ [id]: site })[id] : undefined;
  return parsed?.origin === id ? { list: 'known', id, site: parsed } : null;
}

export async function saveSyncedSites(list: SyncedSite[]): Promise<void> {
  const before = await loadKnownSites();
  const known: KnownSites = {};
  const excluded: string[] = [];
  const dismissed: string[] = [];
  for (const item of list) {
    if (item.list === 'known') known[item.id] = item.site;
    else (item.list === 'off' ? excluded : dismissed).push(item.id);
  }
  await saveSiteLists({ known, excluded, dismissed });
  // Taken off the list elsewhere: the access goes here too, as it does where the user did it.
  for (const origin of Object.keys(before)) if (!(origin in known)) await forgetAccess(origin);
}
