import {
  itemsOf,
  TIKTOK_MAIN_SOURCE,
  TIKTOK_REQUEST_SOURCE,
  type TikTokItem,
  type TikTokMainMessage,
  type TikTokRequestMessage,
} from '../src/lib/tiktok';

declare global {
  interface Window {
    __doubleSubTikTokMain?: boolean;
  }
}

/** The last videos are kept: a feed answer brings 8, the user scrolls through dozens. */
const KEEP_ITEMS = 300;
/** A feed answer is a few hundred KB of JSON: bigger ones are not this. */
const MAX_TEXT = 3_000_000;

/**
 * Runs in TikTok's own page world (registered at document_start on a TikTok site the user has, or
 * injected later when the side panel starts the agent there). Only reads: the page's own data and
 * the answers it gets to its own requests; it never asks TikTok for anything. What it finds (the
 * subtitle files of each video) it keeps, and gives the extension whenever asked.
 */
export default defineUnlistedScript(() => {
  if (window.__doubleSubTikTokMain) return;
  window.__doubleSubTikTokMain = true;

  const items = new Map<string, TikTokItem>();
  const post = (message: TikTokMainMessage) => window.postMessage(message, location.origin);

  const keep = (found: TikTokItem[]) => {
    const fresh = found.filter((item) => {
      const known = items.get(item.id);
      return !known || known.captions.length < item.captions.length;
    });
    if (fresh.length === 0) return;
    for (const item of fresh) {
      items.delete(item.id);
      items.set(item.id, item);
    }
    for (const old of items.keys()) {
      if (items.size <= KEEP_ITEMS) break;
      items.delete(old);
    }
    post({ source: TIKTOK_MAIN_SOURCE, type: 'items', items: fresh });
  };

  const readText = (text: string) => {
    if (text.length > MAX_TEXT || !/subtitleInfos|captionInfos|"video"/.test(text)) return;
    try {
      keep(itemsOf(JSON.parse(text)));
    } catch {
      // not JSON
    }
  };

  // The page's own data: a video page has its video, the feed its first videos.
  const readPage = () => {
    const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (script?.textContent) readText(script.textContent);
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', readPage, { once: true });
  else readPage();

  const isApi = (url: string) => {
    try {
      return new URL(url, location.href).pathname.startsWith('/api/');
    } catch {
      return false;
    }
  };

  // fetch
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await originalFetch.call(this, input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (isApi(url))
      response
        .clone()
        .text()
        .then(readText)
        .catch(() => {});
    return response;
  };

  // XMLHttpRequest
  const urls = new WeakMap<XMLHttpRequest, string>();
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    urls.set(this, String(url));
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const url = urls.get(this);
    if (url && isApi(url))
      this.addEventListener('load', () => {
        if (this.responseType === '' || this.responseType === 'text') readText(this.responseText);
        else if (this.responseType === 'json' && this.response)
          keep(itemsOf(this.response as unknown));
      });
    return originalSend.call(this, body);
  };

  // The extension (it may come later than this script) asks for everything found so far.
  window.addEventListener('message', (event) => {
    const request = event.data as TikTokRequestMessage | undefined;
    if (event.source !== window || request?.source !== TIKTOK_REQUEST_SOURCE) return;
    readPage();
    post({ source: TIKTOK_MAIN_SOURCE, type: 'hello' });
    if (items.size > 0)
      post({ source: TIKTOK_MAIN_SOURCE, type: 'items', items: [...items.values()] });
  });
  post({ source: TIKTOK_MAIN_SOURCE, type: 'hello' });
});
