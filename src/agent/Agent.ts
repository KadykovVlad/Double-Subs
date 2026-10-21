import type { AgentRequest, FrameScan, PickedMessage } from '../lib/messages';
import { rememberPickedPlayer } from '../lib/known-sites';
import { startPicking } from '../lib/picker';
import type { VideoReport } from '../lib/types';
import { AutoStarter, type AutoHost } from './AutoStarter';
import { isExtensionAlive, PanelLink } from './host';
import { PageScanner } from './PageScanner';
import { TranslatorProbeService } from './PrototypeProbe';
import { pairOf } from '../lib/settings';
import { UserData } from './UserData';
import { VideoSession } from './VideoSession';
import { WordService } from './WordService';
import { isTikTokHost } from '../lib/tiktok';
import { tikTokSource } from '../tiktok/TikTokSource';

/** The session of a video that the page took away is let go of within this time. */
const WATCH_EVERY_MS = import.meta.env.VITE_DS_E2E ? 250 : 1500;

/**
 * One agent lives in every frame the extension works in. It answers the side panel (what is on the
 * page, use this video, let the user pick one) and keeps at most one VideoSession. The parts it is
 * made of each have their own class: PageScanner, UserData, WordService, VideoSession, AutoStarter.
 */
export class Agent implements AutoHost {
  session: VideoSession | null = null;
  picking = false;

  private readonly scanner = new PageScanner();
  private readonly data = new UserData();
  private readonly words = new WordService(
    () => pairOf(this.data.settings),
    () => this.data.canSaveWords(),
  );
  private readonly panel = new PanelLink();
  private auto: AutoStarter | null = null;
  /** The page asked for the automatic start (before or without anybody being signed in). */
  private autoWanted = false;
  private stopPick: (() => void) | null = null;
  private watchTimer: ReturnType<typeof setInterval> | undefined;

  start(): void {
    browser.runtime.onMessage.addListener((message: AgentRequest, _sender, sendResponse) =>
      this.handle(message, sendResponse),
    );
    this.watchTimer = setInterval(() => this.watchSession(), WATCH_EVERY_MS);
    window.addEventListener('pagehide', () => {
      this.session?.recordHistory();
      this.closeSession();
    });

    // The extension works for signed-in users only: a sign-out ends everything on this page at once,
    // a sign-in starts the automatic start that was waiting.
    this.data.onAccount((account) => {
      if (account) {
        if (this.autoWanted) this.startAuto();
      } else this.stopEverything();
    });

    if (window.__doubleSubAuto) this.startAuto();
    else AutoStarter.whenAnnounced(() => this.startAuto());
    console.info(
      `[Double Sub] agent ready: ${location.href}${window.__doubleSubAuto ? ' (automatic)' : ''}`,
    );
  }

  // ---------------------------------------------------------------- AutoHost

  /**
   * The videos the automatic start may take. On a YouTube page (it has YouTube's players) only those
   * players, the watch one and the Shorts one: the preview a card plays under the pointer on the home
   * page is not what is watched, and a session left on it would keep the Short opened next from
   * getting ours.
   */
  videos(): HTMLVideoElement[] {
    const videos = this.scanner.refresh();
    // TikTok's feed keeps the next video waiting below the screen in a second <video>: only the one on screen.
    const tiktok = isTikTokHost(location.hostname) ? tikTokSource() : null;
    if (tiktok) return videos.filter((video) => tiktok.playsHere(video));
    const youtube = window.__doubleSubYouTube;
    if (!youtube || !videos.some((video) => youtube.owns(video))) return videos;
    return videos.filter((video) => youtube.owns(video));
  }

  async open(video: HTMLVideoElement, quiet: boolean): Promise<void> {
    await this.data.ready;
    if (!this.data.signedIn()) return;
    await this.select(video, quiet);
    this.panel.selected();
  }

  closeSession(): void {
    this.session?.close();
    this.session = null;
  }

