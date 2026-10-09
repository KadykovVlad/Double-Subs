import type { TranslationRequest } from './translation-messages';

export type Direction = 'en-ru' | 'ru-en';

/** Extension page → offscreen document. Other contexts ignore messages with this target. */
export type OffscreenRequest =
  | { target: 'offscreen'; type: 'probe' }
  | { target: 'offscreen'; type: 'benchmark'; texts: string[]; direction: Direction }
  | { target: 'offscreen'; type: 'translation'; request: TranslationRequest; e2eMode?: string };

/** Message the extension iframe posts to the page frame that created it. */
export const TRANSLATOR_FRAME_SOURCE = 'double-sub-translator-frame';
