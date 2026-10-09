import type { Settings } from '../lib/settings';
import type { SubtitleLines } from '../lib/types';
import type { Overlay, OverlayOptions } from './overlay-types';
import { SubtitleOverlay } from './SubtitleOverlay';

export type { Overlay, OverlayOptions } from './overlay-types';

/** Puts the subtitle bar on `video` (see SubtitleOverlay). */
export function startOverlay(
  video: HTMLVideoElement,
  lines: SubtitleLines,
  settings: Settings,
  options: OverlayOptions = {},
): Overlay {
  return new SubtitleOverlay(video, lines, settings, options);
}
