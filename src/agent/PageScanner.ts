import type { FrameScan, IframeInfo, VideoInfo } from '../lib/messages';
import { isSubtitleUrl, isVisibleBox, toOrigin } from '../lib/scan';
import { isSubtitleTrack } from '../lib/tracks';
import type { VideoReport } from '../lib/types';
import type { TranslationStatus } from '../lib/translation-messages';
import { findVideos } from '../lib/video-finder';

function boxOf(el: Element) {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
  };
}

export const isShown = (el: Element) => isVisibleBox(boxOf(el));

/** Looks at the page for the side panel: which videos are there, which iframes, what was requested. */
export class PageScanner {
  /** Videos of the last look: the panel selects one by its position here. */
  videos: HTMLVideoElement[] = [];

  /** Looks again and returns the videos found. */
  refresh(): HTMLVideoElement[] {
    this.videos = findVideos();
    return this.videos;
  }

  visibleVideos(): HTMLVideoElement[] {
    if (this.videos.length === 0) this.refresh();
    return this.videos.filter(isShown);
  }

  scan(selected: VideoReport | null, translation: TranslationStatus | null): FrameScan {
    this.refresh();
    return {
      url: location.href,
      origin: location.origin,
      isTop: window.top === window.self,
      videos: this.videos.map((video, index) => this.describeVideo(video, index)),
      iframes: this.describeIframes(),
      subtitleResources: this.subtitleResources(),
      selected,
      translation,
    };
  }

  private describeVideo(video: HTMLVideoElement, index: number): VideoInfo {
    const box = boxOf(video);
    return {
      index,
      width: box.width,
      height: box.height,
      visible: isVisibleBox(box),
      trackCount: Array.from(video.textTracks).filter(isSubtitleTrack).length,
    };
  }

  private describeIframes(): IframeInfo[] {
    const result: IframeInfo[] = [];
    for (const iframe of document.querySelectorAll('iframe')) {
      const origin = toOrigin(iframe.src);
      if (!origin) continue;
      const box = boxOf(iframe);
      result.push({
        url: iframe.src,
        origin,
        width: box.width,
        height: box.height,
        visible: isVisibleBox(box),
      });
    }
    return result;
  }

  /** Subtitle-looking URLs the page requested before we were injected (Performance API). */
  private subtitleResources(): string[] {
    return performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter(isSubtitleUrl)
      .slice(0, 20);
  }
}
