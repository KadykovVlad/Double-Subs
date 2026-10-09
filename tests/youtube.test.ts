import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TimedtextTemplates } from '../src/youtube/TimedtextTemplates';
import {
  isPlayerTemplate,
  youtubeBlocked,
  buildTrackUrl,
  buildYouTubeReport,
  isTimedtextUrl,
  normalizeTracks,
  parseJson3,
  planTracks,
  type CaptionTrack,
} from '../src/lib/youtube';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'e2e/fixtures/timedtext', name), 'utf8');

const track = (
  languageCode: string,
  kind: 'asr' | null = null,
  isTranslatable = true,
): CaptionTrack => ({
  baseUrl: `https://www.youtube.com/api/timedtext?v=abc&lang=${languageCode}${kind ? '&kind=asr' : ''}&signature=s`,
  languageCode,
  kind,
  name: languageCode,
  isTranslatable,
});

describe('isTimedtextUrl', () => {
  it('matches absolute and relative timedtext URLs only', () => {
    expect(isTimedtextUrl('https://www.youtube.com/api/timedtext?v=1&lang=en')).toBe(true);
    expect(isTimedtextUrl('/api/timedtext?v=1')).toBe(true);
    expect(isTimedtextUrl('https://www.youtube.com/youtubei/v1/player')).toBe(false);
    expect(isTimedtextUrl('https://www.youtube.com/api/stats/watchtime?timedtext=1')).toBe(false);
  });
});

describe('parseJson3', () => {
  it('reads subtitles made by people: one event is one cue, line breaks kept', () => {
    expect(parseJson3(fixture('en.json'), { rolling: false })).toEqual([
      { start: 1, end: 3, text: 'Hello, Dexter.' },
      { start: 4, end: 6.5, text: 'Tonight is\nthe night.' },
      { start: 7, end: 9, text: "I'm not who you think I am." },
    ]);
  });

  it('assembles automatic subtitles from word segments and ends each cue at the next one', () => {
    expect(parseJson3(fixture('en-asr.json'), { rolling: true })).toEqual([
      { start: 1, end: 4, text: 'hello dexter' }, // would last until 6 s, but the next line starts at 4 s
      { start: 4, end: 7, text: 'tonight is the night' },
      { start: 7, end: 9, text: "i'm not who you think" },
    ]);
  });

  it('skips the window-definition events and the line-break append events', () => {
    const cues = parseJson3(fixture('en-asr.json'), { rolling: true });
    expect(cues.every((cue) => cue.text.trim().length > 0)).toBe(true);
    expect(cues).toHaveLength(3);
  });

  it('returns nothing for the empty body YouTube sends without a pot token', () => {
    expect(parseJson3('', { rolling: false })).toEqual([]);
    expect(parseJson3('{}', { rolling: false })).toEqual([]);
  });
});

describe('normalizeTracks', () => {
  it('reads names from simpleText or runs and drops broken entries', () => {
    expect(
      normalizeTracks([
        {
          baseUrl: 'u1',
          languageCode: 'en',
          kind: 'asr',
          name: { simpleText: 'English (auto-generated)' },
          isTranslatable: true,
        },
        { baseUrl: 'u2', languageCode: 'ru', name: { runs: [{ text: 'Рус' }, { text: 'ский' }] } },
        { languageCode: 'de' },
      ]),
    ).toEqual([
      {
        baseUrl: 'u1',
        languageCode: 'en',
        kind: 'asr',
        name: 'English (auto-generated)',
        isTranslatable: true,
      },
      { baseUrl: 'u2', languageCode: 'ru', kind: null, name: 'Русский', isTranslatable: false },
    ]);
  });
});

