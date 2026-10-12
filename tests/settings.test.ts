import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  glassAlpha,
  normalizeSettings,
  voiceFor,
  voicePatch,
} from '../src/lib/settings';

describe('glassAlpha', () => {
  it('never reaches a solid plate', () => {
    expect(glassAlpha(1)).toBeLessThan(0.9);
    expect(glassAlpha(0.2)).toBeGreaterThan(0.2);
    expect(glassAlpha(0.5)).toBe(0.5);
  });
});

describe('style settings', () => {
  it('accepts valid colours, fonts and effects and rejects the rest', () => {
    expect(
      normalizeSettings({
        colorEn: '#FFF3A0',
        fontFamily: 'serif',
        textEffect: 'glow',
        fontWeight: 700,
        glassBlur: 12,
        glassTint: '#1c1c22',
      }),
    ).toMatchObject({
      colorEn: '#fff3a0',
      fontFamily: 'serif',
      textEffect: 'glow',
      fontWeight: 700,
      glassBlur: 12,
      glassTint: '#1c1c22',
    });
    expect(
      normalizeSettings({
        colorEn: 'red',
        fontFamily: 'comic',
        textEffect: 'x',
        fontWeight: 550,
        glassBlur: 999,
        glassTint: 5,
      }),
    ).toMatchObject({
      colorEn: '#ffffff',
      fontFamily: 'system',
      textEffect: 'shadow',
      fontWeight: 600,
      glassBlur: 40,
      glassTint: '#484850',
    });
  });
});

describe('normalizeSettings', () => {
  it('falls back to defaults for missing or broken values', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ fontSize: 'big', enabled: 'yes', bottomOffset: NaN })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('keeps valid values and clamps out-of-range ones', () => {
    expect(
      normalizeSettings({
        enabled: false,
        fontSize: 26,
        bottomOffset: 20,
        hoverTranslate: false,
        pauseOnHover: false,
        speakWords: false,
        offsetX: -10,
        translationSize: 20,
        barWidth: 55,
        barOpacity: 0.8,
        voiceEn: 'Samantha',
        voiceRu: 'Milena',
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      enabled: false,
      fontSize: 26,
      bottomOffset: 20,
      hoverTranslate: false,
      pauseOnHover: false,
      speakWords: false,
      offsetX: -10,
      translationSize: 20,
      barWidth: 55,
      barOpacity: 0.8,
      voiceEn: 'Samantha',
      voiceRu: 'Milena',
    });
    expect(
      normalizeSettings({ translationSize: 900, barWidth: 5, barOpacity: 0, voiceEn: 7 }),
    ).toMatchObject({
      translationSize: 80,
      barWidth: 40,
      barOpacity: 0.2,
      voiceEn: '',
    });
    expect(normalizeSettings({ fontSize: 3, bottomOffset: -5, offsetX: 200 })).toMatchObject({
      fontSize: 10,
      bottomOffset: 0,
      offsetX: 45,
    });
    expect(normalizeSettings({ bottomOffset: 500 }).bottomOffset).toBe(85);
  });

  it('rounds away floating point noise', () => {
    expect(normalizeSettings({ fontSize: 0.1 + 0.2 + 20.7 }).fontSize).toBe(21);
  });
});

describe('the voice of any language', () => {
  it('English and Russian keep their own fields, the others are kept by language code', () => {
    const base = normalizeSettings({});
    expect(voiceFor(base, 'ko')).toBe('');
    const next = normalizeSettings({ ...base, ...voicePatch(base, 'ko', 'Yuna') });
    expect(voiceFor(next, 'ko')).toBe('Yuna');
    expect(voicePatch(base, 'en', 'Daniel')).toEqual({ voiceEn: 'Daniel' });
    expect(voicePatch(base, 'ru', 'Milena')).toEqual({ voiceRu: 'Milena' });
    // A second language does not wipe the first.
    const both = normalizeSettings({ ...next, ...voicePatch(next, 'de', 'Anna') });
    expect(both.voicesOther).toEqual({ ko: 'Yuna', de: 'Anna' });
  });

  it('refuses unknown languages and non-text names from storage', () => {
    expect(
      normalizeSettings({ voicesOther: { ko: 'Yuna', xx: 'A', de: 7, fr: 'x'.repeat(500) } })
        .voicesOther,
    ).toEqual({ ko: 'Yuna' });
    expect(normalizeSettings({ voicesOther: 'oops' }).voicesOther).toEqual({});
  });
});
