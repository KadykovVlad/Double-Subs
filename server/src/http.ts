/** An error the client gets as `{ error: code }` with this status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export const MAX_BODY_BYTES = 1024 * 1024;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** The JSON body, refused when it is too large or not an object. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new HttpError(413, 'too_large');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_json');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new HttpError(400, 'bad_json');
  return body as Record<string, unknown>;
}

/** CORS headers for the extension's own origins; other origins get none (the browser then blocks them). */
export function corsHeaders(request: Request, allowed: string): Record<string, string> {
  const origin = request.headers.get('origin');
  const origins = allowed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!origin || !origins.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}
