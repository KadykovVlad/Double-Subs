import {
  authenticate,
  closeSession,
  openSession,
  refreshSession,
  userFor,
  verifyGoogleToken,
} from './auth';
import type { Env } from './env';
import { corsHeaders, HttpError, json, readJson } from './http';
import { sync } from './sync';

const stringField = (body: Record<string, unknown>, name: string): string => {
  const value = body[name];
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192)
    throw new HttpError(400, `bad_${name}`);
  return value;
};

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (method === 'GET' && pathname === '/health') return json({ ok: true });

  if (method === 'POST' && pathname === '/auth/google') {
    const body = await readJson(request);
    const identity = await verifyGoogleToken(stringField(body, 'idToken'), env);
    const userId = await userFor(identity, env);
    return json(await openSession(userId, env));
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
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
      ]);
      return json({ ok: true });
    }
    const user = await env.DB.prepare('SELECT email, plan, pro_until FROM users WHERE id = ?')
      .bind(userId)
      .first<{ email: string; plan: string; pro_until: number | null }>();
    if (!user) throw new HttpError(401, 'no_user');
    return json({ email: user.email, plan: user.plan, proUntil: user.pro_until });
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
