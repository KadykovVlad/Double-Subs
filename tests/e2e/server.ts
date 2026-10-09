import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.webm': 'video/webm',
};

/**
 * Fake YouTube /api/timedtext: without the player's `pot` token the body is empty, like on YouTube.
 * `tlang` stands for YouTube's machine translation; the fake only knows English and Russian.
 */
const flakyRuns = new Map<string, number>();

async function fakeTimedtext(params: URLSearchParams, res: ServerResponse): Promise<void> {
  // ?flaky=N in the track address: the first N requests of that page fail like YouTube's 503.
  const run = params.get('run');
  if (run && params.get('pot')) {
    const seen = flakyRuns.get(run) ?? 0;
    flakyRuns.set(run, seen + 1);
    if (seen < Number(params.get('flaky'))) {
      res.writeHead(503);
      res.end();
      return;
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  // Another extension's request without the token: it gets an answer (and so is seen on the page).
  if (!params.get('pot') && params.get('lang') === 'ar') {
    res.end(await readFile(join(FIXTURES, 'timedtext', 'en.json')));
    return;
  }
  // The player's first request after a load: no token yet, but its client parameters, and YouTube answers it.
  const playerWithoutToken = !params.get('pot') && params.get('c') === 'WEB';
  if (params.get('pot') !== 'SECRET' && !playerWithoutToken) {
    res.end('');
    return;
  }
  const lang = params.get('tlang') ?? params.get('lang');
  const asr = params.get('kind') === 'asr' && !params.get('tlang');
  const file = lang === 'ru' ? 'ru.json' : asr ? 'en-asr.json' : 'en.json';
  res.end(await readFile(join(FIXTURES, 'timedtext', file)));
}

export interface FixtureServer {
  origin: string;
  close: () => Promise<void>;
}

/**
 * Serves tests/e2e/fixtures. VTT files get a CORS header (the players use <video crossorigin>,
 * which makes the browser demand it). `{{NAME}}` placeholders in HTML are replaced from `vars`.
 */
export async function startFixtureServer(
  host: string,
  vars: Record<string, string> = {},
  port = 0,
): Promise<FixtureServer> {
  const server: Server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://x');
    if (requestUrl.pathname === '/api/timedtext')
      return fakeTimedtext(requestUrl.searchParams, res);
    let pathname = requestUrl.pathname;
    if (pathname === '/') pathname = '/index.html';
    const file = join(FIXTURES, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    try {
      let body = await readFile(file);
      if (extname(file) === '.html') {
        let html = body.toString('utf8');
        for (const [name, value] of Object.entries(vars))
          html = html.replaceAll(`{{${name}}}`, value);
        body = Buffer.from(html);
      }
      const headers = {
        'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      };
      // Media elements seek with Range requests.
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}` });
        res.end(body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address() as AddressInfo;
  return {
    origin: `http://${host}:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
