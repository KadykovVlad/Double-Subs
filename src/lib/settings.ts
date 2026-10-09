export interface Settings {
  /** Show the dual subtitles. */
  enabled: boolean;
  /** Font size of the learning line (EN), in px. */
  fontSize: number;
  /** Distance of the lines from the bottom of the video, in % of its height. */
  bottomOffset: number;
  /** Hover a word to see its translation; click to save it. */
  hoverTranslate: boolean;
  /** Pause the video while the pointer is on the subtitles (only if the video was playing). */
  pauseOnHover: boolean;
  /** Say a word aloud when the pointer rests on it. */
  speakWords: boolean;
  /** Shift of the subtitle bar from the centre, in % of the video width (the bar can be dragged). */
  offsetX: number;
  /** Font size of the native-language line (RU), in px. */
  translationSize: number;
  /** Width of the bar, in % of the video width. */
  barWidth: number;
  /** How opaque the glass is (0.2 = almost clear, 1 = solid). */
  barOpacity: number;
  /** Names of the system voices for English and Russian words; '' = the system's choice. */
  voiceEn: string;
  voiceRu: string;
  /** Text colours of the learning line (EN) and the native-language line (RU), '#rrggbb'. */
  colorEn: string;
  colorRu: string;
  /** Typeface of the lines, key of FONT_FAMILIES. */
  fontFamily: FontFamily;
  /** Weight of the learning line. */
  fontWeight: number;
  /** How the letters are set off from the picture, key of TEXT_EFFECTS. */
  textEffect: TextEffect;
  /** Blur behind the glass, in px. */
  glassBlur: number;
  /** Roundness of the bar corners, in % of the pill shape. */
  glassRadius: number;
  /** Colour of the glass, '#rrggbb'. */
  glassTint: string;
  /** Keep the list of watched videos (in the browser only). */
  keepHistory: boolean;
}

export const FONT_FAMILIES = {
  system: {
    label: 'font_system',
    css: "ui-sans-serif, system-ui, -apple-system, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif",
  },
  rounded: {
    label: 'font_rounded',
    css: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', system-ui, sans-serif",
  },
  serif: { label: 'font_serif', css: "'New York', Georgia, 'Times New Roman', serif" },
  mono: { label: 'font_mono', css: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
  condensed: {
    label: 'font_condensed',
    css: "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', sans-serif",
  },
} as const;
export type FontFamily = keyof typeof FONT_FAMILIES;

export const TEXT_EFFECTS = {
  shadow: { label: 'effect_shadow', css: '0 1px 8px rgba(0, 0, 0, 0.35)' },
  outline: {
    label: 'effect_outline',
    css: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000',
  },
  glow: { label: 'effect_glow', css: '0 0 6px currentColor, 0 0 16px currentColor' },
  none: { label: 'effect_none', css: 'none' },
} as const;
export type TextEffect = keyof typeof TEXT_EFFECTS;

export const FONT_WEIGHTS = [400, 500, 600, 700];

/** Colours to pick from at a glance; any other can be chosen with the colour field. */
export const TEXT_COLORS = ['#ffffff', '#fff3a0', '#9be7ff', '#a8f0b8', '#ffb3d1', '#ffc78a'];
export const GLASS_TINTS = ['#484850', '#1c1c22', '#3a4a66', '#4a3a66', '#3d5a47', '#6b3d3d'];

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  fontSize: 22,
  bottomOffset: 10,
  hoverTranslate: true,
  pauseOnHover: true,
  speakWords: true,
  offsetX: 0,
  translationSize: 18,
  barWidth: 70,
  barOpacity: 0.5,
  voiceEn: '',
  voiceRu: '',
  colorEn: '#ffffff',
  colorRu: '#e3e3e8',
  fontFamily: 'system',
  fontWeight: 600,
  textEffect: 'shadow',
  glassBlur: 28,
  glassRadius: 100,
  glassTint: '#484850',
  keepHistory: true,
};

