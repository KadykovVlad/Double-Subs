import { describeFrame } from '../lib/frame';
import { phrasize } from '../lib/phrases';
import { updateSettings } from '../lib/settings';
import { mayBeBeforeTheFilm, readPlayerFacts } from '../lib/player-state';
import { fileLabel, loadSubtitleFiles } from '../lib/subtitle-files';
import { inspectVideo } from '../lib/tracks';
import { youtubeBlocked } from '../lib/youtube';
import type { TranslationStatus } from '../lib/translation-messages';
import type { Inspection, VideoReport } from '../lib/types';
import { createNotice, type Notice } from '../overlay/notice';
import { startOverlay, type Overlay } from '../overlay/overlay';
import type { WordTools } from '../overlay/words-ui';
import type { YouTubeBridge } from '../youtube/bridge';
import { HistoryRecorder } from './HistoryRecorder';
import type { PanelLink } from './host';
import { PlayerWatcher } from './PlayerWatcher';
import { TranslationJob } from './TranslationJob';
import type { UserData } from './UserData';
import { t } from '../lib/i18n';

/** The first thing the user sees when subtitles are ready. */
export function readyNotice(report: VideoReport): { text: string; tone: 'ok' | 'warn' } {
  switch (report.decision.case) {
    case 'A':
      return { text: t('chip_ready_a'), tone: 'ok' };
    case 'B':
      return {
        text: t(report.decision.translateFrom === 'en' ? 'chip_ready_b_en' : 'chip_ready_b_ru'),
        tone: 'ok',
      };
    case 'C':
      if (youtubeBlocked(report)) return { text: t('chip_youtube_blocked'), tone: 'warn' };
      return { text: t(report.tracks.length === 0 ? 'chip_none' : 'chip_no_full'), tone: 'warn' };
  }
}

/** Subtitle files the page fetched, in the shape the analysis reads. */
const subtitleFilesAsTracks = async () =>
  (await loadSubtitleFiles()).map(({ url, cues }) => ({ label: fileLabel(url), cues }));

/** How long the chip waits for the film to start before it says that there are no subtitles. */
const WAIT_FOR_FILM_MS = 30_000;
/** YouTube without its token yet, or after a server error: the fallback look again, no more often, no more times than this. */
const YOUTUBE_RETRY_EVERY_MS = import.meta.env.VITE_DS_E2E ? 300 : 5000;
const YOUTUBE_RETRIES = 4;

/** Some line the player has could not be read (yet): worth another look. */
const missesLines = (report: VideoReport) =>
  report.tracks.some((track) => track.status !== 'loaded');

export interface SessionDeps {
  data: UserData;
  words: WordTools;
  panel: PanelLink;
}

/**
 * Everything that belongs to one chosen video: reading its subtitles, the bar on the video, the chip
 * that says what was found, the translation of the missing line, the history entry. It starts with
 * `open()` and lets go of everything with `close()`; nothing outside it touches those parts.
 */
export class VideoSession {
  report: VideoReport | null = null;

  private overlay: Overlay | null = null;
  private inspection: Inspection | null = null;
  private translation: TranslationJob | null = null;
  private readonly notice: Notice;
  private readonly history: HistoryRecorder;
  private readonly youtube: YouTubeBridge | null;
  private stopFollowing: Array<() => void> = [];
  private watcher: PlayerWatcher | null = null;
  private loading = false;
  private giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  private youtubeRetries = 0;
  private lastYoutubeTry = 0;
  private toldBlocked = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopListeningToUser: Array<() => void> = [];

  constructor(
    readonly video: HTMLVideoElement,
    private readonly deps: SessionDeps,
  ) {
    this.notice = createNotice(video);
    this.history = new HistoryRecorder(
      video,
      () => deps.data.settings.keepHistory && this.overlay !== null,
    );
    // YouTube's subtitles are not <track> elements: its own module loads them (stage 5).
    const bridge = window.__doubleSubYouTube;
    this.youtube = bridge?.owns(video) ? bridge : null;
  }

  /** YouTube loads its own subtitles and switches videos inside one page: the Agent leaves following that to it. */
  get isYouTube(): boolean {
    return this.youtube !== null;
  }

  get translationStatus(): TranslationStatus | null {
    return this.translation?.status ?? null;
  }

  /** Reads the subtitles, shows them, and starts following changes of the player. */
  async open(): Promise<VideoReport> {
    const report = await this.load(false);
    this.follow();
    return report;
  }

  /** Looks at the same player again (its tracks may have appeared or changed). `quiet`: the chip says nothing unless there is news. */
  async reload(quiet = false): Promise<VideoReport> {
    return this.load(quiet);
  }

  /** The owner's own timer: reads the subtitles again if the player has changed since (cues added by a script, a new source). */
  recheck(): void {
    if (this.youtube) this.retryYouTube(false);
    else this.watcher?.check();
  }

  retryTranslation(): void {
    if (this.inspection) this.translation?.start(this.inspection);
  }

  recordHistory(): void {
    this.history.recordNow();
  }

  close(): void {
    this.history.stop();
    this.translation?.stop();
    this.translation = null;
    this.overlay?.stop();
    this.overlay = null;
    this.stopFollowing.forEach((stop) => stop());
    this.stopFollowing = [];
    this.watcher?.stop();
    this.watcher = null;
    clearTimeout(this.giveUpTimer);
    clearTimeout(this.retryTimer);
    this.stopListeningToUser.forEach((stop) => stop());
    this.stopListeningToUser = [];
    this.notice.destroy();
  }

