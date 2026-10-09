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