describe('planTracks', () => {
  it('uses English and Russian subtitles made by people when both exist', () => {
    const plan = planTracks([track('ru'), track('en')]);
    expect(plan.en).toMatchObject({ tlang: null, source: 'manual', track: { languageCode: 'en' } });
    expect(plan.ru).toMatchObject({ tlang: null, source: 'manual', track: { languageCode: 'ru' } });
  });

  it('prefers subtitles made by people over automatic ones, any English variant counts', () => {
    const plan = planTracks([track('en', 'asr'), track('en-GB')]);
    expect(plan.en).toMatchObject({ source: 'manual', track: { languageCode: 'en-GB' } });
  });

  it('only automatic English: Russian comes from YouTube translation of it', () => {
    const plan = planTracks([track('en', 'asr')]);
    expect(plan.en).toMatchObject({ source: 'auto', tlang: null });
    expect(plan.ru).toMatchObject({
      source: 'youtube-translation',
      tlang: 'ru',
      track: { kind: 'asr' },
    });
  });

  it('only Russian: English comes from YouTube translation of it', () => {
    const plan = planTracks([track('ru')]);
    expect(plan.en).toMatchObject({
      source: 'youtube-translation',
      tlang: 'en',
      track: { languageCode: 'ru' },
    });
    expect(plan.ru).toMatchObject({ source: 'manual' });
  });

  it('another language: both lines are YouTube translations of it', () => {
    const plan = planTracks([track('es')]);
    expect(plan.en).toMatchObject({ tlang: 'en', track: { languageCode: 'es' } });
    expect(plan.ru).toMatchObject({ tlang: 'ru', track: { languageCode: 'es' } });
  });

  it('cannot translate a track YouTube marks as not translatable', () => {
    const plan = planTracks([track('en', null, false)]);
    expect(plan.en).toMatchObject({ source: 'manual' });
    expect(plan.ru).toBeNull();
  });

  it('nothing to show without tracks', () => {
    expect(planTracks([])).toEqual({ en: null, ru: null });
  });
});

describe('buildTrackUrl', () => {
  const template =
    'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr&fmt=json3&pot=TOKEN&c=WEB&cver=2.0&tlang=de';

  it("keeps the track's own parameters and copies the client ones, including pot", () => {
    const url = new URL(
      buildTrackUrl(template, { track: track('ru'), tlang: null, source: 'manual' }),
    );
    expect(url.searchParams.get('lang')).toBe('ru');
    expect(url.searchParams.get('kind')).toBeNull(); // not copied from the template's asr track
    expect(url.searchParams.get('signature')).toBe('s');
    expect(url.searchParams.get('pot')).toBe('TOKEN');
    expect(url.searchParams.get('c')).toBe('WEB');
    expect(url.searchParams.get('fmt')).toBe('json3');
    expect(url.searchParams.get('tlang')).toBeNull(); // the template's tlang must not leak
  });

  it('refuses a track address outside YouTube, so the token never goes elsewhere', () => {
    const evil = { ...track('ru'), baseUrl: 'https://evil.example/api/timedtext?v=abc&lang=ru' };
    expect(() => buildTrackUrl(template, { track: evil, tlang: null, source: 'manual' })).toThrow();
    const lookalike = { ...track('ru'), baseUrl: 'https://notyoutube.com/api/timedtext?v=abc' };
    expect(() =>
      buildTrackUrl(template, { track: lookalike, tlang: null, source: 'manual' }),
    ).toThrow();
    const http = { ...track('ru'), baseUrl: 'http://www.youtube.com/api/timedtext?v=abc' };
    expect(() => buildTrackUrl(template, { track: http, tlang: null, source: 'manual' })).toThrow();
  });

  it('asks YouTube for a translation with tlang', () => {
    const url = new URL(
      buildTrackUrl(template, {
        track: track('en', 'asr'),
        tlang: 'ru',
        source: 'youtube-translation',
      }),
    );
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.get('kind')).toBe('asr');
    expect(url.searchParams.get('tlang')).toBe('ru');
  });
});

