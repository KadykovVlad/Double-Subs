import {
  cleanTitle,
  historyId,
  pageOfFrame,
  recordHistory,
  type WatchedPage,
} from '../lib/history';
import type { PageOfFrameMessage } from '../lib/messages';
import { isExtensionAlive } from './host';

/** How often the place where the user stopped is saved to the history. */
const EVERY_MS = import.meta.env.VITE_DS_E2E ? 1000 : 15_000;

/** Writes what the user is watching to the history (a setting turns it off). */
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
    void this.record().catch(() => {});
  }

  private async record(): Promise<void> {
    const { url, title } = await currentPage();
    const { host } = new URL(url);
    const now = Date.now();
    await recordHistory({
      id: historyId(url),
      url,
      title: cleanTitle(title, host),
      host,
      firstAt: now,
      lastAt: now,
      position: Math.max(0, this.video.currentTime),
      duration: Number.isFinite(this.video.duration) ? this.video.duration : 0,
    });
  }
}

/** The page the user is on, also for a player in a frame (the agent runs in the frame of the player). */
async function currentPage(): Promise<WatchedPage> {
  const own = { url: location.href, title: document.title };
  if (window === window.top) return own;
  const tab = (await browser.runtime
    .sendMessage({ type: 'page-of-frame' } satisfies PageOfFrameMessage)
    .catch(() => null)) as { url?: string | null; title?: string | null } | null;
  return pageOfFrame(own, tab, Array.from(location.ancestorOrigins), document.referrer);
}
