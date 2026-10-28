import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { verifyEmailCode } from '../src/email';
import { clientIp, rateLimit } from '../src/limits';
import { botUpdate, call, freshEmail, googleToken, lastCode, signIn, type Tokens } from './helpers';

const me = async (token: string) =>
  (await call('/me', { token })).json<{
    email: string | null;
    name: string;
    methods: Array<{ provider: string; label: string }>;
  }>();

async function emailSignIn(email: string): Promise<Tokens> {
  expect((await call('/auth/email/start', { body: { email, lang: 'ru' } })).status).toBe(200);
  const response = await call('/auth/email/verify', {
    body: { email, code: await lastCode(email.trim().toLowerCase()) },
  });
  expect(response.status).toBe(200);
  return response.json();
}

interface TelegramStart {
  loginId: string;
  secret: string;
  link: string;
}

async function telegramStart(token?: string): Promise<TelegramStart> {
  const response = await call('/auth/telegram/start', { method: 'POST', body: {}, token });
  expect(response.status).toBe(200);
  return response.json();
}

const poll = (start: TelegramStart, token?: string) =>
  call('/auth/telegram/poll', { body: { loginId: start.loginId, secret: start.secret }, token });

describe('sign-in with a code by email', () => {
  it('a letter with six digits; the code signs in, and the account is the address', async () => {
    const email = freshEmail();
    const tokens = await emailSignIn(email.toUpperCase()); // the case does not matter
    expect(tokens.refreshToken).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(await me(tokens.accessToken)).toMatchObject({
      email,
      name: email,
      methods: [{ provider: 'email', label: email }],
    });
    const letter = await env.DB.prepare('SELECT subject FROM dev_outbox WHERE to_address = ?')
      .bind(email)
      .first<{ subject: string }>();
    expect(letter!.subject).toMatch(/^Код для входа в Double Sub: \d{6}$/);
  });

  it('the same address signs in as the same user the next time', async () => {
    const email = freshEmail();
    const first = await emailSignIn(email);
    await call('/sync', {
      token: first.accessToken,
      body: { changes: [{ kind: 'words', key: 'en:go', data: {}, updatedAt: 1, deleted: false }] },
    });
    await env.DB.prepare('DELETE FROM rate_limits WHERE key LIKE ?').bind(`%${email}`).run();
    const second = await emailSignIn(email);
    const pulled = await (
      await call('/sync', { token: second.accessToken, body: {} })
    ).json<{ changes: unknown[] }>();
    expect(pulled.changes).toHaveLength(1);
  });

  it('a wrong code is refused; after five wrong ones even the right code is not taken', async () => {
    const email = freshEmail();
    await call('/auth/email/start', { body: { email } });
    const code = await lastCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const response = await call('/auth/email/verify', { body: { email, code: wrong } });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'bad_code' });
    }
    const late = await call('/auth/email/verify', { body: { email, code } });
    expect(await late.json()).toEqual({ error: 'code_expired' });
  });

  it('a code works once, and not after ten minutes', async () => {
    const email = freshEmail();
    await call('/auth/email/start', { body: { email } });
    const code = await lastCode(email);
    expect((await call('/auth/email/verify', { body: { email, code } })).status).toBe(200);
    expect((await call('/auth/email/verify', { body: { email, code } })).status).toBe(401);

    const other = freshEmail();
    await call('/auth/email/start', { body: { email: other } });
    const request = new Request('https://api.test/', { headers: { 'cf-connecting-ip': 'x' } });
    await expect(
      verifyEmailCode(
        request,
        { email: other, code: await lastCode(other) },
        env,
        Date.now() + 11 * 60_000,
      ),
    ).rejects.toMatchObject({ code: 'code_expired' });
  });

  it('a second letter waits a minute; a wrong address is refused', async () => {
    const email = freshEmail();
    expect((await call('/auth/email/start', { body: { email } })).status).toBe(200);
    const again = await call('/auth/email/start', { body: { email } });
    expect(again.status).toBe(429);
    expect(await again.json()).toEqual({ error: 'too_many' });
    for (const bad of ['', 'nobody', 'a@b', 'with space@example.com', 42])
      expect((await call('/auth/email/start', { body: { email: bad } })).status).toBe(400);
  });

  it('one network address sends at most twenty letters an hour', async () => {
    const headers = { 'cf-connecting-ip': `203.0.113.${crypto.randomUUID()}` };
    for (let i = 0; i < 20; i++)
      expect(
        (await call('/auth/email/start', { body: { email: freshEmail() }, headers })).status,
      ).toBe(200);
    expect(
      (await call('/auth/email/start', { body: { email: freshEmail() }, headers })).status,
    ).toBe(429);
  });

  it('Google and a code for the same address are one person', async () => {
    const email = freshEmail();
    const byCode = await emailSignIn(email);
    const sub = crypto.randomUUID();
    const byGoogle = await (
      await call('/auth/google', { body: { idToken: await googleToken({ sub, email }) } })
    ).json<Tokens>();
    const a = await me(byCode.accessToken);
    const b = await me(byGoogle.accessToken);
    expect(b.methods).toEqual([
      { provider: 'google', label: email },
      { provider: 'email', label: email },
    ]);
    expect(a.methods).toEqual(b.methods);
  });
});

