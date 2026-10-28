import { apiBase, GOOGLE_CLIENT_ID } from './account-config';
import { FREE_PLAN, normalizeEntitlements, saveEntitlements } from './entitlements';
import { uiLanguage } from './i18n';
import type { SignInMessage } from './messages';

/** The ways in: Google, a code by email, the Telegram bot. */
export type Provider = 'google' | 'email' | 'telegram';
export const PROVIDERS: readonly Provider[] = ['google', 'email', 'telegram'];

/** One way in of the account, as the server knows it (label: the address, or the Telegram name). */
export interface Method {
  provider: Provider;
  label: string;
}

/** A signed-in browser: the tokens of the server (never Google's), and whose they are. */
export interface Account {
  /** Who is signed in, as the user sees it: the address, or the name in Telegram. */
  name: string;
  /** The ways in of the account; empty until the server was asked. */
  methods: Method[];
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
  | 'signed_out' // the session is gone (ended elsewhere, or the refresh token was refused)
  | 'bad_email' // not an address
  | 'too_many' // too many letters or tries for now
  | 'bad_code' // the code is not the one in the letter
  | 'code_expired' // the code is old or was tried too often: a new letter is needed
  | 'login_expired' // the Telegram link is old or was used
  | 'identity_taken' // this Google, address or Telegram belongs to another account
  | 'provider_taken' // the account has another Google, address or Telegram already
  | 'last_method' // the only way in cannot be removed
  | 'not_configured'; // the server has no mail or bot set up yet

export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode) {
    super(code);
  }
}

const KEY = 'account';
/** A token that ends within this time is renewed before it is used. */
const RENEW_BEFORE_MS = 60_000;

function normalizeMethods(value: unknown): Method[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (method): method is Method =>
      typeof method === 'object' &&
      method !== null &&
      PROVIDERS.includes((method as Method).provider) &&
      typeof (method as Method).label === 'string',
  );
}

/** A stored account, checked; one kept before there were three ways in has `email` for its name. */
export function normalizeAccount(value: unknown): Account | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, email, methods, accessToken, refreshToken, expiresAt } = value as Record<
    string,
    unknown
  >;
  const shown = typeof name === 'string' ? name : email;
  if (
    typeof shown !== 'string' ||
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof expiresAt !== 'number'
  )
    return null;
  return { name: shown, methods: normalizeMethods(methods), accessToken, refreshToken, expiresAt };
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

