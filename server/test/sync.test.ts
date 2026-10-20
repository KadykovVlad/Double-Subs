import { describe, expect, it } from 'vitest';
import { call, signIn } from './helpers';

interface Answer {
  cursor: number;
  changes: Array<{ kind: string; key: string; data: unknown; updatedAt: number; deleted: boolean }>;
  more: boolean;
  reset: boolean;
}

const word = (key: string, updatedAt: number, data: unknown = { word: key }, deleted = false) => ({
  kind: 'words',
  key,
  data,
  updatedAt,
  deleted,
});

async function sync(token: string, body: Record<string, unknown>): Promise<Answer> {
  const response = await call('/sync', { token, body });
  expect(response.status).toBe(200);
  return response.json();
}

describe('sync', () => {
  it('stores changes and gives them back, then only what is new after the cursor', async () => {
    const { accessToken } = await signIn();
    const first = await sync(accessToken, {
      cursor: 0,
      changes: [word('en:go', 10), word('en:run', 11)],
    });
    expect(first.changes.map((c) => c.key).sort()).toEqual(['en:go', 'en:run']);
    expect(first.more).toBe(false);

    const nothing = await sync(accessToken, { cursor: first.cursor });
    expect(nothing.changes).toEqual([]);

    const next = await sync(accessToken, { cursor: first.cursor, changes: [word('en:sit', 12)] });
    expect(next.changes.map((c) => c.key)).toEqual(['en:sit']);
  });

  it('an older change does not overwrite a newer one; a newer one does', async () => {
    const { accessToken } = await signIn();
    await sync(accessToken, { changes: [word('en:go', 100, { translation: 'идти' })] });
    await sync(accessToken, { changes: [word('en:go', 50, { translation: 'old' })] });
    let all = await sync(accessToken, { cursor: 0 });
    expect(all.changes).toEqual([word('en:go', 100, { translation: 'идти' })]);

    await sync(accessToken, { changes: [word('en:go', 200, { translation: 'ходить' })] });
    all = await sync(accessToken, { cursor: 0 });
    expect(all.changes).toEqual([word('en:go', 200, { translation: 'ходить' })]);
  });

  it('a deletion is kept as a tombstone, wins at an equal time, and loses to a later save', async () => {
    const { accessToken } = await signIn();
    await sync(accessToken, { changes: [word('en:go', 100)] });
    await sync(accessToken, { changes: [word('en:go', 100, null, true)] });
    let all = await sync(accessToken, { cursor: 0 });
    expect(all.changes).toEqual([word('en:go', 100, null, true)]);

    await sync(accessToken, { changes: [word('en:go', 150)] });
    all = await sync(accessToken, { cursor: 0 });
    expect(all.changes[0]).toMatchObject({ key: 'en:go', deleted: false, updatedAt: 150 });
  });

  it('a change from a clock that runs ahead counts as made now', async () => {
    const { accessToken } = await signIn();
    const future = Date.now() + 365 * 24 * 60 * 60 * 1000;
    await sync(accessToken, { changes: [word('en:go', future)] });
    const [stored] = (await sync(accessToken, { cursor: 0 })).changes;
    expect(stored!.updatedAt).toBeLessThanOrEqual(Date.now());
  });

  it('a user never sees another user’s data', async () => {
    const alice = await signIn('alice');
    const bob = await signIn('bob');
    await sync(alice.accessToken, { changes: [word('en:secret', 1)] });
    expect((await sync(bob.accessToken, { cursor: 0 })).changes).toEqual([]);
    // Bob writing the same key creates his own row, Alice's stays.
    await sync(bob.accessToken, { changes: [word('en:secret', 999, { mine: 'bob' })] });
    expect((await sync(alice.accessToken, { cursor: 0 })).changes).toEqual([word('en:secret', 1)]);
  });

  it('pages a long list: every change comes exactly once', async () => {
    const { accessToken } = await signIn();
    const many = Array.from({ length: 500 }, (_, i) => word(`en:w${i}`, i + 1));
    const more = Array.from({ length: 120 }, (_, i) => word(`en:x${i}`, i + 1));
    await sync(accessToken, { changes: many });
    await sync(accessToken, { changes: more });

    const keys: string[] = [];
    let cursor = 0;
    for (;;) {
      const page = await sync(accessToken, { cursor });
      keys.push(...page.changes.map((c) => c.key));
      cursor = page.cursor;
      if (!page.more) break;
    }
    expect(keys).toHaveLength(620);
    expect(new Set(keys).size).toBe(620);
  });

  it('a cursor from a lost database asks the client to start again', async () => {
    const { accessToken } = await signIn();
    const answer = await sync(accessToken, { cursor: 10_000 });
    expect(answer).toEqual({ cursor: 0, changes: [], more: false, reset: true });
  });

  it.each([
    ['an unknown kind', { changes: [{ ...word('k', 1), kind: 'passwords' }] }, 400],
    ['an empty key', { changes: [word('', 1)] }, 400],
    ['a negative time', { changes: [word('k', -1)] }, 400],
    ['a bad cursor', { cursor: -3 }, 400],
    ['a too large item', { changes: [word('k', 1, { text: 'x'.repeat(17 * 1024) })] }, 413],
    ['too many changes', { changes: Array.from({ length: 501 }, (_, i) => word(`k${i}`, 1)) }, 413],
  ])('refuses %s', async (_, body, status) => {
    const { accessToken } = await signIn();
    expect((await call('/sync', { token: accessToken, body })).status).toBe(status);
  });
});