  // ---------------------------------------------------------------- choosing a video

  /** Makes `video` the one we work on: reads its subtitles and shows them. */
  private async select(video: HTMLVideoElement, quiet = false): Promise<VideoReport> {
    this.endPicking();
    if (this.session?.video === video) return this.session.reload(quiet);

    this.closeSession();
    const session = new VideoSession(video, {
      data: this.data,
      words: this.words,
      panel: this.panel,
    });
    this.session = session;
    try {
      return await session.open();
    } catch (error) {
      if (this.session === session) this.closeSession();
      throw error;
    }
  }

  private startAuto(): void {
    this.autoWanted = true;
    void this.data.ready.then(() => {
      if (this.auto || !this.data.signedIn()) return;
      this.auto = new AutoStarter(this);
      this.auto.start();
    });
  }

  /** Nobody is signed in any more: no automatic start, no picking, no subtitles on this page. */
  private stopEverything(): void {
    this.auto?.stop();
    this.auto = null;
    this.endPicking();
    this.closeSession();
    this.panel.status();
  }

  /** Lets go of a video the page has removed (another episode in a single-page site). */
  private watchSession(): void {
    if (!isExtensionAlive()) {
      clearInterval(this.watchTimer);
      this.auto?.stop();
      this.endPicking();
      this.closeSession();
      return;
    }
    if (this.session && !this.session.video.isConnected) {
      this.closeSession();
      this.panel.status();
    }
  }

  // ---------------------------------------------------------------- the user picks a player

  private startPicking(): void {
    this.endPicking();
    const visible = this.scanner.visibleVideos();
    if (visible.length === 0) return;
    this.picking = true;
    this.stopPick = startPicking(
      visible,
      (video) => {
        // Right away: the background closes pick mode in the other frames.
        void browser.runtime
          .sendMessage({ type: 'picked' } satisfies PickedMessage)
          .catch(() => {});
        void this.select(video)
          .then(() => {
            void rememberPickedPlayer(location.origin, this.scanner.videos.indexOf(video)).catch(
              () => {},
            );
            this.panel.selected();
          })
          .catch((error) => console.warn('[Double Sub] could not select the video', error));
      },
      () => this.endPicking(),
    );
  }

  private endPicking(): void {
    this.stopPick?.();
    this.stopPick = null;
    this.picking = false;
  }

  // ---------------------------------------------------------------- messages from the side panel

  /** Returns true when the answer comes later. */
  private handle(message: AgentRequest, respond: (response: unknown) => void): boolean {
    // Signed-in users only: an agent left on a page after a sign-out answers nobody.
    void this.data.ready.then(() => {
      if (this.data.signedIn() || message.type === 'stopPick') this.dispatch(message, respond);
      else respond(null);
    });
    return true;
  }

  private dispatch(message: AgentRequest, respond: (response: unknown) => void): void {
    switch (message.type) {
      case 'scan':
        respond(this.scan());
        return;
      case 'select': {
        const video = this.scanner.videos[message.index];
        if (!video) {
          respond(null);
          return;
        }
        void this.select(video)
          .then((report) => {
            void rememberPickedPlayer(location.origin, message.index).catch(() => {});
            respond(report);
          })
          .catch(() => respond(null));
        return;
      }
      case 'startPick':
        this.startPicking();
        respond({ ok: true });
        return;
      case 'stopPick':
        this.endPicking();
        respond({ ok: true });
        return;
      case 'retryTranslation':
        this.session?.retryTranslation();
        respond({ ok: true });
        return;
      case 'probeTranslator':
        if (!__DS_PROTOTYPES__) {
          respond(null);
          return;
        }
        void new TranslatorProbeService().run().then(respond);
        return;
    }
  }

  private scan(): FrameScan {
    return this.scanner.scan(this.session?.report ?? null, this.session?.translationStatus ?? null);
  }
}
