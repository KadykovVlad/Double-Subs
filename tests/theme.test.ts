import { describe, expect, it } from 'vitest';
import { nextTheme, normalizeTheme } from '../src/lib/theme';

describe('the theme of the panel', () => {
  it('goes round: system, light, dark, system', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });

  it('anything unknown is the system theme', () => {
    for (const value of [undefined, null, 'blue', 7, {}])
      expect(normalizeTheme(value)).toBe('system');
    expect(normalizeTheme('dark')).toBe('dark');
  });
});
