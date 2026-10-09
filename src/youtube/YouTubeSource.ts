import { loadUiLanguage } from '../lib/ui-language';
import { alignByTime } from '../lib/align';
import type { Inspection } from '../lib/types';
import type { YouTubeBridge } from './bridge';
import { TimedtextTemplates } from './TimedtextTemplates';
import {
  buildTrackUrl,
  buildYouTubeInspection,
  MAIN_SOURCE,
  parseJson3,
  planTracks,
  REQUEST_SOURCE,
  type CaptionTrack,
  type LoadedPick,
  type MainMessage,
  type RequestMessage,
  type TrackPick,
  type YouTubePlan,
} from '../lib/youtube';

const TRACKS_TIMEOUT_MS = 3000;
/** After in-page navigation the player needs a moment before it describes the new video. */
const TRACK_ATTEMPTS = 6;
const TRACK_RETRY_MS = 500;
const NAVIGATION_POLL_MS = 1000;
/**
 * The player requests the subtitles by itself 1.5–2.5 s after the page loads (in some profiles
 * never, while CC is off). Its request carries the token, so it is waited for first: pressing CC
 * before it comes cancels it and the next one is slow. Only if none comes, CC is pressed once.
 */
const OWN_REQUEST_MS = import.meta.env.VITE_DS_E2E ? 300 : 3000;
/** CC is put back after this long; the request is waited for up to CAPTURE_TIMEOUT_MS in all. */
const CC_HOLD_MS = 1500;
const CAPTURE_TIMEOUT_MS = import.meta.env.VITE_DS_E2E ? 1500 : 8000;
const FETCH_TIMEOUT_MS = 15_000;
const POLL_MS = 100;
/** YouTube sometimes answers 503 even to its own player: try again after these pauses. */
const LOAD_RETRY_MS = [700, 2000];

const currentVideoId = () => new URLSearchParams(location.search).get('v');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type TracksAnswer = { videoId: string | null; tracks: CaptionTrack[] };
type Loaded = [LoadedPick | null, LoadedPick | null];

/** Nothing came back for any line: an empty answer is YouTube's way of saying "no (valid) token". */
const gotNothing = (loaded: Loaded) =>
  loaded.every((pick) => !pick || !pick.cues || pick.cues.length === 0);

/**
 * YouTube's subtitles are not <track> elements. This class (in the isolated world of the YouTube
 * content script) gives the agent a bridge to them:
 * - asking the player for the list of caption tracks of the current video;
 * - loading the English and Russian lines with the token of a request the player made (see
 *   TimedtextTemplates), as the page itself: without the token YouTube answers with an empty file;
 * - telling when YouTube switches to another video without reloading the page, and when the
 *   player's token has arrived (the lines that failed can be read now).
 */
export class YouTubeSource implements YouTubeBridge {
  readonly nativeCaptionSelector = '.ytp-caption-window-container';

  private readonly templates = new TimedtextTemplates();
  private tracksWaiter: ((answer: TracksAnswer) => void) | null = null;
  private readonly fetches = new Map<string, (answer: { status: number; body: string }) => void>();
  private readonly videoListeners = new Set<() => void>();
  private readonly readyListeners = new Set<() => void>();
  private lastVideoId = currentVideoId();

  /** Starts listening to the page-world script and to navigation. */
  start(): this {
    window.addEventListener('message', this.onMessage);
    // In-page navigation: YouTube fires yt-navigate-finish; polling the URL is the safety net.
    document.addEventListener('yt-navigate-finish', this.checkVideo);
    setInterval(this.checkVideo, NAVIGATION_POLL_MS);
    this.templates.onTemplate((videoId) => {
      if (videoId === currentVideoId()) this.readyListeners.forEach((listener) => listener());
    });
    return this;
  }

  owns(video: HTMLVideoElement): boolean {
    return video.closest('#movie_player') !== null;
  }

  onVideoChange(listener: () => void): () => void {
    this.videoListeners.add(listener);
    return () => this.videoListeners.delete(listener);
  }

