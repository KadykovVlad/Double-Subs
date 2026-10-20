import { apiBase, GOOGLE_CLIENT_ID } from './account-config';
import { FREE_PLAN, normalizeEntitlements, saveEntitlements } from './entitlements';

/** A signed-in browser: the tokens of the server (never Google's), and whose they are. */
export interface Account {
  email: string;
  accessToken: string;
  refreshToken: string;
  /** When the access token ends, ms since the epoch. */
  expiresAt: number;
}

export type AccountErrorCode =
  | 'cancelled' // the user closed the Google window
  | 'no_token' // Google's answer had no ID token
  | 'bad_nonce' // the token is not the one this sign-in asked for
  | 'network' // the server could not be reached
  | 'server' // the server refused or failed
  | 'signed_out'; // the session is gone (ended elsewhere, or the refresh token was refused)

export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode) {
    super(code);
  }
}

const KEY = 'account';
/** A token that ends within this time is renewed before it is used. */
const RENEW_BEFORE_MS = 60_000;

export function normalizeAccount(value: unknown): Account | null {
  if (typeof value !== 'object' || value === null) return null;
  const { email, accessToken, refreshToken, expiresAt } = value as Record<string, unknown>;
  if (
    typeof email !== 'string' ||
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof expiresAt !== 'number'
  )
    return null;
  return { email, accessToken, refreshToken, expiresAt };
}

export async function loadAccount(): Promise<Account | null> {
  const stored = await browser.storage.local.get(KEY);
  return normalizeAccount(stored[KEY]);
}

async function saveAccount(account: Account | null): Promise<void> {
  if (account) await browser.storage.local.set({ [KEY]: account });
  else await browser.storage.local.remove(KEY);
}

/** Calls `listener` whenever the account changes anywhere (panel, any frame). */
export function watchAccount(listener: (account: Account | null) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && KEY in changes) listener(normalizeAccount(changes[KEY]!.newValue));
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

// ---------------------------------------------------------------- Google

/** The address that opens Google's sign-in and answers with an ID token in the fragment of `redirectUri`. */
export function googleAuthUrl(redirectUri: string, nonce: string): string {
  const query = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}

/** The payload of a JWT, without checking the signature (the server does that). */
function jwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1] ?? '';
    const padded = part
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(part.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

/** The ID token Google put into the address it redirected to; it must carry the nonce this sign-in sent. */
export function idTokenFromRedirect(redirectedTo: string, nonce: string): string {
  const fragment = redirectedTo.split('#')[1] ?? '';
  const token = new URLSearchParams(fragment).get('id_token');
  if (!token) throw new AccountError('no_token');
  if (jwtPayload(token).nonce !== nonce) throw new AccountError('bad_nonce');
  return token;
}

const randomNonce = () => crypto.randomUUID().replace(/-/g, '');

async function googleIdToken(): Promise<string> {
  const nonce = randomNonce();
  if (import.meta.env.VITE_DS_E2E) return `e2e-google-token.${nonce}`; // the test build has no Google
  let redirectedTo: string | undefined;
  try {
    redirectedTo = await browser.identity.launchWebAuthFlow({
      url: googleAuthUrl(browser.identity.getRedirectURL(), nonce),
      interactive: true,
    });
  } catch {
    throw new AccountError('cancelled');
  }
  if (!redirectedTo) throw new AccountError('cancelled');
  return idTokenFromRedirect(redirectedTo, nonce);
}

// ---------------------------------------------------------------- the server

async function call(path: string, body?: unknown, accessToken?: string): Promise<Response> {
  try {
    return await fetch(`${await apiBase()}${path}`, {
      method: body === undefined && accessToken ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AccountError('network');
  }
}

interface TokensAnswer {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function tokensFrom(response: Response): Promise<TokensAnswer> {
  if (!response.ok) throw new AccountError('server');
  const tokens = (await response.json().catch(() => null)) as Partial<TokensAnswer> | null;
  if (
    typeof tokens?.accessToken !== 'string' ||
    typeof tokens.refreshToken !== 'string' ||
    typeof tokens.expiresAt !== 'number'
  )
    throw new AccountError('server');
  return tokens as TokensAnswer;
}

/** The email behind the tokens, from the server (the first thing asked after a sign-in). */
async function emailAndPlan(accessToken: string) {
  const response = await call('/me', undefined, accessToken);
  if (!response.ok) throw new AccountError('server');
  const me = (await response.json().catch(() => null)) as {
    email?: unknown;
    plan?: unknown;
    proUntil?: unknown;
  } | null;
  if (typeof me?.email !== 'string') throw new AccountError('server');
  return { email: me.email, entitlements: normalizeEntitlements(me) };
}

export async function signIn(): Promise<Account> {
  const idToken = await googleIdToken();
  const tokens = await tokensFrom(await call('/auth/google', { idToken }));
  const { email, entitlements } = await emailAndPlan(tokens.accessToken);
  const account = { email, ...tokens };
  await saveAccount(account);
  await saveEntitlements(entitlements);
  return account;
}

/** Ends the session on the server (if it can be reached) and on this device; the plan is free again. */
export async function signOut(): Promise<void> {
  const account = await loadAccount();
  await saveAccount(null);
  await saveEntitlements(FREE_PLAN);
  if (account) await call('/auth/logout', { refreshToken: account.refreshToken }).catch(() => {});
}

/** Runs `task` while no other part of the extension does (two renewals at once would spend one refresh token twice). */
async function exclusively<T>(task: () => Promise<T>): Promise<T> {
  return globalThis.navigator?.locks ? navigator.locks.request('double-sub-account', task) : task();
}

/**
 * New tokens for the account that holds `stale`. When another part of the extension has renewed them
 * meanwhile, its tokens are taken. A refresh token the server refuses ends the session here too.
 */
async function renew(stale: Account): Promise<Account> {
  return exclusively(async () => {
    const current = await loadAccount();
    if (!current) throw new AccountError('signed_out');
    if (current.refreshToken !== stale.refreshToken) return current;
    const response = await call('/auth/refresh', { refreshToken: current.refreshToken });
    if (response.status === 401) {
      await saveAccount(null);
      await saveEntitlements(FREE_PLAN);
      throw new AccountError('signed_out');
    }
    const next = { email: current.email, ...(await tokensFrom(response)) };
    await saveAccount(next);
    return next;
  });
}

/** A request with the access token; an expired token is renewed first, a refused one once more. */
export async function authedCall(path: string, body?: unknown): Promise<Response> {
  let account = await loadAccount();
  if (!account) throw new AccountError('signed_out');
  if (account.expiresAt - RENEW_BEFORE_MS < Date.now()) account = await renew(account);
  let response = await call(path, body, account.accessToken);
  if (response.status === 401) {
    account = await renew(account);
    response = await call(path, body, account.accessToken);
  }
  return response;
}

/** Asks the server for the plan and keeps it (the panel does this when it opens, so a payment shows up). */
export async function refreshPlan(): Promise<void> {
  if (!(await loadAccount())) return;
  const response = await authedCall('/me');
  if (!response.ok) throw new AccountError('server');
  await saveEntitlements(normalizeEntitlements(await response.json().catch(() => null)));
}
