/** The theme of the panel. The video overlay has its own glass and is not touched. */
export type Theme = 'light' | 'dark';

const KEY = 'panelTheme';

/** The theme chosen by hand; anything else, like the "as in the system" of older versions, is no choice. */
export const normalizeTheme = (value: unknown): Theme | null =>
  value === 'light' || value === 'dark' ? value : null;

export const nextTheme = (theme: Theme): Theme => (theme === 'light' ? 'dark' : 'light');

/** What a user who has not chosen sees. */
export const systemTheme = (): Theme =>
  matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

export async function loadTheme(): Promise<Theme | null> {
  try {
    return normalizeTheme((await browser.storage.local.get(KEY))[KEY]);
  } catch {
    return null;
  }
}

export const saveTheme = (theme: Theme) => browser.storage.local.set({ [KEY]: theme });

export function watchTheme(listener: (theme: Theme | null) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && KEY in changes) listener(normalizeTheme(changes[KEY]!.newValue));
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

/** Tells the page (CSS reads `data-theme`; with no choice the browser decides). */
export function applyTheme(theme: Theme | null): void {
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
}

/**
 * Changes the theme in a circle that grows from `origin`, the accent running along its edge. Without
 * the browser's support, or for a user who asked for less motion, the theme just changes.
 */
export function revealTheme(origin: HTMLElement, change: () => void): void {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    change();
    return;
  }
  const box = origin.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const root = document.documentElement;
  root.style.setProperty('--reveal-x', `${x}px`);
  root.style.setProperty('--reveal-y', `${y}px`);
  root.style.setProperty(
    '--reveal-r',
    `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`,
  );
  const ring = document.createElement('div');
  ring.className = 'theme-ring';
  document.body.append(ring);
  void document.startViewTransition(change).finished.finally(() => ring.remove());
}
