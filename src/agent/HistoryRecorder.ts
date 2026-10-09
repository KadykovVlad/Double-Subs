import { cleanTitle, historyId, recordHistory } from '../lib/history';
import { isExtensionAlive } from './host';

/** How often the place where the user stopped is saved to the history. */
const EVERY_MS = import.meta.env.VITE_DS_E2E ? 1000 : 15_000;

/** Writes what the user is watching to the history (kept in the browser only; a setting turns it off). */
export class HistoryRecorder {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly enabled: () => boolean,
  ) {}

  /** Records now and then keeps recording. */
  start(): void {
    this.stop();
    this.recordNow();
    this.timer = setInterval(() => this.recordNow(), EVERY_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  recordNow(): void {
    if (!this.enabled() || !isExtensionAlive()) return;
    const now = Date.now();
    void recordHistory({
      id: historyId(location.href),
      url: location.href,
      title: cleanTitle(document.title, location.host),
      host: location.host,
      firstAt: now,
      lastAt: now,
      position: Math.max(0, this.video.currentTime),
      duration: Number.isFinite(this.video.duration) ? this.video.duration : 0,
    }).catch(() => {});
  }
}
