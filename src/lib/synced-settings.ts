import { DEFAULT_PAIR, normalizePair } from './languages';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  pairOf,
  updateSettings,
  type Settings,
} from './settings';
import { loadPalette, normalizePalette, savePalette } from './palettes';
import { loadTheme, normalizeTheme, saveTheme, type Theme } from './theme';
import {
  chooseUiLanguage,
  DEFAULT_UI_LANGUAGE,
  savedUiLanguage,
  UI_LANGUAGES,
} from './ui-language';

/**
 * The settings that follow the account, one thing each on the server, so that a font changed in one
 * browser and a colour in another both stay. The two subtitle languages are one thing: only together
 * are they a pair.
 *
 * Staying in the browser: `enabled`, which is "not now, here", and the voices, which are the ones of
 * the system this browser runs on.
 */
const FIELDS = [
  'fontSize',
  'bottomOffset',
  'hoverTranslate',
  'pauseOnHover',
  'speakWords',
  'offsetX',
  'translationSize',
  'barWidth',
  'barOpacity',
  'colorEn',
  'colorRu',
  'fontFamily',
  'fontWeight',
  'textEffect',
  'glassBlur',
  'glassRadius',
  'glassTint',
  'keepHistory',
] as const satisfies ReadonlyArray<keyof Settings>;

const LANGUAGES = 'languages';
const THEME = 'theme';
const PALETTE = 'palette';
const UI_LANGUAGE = 'uiLanguage';

export interface SyncedSetting {
  name: string;
  value: unknown;
}

export async function loadSyncedSettings(): Promise<SyncedSetting[]> {
  const settings = await loadSettings();
  const language = await savedUiLanguage();
  const theme = await loadTheme();
  const palette = await loadPalette();
  return [
    ...FIELDS.map((name) => ({ name, value: settings[name] })),
    { name: LANGUAGES, value: pairOf(settings) },
    ...(theme ? [{ name: THEME, value: theme }] : []),
    ...(palette ? [{ name: PALETTE, value: palette }] : []),
    ...(language ? [{ name: UI_LANGUAGE, value: language }] : []),
  ];
}

const DEFAULTS: Record<string, unknown> = {
  ...DEFAULT_SETTINGS,
  [LANGUAGES]: DEFAULT_PAIR,
  [UI_LANGUAGE]: DEFAULT_UI_LANGUAGE,
};

/**
 * When a setting the server may not know was last touched. Nobody can say when a browser got its
 * values, so they are older than anything changed since. Among them a default is nobody's choice and
 * gives way to any other value, whichever browser comes first. "Keep no history" is always a choice,
 * and a first sign-in must not switch the recording on behind the user's back.
 */
export function settingTime(setting: SyncedSetting): number {
  if (setting.name === 'keepHistory' && setting.value === false) return Date.now();
  return JSON.stringify(setting.value) === JSON.stringify(DEFAULTS[setting.name]) ? 0 : 1;
}

function isValid(name: string, value: unknown): boolean {
  if (name === THEME) return normalizeTheme(value) !== null;
  if (name === PALETTE) return normalizePalette(value) !== null;
  if (name === UI_LANGUAGE) return (UI_LANGUAGES as readonly unknown[]).includes(value);
  if (name === LANGUAGES) {
    const { learn, native } = (value ?? {}) as Record<string, unknown>;
    const pair = normalizePair(learn, native);
    return pair.learn === learn && pair.native === native;
  }
  return (
    (FIELDS as readonly string[]).includes(name) &&
    normalizeSettings({ [name]: value })[name as keyof Settings] === value
  );
}

/** A setting from the server; null for what this version does not know, such as a font added later. */
export function parseSyncedSetting(data: unknown): SyncedSetting | null {
  const { name, value } = (data ?? {}) as Partial<SyncedSetting>;
  return typeof name === 'string' && isValid(name, value) ? { name, value } : null;
}

export async function saveSyncedSettings(list: SyncedSetting[]): Promise<void> {
  const rows = new Map(list.map(({ name, value }) => [name, value]));
  const patch: Record<string, unknown> = {};
  for (const name of FIELDS) if (rows.has(name)) patch[name] = rows.get(name);
  const pair = rows.get(LANGUAGES) as { learn: string; native: string } | undefined;
  if (pair) Object.assign(patch, { learnLang: pair.learn, nativeLang: pair.native });
  await updateSettings(patch as Partial<Settings>);

  const theme = rows.get(THEME) as Theme | undefined;
  if (theme && theme !== (await loadTheme())) await saveTheme(theme);
  const palette = rows.get(PALETTE) as string | undefined;
  if (palette && palette !== (await loadPalette())) await savePalette(palette);
  // Last: its file is read from the package, and the rest must not wait for it.
  const language = rows.get(UI_LANGUAGE) as string | undefined;
  if (language !== undefined && language !== (await savedUiLanguage()))
    await chooseUiLanguage(language);
}
