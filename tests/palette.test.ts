import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The three colours of the panel and what they have to do for each other. */
const css = readFileSync('entrypoints/sidepanel/panel.css', 'utf8');

function pair(name: string): { light: string; dark: string } {
  const found = new RegExp(`--${name}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\);`).exec(css);
  if (!found) throw new Error(`--${name} is not a pair of colours`);
  return { light: found[1]!, dark: found[2]! };
}

function single(name: string): string {
  const found = new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(css);
  if (!found) throw new Error(`--${name} is not one colour`);
  return found[1]!;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

describe('the palette of the panel', () => {
  const ground = pair('ground');
  const ink = pair('ink');
  const accent = single('accent');

  it('the text reads easily on its ground in both themes', () => {
    expect(contrast(ink.dark, ground.dark)).toBeGreaterThanOrEqual(7);
    expect(contrast(ink.light, ground.light)).toBeGreaterThanOrEqual(7);
  });

  it('one accent is seen on both grounds, about equally', () => {
    const onDark = contrast(accent, ground.dark);
    const onLight = contrast(accent, ground.light);
    expect(onDark).toBeGreaterThanOrEqual(3);
    expect(onLight).toBeGreaterThanOrEqual(3);
    expect(Math.abs(onDark - onLight)).toBeLessThan(0.5);
  });

  it('text on the accent reads', () => {
    expect(contrast(single('on-accent'), accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('no gradient of the old purple is left, nor anything written past the tokens', () => {
    expect(css).not.toMatch(/6366f1|8b5cf6|99, 102, 241|139, 92, 246|--grad/);
    const palette = css.indexOf('--radius:');
    expect(css.slice(palette)).not.toMatch(/#(?!fff\b)[0-9a-f]{6}\b/);
  });
});