  onSubtitlesReady(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  /** Reads the subtitles of the current video: the English and the Russian line. */
  async inspect(): Promise<Inspection> {
    await loadUiLanguage(); // this script has its own copy of the texts: the labels are written in the chosen language
    const videoId = currentVideoId();
    const plan = planTracks(await this.requestTracks());
    if (!videoId || (!plan.en && !plan.ru)) {
      const result = buildYouTubeInspection(null, null);
      console.info(
        '[Double Sub] YouTube: у видео нет субтитров',
        JSON.stringify(result.report.decision),
      );
      return result;
    }

    const started = performance.now();
    const template = await this.ensureTemplate(videoId);
    const tokenMs = Math.round(performance.now() - started);
    let loaded: Loaded = [
      plan.en && { pick: plan.en, cues: null },
      plan.ru && { pick: plan.ru, cues: null },
    ];
    if (template) {
      loaded = await this.loadAll(template, plan);
      // An empty answer with this token: forget it, the player's next request brings a fresh one.
      if (gotNothing(loaded)) this.templates.drop(videoId);
    } else {
      console.warn('[Double Sub] YouTube: плеер пока не запросил субтитры, жду его запроса');
    }

    const [en, ru] = loaded;
    const result = buildYouTubeInspection(en, ru);
    const ms = Math.round(performance.now() - started);
    console.info(
      '[Double Sub] YouTube report',
      JSON.stringify({ videoId, tokenMs, ms, ...result.report }),
    );
    if (en?.cues && ru?.cues) {
      console.table(
        alignByTime(en.cues, ru.cues)
          .slice(0, 10)
          .map(({ primary, secondary }) => ({
            time: primary.start.toFixed(1),
            en: primary.text,
            ru: secondary?.text ?? '—',
          })),
      );
    }
    return result;
  }

  // ---------------------------------------------------------------- what the page-world script tells us

  private readonly onMessage = (event: MessageEvent) => {
    const message = event.data as MainMessage | undefined;
    if (event.source !== window || message?.source !== MAIN_SOURCE) return;

    if (message.type === 'timedtext') {
      this.templates.offer(message.url);
    } else if (message.type === 'tracks') {
      this.tracksWaiter?.(message);
    } else if (message.type === 'fetched') {
      this.fetches.get(message.id)?.(message);
    }
  };

  private askTracks(): Promise<TracksAnswer | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.tracksWaiter = null;
        resolve(null);
      }, TRACKS_TIMEOUT_MS);
      this.tracksWaiter = (answer) => {
        clearTimeout(timer);
        this.tracksWaiter = null;
        resolve(answer);
      };
      window.postMessage(
        { source: REQUEST_SOURCE, type: 'tracks' } satisfies RequestMessage,
        location.origin,
      );
    });
  }

  /** Tracks of the current video; retries while the player still describes the previous one. */
  private async requestTracks(): Promise<CaptionTrack[]> {
    for (let attempt = 0; attempt < TRACK_ATTEMPTS; attempt++) {
      const answer = await this.askTracks();
      if (answer && answer.videoId === currentVideoId()) return answer.tracks;
      await sleep(TRACK_RETRY_MS);
    }
    return [];
  }

  /**
   * The token of a request the player made for this video. The player makes one by itself soon
   * after the page loads: wait for it first. If none comes, press CC, wait for the request and put
   * the button back as it was.
   */
  private async ensureTemplate(videoId: string): Promise<string | null> {
    for (let waited = 0; waited < OWN_REQUEST_MS; waited += POLL_MS) {
      const known = this.templates.get(videoId);
      if (known) return known;
      await sleep(POLL_MS);
    }
    const early = this.templates.get(videoId);
    if (early) return early;

    const button = document.querySelector<HTMLElement>('.ytp-subtitles-button');
    const wasOn = button?.getAttribute('aria-pressed') === 'true';
    const putBack = () => {
      if (button && !wasOn && button.getAttribute('aria-pressed') === 'true') button.click();
    };
    if (button && !wasOn) button.click();
    try {
      for (let waited = 0; waited < CAPTURE_TIMEOUT_MS; waited += POLL_MS) {
        const template = this.templates.get(videoId);
        if (template) return template;
        if (waited === CC_HOLD_MS) putBack();
        await sleep(POLL_MS);
      }
      return null;
    } finally {
      putBack();
    }
  }

  /** Both lines, with the player's token. */
  private loadAll(template: string, plan: YouTubePlan): Promise<Loaded> {
    return Promise.all([this.load(template, plan.en), this.load(template, plan.ru)]);
  }

  /** One track; a server error (YouTube's 503) is tried again, a refusal is not. `cues: null` when it failed. */
  private async load(template: string, pick: TrackPick | null): Promise<LoadedPick | null> {
    if (!pick) return null;
    let url: string;
    try {
      url = buildTrackUrl(template, pick);
    } catch {
      return { pick, cues: null }; // not a YouTube address: never sent anywhere
    }
    for (let attempt = 0; ; attempt++) {
      const { status, body } = await this.fetchInPage(url);
      if (status >= 200 && status < 300)
        return { pick, cues: parseJson3(body, { rolling: pick.track.kind === 'asr' }) };
      // 0: a network error, worth another try like a server error
      if (status !== 0 && status < 500 && status !== 429) break;
      const pause = LOAD_RETRY_MS[attempt];
      if (pause === undefined) break;
      await sleep(pause);
    }
    return { pick, cues: null };
  }

  /** The page fetches the file (see RequestMessage); status 0 when it failed or did not answer. */
  private fetchInPage(url: string): Promise<{ status: number; body: string }> {
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      const done = (answer: { status: number; body: string }) => {
        clearTimeout(timer);
        this.fetches.delete(id);
        resolve(answer);
      };
      const timer = setTimeout(() => done({ status: 0, body: '' }), FETCH_TIMEOUT_MS);
      this.fetches.set(id, done);
      window.postMessage(
        { source: REQUEST_SOURCE, type: 'fetch', id, url } satisfies RequestMessage,
        location.origin,
      );
    });
  }

  // ---------------------------------------------------------------- another video in the same page

  private readonly checkVideo = () => {
    const videoId = currentVideoId();
    if (videoId && videoId !== this.lastVideoId) {
      this.lastVideoId = videoId;
      this.videoListeners.forEach((listener) => listener());
    }
  };
}
