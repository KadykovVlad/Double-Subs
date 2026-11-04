import { describe, expect, it } from 'vitest';
import { nextTheme, normalizeTheme } from '../src/lib/theme';

describe('the theme of the panel', () => {
  it('goes between two: light and dark', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });

  it('only a theme chosen by hand counts, "system" of older versions is none', () => {
    for (const value of [undefined, null, 'blue', 'system', 7, {}])
      expect(normalizeTheme(value)).toBeNull();
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('light')).toBe('light');
  });
});
