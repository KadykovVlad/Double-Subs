import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

type Provider = 'google' | 'email' | 'telegram';

/** A stand-in for the Worker: what it answers, and what it was asked. */
export interface FakeApi {
  origin: string;
  plan: 'free' | 'pro';
  failSignIn: boolean;
  /** The code the letter "carries"; any other is wrong. */
  emailCode: string;
  /** The user pressed Start in the bot: the next poll signs in. */
  telegramConfirmed: boolean;
  /** Who /me says is signed in, and by which ways. */
  name: string;
  methods: Array<{ provider: Provider; label: string }>;
  requests: Array<{ method: string; path: string; auth: string | undefined; body: unknown }>;
  close(): Promise<void>;
}

const LOGIN_ID = 'L'.repeat(32);

export async function startFakeApi(): Promise<FakeApi> {
  const api: FakeApi = {
    origin: '',
    plan: 'pro',
    failSignIn: false,
    emailCode: '123456',
    telegramConfirmed: false,
    name: 'learner@example.com',
    methods: [{ provider: 'google', label: 'learner@example.com' }],
    requests: [],
    // The browser keeps its connections alive (the bot's tab, the polls): they are cut, or close waits.
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
  const tokens = () => ({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 3_600_000,
  });
  /** A way in proven: a signed-in request adds it to the account, otherwise it is who signs in. */
  const proven = (signedIn: boolean, provider: Provider, label: string) => {
    if (signedIn) {
      api.methods = [...api.methods.filter((m) => m.provider !== provider), { provider, label }];
      return { linked: true };
    }
    api.name = label;
    api.methods = [{ provider, label }];
    return tokens();
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const send = (status: number, body: unknown, type = 'application/json') => {
      res.writeHead(status, {
        'content-type': type,
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
      });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204, {});
    // The page the Telegram link opens (here instead of t.me).
    if (path === '/bot') return send(200, '<title>Bot</title>Press Start', 'text/html');

    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      const signedIn = Boolean(req.headers.authorization);
      api.requests.push({ method: req.method ?? '', path, auth: req.headers.authorization, body });

      if (path === '/auth/google') {
        if (api.failSignIn) return send(401, { error: 'bad_google_token' });
        return send(200, proven(signedIn, 'google', 'learner@example.com'));
      }
      if (path === '/auth/email/start') return send(200, { ok: true });
      if (path === '/auth/email/verify') {
        if (body?.code !== api.emailCode) return send(401, { error: 'bad_code' });
        return send(200, proven(signedIn, 'email', String(body.email)));
      }
      if (path === '/auth/telegram/start')
        return send(200, {
          loginId: LOGIN_ID,
          secret: 'S',
          link: `${api.origin}/bot?start=${LOGIN_ID}`,
          expiresAt: Date.now() + 600_000,
        });
      if (path === '/auth/telegram/poll') {
        if (!api.telegramConfirmed) return send(200, { pending: true });
        api.telegramConfirmed = false;
        return send(200, proven(signedIn, 'telegram', '@learner'));
      }
      if (path === '/me')
        return send(200, {
          email: api.name.includes('@') && !api.name.startsWith('@') ? api.name : null,
          name: api.name,
          plan: api.plan,
          proUntil: null,
          methods: api.methods,
        });
      const removal = /^\/me\/methods\/(\w+)$/.exec(path);
      if (removal && req.method === 'DELETE') {
        if (api.methods.length === 1) return send(409, { error: 'last_method' });
        api.methods = api.methods.filter((m) => m.provider !== removal[1]);
        api.name = api.methods[0]!.label;
        return send(200, { methods: api.methods });
      }
      if (path === '/auth/logout') return send(200, { ok: true });
      send(404, { error: 'not_found' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  api.origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  return api;
}
