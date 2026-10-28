import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountError,
  authedCall,
  googleAuthUrl,
  idTokenFromRedirect,
  loadAccount,
  normalizeAccount,
  cancelTelegramSignIn,
  pendingTelegramLogin,
  refreshAccount,
  removeMethod,
  sendEmailCode,
  startTelegramSignIn,
  verifyEmailCode,
  waitForTelegram,
  requestSignIn,
  signIn,
  signOut,
} from '../src/lib/account';
import { GOOGLE_CLIENT_ID } from '../src/lib/account-config';
import { FREE_PLAN, loadEntitlements, saveEntitlements } from '../src/lib/entitlements';

const b64url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const idToken = (nonce: string) => `${b64url({ alg: 'RS256' })}.${b64url({ nonce })}.signature`;
const redirect = (token: string) => `https://id.chromiumapp.org/#id_token=${token}&authuser=0`;

describe('Google answer', () => {
  it('takes the ID token from the fragment when it carries our nonce', () => {
    const token = idToken('n1');
    expect(idTokenFromRedirect(redirect(token), 'n1')).toBe(token);
  });

  it('refuses an answer without a token, and a token of another sign-in', () => {
    expect(() =>
      idTokenFromRedirect('https://id.chromiumapp.org/#error=access_denied', 'n1'),
    ).toThrow(expect.objectContaining({ code: 'no_token' }));
    expect(() => idTokenFromRedirect('https://id.chromiumapp.org/', 'n1')).toThrow(
      expect.objectContaining({ code: 'no_token' }),
    );
    expect(() => idTokenFromRedirect(redirect(idToken('other')), 'n1')).toThrow(
      expect.objectContaining({ code: 'bad_nonce' }),
    );
    expect(() => idTokenFromRedirect(redirect('not-a-jwt'), 'n1')).toThrow(
      expect.objectContaining({ code: 'bad_nonce' }),
    );
  });

  it('asks Google for an ID token for this client, to the redirect address of the extension', () => {
    const url = new URL(googleAuthUrl('https://id.chromiumapp.org/', 'n1'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: 'https://id.chromiumapp.org/',
      response_type: 'id_token',
      nonce: 'n1',
    });
  });

  it('reads a stored account and drops a damaged one', () => {
    const account = {
      name: 'a@b.c',
      methods: [{ provider: 'email', label: 'a@b.c' }],
      accessToken: 'x',
      refreshToken: 'y',
      expiresAt: 5,
    };
    expect(normalizeAccount(account)).toEqual(account);
    for (const bad of [null, 'x', {}, { ...account, expiresAt: '5' }, { ...account, name: 1 }])
      expect(normalizeAccount(bad)).toBeNull();
  });

  it('an account kept before there were three ways in still reads: its email is the name', () => {
    expect(
      normalizeAccount({ email: 'a@b.c', accessToken: 'x', refreshToken: 'y', expiresAt: 5 }),
    ).toEqual({ name: 'a@b.c', methods: [], accessToken: 'x', refreshToken: 'y', expiresAt: 5 });
    // A method of an unknown kind is dropped, the account is kept.
    expect(
      normalizeAccount({
        name: 'n',
        methods: [{ provider: 'fax', label: '1' }],
        accessToken: 'x',
        refreshToken: 'y',
        expiresAt: 5,
      })!.methods,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------- the server, faked

type Handler = (path: string, init: RequestInit) => Response | Promise<Response>;

let store: Record<string, unknown>;
let handler: Handler;
let calls: Array<{ path: string; method: string; auth: string | null; body: unknown }>;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const tokens = (n: number, expiresAt = Date.now() + 3_600_000) => ({
  accessToken: `access${n}`,
  refreshToken: `refresh${n}`,
  expiresAt,
});

beforeEach(() => {
  store = {};
  calls = [];
  handler = () => reply({ error: 'unexpected' }, 500);
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => void Object.assign(store, items),
        remove: async (key: string) => void delete store[key],
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
    identity: {
      getRedirectURL: () => 'https://id.chromiumapp.org/',
      launchWebAuthFlow: async ({ url }: { url: string }) =>
        redirect(idToken(new URL(url).searchParams.get('nonce')!)),
    },
  });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const headers = new Headers(init.headers);
    calls.push({
      path,
      method: init.method ?? 'GET',
      auth: headers.get('authorization'),
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return handler(path, init);
  });
});

afterEach(() => vi.unstubAllGlobals());

const signedIn = (n = 1, expiresAt?: number) => {
  store.account = { name: 'learner@example.com', methods: [], ...tokens(n, expiresAt) };
};

const meAnswer = (patch: Record<string, unknown> = {}) =>
  reply({
    email: 'learner@example.com',
    name: 'learner@example.com',
    plan: 'free',
    proUntil: null,
    methods: [{ provider: 'google', label: 'learner@example.com' }],
    ...patch,
  });

describe('sign-in', () => {
  it('trades the Google token for ours, keeps the account and the plan of the server', async () => {
    handler = (path) =>
      path === '/auth/google'
        ? reply(tokens(1))
        : reply({ email: 'learner@example.com', plan: 'pro', proUntil: null });
    const account = await signIn();
    expect(account).toMatchObject({ name: 'learner@example.com', accessToken: 'access1' });
    expect(await loadAccount()).toEqual(account);
    expect((await loadEntitlements()).plan).toBe('pro');
    expect(calls[0]).toMatchObject({ path: '/auth/google', method: 'POST' });
    expect((calls[0]!.body as { idToken: string }).idToken).toMatch(/\./);
    expect(calls[1]).toMatchObject({ path: '/me', auth: 'Bearer access1' });
  });

  it('a closed Google window is "cancelled" and changes nothing', async () => {
    (browser.identity.launchWebAuthFlow as unknown) = async () => {
      throw new Error('The user did not approve access.');
    };
    await expect(signIn()).rejects.toMatchObject({ code: 'cancelled' });
    expect(await loadAccount()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('tells a refusal of the server from a server that cannot be reached', async () => {
    handler = () => reply({ error: 'bad_google_token' }, 401);
    await expect(signIn()).rejects.toMatchObject({ code: 'server' });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(signIn()).rejects.toMatchObject({ code: 'network' });
    expect(await loadAccount()).toBeNull();
  });
});

describe('sign-out', () => {
  it('ends the session on the server and here, and the plan is free again', async () => {
    signedIn();
    await saveEntitlements({ plan: 'pro', proUntil: null });
    handler = () => reply({ ok: true });
    await signOut();
    expect(calls).toEqual([
      { path: '/auth/logout', method: 'POST', auth: null, body: { refreshToken: 'refresh1' } },
    ]);
    expect(await loadAccount()).toBeNull();
    expect(await loadEntitlements()).toEqual(FREE_PLAN);
  });

  it('works offline: the device is signed out whatever the server says', async () => {
    signedIn();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await signOut();
    expect(await loadAccount()).toBeNull();
  });
});

describe('tokens', () => {
  it('renews a token that is about to end, before it is used', async () => {
    signedIn(1, Date.now() + 10_000);
    handler = (path) => (path === '/auth/refresh' ? reply(tokens(2)) : reply({ ok: true }));
    await authedCall('/me');
    expect(calls.map((c) => [c.path, c.auth])).toEqual([
      ['/auth/refresh', null],
      ['/me', 'Bearer access2'],
    ]);
    expect(calls[0]!.body).toEqual({ refreshToken: 'refresh1' });
    expect(await loadAccount()).toMatchObject({
      refreshToken: 'refresh2',
      name: 'learner@example.com',
    });
  });

  it('renews once when the server refuses a token that looked fine, and asks again', async () => {
    signedIn();
    let first = true;
    handler = (path) => {
      if (path === '/auth/refresh') return reply(tokens(2));
      if (first) {
        first = false;
        return reply({ error: 'bad_token' }, 401);
      }
      return reply({ email: 'learner@example.com', plan: 'free', proUntil: null });
    };
    const response = await authedCall('/me');
    expect(response.status).toBe(200);
    expect(calls.map((c) => c.path)).toEqual(['/me', '/auth/refresh', '/me']);
  });

  it('a refresh token the server refuses ends the session here, plan included', async () => {
    signedIn(1, Date.now() + 10_000);
    await saveEntitlements({ plan: 'pro', proUntil: null });
    handler = () => reply({ error: 'bad_refresh_token' }, 401);
    await expect(authedCall('/me')).rejects.toMatchObject({ code: 'signed_out' });
    expect(await loadAccount()).toBeNull();
    expect(await loadEntitlements()).toEqual(FREE_PLAN);
  });

  it('a server that cannot be reached keeps the account: the session is not lost offline', async () => {
    signedIn(1, Date.now() + 10_000);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(authedCall('/me')).rejects.toBeInstanceOf(AccountError);
    expect(await loadAccount()).not.toBeNull();
  });

  it('takes the tokens another part of the extension has renewed meanwhile, without spending the old one', async () => {
    signedIn();
    let first = true;
    handler = (path) => {
      if (path === '/auth/refresh') return reply({ error: 'must not be called' }, 500);
      if (first) {
        // While this request is on its way another context renews the tokens.
        first = false;
        store.account = { name: 'learner@example.com', methods: [], ...tokens(2) };
        return reply({ error: 'bad_token' }, 401);
      }
      return reply({ ok: true });
    };
    const response = await authedCall('/me');
    expect(response.status).toBe(200);
    expect(calls.map((c) => [c.path, c.auth])).toEqual([
      ['/me', 'Bearer access1'],
      ['/me', 'Bearer access2'],
    ]);
  });
});

describe('plan', () => {
  it('is taken from the server when the panel opens', async () => {
    signedIn();
    handler = () =>
      reply({ email: 'learner@example.com', plan: 'pro', proUntil: 4_102_444_800_000 });
    await refreshAccount();
    expect(await loadEntitlements()).toEqual({ plan: 'pro', proUntil: 4_102_444_800_000 });
  });

  it('does nothing when nobody is signed in (the plan of a development build stays)', async () => {
    await saveEntitlements({ plan: 'pro', proUntil: null });
    await expect(refreshAccount()).rejects.toMatchObject({ code: 'signed_out' });
    expect(calls).toEqual([]);
    expect((await loadEntitlements()).plan).toBe('pro');
  });
});

describe('sign-in asked of the background', () => {
  const sends = (answer: unknown) =>
    vi.stubGlobal('browser', {
      ...(globalThis as unknown as { browser: object }).browser,
      runtime: {
        sendMessage: async () => {
          if (answer instanceof Error) throw answer;
          return answer;
        },
      },
    });

  it('is done when the background says so', async () => {
    sends({ ok: true });
    await expect(requestSignIn()).resolves.toBeUndefined();
  });

  it('passes the reason when it failed', async () => {
    sends({ ok: false, code: 'network' });
    await expect(requestSignIn()).rejects.toMatchObject({ code: 'network' });
    sends({ ok: false });
    await expect(requestSignIn()).rejects.toMatchObject({ code: 'server' });
  });

  it('is no error when the window that asked closed on the way: the background finishes alone', async () => {
    sends(new Error('The message port closed before a response was received.'));
    await expect(requestSignIn()).resolves.toBeUndefined();
  });
});

describe('the account from the server', () => {
  it('keeps the name and the ways in, and the tokens renewed on the way', async () => {
    signedIn(1, Date.now() + 10_000);
    handler = (path) =>
      path === '/auth/refresh'
        ? reply(tokens(2))
        : meAnswer({
            name: '@learner',
            email: null,
            methods: [{ provider: 'telegram', label: '@learner' }],
          });
    const account = await refreshAccount();
    expect(account).toMatchObject({
      name: '@learner',
      methods: [{ provider: 'telegram', label: '@learner' }],
      accessToken: 'access2',
    });
    expect(await loadAccount()).toEqual(account);
  });

  it('removes a way in; the last one is refused with its own reason', async () => {
    signedIn();
    handler = (path, init) =>
      path === '/me/methods/google' && init.method === 'DELETE'
        ? reply({ methods: [{ provider: 'email', label: 'learner@example.com' }] })
        : meAnswer({ methods: [{ provider: 'email', label: 'learner@example.com' }] });
    expect((await removeMethod('google')).methods).toEqual([
      { provider: 'email', label: 'learner@example.com' },
    ]);
    handler = () => reply({ error: 'last_method' }, 409);
    await expect(removeMethod('email')).rejects.toMatchObject({ code: 'last_method' });
  });
});

describe('a code by email', () => {
  it('sends the letter in the language of the interface, then the code signs in', async () => {
    handler = (path) =>
      path === '/auth/email/start'
        ? reply({ ok: true })
        : path === '/auth/email/verify'
          ? reply(tokens(1))
          : meAnswer({ methods: [{ provider: 'email', label: 'learner@example.com' }] });
    await sendEmailCode('  learner@example.com ');
    expect(calls[0]).toMatchObject({
      path: '/auth/email/start',
      auth: null,
      body: { email: 'learner@example.com', lang: 'ru' },
    });
    const account = await verifyEmailCode('learner@example.com', '123 456');
    expect(calls[1]!.body).toEqual({ email: 'learner@example.com', code: '123456' });
    expect(account).toMatchObject({ name: 'learner@example.com', accessToken: 'access1' });
    expect(await loadAccount()).toEqual(account);
  });

  it('each refusal has its own reason, and nothing is kept', async () => {
    for (const [error, code] of [
      ['bad_code', 'bad_code'],
      ['code_expired', 'code_expired'],
      ['too_many', 'too_many'],
      ['bad_email', 'bad_email'],
      ['mail_not_configured', 'not_configured'],
      ['something_else', 'server'],
    ]) {
      handler = () => reply({ error }, 400);
      await expect(verifyEmailCode('a@b.c', '000000')).rejects.toMatchObject({ code });
    }
    expect(await loadAccount()).toBeNull();
  });

  it('adding an address goes with the access token and keeps the session', async () => {
    signedIn();
    handler = (path) =>
      path === '/me'
        ? meAnswer({
            methods: [
              { provider: 'google', label: 'learner@example.com' },
              { provider: 'email', label: 'other@example.com' },
            ],
          })
        : reply(path === '/auth/email/verify' ? { linked: true } : { ok: true });
    await sendEmailCode('other@example.com', { link: true });
    const account = await verifyEmailCode('other@example.com', '123456', { link: true });
    expect(calls.map((c) => [c.path, c.auth])).toEqual([
      ['/auth/email/start', 'Bearer access1'],
      ['/auth/email/verify', 'Bearer access1'],
      ['/me', 'Bearer access1'],
    ]);
    expect(account.accessToken).toBe('access1');
    expect(account.methods.map((m) => m.provider)).toEqual(['google', 'email']);
  });
});

describe('the Telegram bot', () => {
  const started = {
    loginId: 'L'.repeat(32),
    secret: 'S',
    link: `https://t.me/Bot?start=${'L'.repeat(32)}`,
    expiresAt: Date.now() + 600_000,
  };

  it('a started sign-in is kept, asked about until the user pressed Start, then signs in once', async () => {
    let polls = 0;
    handler = (path) => {
      if (path === '/auth/telegram/start') return reply(started);
      if (path === '/auth/telegram/poll')
        return ++polls < 3 ? reply({ pending: true }) : reply(tokens(1));
      return meAnswer({ name: '@learner', email: null, methods: [] });
    };
    const login = await startTelegramSignIn();
    expect(login).toEqual({ ...started, linking: false });
    expect(await pendingTelegramLogin()).toEqual(login);

    await waitForTelegram(login, new AbortController().signal);
    expect(polls).toBe(3);
    expect(calls.filter((c) => c.path === '/auth/telegram/poll')[0]!.body).toEqual({
      loginId: started.loginId,
      secret: 'S',
    });
    expect(await loadAccount()).toMatchObject({ name: '@learner', accessToken: 'access1' });
    expect(await pendingTelegramLogin()).toBeNull();
  });

  it('a server not reached for a moment is asked again; an old link ends the waiting', async () => {
    let down = true;
    const login = { ...started, linking: false };
    vi.stubGlobal('fetch', async (url: string) => {
      if (down) {
        down = false;
        throw new TypeError('Failed to fetch');
      }
      calls.push({ path: new URL(url).pathname, method: 'POST', auth: null, body: undefined });
      return reply({ error: 'login_expired' }, 410);
    });
    await expect(waitForTelegram(login, new AbortController().signal)).rejects.toMatchObject({
      code: 'login_expired',
    });
    expect(calls).toHaveLength(1);
    expect(await pendingTelegramLogin()).toBeNull();
  });

  it('stops when asked to, and an expired login is not even asked about', async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(
      waitForTelegram({ ...started, linking: false }, stop.signal),
    ).rejects.toMatchObject({
      code: 'cancelled',
    });
    await expect(
      waitForTelegram(
        { ...started, expiresAt: Date.now() - 1, linking: false },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'login_expired' });
    expect(calls).toEqual([]);
  });

  it('adding Telegram to the account asks with the access token and keeps the session', async () => {
    signedIn();
    handler = (path) =>
      path === '/auth/telegram/start'
        ? reply(started)
        : path === '/auth/telegram/poll'
          ? reply({ linked: true })
          : meAnswer({
              methods: [
                { provider: 'google', label: 'learner@example.com' },
                { provider: 'telegram', label: '@learner' },
              ],
            });
    const login = await startTelegramSignIn({ link: true });
    expect(login.linking).toBe(true);
    await waitForTelegram(login, new AbortController().signal);
    expect(calls.every((c) => c.path === '/me' || c.auth === 'Bearer access1')).toBe(true);
    expect((await loadAccount())!.methods.map((m) => m.provider)).toEqual(['google', 'telegram']);
    expect((await loadAccount())!.accessToken).toBe('access1');
  });

  it('a pending sign-in is forgotten on cancel and on sign-out', async () => {
    store.telegramLogin = { ...started, linking: false };
    await cancelTelegramSignIn();
    expect(await pendingTelegramLogin()).toBeNull();
    store.telegramLogin = { ...started, linking: false };
    signedIn();
    handler = () => reply({ ok: true });
    await signOut();
    expect(await pendingTelegramLogin()).toBeNull();
  });
});
