import {
  BAR_OPACITY,
  BAR_WIDTH,
  DEFAULT_SETTINGS,
  FONT_SIZE,
  GLASS_BLUR,
  GLASS_RADIUS,
  TRANSLATION_SIZE,
} from '../lib/settings';
import { t, type MessageKey } from '../lib/i18n';

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** The numbers the settings panel steps with "−" and "+". */
export type StepKey =
  'fontSize' | 'translationSize' | 'barWidth' | 'barOpacity' | 'glassBlur' | 'glassRadius';

export const STEPS: Record<StepKey, { min: number; max: number; step: number }> = {
  fontSize: FONT_SIZE,
  translationSize: TRANSLATION_SIZE,
  barWidth: BAR_WIDTH,
  barOpacity: BAR_OPACITY,
  glassBlur: GLASS_BLUR,
  glassRadius: GLASS_RADIUS,
};

const px = (v: number) => `${Math.round(v)} px`;
const percent = (v: number) => `${Math.round(v * 100)}%`;

export const FORMAT: Record<StepKey, (v: number) => string> = {
  fontSize: px,
  translationSize: px,
  barWidth: (v) => `${Math.round(v)}%`,
  barOpacity: percent,
  glassBlur: px,
  glassRadius: (v) => `${Math.round(v)}%`,
};

const WEIGHT_KEYS: Record<number, MessageKey> = {
  400: 'weight_400',
  500: 'weight_500',
  600: 'weight_600',
  700: 'weight_700',
};
export const weightLabel = (weight: number) =>
  WEIGHT_KEYS[weight] ? t(WEIGHT_KEYS[weight]!) : String(weight);

/** What "Reset styles" puts back. */
export const STYLE_DEFAULTS = {
  colorEn: DEFAULT_SETTINGS.colorEn,
  colorRu: DEFAULT_SETTINGS.colorRu,
  fontFamily: DEFAULT_SETTINGS.fontFamily,
  fontWeight: DEFAULT_SETTINGS.fontWeight,
  textEffect: DEFAULT_SETTINGS.textEffect,
  glassBlur: DEFAULT_SETTINGS.glassBlur,
  glassRadius: DEFAULT_SETTINGS.glassRadius,
  glassTint: DEFAULT_SETTINGS.glassTint,
};