describe('buildYouTubeReport', () => {
  const cues = [{ start: 1, end: 2, text: 'x' }];
  const pick = (
    languageCode: string,
    source: 'manual' | 'auto' | 'youtube-translation',
    tlang: 'en' | 'ru' | null = null,
  ) => ({
    track: track(languageCode, source === 'auto' ? 'asr' : null),
    tlang,
    source,
  });

  it('case A when both lines loaded', () => {
    const report = buildYouTubeReport(
      { pick: pick('en', 'auto'), cues },
      { pick: pick('en', 'youtube-translation', 'ru'), cues },
    );
    expect(report.decision).toEqual({ case: 'A', en: 0, ru: 1, translateFrom: null });
    expect(report.tracks.map((t) => t.label)).toEqual([
      'en (автосубтитры)',
      'en (автоперевод YouTube → ru)',
    ]);
  });

  it('case B when the Russian request failed: our own translator takes over', () => {
    const report = buildYouTubeReport(
      { pick: pick('en', 'manual'), cues },
      { pick: pick('en', 'youtube-translation', 'ru'), cues: null },
    );
    expect(report.decision).toEqual({ case: 'B', en: 0, ru: null, translateFrom: 'en' });
    expect(report.tracks[1]!.status).toBe('error');
  });

  it('case C when nothing loaded', () => {
    expect(buildYouTubeReport({ pick: pick('en', 'manual'), cues: [] }, null).decision.case).toBe(
      'C',
    );
    expect(buildYouTubeReport(null, null).decision.case).toBe('C');
  });
});

describe('isPlayerTemplate', () => {
  it("takes only the player's own request: the one with the client parameters, token or not", () => {
    expect(
      isPlayerTemplate(
        'https://www.youtube.com/api/timedtext?v=x&lang=en&pot=abc&c=WEB&cver=2&fmt=json3',
      ),
    ).toBe(true);
    expect(isPlayerTemplate('https://www.youtube.com/api/timedtext?v=x&lang=en&c=WEB&cver=2')).toBe(
      true,
    ); // first request after a load
    expect(isPlayerTemplate('https://www.youtube.com/api/timedtext?v=x&lang=ar&fmt=json3')).toBe(
      false,
    ); // another extension
    expect(isPlayerTemplate('http://[bad')).toBe(false);
  });
});

describe('TimedtextTemplates', () => {
  const url = (extra: string) =>
    `https://www.youtube.com/api/timedtext?v=vid&lang=en&c=WEB&cver=2${extra}`;

  it('keeps the request with the token over a later one without it, and drops on request', () => {
    const templates = new TimedtextTemplates();
    expect(templates.offer(url(''))).toBe(true);
    expect(templates.offer(url('&pot=T'))).toBe(true);
    expect(templates.offer(url('&n=2'))).toBe(false);
    expect(templates.get('vid')).toBe(url('&pot=T'));
    templates.drop('vid');
    expect(templates.get('vid')).toBeNull();
  });

  it("ignores other extensions' requests and tells about the player's", () => {
    const templates = new TimedtextTemplates();
    const seen: string[] = [];
    templates.onTemplate((id) => seen.push(id));
    templates.offer('https://www.youtube.com/api/timedtext?v=vid&lang=ar&fmt=json3');
    templates.offer(url('&pot=T'));
    expect(seen).toEqual(['vid']);
  });
});

describe('youtubeBlocked', () => {
  const report = (statuses: Array<'loaded' | 'error' | 'empty'>, mode = 'youtube') => ({
    decision: {
      case: statuses.includes('loaded') ? ('B' as const) : ('C' as const),
      en: null,
      ru: null,
      translateFrom: null,
    },
    tracks: statuses.map((status) => ({
      label: '',
      language: 'en',
      kind: 'subtitles',
      mode,
      status,
      cueCount: 0,
      firstCue: null,
      lastCue: null,
      lang: 'en' as const,
      type: 'empty' as const,
      usableCueCount: 0,
    })),
  });

  it('YouTube has tracks but gave none: the user is told to switch other extensions off', () => {
    expect(youtubeBlocked(report(['error', 'empty']))).toBe(true);
  });

  it('not when a line came, when there are no tracks, or for other players', () => {
    expect(youtubeBlocked(report(['loaded', 'error']))).toBe(false);
    expect(youtubeBlocked(report([]))).toBe(false);
    expect(youtubeBlocked(report(['error'], 'hidden'))).toBe(false);
  });
});
