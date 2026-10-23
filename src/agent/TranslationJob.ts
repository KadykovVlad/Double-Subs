import type { Cue, Inspection } from '../lib/types';
import type { TranslationStatus } from '../lib/translation-messages';
import type { Notice } from '../overlay/notice';
import type { Overlay } from '../overlay/overlay';
import { offscreenTranslationService } from '../translation/client';
import { runTranslation } from '../translation/session';
import { nameOf, t } from '../lib/i18n';
import { otherRole, type LanguagePair } from '../lib/languages';
import { directionOf } from '../lib/translator';

/** What the chip on the video says about the translation of the missing line. */
export function translationNotice(
  status: TranslationStatus,
  target: string,
): { text: string; tone: 'info' | 'warn'; sticky: boolean } | null {
  switch (status.state) {
    case 'translating': {
      const percent = Math.round((status.done / Math.max(1, status.total)) * 100);
      return { text: t('tr_progress', nameOf(target), percent), tone: 'info', sticky: true };
    }
    case 'done':
      return null; // a finished translation is just there: the line appears, nothing to announce
    case 'needs-model':
      return { text: t('tr_needs_model'), tone: 'warn', sticky: true };
    case 'unavailable':
      return { text: t('tr_unavailable'), tone: 'warn', sticky: true };
    case 'error':
      return { text: t('tr_stopped'), tone: 'warn', sticky: true };
  }
}

export interface TranslationTarget {
  video: HTMLVideoElement;
  overlay: Overlay;
  notice: Notice;
  /** The languages chosen now. */
  pair: () => LanguagePair;
  /** Called after every step, so the panel can show progress. */
  onProgress: () => void;
}

/**
 * Case B: one language is there, the other is translated on the device. The translated line is paired
 * with its source cue by timing, so the two lines change together; it fills in as chunks arrive,
 * nearest to the playback position first. One job translates one set of cues; `stop` ends it.
 */
export class TranslationJob {
  status: TranslationStatus | null = null;
  private abort: AbortController | null = null;

  constructor(private readonly target: TranslationTarget) {}

  /**
   * Starts translating the missing line of `inspection`; `quiet` keeps the chip silent (a restart
   * answered from the cache). `meanwhile`: YouTube's own line is on its way, the device only fills
   * the line until it comes, without a word on the chip (no "translating", no "a model is needed").
   */
  start(inspection: Inspection, quiet = false, meanwhile = false): void {
    this.stop();
    const { translateFrom } = inspection.report.decision;
    const source = translateFrom ? inspection.lines[translateFrom] : null;
    if (!translateFrom || !source?.length) return;

    const targetRole = otherRole(translateFrom);
    const pair = this.target.pair();
    const targetLang = pair[targetRole];
    const controller = new AbortController();
    this.abort = controller;

    void runTranslation({
      source,
      direction: directionOf(pair[translateFrom], targetLang),
      getTime: () => this.target.video.currentTime,
      service: offscreenTranslationService,
      signal: controller.signal,
      onUpdate: ({ cues, status }) => {
        if (controller.signal.aborted) return;
        this.status = status;
        this.target.overlay.setLines({ ...inspection.lines, [targetRole]: cues satisfies Cue[] });
        const silent =
          meanwhile || (quiet && (status.state === 'translating' || status.state === 'done'));
        if (!silent) {
          const notice = translationNotice(status, targetLang);
          // Done: the progress chip, if it is still up, goes away.
          if (notice) this.target.notice.show(notice.text, notice.tone, { sticky: notice.sticky });
          else this.target.notice.hide();
        }
        this.target.onProgress();
      },
    });
  }

  stop(): void {
    this.abort?.abort();
    this.abort = null;
    this.status = null;
  }
}