describe('sign-in through the Telegram bot', () => {
  it('pending until the user presses Start in the bot; then a session, once', async () => {
    const start = await telegramStart();
    expect(start.link).toBe(`https://t.me/DoubleSubTestBot?start=${start.loginId}`);
    expect(start.loginId).toMatch(/^[\w-]{32}$/);
    expect(await (await poll(start)).json()).toEqual({ pending: true });

    expect(
      (await botUpdate(`/start ${start.loginId}`, { id: 9001, username: 'learner' })).status,
    ).toBe(200);
    const done = await poll(start);
    expect(done.status).toBe(200);
    const tokens = await done.json<Tokens>();
    expect(await me(tokens.accessToken)).toMatchObject({
      email: null,
      name: '@learner',
      methods: [{ provider: 'telegram', label: '@learner' }],
    });
    // Used: asking again gets nothing.
    expect((await poll(start)).status).toBe(410);
  });

  it('the same Telegram user is the same account the next time; a name without username is shown', async () => {
    const id = Math.floor(Math.random() * 1e9);
    const sign = async () => {
      const start = await telegramStart();
      await botUpdate(`/start ${start.loginId}`, {
        id,
        username: undefined,
        first_name: 'Анна',
        last_name: 'К',
      });
      return (await poll(start)).json<Tokens>();
    };
    const first = await me((await sign()).accessToken);
    const second = await me((await sign()).accessToken);
    expect(first.name).toBe('Анна К');
    expect(second.methods).toEqual(first.methods);
  });

  it('only Telegram can call the webhook; a wrong secret, an unknown login or plain text bind nothing', async () => {
    const start = await telegramStart();
    expect((await botUpdate(`/start ${start.loginId}`, {}, 'wrong')).status).toBe(401);
    expect((await botUpdate(`/start ${'x'.repeat(32)}`)).status).toBe(200);
    expect((await botUpdate('hello')).status).toBe(200);
    expect(await (await poll(start)).json()).toEqual({ pending: true });
  });

  it('a wrong secret cannot take a login somebody else confirmed', async () => {
    const start = await telegramStart();
    await botUpdate(`/start ${start.loginId}`, { id: 31337 });
    expect((await poll({ ...start, secret: 'guess' })).status).toBe(410);
    expect((await poll(start)).status).toBe(200);
  });

  it('a link that is ten minutes old is not taken by the bot', async () => {
    const start = await telegramStart();
    await env.DB.prepare('UPDATE telegram_logins SET expires_at = 1 WHERE id = ?')
      .bind(start.loginId)
      .run();
    await botUpdate(`/start ${start.loginId}`);
    expect((await poll(start)).status).toBe(410);
  });
});

