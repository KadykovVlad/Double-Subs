import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountError,
  authedCall,
  clearStaleSignIn,
  googleAuthUrl,
  idTokenFromRedirect,
  KEEP_AWAKE_EVERY_MS,
  loadAccount,
  normalizeAccount,
  normalizeSignInState,
  refreshPlan,
  requestSignIn,
  signIn,
  signInOnce,
  signOut,
  webAuthFailure,
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
    const account = { email: 'a@b.c', accessToken: 'x', refreshToken: 'y', expiresAt: 5 };
    expect(normalizeAccount(account)).toEqual(account);
    for (const bad of [null, 'x', {}, { ...account, expiresAt: '5' }, { ...account, email: 1 }])
      expect(normalizeAccount(bad)).toBeNull();
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
  store.account = { email: 'learner@example.com', ...tokens(n, expiresAt) };
};

describe('sign-in', () => {
  it('trades the Google token for ours, keeps the account and the plan of the server', async () => {
    handler = (path) =>
      path === '/auth/google'
        ? reply(tokens(1))
        : reply({ email: 'learner@example.com', plan: 'pro', proUntil: null });
    const account = await signIn();
    expect(account).toMatchObject({ email: 'learner@example.com', accessToken: 'access1' });
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
      email: 'learner@example.com',
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
        store.account = { email: 'learner@example.com', ...tokens(2) };
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
    await refreshPlan();
    expect(await loadEntitlements()).toEqual({ plan: 'pro', proUntil: 4_102_444_800_000 });
  });

  it('does nothing when nobody is signed in (the plan of a development build stays)', async () => {
    await saveEntitlements({ plan: 'pro', proUntil: null });
    await refreshPlan();
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

describe('one sign-in at a time', () => {
  const stateOf = () => store.signInState;

  beforeEach(() => {
    (browser as unknown as { runtime: object }).runtime = {
      getPlatformInfo: vi.fn(async () => ({})),
    };
    handler = (path) =>
      path === '/auth/google'
        ? reply(tokens(1))
        : reply({ email: 'learner@example.com', plan: 'free', proUntil: null });
  });

  it('a second request while one is running joins it: Google opens its window once', async () => {
    let opened = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    (browser.identity.launchWebAuthFlow as unknown) = async ({ url }: { url: string }) => {
      opened++;
      await gate;
      return redirect(idToken(new URL(url).searchParams.get('nonce')!));
    };
    const first = signInOnce();
    const second = signInOnce();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(stateOf()).toEqual({ running: true });
    release();
    await Promise.all([first, second]);
    expect(opened).toBe(1);
    expect(stateOf()).toBeUndefined(); // done: nothing is kept
    expect(await loadAccount()).not.toBeNull();
  });

  it('a failure is kept for any window to show, and the next attempt starts clean', async () => {
    handler = () => reply({ error: 'bad_google_token' }, 401);
    await expect(signInOnce()).rejects.toMatchObject({ code: 'server' });
    expect(stateOf()).toEqual({ error: 'server' });

    handler = (path) =>
      path === '/auth/google'
        ? reply(tokens(1))
        : reply({ email: 'learner@example.com', plan: 'free', proUntil: null });
    await signInOnce();
    expect(stateOf()).toBeUndefined();
  });

  it('a closed Google window is no failure: nothing is kept', async () => {
    (browser.identity.launchWebAuthFlow as unknown) = async () => {
      throw new Error('The user did not approve access.');
    };
    await expect(signInOnce()).rejects.toMatchObject({ code: 'cancelled' });
    expect(stateOf()).toBeUndefined();
  });

  it('keeps the background awake while the user picks an account, and stops when it is over', async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      (browser.identity.launchWebAuthFlow as unknown) = async ({ url }: { url: string }) => {
        await gate;
        return redirect(idToken(new URL(url).searchParams.get('nonce')!));
      };
      const awake = (browser.runtime as unknown as { getPlatformInfo: ReturnType<typeof vi.fn> })
        .getPlatformInfo;
      const run = signInOnce();
      await vi.advanceTimersByTimeAsync(KEEP_AWAKE_EVERY_MS * 3 + 100);
      expect(awake).toHaveBeenCalledTimes(3);
      release();
      await vi.advanceTimersByTimeAsync(10);
      await run;
      awake.mockClear();
      await vi.advanceTimersByTimeAsync(KEEP_AWAKE_EVERY_MS * 3);
      expect(awake).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a "running" left from a background that died is cleared when the next one starts', async () => {
    store.signInState = { running: true };
    await clearStaleSignIn();
    expect(stateOf()).toBeUndefined();
  });
});

describe('what Chrome says when the Google window gives nothing', () => {
  it.each([
    ['The user did not approve access.', 'cancelled'],
    ['The window was closed', 'cancelled'],
    ['Authorization page could not be loaded.', 'network'],
    ['net::ERR_NAME_NOT_RESOLVED', 'network'],
    ['Something else went wrong', 'server'],
  ])('%s → %s', (message, code) => {
    expect(webAuthFailure(new Error(message)).code).toBe(code);
  });

  it('reads the stored progress and ignores damaged values', () => {
    expect(normalizeSignInState({ running: true })).toEqual({ running: true });
    expect(normalizeSignInState({ error: 'network' })).toEqual({ error: 'network' });
    for (const bad of [null, 'x', {}, { running: false }])
      expect(normalizeSignInState(bad)).toBeNull();
  });
});
