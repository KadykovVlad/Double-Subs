import { loadUiLanguage } from '../lib/ui-language';
import { loadKnownSites } from '../lib/known-sites';
import { loadSettings, pairOf, updateSettings, watchSettings } from '../lib/settings';
import { DEFAULT_PAIR, type LanguagePair } from '../lib/languages';
import { t } from '../lib/i18n';
import { ICONS } from '../overlay/icons';
import { hostsOf, matchKnownHost } from '../lib/site-match';
import { alignByTime } from '../lib/align';
import type { Inspection } from '../lib/types';
import type { YouTubeBridge } from './bridge';
import { TimedtextTemplates } from './TimedtextTemplates';
import { logTiming } from './timing';
import {
  buildTrackUrl,
  buildYouTubeInspection,
  hasToken,
  isPlayerTemplate,
  MAIN_SOURCE,
  parseJson3,
  planTracks,
  REQUEST_SOURCE,
  shortsIdOf,
  trackKeyOfPick,
  videoIdOf,
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
 * The player requests the subtitles of the track it shows while CC is on, with its token. CC is
 * what makes YouTube load them: when it is off it is turned on once and left on (it is never switched
 * back, and YouTube's own rendering is hidden, see hideNative). The request is
 * waited for this long.
 */
const CAPTURE_TIMEOUT_MS = import.meta.env.VITE_DS_E2E ? 1500 : 8000;
const FETCH_TIMEOUT_MS = 15_000;
const CC_BUTTON = '.ytp-subtitles-button';
/** The CC button of a Short: above it, outside its player. */
const SHORTS_CC_BUTTON = 'ytm-closed-captioning-button button';
const SHORTS_CC_HOST = 'ytm-closed-captioning-button';
/**
 * Our switch in the control bar, with YouTube's button look (ytp-button). While ours are on, its
 * icon is filled: a white box with black lines (like YouTube's own CC when it is on).
 */
const TOGGLE_STYLE = `
  .double-sub-toggle { position: relative; display: inline-flex !important; align-items: center; justify-content: center; color: #fff; }
  .double-sub-toggle svg { width: 26px; height: 26px; }
  .double-sub-toggle[aria-pressed='true'] svg rect { fill: #fff; }
  .double-sub-toggle[aria-pressed='true'] svg path { stroke: #000; }
  .double-sub-toggle.shorts {
    width: 48px; height: 48px; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer;
  }
  .double-sub-toggle.shorts:hover { background: rgba(255, 255, 255, 0.15); }
  .double-sub-toggle.shorts svg { width: 24px; height: 24px; }`;
/** How long the early start waits for the player to appear. */
const PLAYER_TIMEOUT_MS = 20_000;
/** A click on CC before the player is ready may be lost: it is looked at again this often, this many times. */
const CC_RETRY_MS = 300;
const CC_TRIES = 10;
/** YouTube sometimes answers 503 even to its own player: try again after these pauses. */
const LOAD_RETRY_MS = [700, 2000];
/** The player's request for a line is on its way: its answer is waited for this long before ours goes. */
const PLAYER_ANSWER_MS = 4000;
/** One line has come: the other is given this long to come too, then the first is shown alone. */
const SECOND_LINE_GRACE_MS = 250;
/** No request from the player this long after CC is on: it is asked to load the track itself. */
const NUDGE_PLAYER_MS = 800;
/** Lines being read or read, per video and track: a second look takes them from here. */
const KEEP_LOADS = 8;

const currentVideoId = () =>
  new URLSearchParams(location.search).get('v') ?? shortsIdOf(location.pathname);

/**
 * The CC button of the player on screen. A Short has it above the video, in the controls of its
 * reel; the watch player YouTube keeps hidden in the page has its own, which must not be touched.
 */
function findCcButton(): HTMLElement | null {
  if (!shortsIdOf(location.pathname)) return document.querySelector<HTMLElement>(CC_BUTTON);
  const reel = document.getElementById('shorts-player')?.closest('ytd-reel-video-renderer');
  return reel?.querySelector<HTMLElement>(SHORTS_CC_BUTTON) ?? null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type TracksAnswer = { videoId: string | null; tracks: CaptionTrack[] };
type Loaded = [LoadedPick | null, LoadedPick | null];
type Read = { plan: YouTubePlan; loaded: Loaded; tokenMs: number; ms: number };

const hasLines = (pick: LoadedPick | null) => !pick || Boolean(pick.cues && pick.cues.length > 0);

/** What `find` finds, as soon as the page has it; null after `ms`. */
function waitFor<T extends Element>(find: () => T | null, ms: number): Promise<T | null> {
  const found = find();
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const done = (element: T | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(element);
    };
    const observer = new MutationObserver(() => {
      const element = find();
      if (element) done(element);
    });
    observer.observe(document, { childList: true, subtree: true });
    const timer = setTimeout(() => done(null), ms);
  });
}

/** Nothing came back for any line: an empty answer is YouTube's way of saying "no (valid) token". */
const gotNothing = (loaded: Loaded) =>
  loaded.every((pick) => !pick || !pick.cues || pick.cues.length === 0);

/**
 * YouTube's subtitles are not <track> elements. This class (in the isolated world of the YouTube
 * content script) gives the agent a bridge to them:
 * - asking the player for the list of caption tracks of the current video;
 * - loading the English and Russian lines: the track the player asked for from its own answer, the
 *   other with the token of that request (see TimedtextTemplates), as the page itself: without the
 *   token YouTube answers with an empty file;
 * - telling when YouTube switches to another video without reloading the page, and when the
 *   player's token has arrived (the lines that failed can be read now).
 */
export class YouTubeSource implements YouTubeBridge {
  readonly nativeCaptionSelector = '.ytp-caption-window-container';

  private readonly templates = new TimedtextTemplates();
  private readonly tracksWaiters = new Set<(answer: TracksAnswer) => void>();
  private readonly fetches = new Map<string, (answer: { status: number; body: string }) => void>();
  private readonly videoListeners = new Set<() => void>();
  private readonly readyListeners = new Set<() => void>();
  private lastVideoId = currentVideoId();
  /** For the timing log: when the current video started (0: with the page), when its first request was sent. */
  private videoStart = { id: currentVideoId(), at: 0 };
  private readonly firstRequest = new Map<string, number>();
  /** Lines taken from the player's own answer (for the timing log). */
  private readonly fromPlayer = new WeakSet<LoadedPick>();
  private reading: { key: string; result: Promise<Read> } | null = null;
  /** The languages of the last look (the agent's, or the settings' for the early start). */
  private pair: LanguagePair = DEFAULT_PAIR;
  /** Videos whose player was asked to load a missing track (see askForMissing). */
  private readonly askedPlayer = new Set<string>();
  /** Lines being read or read (see loadOnce), by video, track and template. */
  private readonly loads = new Map<string, Promise<LoadedPick | null>>();
  private nativeHidden: HTMLStyleElement | null = null;
  private oursOn = false;
  private toggle: HTMLButtonElement | null = null;
  private turningOn: { videoId: string; done: Promise<void> } | null = null;
  /** Videos the player has asked subtitles for (even when the answer was empty): CC is on there. */
  private readonly playerAsked = new Set<string>();

  /** Starts listening to the page-world script and to navigation. */
  start(): this {
    window.addEventListener('message', this.onMessage);
    // In-page navigation: YouTube fires yt-navigate-finish; polling the URL is the safety net.
    document.addEventListener('yt-navigate-finish', this.checkVideo);
    setInterval(this.checkVideo, NAVIGATION_POLL_MS);
    this.templates.onTemplate((videoId) => {
      if (videoId === currentVideoId()) this.readyListeners.forEach((listener) => listener());
    });
    // YouTube may redraw its control bar with another video: our switch goes back in.
    this.videoListeners.add(() => {
      if (this.nativeHidden) void this.placeToggle();
    });
    void this.prepare().catch(() => {}); // the extension was reloaded under this page: nothing to do
    return this;
  }

  owns(video: HTMLVideoElement): boolean {
    return video.closest('#movie_player, #shorts-player') !== null;
  }

  playsHere(video: HTMLVideoElement): boolean {
    return (
      video.closest(shortsIdOf(location.pathname) ? '#shorts-player' : '#movie_player') !== null
    );
  }

  isShort(video: HTMLVideoElement): boolean {
    return video.closest('#shorts-player') !== null;
  }

  /**
   * Where our overlays live: the reel of a Short (its controls are above the player in it, and it
   * scrolls with the video), the player of a video. Below YouTube's header, so scrolling never
   * puts them over its search bar.
   */
  overlayParent(video: HTMLVideoElement): HTMLElement | null {
    return video.closest<HTMLElement>('ytd-reel-video-renderer') ?? video.closest('#movie_player');
  }

  onVideoChange(listener: () => void): () => void {
    this.videoListeners.add(listener);
    return () => this.videoListeners.delete(listener);
  }

  onSubtitlesReady(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  /** Reads the subtitles of the current video: the line of the learnt language and of the user's own. */
  async inspect(pair: LanguagePair): Promise<Inspection> {
    await loadUiLanguage(); // this script has its own copy of the texts: the labels are written in the chosen language
    this.pair = pair;
    const videoId = currentVideoId();
    const read = videoId ? await this.read(videoId) : null;
    if (!videoId || !read || (!read.plan.learn && !read.plan.native)) {
      const result = buildYouTubeInspection(null, null);
      console.info(
        '[Double Sub] YouTube: у видео нет субтитров',
        JSON.stringify(result.report.decision),
      );
      return result;
    }

    const { loaded, tokenMs, ms } = read;
    const [en, ru] = loaded;
    const result = buildYouTubeInspection(en, ru);
    const firstRequest = this.firstRequest.get(videoId);
    const now = performance.now();
    logTiming('handed-over', {
      videoId,
      sinceVideoMs: Math.round(now - (this.videoStart.id === videoId ? this.videoStart.at : 0)),
      sinceFirstRequestMs: firstRequest === undefined ? null : Math.round(now - firstRequest),
      lines: [en, ru].flatMap((one) =>
        one
          ? [
              {
                lang: trackKeyOfPick(one.pick),
                cues: one.cues?.length ?? null,
                fromPlayer: this.fromPlayer.has(one),
              },
            ]
          : [],
      ),
    });
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

  /**
   * Hides YouTube's own captions and its CC button (CC itself keeps working), or shows them back.
   * Our own switch takes the CC button's place in the control bar meanwhile.
   */
  hideNative(hide: boolean): void {
    if (hide && !this.nativeHidden) {
      this.nativeHidden = document.createElement('style');
      this.nativeHidden.textContent = `${this.nativeCaptionSelector}, ${CC_BUTTON}, ${SHORTS_CC_HOST} { display: none !important; } ${TOGGLE_STYLE}`;
      (document.head ?? document.documentElement).append(this.nativeHidden);
      void this.placeToggle();
    } else if (!hide && this.nativeHidden) {
      this.nativeHidden.remove();
      this.nativeHidden = null;
      this.toggle?.remove();
    }
  }

  // ---------------------------------------------------------------- our switch in YouTube's control bar

  /** Puts our switch right after the (hidden) CC button, once the player has it. */
  private async placeToggle(): Promise<void> {
    const cc = await waitFor(findCcButton, PLAYER_TIMEOUT_MS);
    if (!cc || !this.nativeHidden) return;
    await loadUiLanguage(); // its tooltip is written in the chosen language
    const toggle = this.toggle ?? this.makeToggle();
    // In a Short the button sits inside its own element: ours goes after that one.
    const anchor = cc.closest(SHORTS_CC_HOST) ?? cc;
    toggle.classList.toggle('shorts', anchor !== cc);
    if (anchor.nextElementSibling !== toggle) anchor.after(toggle);
    this.renderToggle((await loadSettings()).enabled);
  }

  private makeToggle(): HTMLButtonElement {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ytp-button double-sub-toggle';
    toggle.dataset.testid = 'yt-toggle';
    toggle.innerHTML = ICONS.subtitles;
    toggle.addEventListener('click', (event) => {
      event.stopPropagation(); // the player's own click handlers have nothing to do with it
      const on = toggle.getAttribute('aria-pressed') !== 'true';
      this.renderToggle(on);
      void updateSettings({ enabled: on }).catch(() => {});
    });
    // The side panel, the cross on the bar, another tab: the switch follows.
    watchSettings((settings) => this.renderToggle(settings.enabled));
    this.toggle = toggle;
    return toggle;
  }

  private renderToggle(on: boolean): void {
    if (!this.toggle) return;
    const label = t(on ? 'bar_close' : 'bar_show');
    this.toggle.setAttribute('aria-pressed', String(on));
    this.toggle.setAttribute('aria-label', label);
    this.toggle.title = label;
  }

  /** Our subtitles are on: CC is turned on, YouTube loads the subtitles only with CC on. With ours off CC is not touched. */
  setOursOn(on: boolean): void {
    this.oursOn = on;
    if (on) void this.turnOnCaptions();
  }

  // ---------------------------------------------------------------- ready before the agent comes

  /**
   * Where Double Sub starts by itself, the agent comes 2–3 s after the page (the probe, the injection,
   * the first look). Everything YouTube needs is started here, at once: its own captions and CC button
   * are hidden, CC is turned on as soon as the player has the button, and both lines are read as soon
   * as the player's answer comes. The agent then finds them ready (see read).
   */
  private async prepare(): Promise<void> {
    const [sites, settings] = await Promise.all([loadKnownSites(), loadSettings()]);
    if (!matchKnownHost(location.hostname, hostsOf(Object.keys(sites)))) return;
    this.pair = pairOf(settings);
    this.hideNative(true); // with ours off too: Double Sub is at work on this site
    if (!settings.enabled) return;
    this.templates.onTemplate((videoId) => {
      if (videoId === currentVideoId()) void this.read(videoId);
    });
    this.videoListeners.add(() => void this.turnOnCaptions());
    this.setOursOn(true);
  }

  /**
   * Turns CC on for the current video as soon as the player can take it, while ours are on; never
   * turns it off. One at a time per video.
   */
  private turnOnCaptions(): Promise<void> {
    const videoId = currentVideoId();
    if (!videoId || !this.oursOn) return Promise.resolve();
    if (this.turningOn?.videoId === videoId) return this.turningOn.done;
    const done = this.turnOnNow(videoId);
    this.turningOn = { videoId, done };
    void done.then(() => {
      if (this.turningOn?.done === done) this.turningOn = null;
    });
    return done;
  }

  private async turnOnNow(videoId: string): Promise<void> {
    const button = await waitFor(findCcButton, PLAYER_TIMEOUT_MS);
    if (!button || videoId !== currentVideoId()) return;
    const plan = planTracks(await this.requestTracks(), this.pair);
    if (!plan.learn && !plan.native) return; // nothing to turn on
    // A click before the player is ready is lost: click again while CC is off and the player has not
    // asked for the subtitles. Once it has asked, CC is on: never click again (that would turn it off).
    for (let tries = 0; tries < CC_TRIES && videoId === currentVideoId(); tries++) {
      if (this.playerAsked.has(videoId) || this.templates.get(videoId)) return;
      if (!this.oursOn) return; // ours were turned off meanwhile
      if (button.getAttribute('aria-pressed') !== 'true') {
        logTiming('cc-on', { videoId, tries });
        button.click();
      }
      await sleep(CC_RETRY_MS);
    }
  }

  /**
   * Tracks, token and both lines of a video. A read in progress or complete is shared: the one
   * started early (prepare) is the one the agent gets. A read with a line missing is not kept, so
   * the next look tries again.
   */
  private read(videoId: string): Promise<Read> {
    // The same video in other languages is another read (the user changed the pair).
    const key = `${videoId}|${this.pair.learn}|${this.pair.native}`;
    if (this.reading?.key === key) return this.reading.result;
    const result = this.readNow(videoId, this.pair);
    const reading = { key, result };
    this.reading = reading;
    void result.then(({ plan, loaded }) => {
      // No tracks at all may only mean that the player was still on another video: not kept either.
      const complete =
        (plan.learn || plan.native) &&
        [plan.learn, plan.native].every((pick, i) => !pick || hasLines(loaded[i]!));
      if (!complete && this.reading === reading) this.reading = null;
    });
    return result;
  }

  private async readNow(videoId: string, pair: LanguagePair): Promise<Read> {
    const started = performance.now();
    const plan = planTracks(await this.requestTracks(), pair);
    let loaded: Loaded = [
      plan.learn && { pick: plan.learn, cues: null },
      plan.native && { pick: plan.native, cues: null },
    ];
    if (!plan.learn && !plan.native) return { plan, loaded, tokenMs: 0, ms: 0 };

    const template = await this.ensureTemplate(videoId, plan);
    const tokenMs = Math.round(performance.now() - started);
    if (template) {
      loaded = await this.loadAll(videoId, template, plan);
      // An empty answer with this token: forget it, the player's next request brings a fresh one.
      if (gotNothing(loaded)) this.templates.drop(videoId);
      else this.askForMissing(videoId, template, loaded);
    } else {
      console.warn('[Double Sub] YouTube: плеер пока не запросил субтитры, жду его запроса');
    }
    return { plan, loaded, tokenMs, ms: Math.round(performance.now() - started) };
  }

  // ---------------------------------------------------------------- what the page-world script tells us

  private readonly onMessage = (event: MessageEvent) => {
    const message = event.data as MainMessage | undefined;
    if (event.source !== window || message?.source !== MAIN_SOURCE) return;

    if (message.type === 'timedtext-sent') {
      const videoId = videoIdOf(message.url);
      if (videoId && isPlayerTemplate(message.url)) this.playerAsked.add(videoId);
      this.templates.sent(message.url);
    } else if (message.type === 'timedtext') {
      const videoId = videoIdOf(message.url);
      if (message.body && videoId && !this.firstRequest.has(videoId))
        this.firstRequest.set(videoId, message.requestedAt);
      this.templates.answered(message.url, message.body);
    } else if (message.type === 'tracks') {
      this.tracksWaiters.forEach((waiter) => waiter(message));
    } else if (message.type === 'fetched') {
      this.fetches.get(message.id)?.(message);
    }
  };

  private askTracks(): Promise<TracksAnswer | null> {
    // Several looks may ask at once (the early start and the agent): every one gets the answer.
    return new Promise((resolve) => {
      const done = (answer: TracksAnswer | null) => {
        clearTimeout(timer);
        this.tracksWaiters.delete(waiter);
        resolve(answer);
      };
      const waiter = (answer: TracksAnswer) => done(answer);
      const timer = setTimeout(() => done(null), TRACKS_TIMEOUT_MS);
      this.tracksWaiters.add(waiter);
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
   * The token of a request the player made for this video. With CC on the player makes it by itself;
   * with CC off (and ours on) CC is turned on so that it does, see turnOnCaptions. Waits for the
   * request, not longer.
   */
  private async ensureTemplate(videoId: string, plan: YouTubePlan): Promise<string | null> {
    const known = this.templates.get(videoId);
    if (known) return known;
    void this.turnOnCaptions();
    return new Promise((resolve) => {
      // Some players stay silent with CC on (a Short opened from the home page): asked to load the
      // track, the player requests it at once, with its token.
      const nudge = setTimeout(() => {
        const pick = plan.learn ?? plan.native;
        if (pick && this.oursOn && !this.askedPlayer.has(videoId))
          this.askPlayer(videoId, pick, true);
      }, NUDGE_PLAYER_MS);
      const done = (template: string | null) => {
        clearTimeout(timer);
        clearTimeout(nudge);
        stop();
        resolve(template);
      };
      const stop = this.templates.onTemplate((id) => {
        if (id === videoId) done(this.templates.get(videoId));
      });
      const timer = setTimeout(() => done(this.templates.get(videoId)), CAPTURE_TIMEOUT_MS);
    });
  }

  /**
   * Both lines, with the player's token. YouTube's translation sometimes takes seconds: as soon as
   * one line has come (and the other has had a moment), what has come is given, and the late line
   * keeps loading; when it comes, YouTube "ready" is told, and the next look takes it from `loads`.
   */
  private async loadAll(videoId: string, template: string, plan: YouTubePlan): Promise<Loaded> {
    const picks = [plan.learn, plan.native] as const;
    const loads = [
      this.loadLine(videoId, template, plan.learn, plan.native),
      this.loadLine(videoId, template, plan.native, plan.learn),
    ];
    const results: Array<LoadedPick | null | undefined> = [undefined, undefined];
    loads.forEach((load, i) => void load.then((result) => (results[i] = result)));
    await new Promise<void>((resolve) => {
      let settled = 0;
      for (const load of loads)
        void load.then((result) => {
          settled++;
          if (settled === loads.length || (result?.cues && result.cues.length > 0)) resolve();
        });
    });
    if (results.some((result) => result === undefined))
      await Promise.race([Promise.all(loads), sleep(SECOND_LINE_GRACE_MS)]);
    const late = loads.filter((_, i) => results[i] === undefined);
    if (late.length > 0)
      void Promise.all(late).then(() => {
        if (currentVideoId() === videoId) this.readyListeners.forEach((listener) => listener());
      });
    return [
      results[0] === undefined ? { pick: picks[0]!, cues: null } : results[0],
      results[1] === undefined ? { pick: picks[1]!, cues: null } : results[1],
    ];
  }

  /**
   * One line. A track of its own language that YouTube gives empty (it happens, with the token too)
   * is not waited for again and again: YouTube's translation of the other line's track into that
   * language is taken at once.
   */
  private async loadLine(
    videoId: string,
    template: string,
    pick: TrackPick | null,
    other: TrackPick | null,
  ): Promise<LoadedPick | null> {
    const loaded = await this.loadOnce(videoId, template, pick);
    if (!pick || pick.tlang || !loaded?.cues || loaded.cues.length > 0 || !hasToken(template))
      return loaded;
    const base = other?.track.isTranslatable ? other.track : null;
    if (!base || base === pick.track) return loaded;
    const translated = await this.loadOnce(videoId, template, {
      track: base,
      tlang: pick.track.languageCode,
      source: 'youtube-translation',
    });
    return translated?.cues && translated.cues.length > 0 ? translated : loaded;
  }

  /** One line, read once: a look while it loads waits for the same load; a failed one is tried again. */
  private loadOnce(
    videoId: string,
    template: string,
    pick: TrackPick | null,
  ): Promise<LoadedPick | null> {
    if (!pick) return Promise.resolve(null);
    const key = `${videoId}|${trackKeyOfPick(pick)}|${template}`;
    const known = this.loads.get(key);
    if (known) return known;
    const load = this.load(videoId, template, pick);
    this.loads.set(key, load);
    void load.then((result) => {
      if (!result?.cues || result.cues.length === 0) this.loads.delete(key);
    });
    for (const old of this.loads.keys()) {
      if (this.loads.size <= KEEP_LOADS) break;
      this.loads.delete(old);
    }
    return load;
  }

  /**
   * One line came, the other did not, and the player's request had no token yet (its first one after
   * a load often has none, and YouTube answers ours with nothing then). Waiting for its next request
   * can take seconds or never end: the player is asked to load the missing track itself (its own
   * captions are hidden), which comes at once with the token; the template it brings reads the line.
   * Once per video.
   */
  private askForMissing(videoId: string, template: string, loaded: Loaded): void {
    if (hasToken(template) || this.askedPlayer.has(videoId)) return;
    const missing = loaded.find((one) => one && !hasLines(one));
    if (!missing) return;
    this.askPlayer(videoId, missing.pick);
  }

  /** The player loads this track itself (with its token); once per video. `reload`: see RequestMessage. */
  private askPlayer(videoId: string, pick: TrackPick, reload = false): void {
    this.askedPlayer.add(videoId);
    const { track } = pick;
    logTiming('ask-player', { videoId, lang: track.languageCode });
    window.postMessage(
      {
        source: REQUEST_SOURCE,
        type: 'load-track',
        languageCode: track.languageCode,
        kind: track.kind,
        ...(reload ? { reload } : {}),
      } satisfies RequestMessage,
      location.origin,
    );
  }

  /**
   * One track. The player's own answer for it is taken as it is; otherwise it is requested, and a
   * server error (YouTube's 503) is tried again, a refusal is not. `cues: null` when it failed.
   */
  private async load(
    videoId: string,
    template: string,
    pick: TrackPick | null,
  ): Promise<LoadedPick | null> {
    if (!pick) return null;
    const heard = await this.templates.lineFromPlayer(videoId, pick, PLAYER_ANSWER_MS);
    if (heard) {
      const cues = parseJson3(heard, { rolling: pick.track.kind === 'asr' });
      if (cues.length > 0) {
        const loaded = { pick, cues };
        this.fromPlayer.add(loaded);
        return loaded;
      }
    }
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
      this.videoStart = { id: videoId, at: performance.now() };
      logTiming('video', { videoId });
      this.videoListeners.forEach((listener) => listener());
    }
  };
}
