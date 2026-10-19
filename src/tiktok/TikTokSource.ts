import { parseSubtitleFile } from '../lib/subtitle-files';
import {
  idOfPath,
  idOfWrapper,
  TIKTOK_MAIN_SOURCE,
  TIKTOK_REQUEST_SOURCE,
  type TikTokItem,
  type TikTokMainMessage,
  type TikTokRequestMessage,
} from '../lib/tiktok';
import type { Cue } from '../lib/types';

/** TikTok's own captions over its video: hidden while ours are on. The class ends with a hash. */
export const TIKTOK_CAPTION_SELECTOR = '[class*="DivVideoClosedCaption"]';

/** The page-world script answers at once; if it is not there (no registration yet), it is injected. */
const HELLO_WAIT_MS = 400;
/** A video's data may come a moment after its player (the feed answer that brings it). */
const ITEM_WAIT_MS = 1500;
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 500_000;
const KEEP = 300;

export interface TikTokFile {
  label: string;
  cues: Cue[];
}

/**
 * The extension's side of TikTok (isolated world, one per page): the subtitle files of every video
 * the page-world script has seen, and the files themselves when a player is looked at.
 */
export class TikTokSource {
  private readonly items = new Map<string, TikTokItem>();
  private readonly waiters = new Set<() => void>();
  private readonly loads = new Map<string, Promise<Cue[]>>();
  private heard = false;

  start(): this {
    window.addEventListener('message', this.onMessage);
    this.ask();
    setTimeout(() => {
      if (!this.heard)
        void browser.runtime.sendMessage({ type: 'inject-tiktok-main' }).catch(() => {});
    }, HELLO_WAIT_MS);
    return this;
  }

  /** The video a player shows; on a video's own page its address says it too. */
  idOf(video: HTMLVideoElement): string | null {
    const wrapper = video.closest<HTMLElement>('[id^="xgwrapper-"]');
    return (wrapper && idOfWrapper(wrapper.id)) ?? idOfPath(location.pathname);
  }

  /**
   * The player is the one on screen. The feed has two <video> elements for all its videos: the one
   * playing, and the next one waiting below the screen.
   */
  playsHere(video: HTMLVideoElement): boolean {
    const rect = video.getBoundingClientRect();
    if (rect.height === 0) return false;
    const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    return visible / rect.height >= 0.5;
  }

  /** The subtitle files of the video in this player, read; none when TikTok has none for it. */
  async files(video: HTMLVideoElement): Promise<TikTokFile[]> {
    const id = this.idOf(video);
    if (!id) return [];
    const item = await this.item(id);
    if (!item) return [];
    const files = await Promise.all(
      item.captions.slice(0, 2).map(async ({ url, language, source }) => ({
        label: `TikTok ${source || ''} ${language}`.replace(/\s+/g, ' ').trim(),
        cues: await this.load(url),
      })),
    );
    return files.filter((file) => file.cues.length > 0);
  }

  private ask(): void {
    window.postMessage(
      { source: TIKTOK_REQUEST_SOURCE, type: 'items' } satisfies TikTokRequestMessage,
      location.origin,
    );
  }

  private item(id: string): Promise<TikTokItem | null> {
    const known = this.items.get(id);
    if (known) return Promise.resolve(known);
    this.ask();
    return new Promise((resolve) => {
      const waiter = () => {
        const item = this.items.get(id);
        if (item) done(item);
      };
      const done = (item: TikTokItem | null) => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve(item);
      };
      const timer = setTimeout(() => done(this.items.get(id) ?? null), ITEM_WAIT_MS);
      this.waiters.add(waiter);
    });
  }

  /** A file, read once (a failed one is tried again next time). Signed addresses: no cookies needed. */
  private load(url: string): Promise<Cue[]> {
    const known = this.loads.get(url);
    if (known) return known;
    const load = fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      .then(async (response) => {
        if (!response.ok) return [];
        const text = await response.text();
        return text.length > MAX_BYTES ? [] : parseSubtitleFile(text);
      })
      .catch(() => [] as Cue[]);
    this.loads.set(url, load);
    void load.then((cues) => {
      if (cues.length === 0) this.loads.delete(url);
    });
    return load;
  }

  private readonly onMessage = (event: MessageEvent) => {
    const message = event.data as TikTokMainMessage | undefined;
    if (event.source !== window || message?.source !== TIKTOK_MAIN_SOURCE) return;
    this.heard = true;
    if (message.type !== 'items' || !Array.isArray(message.items)) return;
    for (const item of message.items) {
      if (typeof item?.id !== 'string' || !Array.isArray(item.captions)) continue;
      this.items.delete(item.id);
      this.items.set(item.id, item);
    }
    for (const old of this.items.keys()) {
      if (this.items.size <= KEEP) break;
      this.items.delete(old);
    }
    this.waiters.forEach((waiter) => waiter());
  };
}

declare global {
  interface Window {
    __doubleSubTikTokSource?: TikTokSource;
  }
}

/** The one source of the page (the agent's isolated world). */
export function tikTokSource(): TikTokSource {
  window.__doubleSubTikTokSource ??= new TikTokSource().start();
  return window.__doubleSubTikTokSource;
}
