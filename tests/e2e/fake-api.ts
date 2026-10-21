import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A stand-in for the Worker: what it answers, and what it was asked. */
export interface FakeApi {
  origin: string;
  plan: 'free' | 'pro';
  failSignIn: boolean;
  requests: Array<{ method: string; path: string; auth: string | undefined }>;
  close(): Promise<void>;
}

export async function startFakeApi(): Promise<FakeApi> {
  const api: FakeApi = {
    origin: '',
    plan: 'pro',
    failSignIn: false,
    requests: [],
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type',
      });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204, {});
    api.requests.push({ method: req.method ?? '', path, auth: req.headers.authorization });
    if (path === '/auth/google') {
      if (api.failSignIn) return send(401, { error: 'bad_google_token' });
      return send(200, {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + 3_600_000,
      });
    }
    if (path === '/me')
      return send(200, { email: 'learner@example.com', plan: api.plan, proUntil: null });
    if (path === '/auth/logout') return send(200, { ok: true });
    send(404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  api.origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  return api;
}
