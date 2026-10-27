/** The theme of the panel: the system's own, or one chosen by hand. The video overlay has its own glass and is not touched. */
export type Theme = 'system' | 'light' | 'dark';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
export const DEFAULT_THEME: Theme = 'system';

const KEY = 'panelTheme';

export const normalizeTheme = (value: unknown): Theme =>
  THEMES.includes(value as Theme) ? (value as Theme) : DEFAULT_THEME;

/** The next one in the row system → light → dark → system (what the button in the header does). */
export const nextTheme = (theme: Theme): Theme =>
  THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;

export async function loadTheme(): Promise<Theme> {
  try {
    return normalizeTheme((await browser.storage.local.get(KEY))[KEY]);
  } catch {
    return DEFAULT_THEME;
  }
}

export const saveTheme = (theme: Theme) => browser.storage.local.set({ [KEY]: theme });

export function watchTheme(listener: (theme: Theme) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && KEY in changes) listener(normalizeTheme(changes[KEY]!.newValue));
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

/** Tells the page (CSS reads `data-theme`; "system" leaves the decision to the browser). */
export function applyTheme(theme: Theme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}
