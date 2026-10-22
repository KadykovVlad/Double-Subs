/** What the user watched with the extension: kept in the browser, newest first, never sent anywhere. */
export interface HistoryEntry {
  /** The page without its fragment and tracking noise, see historyId(). */
  id: string;
  url: string;
  title: string;
  host: string;
  firstAt: number;
  lastAt: number;
  /** Where the user stopped, seconds. */
  position: number;
  duration: number;
}

export const MAX_HISTORY = 100;
const KEY = 'history';

/** The same video or episode gets the same id; YouTube is told apart by its ?v=. */
export function historyId(url: string): string {
  try {
    const u = new URL(url);
    const v = u.searchParams.get('v');
    return v && /(^|\.)youtube\.com$/.test(u.hostname)
      ? `${u.origin}${u.pathname}?v=${v}`
      : `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/** "Video title - YouTube" → "Video title". */
export function cleanTitle(title: string, host: string): string {
  const trimmed = title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[-|–]\s*YouTube$/i, '');
  return trimmed || host;
}

/** An address for people: no "https://", no "www.", no fragment, no trailing slash ("youtube.com/watch?v=abc"). */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, '')}${u.pathname}${u.search}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** A link that continues where the user stopped (only YouTube understands a start time). */
export function resumeUrl(entry: HistoryEntry): string {
  try {
    const u = new URL(entry.url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && entry.position > 10) {
      u.searchParams.set('t', `${Math.floor(entry.position)}s`);
      return u.toString();
    }
  } catch {
    // fall through to the plain address
  }
  return entry.url;
}

/** Adds or refreshes an entry; the list stays newest first and is cut to MAX_HISTORY. */
export function upsertEntry(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const old = list.find((item) => item.id === entry.id);
  const merged: HistoryEntry = old ? { ...entry, firstAt: old.firstAt } : entry;
  return [merged, ...list.filter((item) => item.id !== entry.id)].slice(0, MAX_HISTORY);
}

export function normalizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const list: HistoryEntry[] = [];
  for (const item of raw) {
    const e = item as Partial<HistoryEntry> | null;
    if (!e || typeof e.id !== 'string' || typeof e.url !== 'string' || !/^https?:\/\//.test(e.url))
      continue;
    list.push({
      id: e.id,
      url: e.url,
      title: typeof e.title === 'string' ? e.title : e.id,
      host: typeof e.host === 'string' ? e.host : '',
      firstAt: typeof e.firstAt === 'number' ? e.firstAt : 0,
      lastAt: typeof e.lastAt === 'number' ? e.lastAt : 0,
      position: typeof e.position === 'number' && e.position >= 0 ? e.position : 0,
      duration:
        typeof e.duration === 'number' && e.duration > 0 && Number.isFinite(e.duration)
          ? e.duration
          : 0,
    });
  }
  return list.slice(0, MAX_HISTORY);
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  return normalizeHistory((await browser.storage.local.get(KEY))[KEY]);
}

export async function recordHistory(entry: HistoryEntry): Promise<void> {
  await browser.storage.local.set({ [KEY]: upsertEntry(await loadHistory(), entry) });
}

export async function removeHistoryEntry(id: string): Promise<void> {
  await browser.storage.local.set({
    [KEY]: (await loadHistory()).filter((item) => item.id !== id),
  });
}

export async function clearHistory(): Promise<void> {
  await browser.storage.local.set({ [KEY]: [] });
}

export function watchHistory(listener: (list: HistoryEntry[]) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && KEY in changes) listener(normalizeHistory(changes[KEY]!.newValue));
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

/** The id of a YouTube video ("dQw4w9WgXcQ"), for its preview picture; null for any other page. */
export function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1];
    return id && /^[\w-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** The entries whose title or address has `query` (any case), on `host` when one is chosen. */
export function filterHistory(list: HistoryEntry[], query: string, host = ''): HistoryEntry[] {
  const needle = query.trim().toLowerCase();
  return list.filter(
    (entry) =>
      (!host || entry.host === host) &&
      (!needle ||
        entry.title.toLowerCase().includes(needle) ||
        entry.url.toLowerCase().includes(needle)),
  );
}

/** The sites in the history, most watched first: for the "all sites" filter. */
export function historyHosts(list: HistoryEntry[]): string[] {
  const count = new Map<string, number>();
  for (const entry of list) if (entry.host) count.set(entry.host, (count.get(entry.host) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([host]) => host);
}

/** The list cut into days of the last view, newest first; `daysAgo` 0 is today (local time). */
export function groupByDay(
  list: HistoryEntry[],
  now = Date.now(),
): Array<{ daysAgo: number; day: number; entries: HistoryEntry[] }> {
  const dayStart = (ts: number) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const today = dayStart(now);
  const groups: Array<{ daysAgo: number; day: number; entries: HistoryEntry[] }> = [];
  for (const entry of [...list].sort((a, b) => b.lastAt - a.lastAt)) {
    const day = dayStart(entry.lastAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, daysAgo: Math.round((today - day) / 86_400_000), entries: [entry] });
  }
  return groups;
}

/** 95 → "1:35", 3725 → "1:02:05". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
