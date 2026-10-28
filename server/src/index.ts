import {
  authenticate,
  closeSession,
  openSession,
  optionalUser,
  refreshSession,
  verifyGoogleToken,
} from './auth';
import { startEmailSignIn, verifyEmailCode } from './email';
import type { Env } from './env';
import { corsHeaders, HttpError, json, readJson } from './http';
import {
  linkIdentity,
  methodsOf,
  PROVIDERS,
  unlinkIdentity,
  userFor,
  type Identity,
  type Provider,
} from './identities';
import { sync } from './sync';
import { pollTelegramSignIn, startTelegramSignIn, telegramWebhook } from './telegram';

const stringField = (body: Record<string, unknown>, name: string): string => {
  const value = body[name];
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192)
    throw new HttpError(400, `bad_${name}`);
  return value;
};

/**
 * The end of every way in. A way in that was started by a signed-in user (`linkTo`) is added to that
 * user, and only that user can finish it; otherwise the person signs in and gets a session.
 */
async function signInOrLink(
  identity: Identity,
  linkTo: string | null,
  request: Request,
  env: Env,
): Promise<Response> {
  if (linkTo) {
    if ((await optionalUser(request, env)) !== linkTo) throw new HttpError(401, 'not_your_link');
    await linkIdentity(linkTo, identity, env);
    return json({ linked: true });
  }
  return json(await openSession(await userFor(identity, env), env));
}

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (method === 'GET' && pathname === '/health') return json({ ok: true });

  if (method === 'POST' && pathname === '/auth/google') {
    const body = await readJson(request);
    const identity = await verifyGoogleToken(stringField(body, 'idToken'), env);
    // With an access token: a signed-in user adds Google to their account.
    return signInOrLink(identity, await optionalUser(request, env), request, env);
  }
  if (method === 'POST' && pathname === '/auth/email/start') {
    const body = await readJson(request);
    await startEmailSignIn(request, body, await optionalUser(request, env), env);
    return json({ ok: true });
  }
  if (method === 'POST' && pathname === '/auth/email/verify') {
    const { identity, linkTo } = await verifyEmailCode(request, await readJson(request), env);
    return signInOrLink(identity, linkTo, request, env);
  }
  if (method === 'POST' && pathname === '/auth/telegram/start') {
    return json(await startTelegramSignIn(request, await optionalUser(request, env), env));
  }
  if (method === 'POST' && pathname === '/auth/telegram/poll') {
    const answer = await pollTelegramSignIn(request, await readJson(request), env);
    if ('pending' in answer) return json(answer);
    return signInOrLink(answer.identity, answer.linkTo, request, env);
  }
  if (method === 'POST' && pathname === '/telegram/webhook') {
    await telegramWebhook(request, env);
    return json({ ok: true });
  }
  if (method === 'POST' && pathname === '/auth/refresh') {
    const body = await readJson(request);
    return json(await refreshSession(stringField(body, 'refreshToken'), env));
  }
  if (method === 'POST' && pathname === '/auth/logout') {
    const body = await readJson(request);
    await closeSession(stringField(body, 'refreshToken'), env);
    return json({ ok: true });
  }

  if (pathname === '/me' && (method === 'GET' || method === 'DELETE')) {
    const userId = await authenticate(request, env);
    if (method === 'DELETE') {
      // The account and everything synced with it (the store requires a way to delete one's data).
      await env.DB.batch([
        env.DB.prepare('DELETE FROM items WHERE user_id = ?').bind(userId),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
        env.DB.prepare('DELETE FROM identities WHERE user_id = ?').bind(userId),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
      ]);
      return json({ ok: true });
    }
    const user = await env.DB.prepare('SELECT email, plan, pro_until FROM users WHERE id = ?')
      .bind(userId)
      .first<{ email: string; plan: string; pro_until: number | null }>();
    if (!user) throw new HttpError(401, 'no_user');
    const methods = await methodsOf(userId, env);
    // The name to show: the address, or (an account of Telegram only) the Telegram name.
    const name = user.email || methods[0]?.label || '';
    return json({
      email: user.email || null,
      name,
      plan: user.plan,
      proUntil: user.pro_until,
      methods,
    });
  }

  const removal = /^\/me\/methods\/(\w+)$/.exec(pathname);
  if (method === 'DELETE' && removal) {
    const userId = await authenticate(request, env);
    const provider = removal[1] as Provider;
    if (!PROVIDERS.includes(provider)) throw new HttpError(404, 'no_such_method');
    await unlinkIdentity(userId, provider, env);
    return json({ methods: await methodsOf(userId, env) });
  }

  if (method === 'POST' && pathname === '/sync') {
    const userId = await authenticate(request, env);
    return json(await sync(userId, await readJson(request), env));
  }

  throw new HttpError(404, 'not_found');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env.EXTENSION_ORIGINS ?? '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) response = json({ error: error.code }, error.status);
      else {
        console.error(error);
        response = json({ error: 'internal' }, 500);
      }
    }
    for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
    return response;
  },
} satisfies ExportedHandler<Env>;
