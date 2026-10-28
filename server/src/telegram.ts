import type { Env } from './env';
import { HttpError, readJson } from './http';
import type { Identity } from './identities';
import { clientIp, rateLimit, sameSecret } from './limits';

const LOGIN_TTL_MS = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function randomToken(bytes: number): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

export interface TelegramStart {
  loginId: string;
  /** Only the extension knows it: the id travels through Telegram and a link, this does not. */
  secret: string;
  /** Opens the bot, which is sent /start <loginId> by the user's press of Start. */
  link: string;
  expiresAt: number;
}

/**
 * A new sign-in through the bot: the extension opens `link`, the user presses Start in Telegram, and
 * the bot learns who they are. `linkTo`: a signed-in user who adds Telegram to their account.
 */
export async function startTelegramSignIn(
  request: Request,
  linkTo: string | null,
  env: Env,
  now = Date.now(),
): Promise<TelegramStart> {
  if (!env.TELEGRAM_BOT_NAME) throw new HttpError(500, 'telegram_not_configured');
  await rateLimit(env, `telegram-start-ip:${clientIp(request, env)}`, 30, HOUR, now);
  const loginId = randomToken(24); // 32 characters of [A-Za-z0-9_-], as a /start parameter must be
  const secret = randomToken(32);
  const expiresAt = now + LOGIN_TTL_MS;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM telegram_logins WHERE expires_at <= ?').bind(now),
    env.DB.prepare(
      `INSERT INTO telegram_logins (id, secret_hash, link_user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(loginId, await sha256(secret), linkTo, expiresAt, now),
  ]);
  return {
    loginId,
    secret,
    link: `https://t.me/${env.TELEGRAM_BOT_NAME}?start=${loginId}`,
    expiresAt,
  };
}

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

interface TelegramUpdate {
  message?: { text?: string; chat?: { id: number }; from?: TelegramUser };
}

const russianSpeaking = (user: TelegramUser) => /^(ru|uk|be|kk)/.test(user.language_code ?? '');

const REPLIES = {
  done: [
    'Готово: вы вошли в Double Sub. Вернитесь в браузер.',
    'Done: you are signed in to Double Sub. Go back to the browser.',
  ],
  expired: [
    'Эта ссылка для входа устарела. Нажмите «Войти через Telegram» в расширении ещё раз.',
    'This sign-in link has expired. Press "Sign in with Telegram" in the extension again.',
  ],
  help: [
    'Это бот для входа в расширение Double Sub. Нажмите «Войти через Telegram» в расширении.',
    'This bot signs you in to the Double Sub extension. Press "Sign in with Telegram" there.',
  ],
} as const;

/** The bot answers in the chat; without its token (development, tests) it stays silent. */
async function reply(env: Env, chatId: number, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (error) {
    console.error('telegram reply failed', error);
  }
}

const labelOf = (user: TelegramUser) =>
  user.username
    ? `@${user.username}`
    : [user.first_name, user.last_name].filter(Boolean).join(' ') || `Telegram ${user.id}`;

/**
 * Telegram's call for every message to the bot. Only Telegram knows the webhook secret; "/start
 * <loginId>" from a user marks that sign-in as theirs. Always 200 for a real update, or Telegram
 * would send it again and again.
 */
export async function telegramWebhook(request: Request, env: Env, now = Date.now()) {
  const secret = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!env.TELEGRAM_WEBHOOK_SECRET || !sameSecret(secret, env.TELEGRAM_WEBHOOK_SECRET))
    throw new HttpError(401, 'bad_webhook_secret');
  const update = (await readJson(request)) as TelegramUpdate;
  const message = update.message;
  const user = message?.from;
  const chatId = message?.chat?.id;
  if (!message || !user || typeof user.id !== 'number' || typeof chatId !== 'number') return;

  const lang = russianSpeaking(user) ? 0 : 1;
  const start = /^\/start(?:@\w+)?\s+([\w-]{16,64})$/.exec((message.text ?? '').trim());
  if (!start) return reply(env, chatId, REPLIES.help[lang]);

  const taken = await env.DB.prepare(
    `UPDATE telegram_logins SET telegram_id = ?, label = ?
     WHERE id = ? AND expires_at > ? AND telegram_id IS NULL`,
  )
    .bind(String(user.id), labelOf(user), start[1], now)
    .run();
  await reply(env, chatId, (taken.meta.changes === 1 ? REPLIES.done : REPLIES.expired)[lang]);
}

/**
 * The extension asks whether the user has pressed Start: `pending` until then, then the proven
 * identity, once (the login is gone after it). A wrong secret, an unknown or old login: 410.
 */
export async function pollTelegramSignIn(
  request: Request,
  body: Record<string, unknown>,
  env: Env,
  now = Date.now(),
): Promise<{ pending: true } | { identity: Identity; linkTo: string | null }> {
  const loginId = typeof body.loginId === 'string' ? body.loginId : '';
  const secret = typeof body.secret === 'string' ? body.secret : '';
  if (!loginId || !secret) throw new HttpError(400, 'bad_login');
  await rateLimit(env, `telegram-poll-ip:${clientIp(request, env)}`, 600, 10 * 60 * 1000, now);

  const row = await env.DB.prepare(
    'SELECT secret_hash, telegram_id, label, link_user_id, expires_at FROM telegram_logins WHERE id = ?',
  )
    .bind(loginId)
    .first<{
      secret_hash: string;
      telegram_id: string | null;
      label: string | null;
      link_user_id: string | null;
      expires_at: number;
    }>();
  if (!row || !sameSecret(await sha256(secret), row.secret_hash) || row.expires_at <= now)
    throw new HttpError(410, 'login_expired');
  if (!row.telegram_id) return { pending: true };

  const used = await env.DB.prepare(
    'DELETE FROM telegram_logins WHERE id = ? AND telegram_id IS NOT NULL',
  )
    .bind(loginId)
    .run();
  if (used.meta.changes !== 1) throw new HttpError(410, 'login_expired'); // taken by a poll at the same time

  return {
    identity: {
      provider: 'telegram',
      subject: row.telegram_id,
      label: row.label ?? `Telegram ${row.telegram_id}`,
      email: null,
    },
    linkTo: row.link_user_id,
  };
}
