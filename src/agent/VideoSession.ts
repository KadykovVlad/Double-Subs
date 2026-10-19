import { describeFrame } from '../lib/frame';
import { phrasize } from '../lib/phrases';
import { pairOf, updateSettings } from '../lib/settings';
import {
  DEFAULT_PAIR,
  otherRole,
  sameLanguage,
  shortName,
  type LanguagePair,
} from '../lib/languages';
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
import { isTikTokHost } from '../lib/tiktok';
import { TIKTOK_CAPTION_SELECTOR, tikTokSource, type TikTokSource } from '../tiktok/TikTokSource';
import { HistoryRecorder } from './HistoryRecorder';
import type { PanelLink } from './host';
import { PlayerWatcher } from './PlayerWatcher';
import { TranslationJob } from './TranslationJob';
import type { UserData } from './UserData';
import { nameOf, t } from '../lib/i18n';

/** The first thing the user sees when subtitles are ready. */
export function readyNotice(
  report: VideoReport,
  pair: LanguagePair,
): { text: string; tone: 'ok' | 'warn' } {
  const from = report.decision.translateFrom;
  switch (report.decision.case) {
    case 'A':
      return {
        text: t('chip_ready_a', shortName(pair.learn), shortName(pair.native)),
        tone: 'ok',
      };
    case 'B':
      return {
        text: t('chip_ready_b', shortName(pair[from!]), nameOf(pair[otherRole(from!)])),
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
  /** The page's container that moves with the video, for the overlay and the chip to live in (only on YouTube so far). */
  private readonly anchor = () => this.youtube?.overlayParent(this.video) ?? null;
  /** On TikTok: its subtitle files (it has no <track>), see TikTokSource. */
  private readonly tiktok: TikTokSource | null = isTikTokHost(location.hostname)
    ? tikTokSource()
    : null;
  private closed = false;
  /** The TikTok video the lines on screen belong to: the feed puts another one into the same <video>. */
  private tiktokId: string | null = null;
  private stopFollowing: Array<() => void> = [];
  private watcher: PlayerWatcher | null = null;
  private loading = false;
  /** Counts the looks: a look that a newer one has overtaken (another video) is thrown away. */
  private generation = 0;
  private giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  private youtubeRetries = 0;
  private lastYoutubeTry = 0;
  private toldBlocked = false;
  /** The languages of the lines on screen (the settings' when they were read). */
  private pair: LanguagePair = DEFAULT_PAIR;
  /** The player's token came while a look was running (see load). */
  private readyWhileLoading = false;
  /** Every try for YouTube's own line is spent: the device translates it instead. */
  private gaveUpOnYouTubeLine = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopListeningToUser: Array<() => void> = [];

  constructor(
    readonly video: HTMLVideoElement,
    private readonly deps: SessionDeps,
  ) {
    // YouTube's subtitles are not <track> elements: its own module loads them (stage 5).
    const bridge = window.__doubleSubYouTube;
    this.youtube = bridge?.owns(video) ? bridge : null;
    // A Short has YouTube's buttons at its top: the chip goes to the bottom there.
    this.notice = createNotice(video, {
      bottom: this.youtube?.isShort(video) ?? false,
      anchor: this.anchor,
    });
    this.history = new HistoryRecorder(
      video,
      () => deps.data.settings.keepHistory && this.overlay !== null,
    );
  }

  /** YouTube loads its own subtitles and switches videos inside one page: the Agent leaves following that to it. */
  get isYouTube(): boolean {
    return this.youtube !== null;
  }

  /** A YouTube video that is no longer the one on screen (the user went from a video to Shorts or back). */
  get leftBehind(): boolean {
    if (this.tiktok) return !this.tiktok.playsHere(this.video);
    return this.youtube !== null && !this.youtube.playsHere(this.video);
  }

  get translationStatus(): TranslationStatus | null {
    return this.translation?.status ?? null;
  }

  /** Reads the subtitles, shows them, and starts following changes of the player. */
  async open(): Promise<VideoReport> {
    // On YouTube a switch to another video during the first look must not be missed.
    if (this.youtube) this.follow();
    const report = await this.load(false);
    if (!this.youtube) this.follow();
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
    this.generation++; // a look still running belongs to a closed session: its result is dropped
    this.closed = true;
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
    this.youtube?.setOursOn(false);
    this.youtube?.hideNative(false);
    this.notice.destroy();
  }

  /**
   * YouTube's own captions (and its CC button) are hidden for the whole session, not only while the
   * bar is up: CC stays on (it is what makes YouTube load the subtitles), and its text must not show
   * while ours load, between videos, or when the user turns ours off. CC is turned on only for ours.
   */
  private syncNativeCaptions(): void {
    this.youtube?.hideNative(true);
    this.youtube?.setOursOn(this.deps.data.settings.enabled);
  }

  private async load(quiet: boolean): Promise<VideoReport> {
    const generation = ++this.generation;
    this.loading = true;
    try {
      await this.deps.data.ready; // the language of the texts (track labels, notes) is known from here on
      this.syncNativeCaptions();
      const pair = pairOf(this.deps.data.settings);
      const inspection = this.youtube
        ? await this.youtube.inspect(pair)
        : await inspectVideo(this.video, this.extraFiles, undefined, pair);
      // YouTube switched to another video meanwhile: these lines are of the old one, the newer look shows its own.
      if (generation !== this.generation) return inspection.report;
      this.pair = pair;
      this.watcher?.markSeen();
      this.announce(inspection, quiet);
      await this.show(inspection);
      if (this.youtube && missesLines(inspection.report)) {
        clearTimeout(this.retryTimer);
        // YouTube said "ready" while this look was running: look again as soon as it is over.
        const signalled = this.readyWhileLoading;
        this.retryTimer = signalled
          ? setTimeout(() => this.retryYouTube(true), 0)
          : setTimeout(() => this.retryYouTube(false), YOUTUBE_RETRY_EVERY_MS);
      }
      this.readyWhileLoading = false;
      return inspection.report;
    } finally {
      if (generation === this.generation) this.loading = false;
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
    if (!quiet || (before !== undefined && before !== report.decision.case)) {
      if (this.youtube && (youtubeBlocked(report) || this.awaitsYouTubeLine(report))) {
        // The player's request (and its token) usually comes a moment later: the retry will read the lines.
        this.notice.show(t('chip_loading_youtube'), 'info', { sticky: true });
      } else if (this.waitingForFilm(report)) {
        this.notice.show(t('chip_waiting_film'), 'info');
        // A short video that really has none: say so after a while.
        this.giveUpTimer = setTimeout(() => {
          if (this.report?.decision.case === 'C')
            this.notice.show(readyNotice(this.report, this.pair).text, 'warn');
        }, WAIT_FOR_FILM_MS);
      } else {
        const { text, tone } = readyNotice(report, this.pair);
        this.notice.show(text, tone);
      }
    }
  }

  /**
   * YouTube has the missing line (its own track or its translation) but it has not come yet (most
   * often the player's token had not arrived): it is waited for, not translated on the device.
   */
  private awaitsYouTubeLine(report: VideoReport): boolean {
    const { translateFrom } = report.decision;
    if (!this.youtube || !translateFrom || this.gaveUpOnYouTubeLine) return false;
    const target = this.pair[otherRole(translateFrom)];
    return report.tracks.some(
      (track) => sameLanguage(track.lang, target) && track.status !== 'loaded',
    );
  }

  /** No subtitles yet, but the player has not started its film (no length known, or a short clip before it): they may still come. */
  private waitingForFilm(report: VideoReport): boolean {
    return (
      !this.youtube &&
      !this.tiktok && // its clips are short and have no film after them
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
    const { learn, native } = inspection.lines;
    if (!learn && !native) return;

    await this.deps.data.ready;
    if (this.closed) return;
    const { data, words, panel } = this.deps;
    this.stopListeningToUser.forEach((stop) => stop());
    this.overlay = startOverlay(this.video, inspection.lines, data.settings, {
      hideSelector:
        this.youtube?.nativeCaptionSelector ?? (this.tiktok ? TIKTOK_CAPTION_SELECTOR : undefined),
      noRestoreButton: this.youtube !== null, // our switch sits in YouTube's control bar
      anchor: this.anchor,
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
      pair: () => this.pair,
      onProgress: () => panel.status(),
    });
    // YouTube's line on its way (its translation of a whole track can take seconds): the device
    // fills the line at once, from the cue on screen on, until YouTube's comes and takes its place.
    this.translation.start(inspection, false, this.awaitsYouTubeLine(inspection.report));
    this.history.start();
  }

  /**
   * Reads the YouTube lines again when some could not be read: at once when YouTube says they are
   * ready (`now`), otherwise as a fallback a few times, some seconds apart.
   */
  private retryYouTube(now: boolean): void {
    if (this.loading && now) this.readyWhileLoading = true;
    if (this.loading || !this.report || !missesLines(this.report)) return;
    if (!now && this.youtubeRetries >= YOUTUBE_RETRIES) {
      // Every try is spent: now it is worth telling the user (another extension may be in the way).
      if (youtubeBlocked(this.report) && !this.toldBlocked) {
        this.toldBlocked = true;
        this.notice.show(t('chip_youtube_blocked'), 'warn');
      }
      // YouTube's own line did not come: the device translates the other one after all.
      if (this.awaitsYouTubeLine(this.report) && this.inspection) {
        this.gaveUpOnYouTubeLine = true;
        this.translation?.start(this.inspection);
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

  /** Subtitles that are not tracks: TikTok's files of this video, or the files the page fetched. */
  private readonly extraFiles = async () => {
    if (!this.tiktok) return subtitleFilesAsTracks();
    this.tiktokId = this.tiktok.idOf(this.video);
    return this.tiktok.files(this.video);
  };

  /**
   * The feed puts the next video into the same <video>: the lines of the old one must not stay on it
   * while the player settles (the watcher would look again only after a moment), so they go at once.
   */
  private followTikTok(tiktok: TikTokSource): void {
    const check = () => {
      const id = tiktok.idOf(this.video);
      // The <video> that went below the screen takes the video after next: the one on screen is followed.
      if (!id || id === this.tiktokId || this.loading || this.leftBehind) return;
      this.tiktokId = id;
      this.translation?.stop();
      this.translation = null;
      this.overlay?.stop();
      this.overlay = null;
      this.inspection = null;
      void this.load(false)
        .then(() => this.deps.panel.selected())
        .catch(() => {});
    };
    for (const name of ['loadstart', 'play', 'playing'] as const) {
      this.video.addEventListener(name, check);
      this.stopFollowing.push(() => this.video.removeEventListener(name, check));
    }
  }

  /** Follows what the page does with the player: another video in YouTube, another episode in the same element. */
  private follow(): void {
    this.stopFollowing.forEach((stop) => stop());
    this.stopFollowing = [];
    // Other languages chosen: the lines are read again in them at once.
    this.stopFollowing.push(
      this.deps.data.onSettings((settings) => {
        const pair = pairOf(settings);
        if (pair.learn === this.pair.learn && pair.native === this.pair.native) return;
        this.youtubeRetries = 0;
        this.toldBlocked = false;
        this.gaveUpOnYouTubeLine = false;
        void this.load(false)
          .then(() => this.deps.panel.selected())
          .catch(() => {});
      }),
    );

    if (this.youtube) {
      // YouTube keeps the same <video> when it switches to another video: reload the lines.
      this.stopFollowing.push(
        this.youtube.onVideoChange(async () => {
          this.youtubeRetries = 0;
          this.toldBlocked = false;
          this.gaveUpOnYouTubeLine = false;
          clearTimeout(this.retryTimer);
          // The old video's lines must not run over the new one while its own load.
          this.translation?.stop();
          this.translation = null;
          this.overlay?.stop();
          this.overlay = null;
          this.inspection = null;
          try {
            await this.load(false);
          } catch (error) {
            console.warn('[Double Sub] could not reload the lines', error);
          }
        }),
        // The player's token arrived: the lines that could not be read can be read now.
        this.youtube.onSubtitlesReady(() => this.retryYouTube(true)),
        this.deps.data.onSettings(() => this.syncNativeCaptions()),
      );
      return;
    }

    if (this.tiktok) this.followTikTok(this.tiktok);

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