  private async load(quiet: boolean): Promise<VideoReport> {
    this.loading = true;
    try {
      await this.deps.data.ready; // the language of the texts (track labels, notes) is known from here on
      const inspection = this.youtube
        ? await this.youtube.inspect()
        : await inspectVideo(this.video, subtitleFilesAsTracks);
      this.watcher?.markSeen();
      this.announce(inspection, quiet);
      await this.show(inspection);
      if (this.youtube && missesLines(inspection.report)) {
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.retryYouTube(false), YOUTUBE_RETRY_EVERY_MS);
      }
      return inspection.report;
    } finally {
      this.loading = false;
    }
  }

  /** Console report and the chip on the video. */
  private announce({ report }: Inspection, quiet: boolean): void {
    const before = this.report?.decision.case;
    this.report = report;
    clearTimeout(this.giveUpTimer);
    // The report is a debugging aid (the e2e tests read it); the store build stays quiet.
    if (__DS_PROTOTYPES__) {
      console.info(
        '[Double Sub] video-report',
        JSON.stringify({ frame: describeFrame(window), ...report }),
      );
      console.table(report.tracks);
    }
    // A repeated look at the same player stays silent, unless it has found the subtitles it was waiting for.
    if (!quiet || (before === 'C' && report.decision.case !== 'C')) {
      if (this.youtube && youtubeBlocked(report)) {
        // The player's request (and its token) usually comes a moment later: the retry will read the lines.
        this.notice.show(t('chip_loading_youtube'), 'info', { sticky: true });
      } else if (this.waitingForFilm(report)) {
        this.notice.show(t('chip_waiting_film'), 'info');
        // A short video that really has none: say so after a while.
        this.giveUpTimer = setTimeout(() => {
          if (this.report?.decision.case === 'C')
            this.notice.show(readyNotice(this.report).text, 'warn');
        }, WAIT_FOR_FILM_MS);
      } else {
        const { text, tone } = readyNotice(report);
        this.notice.show(text, tone);
      }
    }
  }

  /** No subtitles yet, but the player has not started its film (no length known, or a short clip before it): they may still come. */
  private waitingForFilm(report: VideoReport): boolean {
    return (
      !this.youtube &&
      report.decision.case === 'C' &&
      report.tracks.length === 0 &&
      mayBeBeforeTheFilm(readPlayerFacts(this.video))
    );
  }

  /** Puts the subtitle bar on the video and starts translating what is missing. */
  private async show(raw: Inspection): Promise<void> {
    this.translation?.stop();
    this.overlay?.stop();
    this.overlay = null;
    // Whole phrases on both lines: a sentence cut in two cues is joined, and the cues one track needs
    // to match a longer cue of the other are shown together. The translation takes the joined text too.
    const inspection: Inspection = { ...raw, lines: phrasize(raw.lines) };
    this.inspection = inspection;
    const { en, ru } = inspection.lines;
    if (!en && !ru) return;

    await this.deps.data.ready;
    const { data, words, panel } = this.deps;
    this.stopListeningToUser.forEach((stop) => stop());
    this.overlay = startOverlay(this.video, inspection.lines, data.settings, {
      hideSelector: this.youtube?.nativeCaptionSelector,
      words,
      savedKeys: data.savedKeys,
      onSettingsChange: (patch) => void updateSettings(patch).catch(() => {}),
    });
    this.stopListeningToUser = [
      data.onSettings((settings) => this.overlay?.setSettings(settings)),
      data.onSavedWords((keys) => this.overlay?.setSaved(keys)),
    ];

    this.translation = new TranslationJob({
      video: this.video,
      overlay: this.overlay,
      notice: this.notice,
      onProgress: () => panel.status(),
    });
    this.translation.start(inspection);
    this.history.start();
  }

  /**
   * Reads the YouTube lines again when some could not be read: at once when YouTube says they are
   * ready (`now`), otherwise as a fallback a few times, some seconds apart.
   */
  private retryYouTube(now: boolean): void {
    if (this.loading || !this.report || !missesLines(this.report)) return;
    if (!now && this.youtubeRetries >= YOUTUBE_RETRIES) {
      // Every try is spent: now it is worth telling the user (another extension may be in the way).
      if (youtubeBlocked(this.report) && !this.toldBlocked) {
        this.toldBlocked = true;
        this.notice.show(t('chip_youtube_blocked'), 'warn');
      }
      return;
    }
    if (!now && Date.now() - this.lastYoutubeTry < YOUTUBE_RETRY_EVERY_MS) return;
    this.youtubeRetries = now ? 0 : this.youtubeRetries + 1; // a signal from YouTube gives the fallback its tries back
    this.lastYoutubeTry = Date.now();
    void this.load(true)
      .then(() => this.deps.panel.selected())
      .catch(() => {});
  }

  /** Follows what the page does with the player: another video in YouTube, another episode in the same element. */
  private follow(): void {
    this.stopFollowing.forEach((stop) => stop());
    this.stopFollowing = [];

    if (this.youtube) {
      // YouTube keeps the same <video> when it switches to another video: reload the lines.
      this.stopFollowing.push(
        this.youtube.onVideoChange(async () => {
          this.youtubeRetries = 0;
          this.toldBlocked = false;
          try {
            await this.load(false);
          } catch (error) {
            console.warn('[Double Sub] could not reload the lines', error);
          }
        }),
        // The player's token arrived: the lines that could not be read can be read now.
        this.youtube.onSubtitlesReady(() => this.retryYouTube(true)),
      );
      return;
    }

    // A single-page site may load the next episode into the same <video>, an ad may come before the
    // film, tracks may be added late: look again whenever the player changes.
    const watcher = new PlayerWatcher(this.video, () => {
      if (this.loading || !this.video.isConnected) return;
      void this.load(true)
        .then(() => this.deps.panel.selected())
        .catch(() => {});
    });
    this.watcher = watcher;
    watcher.start();
  }
}
