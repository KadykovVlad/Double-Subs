import type { Inspection } from '../lib/types';

/**
 * What the agent (injected by the popup) uses on YouTube instead of reading <track> elements.
 * The YouTube content script and the agent run in the same isolated world, so they share `window`.
 */
export interface YouTubeBridge {
  /** The video belongs to YouTube's main player (not a hover preview). */
  owns(video: HTMLVideoElement): boolean;
  /** Loads the English and Russian lines of the current video. */
  inspect(): Promise<Inspection>;
  /** Called when YouTube switches to another video without reloading the page. */
  onVideoChange(listener: () => void): () => void;
  /** Called when the player's token for the current video has arrived: lines that failed can be read now. */
  onSubtitlesReady(listener: () => void): () => void;
  /** YouTube's own subtitle display, hidden while our overlay is on. */
  nativeCaptionSelector: string;
}

declare global {
  interface Window {
    __doubleSubYouTube?: YouTubeBridge;
  }
}