export const FONT_SIZE = { min: 10, max: 80, step: 1 };
export const BOTTOM_OFFSET = { min: 0, max: 85, step: 2 };
export const TRANSLATION_SIZE = { min: 10, max: 80, step: 1 };
export const BAR_WIDTH = { min: 40, max: 100, step: 5 };
export const BAR_OPACITY = { min: 0.2, max: 1, step: 0.1 };
export const GLASS_BLUR = { min: 0, max: 40, step: 4 };
export const GLASS_RADIUS = { min: 0, max: 100, step: 10 };
export const OFFSET_X = { min: -45, max: 45, step: 5 };

/**
 * Opacity 100% is still frosted glass, not a solid plate: the picture keeps showing through.
 * The slider maps onto the real alpha 0.32 ... 0.8.
 */
export const glassAlpha = (opacity: number) => Math.round((0.2 + 0.6 * opacity) * 100) / 100;

const oneOf = <T extends string>(value: unknown, allowed: Record<T, unknown>, fallback: T): T =>
  typeof value === 'string' && value in allowed ? (value as T) : fallback;
const color = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

const clamp = (value: unknown, range: { min: number; max: number }, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(range.max, Math.max(range.min, value)) * 100) / 100
    : fallback;

/** Settings from storage may be missing, partial or from an older version. */
export function normalizeSettings(raw: unknown): Settings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof Settings, unknown>
  >;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SETTINGS.enabled,
    fontSize: clamp(value.fontSize, FONT_SIZE, DEFAULT_SETTINGS.fontSize),
    bottomOffset: clamp(value.bottomOffset, BOTTOM_OFFSET, DEFAULT_SETTINGS.bottomOffset),
    hoverTranslate:
      typeof value.hoverTranslate === 'boolean'
        ? value.hoverTranslate
        : DEFAULT_SETTINGS.hoverTranslate,
    pauseOnHover:
      typeof value.pauseOnHover === 'boolean' ? value.pauseOnHover : DEFAULT_SETTINGS.pauseOnHover,
    speakWords:
      typeof value.speakWords === 'boolean' ? value.speakWords : DEFAULT_SETTINGS.speakWords,
    offsetX: clamp(value.offsetX, OFFSET_X, DEFAULT_SETTINGS.offsetX),
    translationSize: clamp(
      value.translationSize,
      TRANSLATION_SIZE,
      DEFAULT_SETTINGS.translationSize,
    ),
    barWidth: clamp(value.barWidth, BAR_WIDTH, DEFAULT_SETTINGS.barWidth),
    barOpacity: clamp(value.barOpacity, BAR_OPACITY, DEFAULT_SETTINGS.barOpacity),
    voiceEn: typeof value.voiceEn === 'string' ? value.voiceEn : DEFAULT_SETTINGS.voiceEn,
    voiceRu: typeof value.voiceRu === 'string' ? value.voiceRu : DEFAULT_SETTINGS.voiceRu,
    colorEn: color(value.colorEn, DEFAULT_SETTINGS.colorEn),
    colorRu: color(value.colorRu, DEFAULT_SETTINGS.colorRu),
    fontFamily: oneOf(value.fontFamily, FONT_FAMILIES, DEFAULT_SETTINGS.fontFamily),
    fontWeight: FONT_WEIGHTS.includes(value.fontWeight as number)
      ? (value.fontWeight as number)
      : DEFAULT_SETTINGS.fontWeight,
    textEffect: oneOf(value.textEffect, TEXT_EFFECTS, DEFAULT_SETTINGS.textEffect),
    glassBlur: clamp(value.glassBlur, GLASS_BLUR, DEFAULT_SETTINGS.glassBlur),
    glassRadius: clamp(value.glassRadius, GLASS_RADIUS, DEFAULT_SETTINGS.glassRadius),
    glassTint: color(value.glassTint, DEFAULT_SETTINGS.glassTint),
    keepHistory:
      typeof value.keepHistory === 'boolean' ? value.keepHistory : DEFAULT_SETTINGS.keepHistory,
  };
}

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY);
  return normalizeSettings(stored[KEY]);
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

/** Calls `listener` whenever settings change in any frame or in the popup. */
export function watchSettings(listener: (settings: Settings) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && KEY in changes) listener(normalizeSettings(changes[KEY]!.newValue));
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
