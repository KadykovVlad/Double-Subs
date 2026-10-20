import type { Env } from './env';
import { HttpError } from './http';

export const KINDS = ['words', 'history', 'settings', 'sites'] as const;
export type Kind = (typeof KINDS)[number];

export const MAX_CHANGES = 500;
export const PAGE_SIZE = 500;
const MAX_KEY_LENGTH = 200;
const MAX_DATA_BYTES = 16 * 1024;

/** One synced thing as the extension sends and receives it. */
export interface Change {
  kind: Kind;
  key: string;
  /** The extension's own JSON for it; null when deleted. */
  data: unknown;
  /** When the user made the change, ms since the epoch: the later change wins. */
  updatedAt: number;
  deleted: boolean;
}

interface Stored {
  kind: Kind;
  key: string;
  data: string | null;
  updated_at: number;
  deleted: number;
  seq: number;
}

/** The changes of a request, checked; a time ahead of the server's clock is taken as now. */
export function parseChanges(value: unknown, now: number): Array<Change & { json: string | null }> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'bad_changes');
  if (value.length > MAX_CHANGES) throw new HttpError(413, 'too_many_changes');
  return value.map((item: unknown) => {
    const { kind, key, data, updatedAt, deleted } = (item ?? {}) as Record<string, unknown>;
    if (!KINDS.includes(kind as Kind)) throw new HttpError(400, 'bad_kind');
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH)
      throw new HttpError(400, 'bad_key');
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0)
      throw new HttpError(400, 'bad_time');
    if (typeof deleted !== 'boolean') throw new HttpError(400, 'bad_deleted');
    const json = deleted ? null : JSON.stringify(data ?? null);
    if (json !== null && new TextEncoder().encode(json).length > MAX_DATA_BYTES)
      throw new HttpError(413, 'item_too_large');
    return {
      kind: kind as Kind,
      key,
      data: deleted ? null : data,
      updatedAt: Math.min(Math.floor(updatedAt), now),
      deleted,
      json,
    };
  });
}

export interface SyncResult {
  /** Pass it back as `cursor` next time to get only what changed after this answer. */
  cursor: number;
  changes: Change[];
  /** More changes are waiting: ask again at once with the new cursor. */
  more: boolean;
  /** The cursor is from a database that no longer exists: start again from 0 and send everything. */
  reset: boolean;
}

/**
 * Stores the client's changes where they are newer than what is stored (an equal time: the deletion
 * wins), then answers with everything after `cursor`. Each stored change gets the next number of the
 * user's sequence, so a page ends exactly between two changes.
 */
export async function sync(
  userId: string,
  body: Record<string, unknown>,
  env: Env,
  now = Date.now(),
): Promise<SyncResult> {
  const cursor = body.cursor ?? 0;
  if (typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0)
    throw new HttpError(400, 'bad_cursor');
  const changes = parseChanges(body.changes, now);
  // An access token outlives a deleted account by up to an hour.
  const user = await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(userId).first();
  if (!user) throw new HttpError(401, 'no_user');

  if (changes.length > 0) {
    const count = changes.length;
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET sync_seq = sync_seq + ? WHERE id = ?').bind(count, userId),
      ...changes.map((change, index) =>
        env.DB.prepare(
          `INSERT INTO items (user_id, kind, key, data, updated_at, deleted, seq)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT sync_seq FROM users WHERE id = ?1) - ?7)
           ON CONFLICT (user_id, kind, key) DO UPDATE SET
             data = excluded.data, updated_at = excluded.updated_at,
             deleted = excluded.deleted, seq = excluded.seq
           WHERE excluded.updated_at > items.updated_at
              OR (excluded.updated_at = items.updated_at AND excluded.deleted > items.deleted)`,
        ).bind(
          userId,
          change.kind,
          change.key,
          change.json,
          change.updatedAt,
          change.deleted ? 1 : 0,
          count - 1 - index,
        ),
      ),
    ]);
  }

  const [rows, sequence] = await env.DB.batch([
    env.DB.prepare(
      `SELECT kind, key, data, updated_at, deleted, seq FROM items
       WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?`,
    ).bind(userId, cursor, PAGE_SIZE + 1),
    env.DB.prepare('SELECT sync_seq FROM users WHERE id = ?').bind(userId),
  ]);
  const latest = (sequence!.results[0] as { sync_seq: number } | undefined)?.sync_seq ?? 0;
  if (cursor > latest) return { cursor: 0, changes: [], more: false, reset: true };

  const stored = rows!.results as unknown as Stored[];
  const more = stored.length > PAGE_SIZE;
  const page = more ? stored.slice(0, PAGE_SIZE) : stored;
  return {
    cursor: more ? page[page.length - 1]!.seq : latest,
    changes: page.map((row) => ({
      kind: row.kind,
      key: row.key,
      data: row.data === null ? null : JSON.parse(row.data),
      updatedAt: row.updated_at,
      deleted: row.deleted === 1,
    })),
    more,
    reset: false,
  };
}