async function call(
  path: string,
  body?: unknown,
  accessToken?: string,
  method?: 'DELETE',
): Promise<Response> {
  try {
    return await fetch(`${await apiBase()}${path}`, {
      method: method ?? (body === undefined && accessToken ? 'GET' : 'POST'),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    // The panel only says "no connection"; the reason (DNS, CORS, a blocked address) is in its DevTools console.
    // Not a warning: being offline is normal, and a warning lands on the extension's error page.
    console.info('[Double Sub] request to the server failed:', path, error);
    throw new AccountError('network');
  }
}

interface TokensAnswer {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** Refusals of the server the user is told about in their own words; the rest is "server". */
const TOLD: Partial<Record<string, AccountErrorCode>> = {
  bad_email: 'bad_email',
  too_many: 'too_many',
  bad_code: 'bad_code',
  code_expired: 'code_expired',
  login_expired: 'login_expired',
  identity_taken: 'identity_taken',
  provider_taken: 'provider_taken',
  last_method: 'last_method',
  mail_not_configured: 'not_configured',
  telegram_not_configured: 'not_configured',
};

async function refusal(response: Response): Promise<AccountError> {
  const answer = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const code = typeof answer?.error === 'string' ? TOLD[answer.error] : undefined;
  return new AccountError(code ?? 'server');
}

async function tokensFrom(response: Response): Promise<TokensAnswer> {
  if (!response.ok) throw await refusal(response);
  const tokens = (await response.json().catch(() => null)) as Partial<TokensAnswer> | null;
  if (
    typeof tokens?.accessToken !== 'string' ||
    typeof tokens.refreshToken !== 'string' ||
    typeof tokens.expiresAt !== 'number'
  )
    throw new AccountError('server');
  return tokens as TokensAnswer;
}

/** Who the tokens belong to, their ways in and their plan: the server's /me. */
async function aboutMe(response: Response) {
  if (!response.ok) throw await refusal(response);
  const me = (await response.json().catch(() => null)) as {
    name?: unknown;
    email?: unknown;
    methods?: unknown;
    plan?: unknown;
    proUntil?: unknown;
  } | null;
  const name = typeof me?.name === 'string' ? me.name : me?.email;
  if (typeof name !== 'string') throw new AccountError('server');
  return { name, methods: normalizeMethods(me?.methods), entitlements: normalizeEntitlements(me) };
}

/** The end of every sign-in: the tokens are kept with whose they are, and the plan. */
async function finishSignIn(tokens: TokensAnswer): Promise<Account> {
  const { name, methods, entitlements } = await aboutMe(
    await call('/me', undefined, tokens.accessToken),
  );
  const account = { name, methods, ...tokens };
  await saveAccount(account);
  await saveEntitlements(entitlements);
  return account;
}

/**
 * Signs in with Google (in the background, see requestSignIn). `link`: the signed-in user adds their
 * Google to the account instead.
 */
export async function signIn(options: { link?: boolean } = {}): Promise<Account> {
  const idToken = await googleIdToken();
  if (options.link) {
    const response = await authedCall('/auth/google', { idToken });
    if (!response.ok) throw await refusal(response);
    return refreshAccount();
  }
  return finishSignIn(await tokensFrom(await call('/auth/google', { idToken })));
}

/**
 * Signs in by asking the background to do it (see SignInMessage). If the window that asked closes on
 * the way, the sign-in still ends in the background and the account shows up in the storage.
 */
export async function requestSignIn(options: { link?: boolean } = {}): Promise<void> {
  const answer = (await browser.runtime
    .sendMessage({ type: 'sign-in', link: options.link === true } satisfies SignInMessage)
    .catch(() => undefined)) as { ok: boolean; code?: AccountErrorCode } | undefined;
  if (answer && !answer.ok) throw new AccountError(answer.code ?? 'server');
}

/** Ends the session on the server (if it can be reached) and on this device; the plan is free again. */
export async function signOut(): Promise<void> {
  const account = await loadAccount();
  await saveAccount(null);
  await browser.storage.local.remove(TELEGRAM_KEY);
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
    const next = { ...current, ...(await tokensFrom(response)) };
    await saveAccount(next);
    return next;
  });
}

/** A request with the access token; an expired token is renewed first, a refused one once more. */
export async function authedCall(
  path: string,
  body?: unknown,
  method?: 'DELETE',
): Promise<Response> {
  let account = await loadAccount();
  if (!account) throw new AccountError('signed_out');
  if (account.expiresAt - RENEW_BEFORE_MS < Date.now()) account = await renew(account);
  let response = await call(path, body, account.accessToken, method);
  if (response.status === 401) {
    account = await renew(account);
    response = await call(path, body, account.accessToken, method);
  }
  return response;
}

/**
 * Asks the server who is signed in, by which ways and on which plan, and keeps it (the panel does this
 * when it opens, so a payment or a way in added elsewhere shows up).
 */
export async function refreshAccount(): Promise<Account> {
  if (!(await loadAccount())) throw new AccountError('signed_out');
  const { name, methods, entitlements } = await aboutMe(await authedCall('/me'));
  // The tokens may have been renewed on the way: the latest ones are kept.
  const current = await loadAccount();
  if (!current) throw new AccountError('signed_out');
  const account = { ...current, name, methods };
  await saveAccount(account);
  await saveEntitlements(entitlements);
  return account;
}

/** Removes a way in of the account; the last one cannot be removed (last_method). */
export async function removeMethod(provider: Provider): Promise<Account> {
  const response = await authedCall(`/me/methods/${provider}`, undefined, 'DELETE');
  if (!response.ok) throw await refusal(response);
  return refreshAccount();
}

// ---------------------------------------------------------------- a code by email

/**
 * Sends a letter with a sign-in code (in the language of the interface). `link`: the signed-in user
 * adds this address to the account; the code must then be entered while still signed in.
 */
export async function sendEmailCode(email: string, options: { link?: boolean } = {}) {
  const body = { email: email.trim(), lang: uiLanguage() };
  const response = options.link
    ? await authedCall('/auth/email/start', body)
    : await call('/auth/email/start', body);
  if (!response.ok) throw await refusal(response);
}

/** Signs in with the code from the letter (or, with `link`, adds the address to the account). */
export async function verifyEmailCode(
  email: string,
  code: string,
  options: { link?: boolean } = {},
): Promise<Account> {
  const body = { email: email.trim(), code: code.replace(/\s/g, '') };
  if (options.link) {
    const response = await authedCall('/auth/email/verify', body);
    if (!response.ok) throw await refusal(response);
    return refreshAccount();
  }
  return finishSignIn(await tokensFrom(await call('/auth/email/verify', body)));
}

// ---------------------------------------------------------------- the Telegram bot

/**
 * A sign-in through the bot that waits for the user to press Start in Telegram. It is kept in the
 * storage, so a panel closed and opened again (Telegram took the focus) goes on waiting for it.
 */
export interface TelegramLogin {
  loginId: string;
  secret: string;
  /** t.me/<bot>?start=<loginId>: opens the bot. */
  link: string;
  expiresAt: number;
  /** The signed-in user adds Telegram to the account (true), or somebody signs in (false). */
  linking: boolean;
}

const TELEGRAM_KEY = 'telegramLogin';

function normalizeTelegramLogin(value: unknown): TelegramLogin | null {
  if (typeof value !== 'object' || value === null) return null;
  const { loginId, secret, link, expiresAt, linking } = value as Record<string, unknown>;
  if (
    typeof loginId !== 'string' ||
    typeof secret !== 'string' ||
    typeof link !== 'string' ||
    typeof expiresAt !== 'number'
  )
    return null;
  return { loginId, secret, link, expiresAt, linking: linking === true };
}

/** A sign-in through the bot that is still waiting, if any (an old one is dropped). */
export async function pendingTelegramLogin(): Promise<TelegramLogin | null> {
  const login = normalizeTelegramLogin(
    (await browser.storage.local.get(TELEGRAM_KEY))[TELEGRAM_KEY],
  );
  if (login && login.expiresAt > Date.now()) return login;
  if (login) await browser.storage.local.remove(TELEGRAM_KEY);
  return null;
}

export async function cancelTelegramSignIn(): Promise<void> {
  await browser.storage.local.remove(TELEGRAM_KEY);
}

/** Asks the server for a new sign-in through the bot; the caller opens its link. */
export async function startTelegramSignIn(
  options: { link?: boolean } = {},
): Promise<TelegramLogin> {
  const response = options.link
    ? await authedCall('/auth/telegram/start', {})
    : await call('/auth/telegram/start', {});
  if (!response.ok) throw await refusal(response);
  const login = normalizeTelegramLogin({
    ...((await response.json().catch(() => null)) as object | null),
    linking: options.link === true,
  });
  if (!login) throw new AccountError('server');
  await browser.storage.local.set({ [TELEGRAM_KEY]: login });
  return login;
}

/**
 * One question to the server: has the user pressed Start? 'done' signs in (or adds Telegram to the
 * account) and forgets the login; an old or used login is login_expired.
 */
export async function pollTelegramSignIn(login: TelegramLogin): Promise<'pending' | 'done'> {
  const body = { loginId: login.loginId, secret: login.secret };
  const response = login.linking
    ? await authedCall('/auth/telegram/poll', body)
    : await call('/auth/telegram/poll', body);
  if (!response.ok) {
    await cancelTelegramSignIn();
    throw await refusal(response);
  }
  const answer = (await response
    .clone()
    .json()
    .catch(() => null)) as { pending?: unknown } | null;
  if (answer?.pending === true) return 'pending';
  await cancelTelegramSignIn();
  if (login.linking) await refreshAccount();
  else await finishSignIn(await tokensFrom(response));
  return 'done';
}

const TELEGRAM_POLL_MS = import.meta.env.VITE_DS_E2E ? 200 : 2000;

/**
 * Asks until the user has pressed Start in the bot, the link is old, or `signal` stops it. A server
 * that cannot be reached for a moment is asked again: the user is in another app meanwhile.
 */
export async function waitForTelegram(login: TelegramLogin, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    if (login.expiresAt <= Date.now()) {
      await cancelTelegramSignIn();
      throw new AccountError('login_expired');
    }
    try {
      if ((await pollTelegramSignIn(login)) === 'done') return;
    } catch (error) {
      if (!(error instanceof AccountError) || error.code !== 'network') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, TELEGRAM_POLL_MS));
  }
  throw new AccountError('cancelled');
}
