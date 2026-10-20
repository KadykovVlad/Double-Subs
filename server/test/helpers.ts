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
  const headers: Record<string, string> = { origin: ORIGIN, ...options.headers };
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
