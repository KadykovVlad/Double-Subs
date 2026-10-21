import { AUTO_EVENT } from '../lib/auto-event';
import {
  chooseAutoPlayer,
  frameAddresses,
  isSiteExcluded,
  loadKnownSites,
  watchExcludedSites,
} from '../lib/known-sites';
import { isExtensionAlive } from './host';
import { isShown } from './PageScanner';
import type { VideoSession } from './VideoSession';

/** What the starter needs from the agent: look at the page, and open or close the session. */
export interface AutoHost {
  readonly session: VideoSession | null;
  /** The user is choosing a player on the page: do not interfere. */
  readonly picking: boolean;
  videos(): HTMLVideoElement[];
  /** Opens a session on the video; `quiet` is for a repeated look at the same one. */
  open(video: HTMLVideoElement, quiet: boolean): Promise<void>;
  closeSession(): void;
}

const CHECK_EVERY_MS = import.meta.env.VITE_DS_E2E ? 250 : 1500;
/** After a click or a page change the player often appears a moment later: look again at these delays. */
const BURST_DELAYS_MS = [150, 700, 2000, 5000];
/** After a failed start the next try waits, so a broken player is not hammered. */
const RETRY_AFTER_FAILURE_MS = 10_000;
const DOM_QUIET_MS = 400;
/** Media events do not bubble, but a capture listener on the window hears the ones of the plain DOM. */
const MEDIA_EVENTS = ['loadstart', 'loadedmetadata', 'emptied'] as const;

/**
 * Finds the player by itself on a page where the extension may work, and starts the subtitles at once.
 * It looks again on every sign that something is about to appear:
 * - a click on the page (the play button that loads the player);
 * - a change of the page: a new or replaced video or iframe, or another address (the next episode);
 * - a video that begins to load (a new source) or to play;
 * - a timer, as the safety net.
 */
export class AutoStarter {
  private timer: ReturnType<typeof setInterval> | undefined;
  private burstTimers: Array<ReturnType<typeof setTimeout>> = [];
  private domTimer: ReturnType<typeof setTimeout> | undefined;
  private observer: MutationObserver | null = null;
  private stopWatchingSites: (() => void) | null = null;
  /** The videos and iframes of the last look at the page: a replaced one shows as a difference. */
  private seen = new Set<Element>();
  private busy = false;
  private ticks = 0;
  private retryAt = 0;
  private href = location.href;
  private running = false;

