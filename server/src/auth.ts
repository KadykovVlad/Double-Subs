import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  SignJWT,
  type JWTVerifyGetKey,
} from 'jose';
import type { Env } from './env';
import { HttpError } from './http';
import type { Identity } from './identities';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Google's keys are fetched once per isolate and refreshed by jose when they rotate. */
let googleKeys: JWTVerifyGetKey | null = null;

function keysOf(env: Env): JWTVerifyGetKey {
  if (env.GOOGLE_JWKS) return createLocalJWKSet(JSON.parse(env.GOOGLE_JWKS));
  googleKeys ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  return googleKeys;
}

/** The account behind a Google ID token, or 401: wrong signature, issuer, audience, expired, unverified email. */
export async function verifyGoogleToken(idToken: string, env: Env): Promise<Identity> {
  try {
    const { payload } = await jwtVerify(idToken, keysOf(env), {
      issuer: GOOGLE_ISSUERS,
      audience: env.GOOGLE_CLIENT_ID,
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string')
      throw new Error('no identity');
    if (payload.email_verified !== true) throw new Error('email not verified');
    return { provider: 'google', subject: payload.sub, label: payload.email, email: payload.email };
  } catch {
    throw new HttpError(401, 'bad_google_token');
  }
}

const secretKey = (env: Env) => {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw new HttpError(500, 'server_not_configured');
  return new TextEncoder().encode(env.SESSION_SECRET);
};

/** The user id of a request with a valid `Authorization: Bearer <access token>`, or 401. */
export async function authenticate(request: Request, env: Env): Promise<string> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'no_token');
  try {
    const { payload } = await jwtVerify(token, secretKey(env), {
      algorithms: ['HS256'],
      audience: 'double-sub',
    });
    if (typeof payload.sub !== 'string') throw new Error('no subject');
    return payload.sub;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, 'bad_token');
  }
}

/**
 * The user of a request that carries an access token, or null when it carries none: a sign-in that
 * comes with one adds the new way in to that user instead of signing in. A bad token is still 401.
 */
export async function optionalUser(request: Request, env: Env): Promise<string | null> {
  return request.headers.has('authorization') ? authenticate(request, env) : null;
}

export interface Tokens {
  accessToken: string;
  /** `<session id>.<secret>`: only its hash is on the server. */
  refreshToken: string;
  /** When the access token ends, ms since the epoch. */
  expiresAt: number;
}

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

const sha256 = async (text: string) =>
  toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function accessToken(userId: string, env: Env, now: number) {
  const expiresAt = now + ACCESS_TTL_S * 1000;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setAudience('double-sub')
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(secretKey(env));
  return { token, expiresAt };
}

/** A new session (a browser signs in). */
export async function openSession(userId: string, env: Env, now = Date.now()): Promise<Tokens> {
  const id = crypto.randomUUID();
  const secret = randomSecret();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, refresh_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, userId, await sha256(secret), now + REFRESH_TTL_MS, now)
    .run();
  const access = await accessToken(userId, env, now);
  return {
    accessToken: access.token,
    refreshToken: `${id}.${secret}`,
    expiresAt: access.expiresAt,
  };
}

/**
 * New tokens for a refresh token; the old refresh token stops working. A known session with a wrong
 * secret means an old, already replaced token is being used again (it may be stolen): the session ends.
 */
export async function refreshSession(
  refreshToken: string,
  env: Env,
  now = Date.now(),
): Promise<Tokens> {
  const [id, secret] = refreshToken.split('.');
  if (!id || !secret) throw new HttpError(401, 'bad_refresh_token');
  const session = await env.DB.prepare(
    'SELECT user_id, refresh_hash, expires_at FROM sessions WHERE id = ?',
  )
    .bind(id)
    .first<{ user_id: string; refresh_hash: string; expires_at: number }>();
  if (!session) throw new HttpError(401, 'bad_refresh_token');
  if (session.refresh_hash !== (await sha256(secret)) || session.expires_at <= now) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    throw new HttpError(401, 'bad_refresh_token');
  }
  const next = randomSecret();
  await env.DB.prepare('UPDATE sessions SET refresh_hash = ?, expires_at = ? WHERE id = ?')
    .bind(await sha256(next), now + REFRESH_TTL_MS, id)
    .run();
  const access = await accessToken(session.user_id, env, now);
  return { accessToken: access.token, refreshToken: `${id}.${next}`, expiresAt: access.expiresAt };
}

/** Ends the session of a refresh token (sign-out); an unknown token is no error. */
export async function closeSession(refreshToken: string, env: Env): Promise<void> {
  const [id, secret] = refreshToken.split('.');
  if (!id || !secret) return;
  await env.DB.prepare('DELETE FROM sessions WHERE id = ? AND refresh_hash = ?')
    .bind(id, await sha256(secret))
    .run();
}