describe('adding and removing ways in', () => {
  it('a Google user adds an address: the code must be entered while signed in, then both work', async () => {
    const google = await signIn();
    const email = freshEmail();
    await call('/auth/email/start', { body: { email }, token: google.accessToken });
    const code = await lastCode(email);
    // Somebody without the account cannot finish it.
    expect((await call('/auth/email/verify', { body: { email, code } })).status).toBe(401);

    await env.DB.prepare('DELETE FROM rate_limits WHERE key LIKE ?').bind(`%${email}`).run();
    await call('/auth/email/start', { body: { email }, token: google.accessToken });
    const linked = await call('/auth/email/verify', {
      body: { email, code: await lastCode(email) },
      token: google.accessToken,
    });
    expect(await linked.json()).toEqual({ linked: true });
    const methods = (await me(google.accessToken)).methods.map((m) => m.provider);
    expect(methods).toEqual(['google', 'email']);

    await env.DB.prepare('DELETE FROM rate_limits WHERE key LIKE ?').bind(`%${email}`).run();
    const byCode = await emailSignIn(email);
    expect((await me(byCode.accessToken)).methods.map((m) => m.provider)).toEqual([
      'google',
      'email',
    ]);
  });

  it('a user adds Telegram; a Telegram account of somebody else cannot be added', async () => {
    const owner = await signIn();
    const start = await telegramStart(owner.accessToken);
    await botUpdate(`/start ${start.loginId}`, { id: 55555, username: 'owner' });
    expect(await (await poll(start, owner.accessToken)).json()).toEqual({ linked: true });
    expect((await me(owner.accessToken)).methods.map((m) => m.provider)).toEqual([
      'google',
      'telegram',
    ]);

    const other = await signIn();
    const theirs = await telegramStart(other.accessToken);
    await botUpdate(`/start ${theirs.loginId}`, { id: 55555, username: 'owner' });
    const taken = await poll(theirs, other.accessToken);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'identity_taken' });
  });

  it('a way in can be removed, but not the last one', async () => {
    const tokens = await signIn();
    const email = freshEmail();
    await call('/auth/email/start', { body: { email }, token: tokens.accessToken });
    await call('/auth/email/verify', {
      body: { email, code: await lastCode(email) },
      token: tokens.accessToken,
    });
    const removed = await call('/me/methods/google', {
      method: 'DELETE',
      token: tokens.accessToken,
    });
    expect(await removed.json()).toEqual({ methods: [{ provider: 'email', label: email }] });
    const last = await call('/me/methods/email', { method: 'DELETE', token: tokens.accessToken });
    expect(last.status).toBe(409);
    expect(await last.json()).toEqual({ error: 'last_method' });
    expect(
      (await call('/me/methods/nothing', { method: 'DELETE', token: tokens.accessToken })).status,
    ).toBe(404);
  });

  it('deleting the account removes its ways in: the address starts a new, empty account', async () => {
    const email = freshEmail();
    const tokens = await emailSignIn(email);
    expect((await call('/me', { method: 'DELETE', token: tokens.accessToken })).status).toBe(200);
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM identities WHERE subject = ?')
        .bind(email)
        .first(),
    ).toEqual({ n: 0 });
  });
});

describe('limits', () => {
  it('a fixed window: refused over the limit, counted afresh in the next window', async () => {
    const key = `test:${crypto.randomUUID()}`;
    await rateLimit(env, key, 2, 1000, 10_000);
    await rateLimit(env, key, 2, 1000, 10_500);
    await expect(rateLimit(env, key, 2, 1000, 10_900)).rejects.toMatchObject({ status: 429 });
    await rateLimit(env, key, 2, 1000, 11_001);
  });

  it("the proxy's word for the user's address is taken only with its secret", () => {
    const request = (headers: Record<string, string>) => new Request('https://x/', { headers });
    expect(clientIp(request({ 'cf-connecting-ip': '1.1.1.1' }), env)).toBe('1.1.1.1');
    expect(clientIp(request({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '9.9.9.9' }), env)).toBe(
      '1.1.1.1',
    );
    expect(
      clientIp(
        request({
          'cf-connecting-ip': '1.1.1.1',
          'x-real-ip': '9.9.9.9',
          'x-proxy-secret': 'nope',
        }),
        env,
      ),
    ).toBe('1.1.1.1');
    expect(
      clientIp(
        request({
          'cf-connecting-ip': '1.1.1.1',
          'x-real-ip': '9.9.9.9',
          'x-proxy-secret': 'test-proxy-secret',
        }),
        env,
      ),
    ).toBe('9.9.9.9');
  });
});
