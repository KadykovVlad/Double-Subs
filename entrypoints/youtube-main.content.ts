import {
  isTimedtextUrl,
  isYouTubeHost,
  MAIN_SOURCE,
  normalizeTracks,
  REQUEST_SOURCE,
  type MainMessage,
  type RequestMessage,
  type YtCaptionTrack,
} from '../src/lib/youtube';

const YOUTUBE = ['*://*.youtube.com/*'];
// The e2e build also runs on the local fake YouTube page.
const E2E = ['http://localhost/*'];

interface YtPlayerResponse {
  videoDetails?: { videoId?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: YtCaptionTrack[] } };
}

/**
 * Runs in the page's own JavaScript world (MAIN), from the very start of the page, because only
 * there can we see the player's requests and its player response. Sends what it finds to the
 * extension's isolated world with window.postMessage.
 */
export default defineContentScript({
  matches: import.meta.env.VITE_DS_E2E ? [...YOUTUBE, ...E2E] : YOUTUBE,
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const post = (message: MainMessage) => window.postMessage(message, location.origin);

    const captured = (url: string, body: string) => {
      if (body)
        post({
          source: MAIN_SOURCE,
          type: 'timedtext',
          url: new URL(url, location.href).href,
          body,
        });
    };

    // fetch
    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
      const response = await originalFetch.call(this, input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (isTimedtextUrl(url)) {
        response
          .clone()
          .text()
          .then((body) => captured(url, body))
          .catch(() => {});
      }
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
      if (url && isTimedtextUrl(url)) {
        this.addEventListener('load', () => {
          if (this.responseType === '' || this.responseType === 'text')
            captured(url, this.responseText);
          else if (this.responseType === 'json') captured(url, JSON.stringify(this.response));
        });
      }
      return originalSend.call(this, body);
    };

    // Caption track list: asked for by the isolated world (on popup open and after navigation).
    const playerResponse = (): YtPlayerResponse | null => {
      const player = document.getElementById('movie_player') as
        (HTMLElement & { getPlayerResponse?: () => YtPlayerResponse }) | null;
      return (
        player?.getPlayerResponse?.() ??
        (window as { ytInitialPlayerResponse?: YtPlayerResponse }).ytInitialPlayerResponse ??
        null
      );
    };

    // Only YouTube's own subtitle files are fetched on request (the test build: the local fake too).
    const fetchable = (url: string) => {
      try {
        const parsed = new URL(url);
        const host = parsed.protocol === 'https:' && isYouTubeHost(parsed.hostname);
        return (
          isTimedtextUrl(url) &&
          (host || (Boolean(import.meta.env.VITE_DS_E2E) && parsed.hostname === 'localhost'))
        );
      } catch {
        return false;
      }
    };

    window.addEventListener('message', (event) => {
      const request = event.data as RequestMessage | undefined;
      if (event.source !== window || request?.source !== REQUEST_SOURCE) return;
      if (request.type === 'fetch') {
        if (!fetchable(request.url)) return;
        originalFetch
          .call(window, request.url, { credentials: 'include' })
          .then(async (response) =>
            post({
              source: MAIN_SOURCE,
              type: 'fetched',
              id: request.id,
              status: response.status,
              body: response.ok ? await response.text() : '',
            }),
          )
          .catch(() =>
            post({ source: MAIN_SOURCE, type: 'fetched', id: request.id, status: 0, body: '' }),
          );
        return;
      }
      const response = playerResponse();
      post({
        source: MAIN_SOURCE,
        type: 'tracks',
        videoId: response?.videoDetails?.videoId ?? null,
        tracks: normalizeTracks(response?.captions?.playerCaptionsTracklistRenderer?.captionTracks),
      });
    });
  },
});
