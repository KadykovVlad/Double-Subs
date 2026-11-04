import { cleanTitle, historyId } from './history';

/** What the user put aside to watch later: chosen by hand, unlike the history, which writes itself. */
export interface WatchItem {
  /** The address without its fragment; on YouTube the video, see watchId(). */
  id: string;
  url: string;
  title: string;
  host: string;
  addedAt: number;
}

export const MAX_WATCHLIST = 500;
const MAX_TITLE = 300;
const KEY = 'watchlist';

/** The address to keep for what the user gave, or null: web addresses only, no fragment, no password. */
export function watchUrl(input: string): string | null {
  const text = input.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** The same video gets the same id; on YouTube ?t= and the playlist do not make another one. */
export function watchId(url: string): string {
  return /^https?:\/\/([^/]+\.)?youtube\.com\//.test(url) ? historyId(url) : url;
}

function makeItem(url: string, title: string, addedAt: number): WatchItem {
  const { host } = new URL(url);
  return {
    id: watchId(url),
    url,
    title: cleanTitle(title, host).slice(0, MAX_TITLE),
    host,
    addedAt,
  };
}

/** A thing from the storage or the server; null when it is not one. */
export function normalizeWatchItem(raw: unknown): WatchItem | null {
  const { url, title, addedAt } = (raw ?? {}) as Partial<WatchItem>;
  const address = typeof url === 'string' ? watchUrl(url) : null;
  if (!address) return null;
  return makeItem(
    address,
    typeof title === 'string' ? title : '',
    typeof addedAt === 'number' && addedAt >= 0 ? addedAt : 0,
  );
}

export function normalizeWatchlist(raw: unknown): WatchItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeWatchItem).filter((item): item is WatchItem => item !== null);
}

export async function loadWatchlist(): Promise<WatchItem[]> {
  return normalizeWatchlist((await browser.storage.local.get(KEY))[KEY]);
}

export async function saveWatchlist(list: WatchItem[]): Promise<void> {
  await browser.storage.local.set({ [KEY]: list });
}

export type AddResult = 'added' | 'exists' | 'bad-url' | 'full';

/** Puts a video on the list, newest first. */
export async function addToWatchlist(page: { url: string; title: string }): Promise<AddResult> {
  const url = watchUrl(page.url);
  if (!url) return 'bad-url';
  const list = await loadWatchlist();
  if (list.some((item) => item.id === watchId(url))) return 'exists';
  if (list.length >= MAX_WATCHLIST) return 'full';
  await saveWatchlist([makeItem(url, page.title, Date.now()), ...list]);
  return 'added';
}

export async function removeFromWatchlist(id: string): Promise<void> {
  await saveWatchlist((await loadWatchlist()).filter((item) => item.id !== id));
}

export function watchWatchlist(listener: (list: WatchItem[]) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && KEY in changes) listener(normalizeWatchlist(changes[KEY]!.newValue));
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