  /** `onStop`: the starter ended (by itself or by the owner), so the owner can make a new one later. */
  constructor(
    private readonly host: AutoHost,
    private readonly onStop?: () => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.onTimer(), CHECK_EVERY_MS);
    window.addEventListener('click', this.onClick, true);
    // A video started to play (the next one of a feed, scrolled to): look at once. Media events do not bubble.
    window.addEventListener('play', this.onPlay, true);
    // A new source or a new video element starts to load: the next episode, a player made again.
    for (const name of MEDIA_EVENTS) window.addEventListener(name, this.onMedia, true);
    window.addEventListener('popstate', this.onNavigate);
    window.addEventListener('hashchange', this.onNavigate);
    (window as unknown as { navigation?: EventTarget }).navigation?.addEventListener(
      'currententrychange',
      this.onNavigate,
    );
    this.observer = new MutationObserver(this.onDomChange);
    this.observer.observe(document, { childList: true, subtree: true });
    // The user switched this site off: the subtitles go and nothing starts by itself any more.
    this.stopWatchingSites = watchExcludedSites((excluded) => {
      if (!isSiteExcluded(excluded, frameAddresses())) return;
      this.host.closeSession();
      this.stop();
    });
    void this.tick();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.clearBurst();
    clearTimeout(this.domTimer);
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('play', this.onPlay, true);
    for (const name of MEDIA_EVENTS) window.removeEventListener(name, this.onMedia, true);
    window.removeEventListener('popstate', this.onNavigate);
    window.removeEventListener('hashchange', this.onNavigate);
    (window as unknown as { navigation?: EventTarget }).navigation?.removeEventListener(
      'currententrychange',
      this.onNavigate,
    );
    this.observer?.disconnect();
    this.observer = null;
    this.stopWatchingSites?.();
    this.stopWatchingSites = null;
    this.onStop?.();
  }

  /** Starts when the page announces that it is a known site (the agent was there before the probe). */
  static whenAnnounced(onAuto: () => void): () => void {
    window.addEventListener(AUTO_EVENT, onAuto, { once: true });
    return () => window.removeEventListener(AUTO_EVENT, onAuto);
  }

  // ---------------------------------------------------------------- signs that a player may be there

  private readonly onClick = () => this.burst();

  private readonly onPlay = (event: Event) => {
    if (event.target instanceof HTMLVideoElement && event.target !== this.host.session?.video)
      void this.tick();
  };

  private readonly onMedia = (event: Event) => {
    if (event.target instanceof HTMLVideoElement && event.target !== this.host.session?.video)
      this.burst(); // its size and its place settle a moment later
  };

  private readonly onNavigate = () => {
    if (location.href === this.href) return;
    this.href = location.href;
    // Another address is another episode: let go of the old one so its lines do not stay on screen.
    // YouTube changes videos inside one page and its own follower does the work there.
    if (this.host.session && !this.host.session.isYouTube) this.host.closeSession();
    this.burst();
  };

  private readonly onDomChange = () => {
    if (this.domTimer !== undefined) return;
    this.domTimer = setTimeout(() => {
      this.domTimer = undefined;
      // The set of videos and iframes, not only its size: one taken away and one put in is a change.
      const now: Element[] = [
        ...document.getElementsByTagName('video'),
        ...document.getElementsByTagName('iframe'),
      ];
      if (now.length !== this.seen.size || now.some((element) => !this.seen.has(element))) {
        this.seen = new Set(now);
        void this.tick();
      }
    }, DOM_QUIET_MS);
  };

  private onTimer(): void {
    if (!isExtensionAlive()) return this.stop();
    this.onNavigate(); // the address can change without any event we hear
    void this.tick();
  }

  private burst(): void {
    this.clearBurst();
    this.burstTimers = BURST_DELAYS_MS.map((delay) => setTimeout(() => void this.tick(), delay));
  }

  private clearBurst(): void {
    this.burstTimers.forEach(clearTimeout);
    this.burstTimers = [];
  }

  // ---------------------------------------------------------------- the start itself

  private async tick(): Promise<void> {
    if (!this.running || this.busy || this.host.picking) return;
    this.ticks++;
    this.busy = true;
    try {
      const session = this.host.session;
      // A player we hold that is gone from the screen (hidden, with a new one beside it) is not kept.
      if (session?.video.isConnected && !session.leftBehind && isShown(session.video))
        return this.waitForSubtitles(session);
      if (Date.now() < this.retryAt) return;
      // Walking the whole page is costly: do it often only when a <video> is plainly there, otherwise
      // (shadow DOM players) every other tick.
      if (document.getElementsByTagName('video').length === 0 && this.ticks % 2 !== 0) return;

      const videos = this.host.videos();
      const candidates = videos.map((video, index) => {
        const rect = video.getBoundingClientRect();
        return { index, width: rect.width, height: rect.height, visible: isShown(video) };
      });
      const sites = await loadKnownSites();
      const pick = chooseAutoPlayer(
        candidates.filter((c) => c.visible),
        sites[location.origin]?.preferredIndex ?? null,
      );
      if (pick !== null) await this.host.open(videos[pick]!, false);
    } catch (error) {
      this.retryAt = Date.now() + RETRY_AFTER_FAILURE_MS;
      console.warn('[Double Sub] automatic start failed', error);
    } finally {
      this.busy = false;
    }
  }

  /** A player already taken: it may have changed (a film after an ad, late subtitles); cheap to ask, so every few ticks. */
  private waitForSubtitles(session: VideoSession): void {
    if (this.ticks % 3 === 0) session.recheck();
  }
}
