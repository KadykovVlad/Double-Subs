import { describe, expect, it } from 'vitest';
import { call, googleToken, ORIGIN, signIn } from './helpers';

describe('sign-in with Google', () => {
  it('gives tokens for a valid Google ID token, and /me knows the account (free plan)', async () => {
    const tokens = await signIn();
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toMatch(/^[\w-]+\.[\w-]+$/);
    const me = await call('/me', { token: tokens.accessToken });
    expect(await me.json()).toEqual({ email: 'learner@example.com', plan: 'free', proUntil: null });
  });

  it('the same Google account is the same user on a second browser', async () => {
    const first = await signIn('same-person');
    const second = await signIn('same-person');
    await call('/sync', {
      token: first.accessToken,
      body: {
        changes: [
          { kind: 'settings', key: 'settings', data: { a: 1 }, updatedAt: 5, deleted: false },
        ],
      },
    });
    const pulled = await (
      await call('/sync', { token: second.accessToken, body: {} })
    ).json<{
      changes: unknown[];
    }>();
    expect(pulled.changes).toHaveLength(1);
  });

  it.each([
    ['another audience', { aud: 'someone-else' }],
    ['another issuer', { iss: 'https://evil.example' }],
    ['an unverified email', { email_verified: false }],
  ])('refuses a token with %s', async (_, claims) => {
    const token = await googleToken(claims);
    const response = await call('/auth/google', { body: { idToken: token } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'bad_google_token' });
  });

  it('refuses an expired token and one with a broken signature', async () => {
    const expired = await googleToken({}, '-1m');
    expect((await call('/auth/google', { body: { idToken: expired } })).status).toBe(401);
    const valid = await googleToken();
    const broken = valid.slice(0, -4) + (valid.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect((await call('/auth/google', { body: { idToken: broken } })).status).toBe(401);
  });

  it('refuses requests without a valid access token', async () => {
    expect((await call('/me')).status).toBe(401);
    expect((await call('/me', { token: 'nonsense' })).status).toBe(401);
    expect((await call('/sync', { body: {} })).status).toBe(401);
  });
});

describe('sessions', () => {
  it('a refresh gives new tokens and the old refresh token stops working', async () => {
    const tokens = await signIn();
    const refreshed = await call('/auth/refresh', { body: { refreshToken: tokens.refreshToken } });
    expect(refreshed.status).toBe(200);
    const next = await refreshed.json<{ accessToken: string; refreshToken: string }>();
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    expect((await call('/me', { token: next.accessToken })).status).toBe(200);

    // The old token used again: refused, and the whole session ends (it may have been stolen).
    expect(
      (await call('/auth/refresh', { body: { refreshToken: tokens.refreshToken } })).status,
    ).toBe(401);
    expect(
      (await call('/auth/refresh', { body: { refreshToken: next.refreshToken } })).status,
    ).toBe(401);
  });

  it('sign-out ends the session', async () => {
    const tokens = await signIn();
    expect(
      (await call('/auth/logout', { body: { refreshToken: tokens.refreshToken } })).status,
    ).toBe(200);
    expect(
      (await call('/auth/refresh', { body: { refreshToken: tokens.refreshToken } })).status,
    ).toBe(401);
  });

  it('deleting the account removes the user, the data and the sessions', async () => {
    const tokens = await signIn('leaving');
    await call('/sync', {
      token: tokens.accessToken,
      body: { changes: [{ kind: 'words', key: 'en:go', data: {}, updatedAt: 1, deleted: false }] },
    });
    expect((await call('/me', { method: 'DELETE', token: tokens.accessToken })).status).toBe(200);
    expect((await call('/me', { token: tokens.accessToken })).status).toBe(401);
    // The access token is still signed for an hour, but there is nobody to sync for.
    expect((await call('/sync', { token: tokens.accessToken, body: {} })).status).toBe(401);
    expect(
      (await call('/auth/refresh', { body: { refreshToken: tokens.refreshToken } })).status,
    ).toBe(401);
    // Signing in again starts empty.
    const again = await signIn('leaving');
    const pulled = await (
      await call('/sync', { token: again.accessToken, body: {} })
    ).json<{
      changes: unknown[];
    }>();
    expect(pulled.changes).toEqual([]);
  });
});

describe('http', () => {
  it('answers CORS only for the extension origin', async () => {
    const own = await call('/health');
    expect(own.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const other = await call('/health', { headers: { origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await call('/sync', { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('refuses bad JSON, a too large body and unknown paths', async () => {
    expect((await call('/auth/google', { body: 'not json' })).status).toBe(400);
    expect(
      (await call('/auth/google', { body: { idToken: 'x'.repeat(1024 * 1024 + 1) } })).status,
    ).toBe(413);
    expect((await call('/nowhere')).status).toBe(404);
  });
});
