import type { AgentRequest, FrameScan, PickedMessage } from '../lib/messages';
import { rememberPickedPlayer } from '../lib/known-sites';
import { startPicking } from '../lib/picker';
import type { VideoReport } from '../lib/types';
import { AutoStarter, type AutoHost } from './AutoStarter';
import { isExtensionAlive, PanelLink } from './host';
import { PageScanner } from './PageScanner';
import { TranslatorProbeService } from './PrototypeProbe';
import { UserData } from './UserData';
import { VideoSession } from './VideoSession';
import { WordService } from './WordService';

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
  private readonly words = new WordService();
  private readonly panel = new PanelLink();
  private auto: AutoStarter | null = null;
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

    if (window.__doubleSubAuto) this.startAuto();
    else AutoStarter.whenAnnounced(() => this.startAuto());
    console.info(
      `[Double Sub] agent ready: ${location.href}${window.__doubleSubAuto ? ' (automatic)' : ''}`,
    );
  }

  // ---------------------------------------------------------------- AutoHost

  videos(): HTMLVideoElement[] {
    return this.scanner.refresh();
  }

  async open(video: HTMLVideoElement, quiet: boolean): Promise<void> {
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
    if (this.auto) return;
    this.auto = new AutoStarter(this);
    this.auto.start();
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
    switch (message.type) {
      case 'scan':
        respond(this.scan());
        return false;
      case 'select': {
        const video = this.scanner.videos[message.index];
        if (!video) {
          respond(null);
          return false;
        }
        void this.select(video)
          .then((report) => {
            void rememberPickedPlayer(location.origin, message.index).catch(() => {});
            respond(report);
          })
          .catch(() => respond(null));
        return true;
      }
      case 'startPick':
        this.startPicking();
        respond({ ok: true });
        return false;
      case 'stopPick':
        this.endPicking();
        respond({ ok: true });
        return false;
      case 'retryTranslation':
        this.session?.retryTranslation();
        respond({ ok: true });
        return false;
      case 'probeTranslator':
        if (!__DS_PROTOTYPES__) {
          respond(null);
          return false;
        }
        void new TranslatorProbeService().run().then(respond);
        return true;
    }
    return false;
  }

  private scan(): FrameScan {
    return this.scanner.scan(this.session?.report ?? null, this.session?.translationStatus ?? null);
  }
}
