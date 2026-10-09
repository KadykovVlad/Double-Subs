import type { Cue, Inspection } from '../lib/types';
import type { TranslationStatus } from '../lib/translation-messages';
import type { Notice } from '../overlay/notice';
import type { Overlay } from '../overlay/overlay';
import { offscreenTranslationService } from '../translation/client';
import { runTranslation } from '../translation/session';
import { t } from '../lib/i18n';

/** What the chip on the video says about the translation of the missing line. */
export function translationNotice(
  status: TranslationStatus,
  target: 'ru' | 'en',
): { text: string; tone: 'ok' | 'info' | 'warn'; sticky: boolean } {
  switch (status.state) {
    case 'translating': {
      const percent = Math.round((status.done / Math.max(1, status.total)) * 100);
      return {
        text: t(target === 'ru' ? 'tr_progress_ru' : 'tr_progress_en', percent),
        tone: 'info',
        sticky: true,
      };
    }
    case 'done': {
      const key =
        target === 'ru'
          ? status.fromCache
            ? 'tr_done_ru_cache'
            : 'tr_done_ru'
          : status.fromCache
            ? 'tr_done_en_cache'
            : 'tr_done_en';
      return { text: t(key), tone: 'ok', sticky: false };
    }
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

  /** Starts translating the missing line of `inspection`; `quiet` keeps the chip silent (a restart answered from the cache). */
  start(inspection: Inspection, quiet = false): void {
    this.stop();
    const { translateFrom } = inspection.report.decision;
    const source = translateFrom ? inspection.lines[translateFrom] : null;
    if (!translateFrom || !source?.length) return;

    const targetLang = translateFrom === 'en' ? 'ru' : 'en';
    const controller = new AbortController();
    this.abort = controller;

    void runTranslation({
      source,
      direction: translateFrom === 'en' ? 'en-ru' : 'ru-en',
      getTime: () => this.target.video.currentTime,
      service: offscreenTranslationService,
      signal: controller.signal,
      onUpdate: ({ cues, status }) => {
        if (controller.signal.aborted) return;
        this.status = status;
        this.target.overlay.setLines({ ...inspection.lines, [targetLang]: cues satisfies Cue[] });
        const silent = quiet && (status.state === 'translating' || status.state === 'done');
        if (!silent) {
          const { text, tone, sticky } = translationNotice(status, targetLang);
          this.target.notice.show(text, tone, { sticky });
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
