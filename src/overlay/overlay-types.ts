import type { Settings } from '../lib/settings';
import type { SubtitleLines } from '../lib/types';
import type { WordTools } from './words-ui';

export interface OverlayOptions {
  /** CSS selector of the site's own subtitle elements to hide while the overlay is on (YouTube). */
  hideSelector?: string;
  /** Makes the words hoverable (translation, saving); without it the lines are plain text. */
  words?: WordTools;
  /** wordKey()s of the words that are saved already. */
  savedKeys?: Set<string>;
  /** The user changed something in the bar (size, position, voice): the owner stores it. */
  onSettingsChange?: (patch: Partial<Settings>) => void;
}

export interface Overlay {
  setLines(lines: SubtitleLines): void;
  setSettings(settings: Settings): void;
  /** Underlines the saved words (their wordKey()s). */
  setSaved(keys: Set<string>): void;
  stop(): void;
}
