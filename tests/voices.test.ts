import { describe, expect, it } from 'vitest';
import {
  chooseVoice,
  moreVoicesHint,
  RANDOM_VOICE,
  voiceOptions,
  type VoiceInfo,
} from '../src/lib/voices';

const voices: VoiceInfo[] = [
  { voiceName: 'Google US English', lang: 'en-US', remote: true },
  { voiceName: 'Samantha', lang: 'en-US', remote: false },
  { voiceName: 'Alex', lang: 'en-US' },
  { voiceName: 'Daniel', lang: 'en-GB' },
  { voiceName: 'Karen', lang: 'en-AU' },
  { voiceName: 'Samantha', lang: 'en-US' }, // listed twice
  { voiceName: 'Milena', lang: 'ru-RU' },
  { voiceName: 'Google русский', lang: 'ru-RU', remote: true },
  { voiceName: 'Thomas', lang: 'fr-FR' },
  { lang: 'en-US' },
];

describe('voiceOptions', () => {
  it('keeps the voices of the language, once each, built-in first, then by accent and name', () => {
    expect(
      voiceOptions(voices, 'en').map(
        (v) => `${v.name}/${v.accent}/${v.remote ? 'online' : 'local'}`,
      ),
    ).toEqual([
      'Karen/Австралия/local',
      'Daniel/Великобритания/local',
      'Alex/США/local',
      'Samantha/США/local',
      'Google US English/США/online',
    ]);
    expect(voiceOptions(voices, 'ru').map((v) => v.name)).toEqual(['Milena', 'Google русский']);
  });
  it('is empty when the system has none', () => {
    expect(voiceOptions([], 'en')).toEqual([]);
  });
});

describe('voices of any language', () => {
  const system: VoiceInfo[] = [
    { voiceName: 'Yuna', lang: 'ko-KR' },
    { voiceName: 'Google 한국의', lang: 'ko-KR', remote: true },
    { voiceName: 'Nora', lang: 'nb-NO' },
    { voiceName: 'Carmit', lang: 'iw-IL' },
    { voiceName: 'Ting-Ting', lang: 'zh_CN' },
    { voiceName: 'Samantha', lang: 'en-US' },
  ];

  it('finds a voice by its language whatever the region or the old code', () => {
    expect(voiceOptions(system, 'ko').map((v) => v.name)).toEqual(['Yuna', 'Google 한국의']);
    expect(voiceOptions(system, 'no').map((v) => v.name)).toEqual(['Nora']); // the system says nb
    expect(voiceOptions(system, 'he').map((v) => v.name)).toEqual(['Carmit']); // the system says iw
    expect(voiceOptions(system, 'zh').map((v) => v.name)).toEqual(['Ting-Ting']);
    expect(voiceOptions(system, 'de')).toEqual([]);
  });

  it('names the accent of any voice by its country', () => {
    const [yuna] = voiceOptions(system, 'ko');
    expect(yuna!.accent).toMatch(/Korea|Корея/);
  });
});

describe('chooseVoice', () => {
  it('uses the saved voice as it is, even an online one', () => {
    expect(chooseVoice('Google US English', voices, 'en')).toBe('Google US English');
  });
  it('nothing saved: the first built-in voice, never an online one by itself', () => {
    expect(chooseVoice('', voices, 'en')).toBe('Karen');
    expect(chooseVoice('', [voices[0]!], 'en')).toBeUndefined();
  });
  it('"random": a built-in voice, and over many words more than one of them', () => {
    const local = new Set(
      voiceOptions(voices, 'en')
        .filter((v) => !v.remote)
        .map((v) => v.name),
    );
    const used = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const name = chooseVoice(RANDOM_VOICE, voices, 'en')!;
      expect(local.has(name)).toBe(true);
      used.add(name);
    }
    expect(used.size).toBeGreaterThan(2);
  });
  it('"random" with a fixed random source picks by position', () => {
    expect(chooseVoice(RANDOM_VOICE, voices, 'en', () => 0)).toBe('Karen');
    expect(chooseVoice(RANDOM_VOICE, voices, 'en', () => 0.99)).toBe('Samantha');
    expect(chooseVoice(RANDOM_VOICE, [], 'en')).toBeUndefined();
  });
});

describe('moreVoicesHint', () => {
  it('tells where to add voices on this system', () => {
    expect(moreVoicesHint('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toContain(
      'Устный контент',
    );
    expect(moreVoicesHint('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toContain('Речь');
    expect(moreVoicesHint('X11; Linux')).toContain('настройках речи');
  });
});
