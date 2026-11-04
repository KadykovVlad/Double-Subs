import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePalette, PALETTES } from '../src/lib/palettes';

/** Every colour theme and what its colours have to do for each other. */
const css = readFileSync('entrypoints/sidepanel/panel.css', 'utf8');

const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16) / 255;
const toLinear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const fromLinear = (value: number) => {
  const clipped = Math.min(1, Math.max(0, value));
  return clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
};
type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [channel(hex, 1), channel(hex, 3), channel(hex, 5)];

function contrast(a: Rgb, b: Rgb): number {
  const luminance = (color: Rgb) => {
    const [r, g, c] = color.map(toLinear) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * c;
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

/** `color-mix(in oklab, a share, b)`, as the panel mixes its small accent text. */
function mix(a: Rgb, b: Rgb, share: number): Rgb {
  const toLab = (color: Rgb): Rgb => {
    const [r, g, c] = color.map(toLinear) as Rgb;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * c);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * c);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * c);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const x = toLab(a);
  const y = toLab(b);
  const [L, A, B] = x.map((value, index) => value * share + y[index]! * (1 - share)) as Rgb;
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLinear) as Rgb;
}

describe('the colour themes', () => {
  it('there are ten, each under its own name', () => {
    expect(PALETTES).toHaveLength(10);
    expect(new Set(PALETTES.map((palette) => palette.id)).size).toBe(10);
    expect(new Set(PALETTES.map((palette) => palette.name)).size).toBe(10);
  });

  for (const palette of PALETTES)
    for (const mode of ['light', 'dark'] as const)
      it(`${palette.id}, ${mode}: everything reads`, () => {
        const { ground, ink, accent, onAccent } = palette[mode];
        expect(contrast(rgb(ink), rgb(ground))).toBeGreaterThanOrEqual(7);
        expect(contrast(rgb(accent), rgb(ground))).toBeGreaterThanOrEqual(3);
        expect(contrast(rgb(onAccent), rgb(accent))).toBeGreaterThanOrEqual(4.5);
        const accentText = mix(rgb(accent), rgb(ink), 0.7);
        expect(contrast(accentText, rgb(ground))).toBeGreaterThanOrEqual(4.5);
      });

  it('the tones are soft: no ground is a loud colour', () => {
    const chroma = ([r, g, b]: Rgb) => Math.max(r, g, b) - Math.min(r, g, b);
    for (const { light, dark } of PALETTES) {
      expect(chroma(rgb(light.ground))).toBeLessThan(0.06);
      expect(chroma(rgb(dark.ground))).toBeLessThan(0.12);
    }
  });

  it('the panel starts with the first of them, so nothing changes when it is painted', () => {
    const { light, dark } = PALETTES[0]!;
    expect(css).toContain(`--ground: light-dark(${light.ground}, ${dark.ground});`);
    expect(css).toContain(`--ink: light-dark(${light.ink}, ${dark.ink});`);
    expect(css).toContain(`--accent: light-dark(${light.accent}, ${dark.accent});`);
    expect(css).toContain(`--on-accent: light-dark(${light.onAccent}, ${dark.onAccent});`);
  });

  it('only a theme of the list counts', () => {
    expect(normalizePalette('plum')).toBe('plum');
    for (const value of [undefined, null, 'orange', 7]) expect(normalizePalette(value)).toBeNull();
  });

  it('what is painted with the accent takes its text colour, which differs by theme and mode', () => {
    for (const rule of css.match(/\{[^{}]*\}/g) ?? [])
      if (rule.includes('background: var(--accent);')) expect(rule).not.toContain('color: #fff');
  });

  it('nothing of the old colours is left, nor anything written past the tokens', () => {
    expect(css).not.toMatch(/6366f1|8b5cf6|99, 102, 241|139, 92, 246|--grad|d14426/);
    expect(css.slice(css.indexOf('--radius:'))).not.toMatch(/#(?!fff\b)[0-9a-f]{6}\b/);
  });
});
