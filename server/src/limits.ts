import type { Env } from './env';
import { HttpError } from './http';

/** True when a and b are the same, in a time that does not depend on where they differ. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** The user's address: Cloudflare's, or the one our own proxy vouches for (see Env.PROXY_SECRET). */
export function clientIp(request: Request, env: Env): string {
  const proxied = request.headers.get('x-real-ip');
  const secret = request.headers.get('x-proxy-secret');
  if (proxied && secret && env.PROXY_SECRET && sameSecret(secret, env.PROXY_SECRET)) return proxied;
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

/**
 * Counts one more use of `key` in a fixed window and refuses with 429 once there were `limit` of
 * them. The counter is one row, updated in a single statement, so two requests at once both count.
 */
export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<void> {
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END
     RETURNING count`,
  )
    .bind(key, now, windowMs)
    .first<{ count: number }>();
  if (row!.count > limit) throw new HttpError(429, 'too_many');
}
