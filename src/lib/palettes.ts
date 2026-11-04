import type { MessageKey } from './i18n';

/** The colours of a theme in one of its modes: all the others are mixed from these (panel.css). */
export interface PaletteColors {
  ground: string;
  ink: string;
  accent: string;
  onAccent: string;
}

export interface Palette {
  id: string;
  name: MessageKey;
  light: PaletteColors;
  dark: PaletteColors;
}

/**
 * The colour themes the user picks from, soft tones of one hue each. The accent is deeper in the light
 * mode and lighter in the dark one; tests/palette.test.ts holds every colour here to its contrast.
 * The first is the default, and panel.css starts with it.
 */
export const PALETTES: readonly Palette[] = [
  {
    id: 'ocean',
    name: 'palette_ocean',
    light: { ground: '#eff5fc', ink: '#172839', accent: '#3574b0', onAccent: '#ffffff' },
    dark: { ground: '#14222f', ink: '#e3eaf3', accent: '#82b6ec', onAccent: '#0d1926' },
  },
  {
    id: 'olive',
    name: 'palette_olive',
    light: { ground: '#f2f6ee', ink: '#202a15', accent: '#597d2e', onAccent: '#ffffff' },
    dark: { ground: '#1b2413', ink: '#e6ece2', accent: '#9dbe7d', onAccent: '#141b0c' },
  },
  {
    id: 'lavender',
    name: 'palette_lavender',
    light: { ground: '#f6f3fb', ink: '#2b2136', accent: '#805da5', onAccent: '#ffffff' },
    dark: { ground: '#241d2d', ink: '#ebe7f1', accent: '#bfa2e2', onAccent: '#1b1523' },
  },
  {
    id: 'lagoon',
    name: 'palette_lagoon',
    light: { ground: '#ecf7f8', ink: '#082c30', accent: '#007f8a', onAccent: '#ffffff' },
    dark: { ground: '#0b2528', ink: '#dfecee', accent: '#5ec3ce', onAccent: '#051c1f' },
  },
  {
    id: 'mint',
    name: 'palette_mint',
    light: { ground: '#edf7f2', ink: '#112d21', accent: '#00855f', onAccent: '#ffffff' },
    dark: { ground: '#10251d', ink: '#e1ede7', accent: '#73c4a2', onAccent: '#091d15' },
  },
  {
    id: 'honey',
    name: 'palette_honey',
    light: { ground: '#f8f4ec', ink: '#2e2511', accent: '#896c17', onAccent: '#ffffff' },
    dark: { ground: '#262010', ink: '#ede9df', accent: '#c8ae71', onAccent: '#1d1809' },
  },
  {
    id: 'rose',
    name: 'palette_rose',
    light: { ground: '#fcf1f3', ink: '#371e24', accent: '#a65067', onAccent: '#ffffff' },
    dark: { ground: '#2d1a1e', ink: '#f2e6e8', accent: '#e598a9', onAccent: '#241216' },
  },
  {
    id: 'plum',
    name: 'palette_plum',
    light: { ground: '#faf2f8', ink: '#331f2e', accent: '#98548b', onAccent: '#ffffff' },
    dark: { ground: '#2a1b26', ink: '#f0e6ed', accent: '#d79ac9', onAccent: '#21131e' },
  },
  {
    id: 'periwinkle',
    name: 'palette_periwinkle',
    light: { ground: '#f2f4fd', ink: '#21253a', accent: '#5d69b2', onAccent: '#ffffff' },
    dark: { ground: '#1c1f30', ink: '#e6e9f3', accent: '#9fadee', onAccent: '#141726' },
  },
  {
    id: 'graphite',
    name: 'palette_graphite',
    light: { ground: '#f2f5f7', ink: '#22272c', accent: '#68717c', onAccent: '#ffffff' },
    dark: { ground: '#1e2124', ink: '#e7eaec', accent: '#aab2ba', onAccent: '#16191c' },
  },
];

const KEY = 'panelPalette';

/** The id of a palette, or null for anything else. */
export const normalizePalette = (value: unknown): string | null =>
  PALETTES.some((palette) => palette.id === value) ? (value as string) : null;

export async function loadPalette(): Promise<string | null> {
  try {
    return normalizePalette((await browser.storage.local.get(KEY))[KEY]);
  } catch {
    return null;
  }
}

export const savePalette = (id: string) => browser.storage.local.set({ [KEY]: id });

export function watchPalette(listener: (id: string | null) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && KEY in changes) listener(normalizePalette(changes[KEY]!.newValue));
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

/** Paints the page: one pair of colours for each token, the mode chooses between them. */
export function applyPalette(id: string | null): void {
  const { light, dark } = PALETTES.find((palette) => palette.id === id) ?? PALETTES[0]!;
  const { style } = document.documentElement;
  style.setProperty('--ground', `light-dark(${light.ground}, ${dark.ground})`);
  style.setProperty('--ink', `light-dark(${light.ink}, ${dark.ink})`);
  style.setProperty('--accent', `light-dark(${light.accent}, ${dark.accent})`);
  style.setProperty('--on-accent', `light-dark(${light.onAccent}, ${dark.onAccent})`);
}
