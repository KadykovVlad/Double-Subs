import type { LanguagePair } from '../lib/languages';
import type { Inspection } from '../lib/types';

/**
 * What the agent (injected by the popup) uses on YouTube instead of reading <track> elements.
 * The YouTube content script and the agent run in the same isolated world, so they share `window`.
 */
export interface YouTubeBridge {
  /** The video belongs to YouTube's main player or to the Shorts one (not a hover preview). */
  owns(video: HTMLVideoElement): boolean;
  /**
   * The video is the one of the player on screen. The watch player stays in the page, hidden, while
   * Shorts play in their own (and the other way round): a session left on the hidden one moves.
   */
  playsHere(video: HTMLVideoElement): boolean;
  /** A Short: tall video with YouTube's own buttons at its top. */
  isShort(video: HTMLVideoElement): boolean;
  /** The element of the page that moves with this video (the player, the reel of a Short): overlays live in it. */
  overlayParent(video: HTMLVideoElement): HTMLElement | null;
  /** Loads the two lines of the current video, in the languages of `pair`. */
  inspect(pair: LanguagePair): Promise<Inspection>;
  /** Called when YouTube switches to another video without reloading the page. */
  onVideoChange(listener: () => void): () => void;
  /** Called when the player's token for the current video has arrived: lines that failed can be read now. */
  onSubtitlesReady(listener: () => void): () => void;
  /** YouTube's own subtitle display, hidden while our overlay is on. */
  nativeCaptionSelector: string;
  /** Hides YouTube's own captions and its CC button (CC keeps working), or shows them back. */
  hideNative(hide: boolean): void;
  /** Our subtitles are on (CC is turned on for them) or off (CC is not touched). */
  setOursOn(on: boolean): void;
}

declare global {
  interface Window {
    __doubleSubYouTube?: YouTubeBridge;
  }
}
