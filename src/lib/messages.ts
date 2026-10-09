import type { TranslationStatus } from './translation-messages';
import type { TranslatorProbe } from './translator';
import type { VideoReport } from './types';

export interface VideoInfo {
  /** Position in the agent's last scan; used to select this video later. */
  index: number;
  width: number;
  height: number;
  visible: boolean;
  trackCount: number;
}

export interface IframeInfo {
  url: string;
  origin: string;
  width: number;
  height: number;
  visible: boolean;
}

/** What the agent in one frame reports back to the popup. */
export interface FrameScan {
  url: string;
  origin: string;
  isTop: boolean;
  videos: VideoInfo[];
  iframes: IframeInfo[];
  /** Subtitle-looking URLs the page requested before we were injected (Performance API). */
  subtitleResources: string[];
  /** The video already chosen in this frame, if any. */
  selected: VideoReport | null;
  /** Machine translation of the missing line (case B) for the selected video. */
  translation: TranslationStatus | null;
}

/** Popup / background → agent. */
export type AgentRequest =
  | { type: 'scan' }
  | { type: 'select'; index: number }
  | { type: 'startPick' }
  | { type: 'stopPick' }
  | { type: 'probeTranslator' }
  | { type: 'retryTranslation' };

/** Where the Translator API works inside one page frame (stage 4 prototype). */
export interface FrameTranslatorProbe {
  frame: string;
  /** The agent itself (content script, isolated world). */
  contentScript: TranslatorProbe;
  /** An extension page embedded into this frame with allow="translator"; null if it never answered. */
  extensionFrame: TranslatorProbe | null;
}

/** Agent → extension: the user clicked a video in pick mode (background closes pick mode elsewhere). */
export interface PickedMessage {
  type: 'picked';
}

/** Agent → extension: the picked video's tracks are read (an open popup refreshes its status). */
export interface SelectedMessage {
  type: 'selected';
}

/** Probe → background: this frame is on a known site, start the agent in it. */
export interface StartAgentMessage {
  type: 'start-agent';
}
