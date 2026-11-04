import type { SyncMessage } from './messages';

/**
 * Keeping the user's data on the server, so that it comes back in another browser. The lists stay as
 * they are in `chrome.storage.local` and their writers know nothing of this: what changed is found by
 * comparing a list with what the last synchronisation saw (`SyncState.seen`). This file is the
 * comparing and merging; the network and the timing are in src/background/SyncService.ts.
 */

const SYNC_KINDS = ['words', 'history', 'settings', 'sites'] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

/** One thing as the server's /sync takes and gives it. */
export interface SyncChange {
  kind: SyncKind;
  key: string;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
}

/** A synced list: where it lives and how to read one of its things. */
export interface Collection<T> {
  kind: SyncKind;
  /** False: the user does not want this list to leave the browser (nothing goes either way). */
  enabled(): Promise<boolean>;
  load(): Promise<T[]>;
  save(list: T[]): Promise<void>;
  idOf(item: T): string;
  /** When the thing was last touched, for a thing the server may not know yet. */
  timeOf(item: T): number;
  /** The thing from the server, or null when it is not one. */
  parse(data: unknown): T | null;
  /** The list as it is kept: its order, and its limit if it has one. */
  arrange(list: T[]): T[];
}

/** The server's limits (server/src/sync.ts). */
const MAX_KEY_LENGTH = 200;
const MAX_ITEM_BYTES = 16 * 1024;
/** Under the server's 500 changes and 1 MB per request. */
const CHUNK_CHANGES = 400;
const CHUNK_BYTES = 700 * 1024;

const bytes = (text: string) => new TextEncoder().encode(text).length;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The key of a thing on the server: its id, or a hash of an id too long for it (a long address). */
export async function syncKey(id: string): Promise<string> {
  return id.length <= MAX_KEY_LENGTH ? id : `sha256:${await sha256(id)}`;
}

/** JSON that does not depend on the order of the fields. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((name) => record[name] !== undefined)
      .sort()
      .map((name) => `${JSON.stringify(name)}:${canonical(record[name])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A short print of a thing: enough to tell that it changed, without keeping a second copy of it. */
export async function fingerprint(item: unknown): Promise<string> {
  return (await sha256(canonical(item))).slice(0, 16);
}

export interface Snapshot<T> {
  item: T;
  print: string;
}

/** The list by server key, each thing with its print. */
export async function snapshot<T>(
  collection: Collection<T>,
  list: T[],
): Promise<Map<string, Snapshot<T>>> {
  const map = new Map<string, Snapshot<T>>();
  for (const item of list)
    map.set(await syncKey(collection.idOf(item)), { item, print: await fingerprint(item) });
  return map;
}

/**
 * What to tell the server: what is new or different from `seen`, and what has gone. A thing the server
 * may not know yet keeps its own time, so an old thing of this browser does not beat a newer change
 * made elsewhere; a change the user made after the last synchronisation is of now.
 */
export function changesSince<T>(
  collection: Collection<T>,
  current: Map<string, Snapshot<T>>,
  seen: Record<string, string>,
  now: number,
): SyncChange[] {
  const changes: SyncChange[] = [];
  for (const [key, { item, print }] of current) {
    if (seen[key] === print) continue;
    if (bytes(JSON.stringify(item)) > MAX_ITEM_BYTES) continue; // stays in this browser only
    changes.push({
      kind: collection.kind,
      key,
      data: item,
      updatedAt: key in seen ? now : collection.timeOf(item),
      deleted: false,
    });
  }
  for (const key of Object.keys(seen))
    if (!current.has(key))
      changes.push({ kind: collection.kind, key, data: null, updatedAt: now, deleted: true });
  return changes;
}

/** `seen` after the changes were told to the server. */
export function seenAfter<T>(
  current: Map<string, Snapshot<T>>,
  changes: SyncChange[],
  seen: Record<string, string>,
): Record<string, string> {
  const next = { ...seen };
  for (const change of changes) {
    if (change.deleted) delete next[change.key];
    else next[change.key] = current.get(change.key)!.print;
  }
  return next;
}

