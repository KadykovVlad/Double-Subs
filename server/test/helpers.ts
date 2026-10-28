import { env, exports } from 'cloudflare:workers';
import { importJWK, SignJWT } from 'jose';

export const ORIGIN = 'chrome-extension://abcdefghijklmnop';

/** A Google ID token signed with the test key; `claims` override the valid defaults. */
export async function googleToken(claims: Record<string, unknown> = {}, expiresIn = '1h') {
  const key = await importJWK(JSON.parse(env.TEST_GOOGLE_PRIVATE_JWK), 'RS256');
  return new SignJWT({ email: 'learner@example.com', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer((claims.iss as string) ?? 'https://accounts.google.com')
    .setAudience((claims.aud as string) ?? env.GOOGLE_CLIENT_ID)
    .setSubject((claims.sub as string) ?? 'google-user-1')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export function call(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    headers?: Record<string, string>;
  } = {},
) {
  // A new network address for every request unless a test names one: the limits per address stay
  // out of tests that are not about them.
  const headers: Record<string, string> = {
    origin: ORIGIN,
    'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 250)}-${crypto.randomUUID()}`,
    ...options.headers,
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  return (exports as unknown as { default: Fetcher }).default.fetch(
    new Request(`https://api.test${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body:
        options.body === undefined
          ? undefined
          : typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body),
    }),
  );
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** Signs in a new Google account each time, unless `sub` names one. */
export async function signIn(sub: string = crypto.randomUUID()): Promise<Tokens> {
  const response = await call('/auth/google', { body: { idToken: await googleToken({ sub }) } });
  if (response.status !== 200) throw new Error(`sign-in failed: ${response.status}`);
  return response.json();
}

/** The code in the last letter to an address (the test Worker keeps letters in dev_outbox). */
export async function lastCode(to: string): Promise<string> {
  const { env } = await import('cloudflare:workers');
  const letter = await env.DB.prepare(
    'SELECT body FROM dev_outbox WHERE to_address = ? ORDER BY id DESC LIMIT 1',
  )
    .bind(to)
    .first<{ body: string }>();
  const code = /\b(\d{6})\b/.exec(letter?.body ?? '')?.[1];
  if (!code) throw new Error(`no code sent to ${to}`);
  return code;
}

/** A message to the bot, as Telegram's webhook delivers it. */
export function botUpdate(
  text: string,
  from: Record<string, unknown> = {},
  secret = 'test-webhook-secret',
) {
  return call('/telegram/webhook', {
    headers: { 'x-telegram-bot-api-secret-token': secret },
    body: {
      update_id: 1,
      message: {
        message_id: 1,
        text,
        chat: { id: 42, type: 'private' },
        from: {
          id: 777,
          is_bot: false,
          first_name: 'Vlad',
          username: 'vlad',
          language_code: 'ru',
          ...from,
        },
      },
    },
  });
}

/** A fresh address each time, so the limits of one test do not reach another. */
export const freshEmail = () => `user-${crypto.randomUUID().slice(0, 8)}@example.com`;
