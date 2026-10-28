import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, googleToken } from './helpers';

describe('the sign-in methods migration', () => {
  it('keeps a user of Google from before it, with the session and the synced data', async () => {
    const identity = await env.DB.prepare(
      "SELECT provider, subject, label FROM identities WHERE user_id = 'legacy-user'",
    ).first();
    expect(identity).toEqual({
      provider: 'google',
      subject: 'legacy-sub',
      label: 'old@example.com',
    });
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM sessions WHERE user_id = 'legacy-user'",
      ).first(),
    ).toEqual({ n: 1 });
    expect(
      await env.DB.prepare("SELECT count(*) AS n FROM items WHERE user_id = 'legacy-user'").first(),
    ).toEqual({ n: 1 });
  });

  it('that user signs in with Google again as the same user', async () => {
    const response = await call('/auth/google', {
      body: { idToken: await googleToken({ sub: 'legacy-sub', email: 'old@example.com' }) },
    });
    const tokens = await response.json<{ accessToken: string }>();
    const pulled = await (
      await call('/sync', { token: tokens.accessToken, body: {} })
    ).json<{ changes: Array<{ key: string }> }>();
    expect(pulled.changes.map((change) => change.key)).toEqual(['en:go']);
  });
});
