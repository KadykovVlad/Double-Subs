import {
  isTimedtextUrl,
  isYouTubeHost,
  MAIN_SOURCE,
  normalizeTracks,
  REQUEST_SOURCE,
  shortsIdOf,
  trackKeyOfUrl,
  videoIdOf,
  type MainMessage,
  type RequestMessage,
  type YtCaptionTrack,
} from '../src/lib/youtube';
import { logTiming } from '../src/youtube/timing';

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

    // Timing (see logTiming): the first request and the first answer with text, once per video.
    const requested = new Set<string>();
    const answered = new Set<string>();
    const sent = (url: string) => {
      post({ source: MAIN_SOURCE, type: 'timedtext-sent', url: new URL(url, location.href).href });
      const videoId = videoIdOf(url);
      if (videoId && !requested.has(videoId)) {
        requested.add(videoId);
        logTiming('first-request', { videoId, lang: trackKeyOfUrl(url) });
      }
      return performance.now();
    };

    const captured = (url: string, body: string, requestedAt: number) => {
      if (!body) return;
      const videoId = videoIdOf(url);
      if (videoId && !answered.has(videoId)) {
        answered.add(videoId);
        logTiming('first-answer', {
          videoId,
          lang: trackKeyOfUrl(url),
          bytes: body.length,
          sinceRequestMs: Math.round(performance.now() - requestedAt),
        });
      }
      post({
        source: MAIN_SOURCE,
        type: 'timedtext',
        url: new URL(url, location.href).href,
        body,
        requestedAt,
      });
    };

    // fetch
    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const requestedAt = isTimedtextUrl(url) ? sent(url) : 0;
      const response = await originalFetch.call(this, input, init);
      if (requestedAt) {
        response
          .clone()
          .text()
          .then((body) => captured(url, body, requestedAt))
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
        const requestedAt = sent(url);
        this.addEventListener('load', () => {
          if (this.responseType === '' || this.responseType === 'text')
            captured(url, this.responseText, requestedAt);
          else if (this.responseType === 'json')
            captured(url, JSON.stringify(this.response), requestedAt);
        });
      }
      return originalSend.call(this, body);
    };

    // Shorts have a player of their own; the watch player YouTube keeps in the page describes another video.
    const currentPlayer = () =>
      document.getElementById(shortsIdOf(location.pathname) ? 'shorts-player' : 'movie_player') as
        | (HTMLElement & {
            getPlayerResponse?: () => YtPlayerResponse;
            setOption?: (module: string, option: string, value: unknown) => void;
          })
        | null;

    // Caption track list: asked for by the isolated world (on popup open and after navigation).
    const playerResponse = (): YtPlayerResponse | null => {
      const player = currentPlayer();
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
      if (request.type === 'load-track') {
        // The player loads this track itself, with its token (its own captions are hidden by us).
        try {
          currentPlayer()?.setOption?.('captions', 'track', {
            languageCode: request.languageCode,
            ...(request.kind ? { kind: request.kind } : {}),
          });
        } catch {
          // An older player without the option: the wait for its next request stays.
        }
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
