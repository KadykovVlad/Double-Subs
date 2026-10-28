import type { Env } from './env';
import { HttpError } from './http';

export type Provider = 'google' | 'email' | 'telegram';

export const PROVIDERS: readonly Provider[] = ['google', 'email', 'telegram'];

/** A proven way in: who the person is for one provider. */
export interface Identity {
  provider: Provider;
  /** Google's sub, the address in lower case, or the Telegram user id. */
  subject: string;
  /** What the user sees for it: the address, or @username / the name in Telegram. */
  label: string;
  /** A verified address this identity proves (Google and the email code), or null (Telegram). */
  email: string | null;
}

/** The users holding a verified address, through Google or a code: one person, whichever way they come. */
async function userWithEmail(email: string, env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT user_id FROM identities
     WHERE provider IN ('google', 'email') AND lower(label) = lower(?)
     ORDER BY created_at LIMIT 1`,
  )
    .bind(email)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

const insertIdentity = (env: Env, userId: string, identity: Identity, now: number) =>
  env.DB.prepare(
    'INSERT INTO identities (provider, subject, user_id, label, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(identity.provider, identity.subject, userId, identity.label, now);

/** The user's own address is filled once one is known (a user who came by Telegram adds Google). */
const fillEmail = (env: Env, userId: string, email: string | null) =>
  env.DB.prepare("UPDATE users SET email = ? WHERE id = ? AND email = ''").bind(
    email ?? '',
    userId,
  );

/**
 * The user an identity signs in as, made on the first sign-in. An address proven by Google and by a
 * code is the same person, so the second way joins the first one's user. The label follows the
 * provider (a Telegram username or a Google address can change).
 */
export async function userFor(identity: Identity, env: Env, now = Date.now()): Promise<string> {
  const known = await env.DB.prepare(
    'SELECT user_id FROM identities WHERE provider = ? AND subject = ?',
  )
    .bind(identity.provider, identity.subject)
    .first<{ user_id: string }>();
  if (known) {
    await env.DB.prepare('UPDATE identities SET label = ? WHERE provider = ? AND subject = ?')
      .bind(identity.label, identity.provider, identity.subject)
      .run();
    return known.user_id;
  }

  const sameEmail = identity.email ? await userWithEmail(identity.email, env) : null;
  if (sameEmail) {
    try {
      await insertIdentity(env, sameEmail, identity, now).run();
      return sameEmail;
    } catch {
      // That user already has this provider with another subject (a Google account made anew with
      // the same address): this one becomes a user of its own.
    }
  }

  const userId = crypto.randomUUID();
  // users.google_sub is NOT NULL UNIQUE from the first schema and no longer read: a placeholder.
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id, google_sub, email, created_at) VALUES (?, ?, ?, ?)',
    ).bind(userId, `user:${userId}`, identity.email ?? '', now),
    insertIdentity(env, userId, identity, now),
  ]);
  return userId;
}

/**
 * Adds a way in to a signed-in user. Refused when it already belongs to somebody else (409
 * identity_taken) or the user has this provider already with another account (409 provider_taken).
 */
export async function linkIdentity(
  userId: string,
  identity: Identity,
  env: Env,
  now = Date.now(),
): Promise<void> {
  const owner = await env.DB.prepare(
    'SELECT user_id FROM identities WHERE provider = ? AND subject = ?',
  )
    .bind(identity.provider, identity.subject)
    .first<{ user_id: string }>();
  if (owner && owner.user_id !== userId) throw new HttpError(409, 'identity_taken');
  if (owner) {
    await env.DB.prepare('UPDATE identities SET label = ? WHERE provider = ? AND subject = ?')
      .bind(identity.label, identity.provider, identity.subject)
      .run();
    return;
  }
  const same = await env.DB.prepare(
    'SELECT 1 AS x FROM identities WHERE user_id = ? AND provider = ?',
  )
    .bind(userId, identity.provider)
    .first();
  if (same) throw new HttpError(409, 'provider_taken');
  await env.DB.batch([
    insertIdentity(env, userId, identity, now),
    fillEmail(env, userId, identity.email),
  ]);
}

export interface Method {
  provider: Provider;
  label: string;
}

/** The ways in of a user, in a fixed order. */
export async function methodsOf(userId: string, env: Env): Promise<Method[]> {
  const { results } = await env.DB.prepare(
    'SELECT provider, label FROM identities WHERE user_id = ?',
  )
    .bind(userId)
    .all<Method>();
  return results.sort((a, b) => PROVIDERS.indexOf(a.provider) - PROVIDERS.indexOf(b.provider));
}

/** Removes a way in; the last one stays (409 last_method), or the user could never come back. */
export async function unlinkIdentity(userId: string, provider: Provider, env: Env): Promise<void> {
  const methods = await methodsOf(userId, env);
  if (!methods.some((method) => method.provider === provider))
    throw new HttpError(404, 'no_such_method');
  if (methods.length === 1) throw new HttpError(409, 'last_method');
  await env.DB.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?')
    .bind(userId, provider)
    .run();
}
