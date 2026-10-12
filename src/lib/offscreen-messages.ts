import type { TranslationRequest } from './translation-messages';

/** "en-ru": from English into Russian. The codes are those of SUBTITLE_LANGUAGES (none has a hyphen). */
export type Direction = `${string}-${string}`;

/** Extension page → offscreen document. Other contexts ignore messages with this target. */
export type OffscreenRequest =
  | { target: 'offscreen'; type: 'probe' }
  | { target: 'offscreen'; type: 'benchmark'; texts: string[]; direction: Direction }
  | { target: 'offscreen'; type: 'translation'; request: TranslationRequest; e2eMode?: string };

/** Message the extension iframe posts to the page frame that created it. */
export const TRANSLATOR_FRAME_SOURCE = 'double-sub-translator-frame';