/** The next request's share of `queue` (taken out of it); one request stays within the server's limits. */
export function takeChunk(queue: SyncChange[]): SyncChange[] {
  let size = 0;
  let count = 0;
  while (count < queue.length && count < CHUNK_CHANGES) {
    size += bytes(JSON.stringify(queue[count]));
    if (count > 0 && size > CHUNK_BYTES) break;
    count += 1;
  }
  return queue.splice(0, count);
}

/**
 * The server's changes applied to the list as it is now. A thing the user changed while the request
 * was on its way is left alone: it differs from `seen`, so the next synchronisation tells the server.
 */
export async function merge<T>(
  collection: Collection<T>,
  current: Map<string, Snapshot<T>>,
  seen: Record<string, string>,
  remote: SyncChange[],
): Promise<{ list: T[] | null; seen: Record<string, string> }> {
  const items = new Map(current);
  const next = { ...seen };
  let changed = false;
  for (const change of remote) {
    if (change.kind !== collection.kind) continue;
    const { key } = change;
    if (items.get(key)?.print !== next[key]) continue;
    if (change.deleted) {
      changed = items.delete(key) || changed;
      delete next[key];
      continue;
    }
    const item = collection.parse(change.data);
    if (item === null || (await syncKey(collection.idOf(item))) !== key) continue;
    const print = await fingerprint(item);
    if (print === next[key]) continue;
    items.set(key, { item, print });
    next[key] = print;
    changed = true;
  }
  if (!changed) return { list: null, seen: next };

  const list = collection.arrange([...items.values()].map((entry) => entry.item));
  const kept = new Set(await Promise.all(list.map((item) => syncKey(collection.idOf(item)))));
  // Cut by the limit of the list, not deleted by the user: the server and other browsers keep it.
  for (const key of items.keys()) if (!kept.has(key)) delete next[key];
  return { list, seen: next };
}

/** What the last synchronisation of this browser knows. */
export interface SyncState {
  /** The user whose data the lists hold; null when the account does not tell. */
  owner: string | null;
  /** The server's place in the user's changes. */
  cursor: number;
  seen: Record<SyncKind, Record<string, string>>;
  /** When it last reached the server, ms since the epoch. */
  lastAt: number;
  /** The history was off when the cursor moved on: what it passed must be read again once it is on. */
  historyPaused: boolean;
}

const KEY = 'syncState';

export const emptySyncState = (owner: string | null): SyncState => ({
  owner,
  cursor: 0,
  seen: { words: {}, history: {}, settings: {}, sites: {} },
  lastAt: 0,
  historyPaused: false,
});

const prints = (value: unknown): Record<string, string> =>
  typeof value === 'object' && value !== null ? (value as Record<string, string>) : {};

export function normalizeSyncState(value: unknown): SyncState | null {
  if (typeof value !== 'object' || value === null) return null;
  const { owner, cursor, seen, lastAt, historyPaused } = value as Record<string, unknown>;
  if (typeof cursor !== 'number') return null;
  const record = (typeof seen === 'object' && seen !== null ? seen : {}) as Record<string, unknown>;
  return {
    owner: typeof owner === 'string' ? owner : null,
    // A kind this browser has not synchronised yet: the cursor has passed its things, unread.
    cursor: SYNC_KINDS.every((kind) => kind in record) ? cursor : 0,
    seen: {
      words: prints(record.words),
      history: prints(record.history),
      settings: prints(record.settings),
      sites: prints(record.sites),
    },
    lastAt: typeof lastAt === 'number' ? lastAt : 0,
    historyPaused: historyPaused === true,
  };
}

export async function loadSyncState(): Promise<SyncState | null> {
  return normalizeSyncState((await browser.storage.local.get(KEY))[KEY]);
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await browser.storage.local.set({ [KEY]: state });
}

/**
 * Asks the background to synchronise now, and waits for it for `timeoutMs` at most (the user must not
 * wait for a bad network): a panel that opens, a sign-out that wants the last changes on the server.
 */
export async function requestSync(timeoutMs = 3000): Promise<void> {
  await Promise.race([
    browser.runtime.sendMessage({ type: 'sync' } satisfies SyncMessage).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
