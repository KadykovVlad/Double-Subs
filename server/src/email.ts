import type { Env } from './env';
import { HttpError } from './http';
import type { Identity } from './identities';
import { clientIp, rateLimit, sameSecret } from './limits';

const CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong codes allowed for one letter; then a new one must be asked for. */
const MAX_ATTEMPTS = 5;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The address as it is kept and compared: trimmed and in lower case; 400 bad_email when it is none. */
export function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !ADDRESS.test(email)) throw new HttpError(400, 'bad_email');
  return email;
}

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A keyed hash: a leaked table of a million possible codes per address is still of no use. */
async function codeHash(email: string, code: string, env: Env): Promise<string> {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw new HttpError(500, 'server_not_configured');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`email-code:${email}:${code}`)),
  );
}

/** Six digits, every one of the million equally likely. */
function newCode(): string {
  const limit = 4_294_000_000; // a multiple of 1 000 000 under 2^32: no number is likelier
  for (;;) {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    if (value! < limit) return String(value! % 1_000_000).padStart(6, '0');
  }
}

interface Letter {
  subject: string;
  text: string;
}

function letterOf(code: string, lang: string): Letter {
  if (/^(ru|uk|be|kk)/.test(lang))
    return {
      subject: `Код для входа в Double Sub: ${code}`,
      text: `Ваш код для входа в Double Sub: ${code}\n\nОн действует 10 минут. Если вы не входили, просто не обращайте внимания на это письмо.`,
    };
  return {
    subject: `Your Double Sub sign-in code: ${code}`,
    text: `Your code to sign in to Double Sub: ${code}\n\nIt works for 10 minutes. If you did not try to sign in, just ignore this letter.`,
  };
}

/** Sends a letter through Resend, or keeps it in dev_outbox for development and tests. */
async function sendLetter(env: Env, to: string, letter: Letter, now: number): Promise<void> {
  if (env.MAIL_OUTBOX === '1') {
    await env.DB.prepare(
      'INSERT INTO dev_outbox (to_address, subject, body, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(to, letter.subject, letter.text, now)
      .run();
    return;
  }
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new HttpError(500, 'mail_not_configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject: letter.subject,
      text: letter.text,
    }),
  });
  if (!response.ok) {
    console.error('mail not sent', response.status, await response.text().catch(() => ''));
    throw new HttpError(502, 'mail_failed');
  }
}

/**
 * Sends a sign-in code to an address. A second letter to the same address waits a minute, and there
 * are at most five an hour per address and twenty per network address (nobody is flooded with mail,
 * and our sending limits are not spent by somebody else). `linkTo`: a signed-in user who adds this
 * address to their account.
 */
export async function startEmailSignIn(
  request: Request,
  body: Record<string, unknown>,
  linkTo: string | null,
  env: Env,
  now = Date.now(),
): Promise<void> {
  const email = normalizeEmail(body.email);
  const lang = typeof body.lang === 'string' ? body.lang.slice(0, 8) : 'en';
  await rateLimit(env, `email-send-ip:${clientIp(request, env)}`, 20, HOUR, now);
  await rateLimit(env, `email-send:${email}`, 1, MINUTE, now);
  await rateLimit(env, `email-send-hour:${email}`, 5, HOUR, now);

  const code = newCode();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_codes WHERE expires_at <= ?').bind(now),
    env.DB.prepare(
      `INSERT INTO email_codes (email, code_hash, expires_at, attempts, link_user_id, created_at)
       VALUES (?, ?, ?, 0, ?, ?)
       ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash,
         expires_at = excluded.expires_at, attempts = 0, link_user_id = excluded.link_user_id,
         created_at = excluded.created_at`,
    ).bind(email, await codeHash(email, code, env), now + CODE_TTL_MS, linkTo, now),
  ]);
  await sendLetter(env, email, letterOf(code, lang), now);
}

/**
 * Checks a code. The try is counted before the code is compared, so guesses sent at once cannot get
 * past the limit; a right code works once. Answers the proven identity and, for an address being
 * added to an account, whose account that is.
 */
export async function verifyEmailCode(
  request: Request,
  body: Record<string, unknown>,
  env: Env,
  now = Date.now(),
): Promise<{ identity: Identity; linkTo: string | null }> {
  const email = normalizeEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : '';
  await rateLimit(env, `email-verify-ip:${clientIp(request, env)}`, 30, 10 * MINUTE, now);
  if (!/^\d{6}$/.test(code)) throw new HttpError(401, 'bad_code');

  const row = await env.DB.prepare(
    `UPDATE email_codes SET attempts = attempts + 1
     WHERE email = ? AND expires_at > ? AND attempts < ?
     RETURNING code_hash, link_user_id`,
  )
    .bind(email, now, MAX_ATTEMPTS)
    .first<{ code_hash: string; link_user_id: string | null }>();
  if (!row) throw new HttpError(401, 'code_expired');

  const hash = await codeHash(email, code, env);
  if (!sameSecret(hash, row.code_hash)) throw new HttpError(401, 'bad_code');
  const used = await env.DB.prepare('DELETE FROM email_codes WHERE email = ? AND code_hash = ?')
    .bind(email, hash)
    .run();
  if (used.meta.changes !== 1) throw new HttpError(401, 'code_expired'); // the same code, used at once twice

  return {
    identity: { provider: 'email', subject: email, label: email, email },
    linkTo: row.link_user_id,
  };
}
