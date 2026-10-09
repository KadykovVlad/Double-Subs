import { describe, expect, it } from 'vitest';
import {
  analyzeTracks,
  cleanCueText,
  detectLanguage,
  normalizeCues,
  type TrackInput,
} from '../src/lib/analysis';
import type { Cue } from '../src/lib/types';

// ------------------------------------------------------------ test data
// The labels below are copied from the real players (plan: stage 3). The dialogue is invented,
// but the proportions are real: an episode has hundreds of cues, a forced track a few dozen.

const EN_LINES = [
  "I don't know what you're talking about.",
  'We need to get out of here before they find us.',
  "That's not what I said, and you know it.",
  'Where have you been all night?',
  "It's been a long time since I was here.",
  'Tell me what you saw at the lake.',
  "I'm not going to ask you again.",
  'You can trust me, I just want to help.',
  'There is something wrong with this town.',
  'Do you have any idea what this is about?',
];

const RU_LINES = [
  'Я не понимаю, о чём ты говоришь.',
  'Нам нужно уйти отсюда, пока нас не нашли.',
  'Я не это сказал, и ты это знаешь.',
  'Где ты был всю ночь?',
  'Прошло много времени с тех пор, как я был здесь.',
  'Расскажи мне, что ты видел на озере.',
  'Я не буду спрашивать тебя снова.',
  'Ты можешь мне доверять, я просто хочу помочь.',
  'С этим городом что-то не так.',
  'Ты хоть представляешь, в чём тут дело?',
];

const ES_LINES = [
  'Buenos días, ¿cómo estás hoy?',
  'No sé qué quieres que haga con esto.',
  'Vamos a la casa de mi madre para comer.',
  'Ella dijo que no volvería hasta mañana.',
];

function makeCues(
  lines: string[],
  count: number,
  decorate: (text: string, i: number) => string = (text) => text,
): Cue[] {
  return Array.from({ length: count }, (_, i) => ({
    start: i * 3,
    end: i * 3 + 2.5,
    text: decorate(lines[i % lines.length]!, i),
  }));
}

/** Every 7th cue is a sound description: about 14%, like a real SDH track. */
const withSounds = (text: string, i: number) =>
  i % 7 === 0 ? `[tense music playing]\n${text}` : i % 11 === 0 ? `(door slams)` : text;

const EPISODE_CUES = 800;
const EPISODE_SEC = 2900;

/** The four tracks of the allplay player (player 1). */
function player1(): TrackInput[] {
  return [
    { label: '(Russian) forced', cues: makeCues(RU_LINES, 40) },
    { label: '(Russian) full', cues: makeCues(RU_LINES, EPISODE_CUES) },
    { label: '(English) full', cues: makeCues(EN_LINES, EPISODE_CUES) },
    // More cues than the full track once sound cues are added: the type must win over the count.
    { label: '(English) SDH', cues: makeCues(EN_LINES, 860, withSounds) },
  ];
}

// ------------------------------------------------------------ cleaning

describe('cleanCueText', () => {
  const keep = { stripSoundDescriptions: false };
  const strip = { stripSoundDescriptions: true };

  it('removes markup, ASS tags and WebVTT voice and timestamp tags', () => {
    expect(cleanCueText('<i>Hello</i> <b>there</b>', keep)).toBe('Hello there');
    expect(cleanCueText('{\\an8}Top line', keep)).toBe('Top line');
    expect(cleanCueText('<v Dexter>Hi</v>', keep)).toBe('Hi');
    expect(cleanCueText('One <00:00:01.500>two', keep)).toBe('One two');
    expect(cleanCueText('<font color="#ffff00">Yellow</font>', keep)).toBe('Yellow');
  });

  it('decodes entities after removing tags', () => {
    expect(cleanCueText('Tom &amp; Jerry', keep)).toBe('Tom & Jerry');
    expect(cleanCueText('&lt;i&gt;not a tag&lt;/i&gt;', keep)).toBe('<i>not a tag</i>');
    expect(cleanCueText('a&nbsp;b', keep)).toBe('a b');
  });

  it('keeps the line structure, trims lines and drops empty ones', () => {
    expect(cleanCueText('- Hi.\n  - Hello.  \n\n', keep)).toBe('- Hi.\n- Hello.');
  });

  it('removes music notes but keeps the lyrics', () => {
    expect(cleanCueText('♪ la la la ♪', keep)).toBe('la la la');
    expect(cleanCueText('♪♪', keep)).toBe('');
  });

  it('keeps bracketed text in regular tracks', () => {
    expect(cleanCueText('He (the doctor) said no', keep)).toBe('He (the doctor) said no');
  });

  it('strips sound descriptions and speaker labels in SDH mode', () => {
    expect(cleanCueText('[ominous music playing]', strip)).toBe('');
    expect(cleanCueText('(door slams)\nTonight is the night.', strip)).toBe(
      'Tonight is the night.',
    );
    expect(cleanCueText('[sighs] I know.', strip)).toBe('I know.');
    expect(cleanCueText('DEXTER: Hello.', strip)).toBe('Hello.');
    expect(cleanCueText('ДЕКСТЕР: Привет.', strip)).toBe('Привет.');
    expect(cleanCueText('Note: not a label', strip)).toBe('Note: not a label');
  });
});

describe('normalizeCues', () => {
  it('drops cues that become empty and sorts by start time', () => {
    const cues: Cue[] = [
      { start: 5, end: 6, text: 'Second' },
      { start: 1, end: 2, text: '[music]' },
      { start: 3, end: 4, text: 'First' },
    ];
    expect(normalizeCues(cues, { stripSoundDescriptions: true })).toEqual([
      { start: 3, end: 4, text: 'First' },
      { start: 5, end: 6, text: 'Second' },
    ]);
  });
});

// ------------------------------------------------------------ language

describe('detectLanguage', () => {
  it('recognises Russian and English dialogue', () => {
    expect(detectLanguage(makeCues(RU_LINES, 30))).toBe('ru');
    expect(detectLanguage(makeCues(EN_LINES, 30))).toBe('en');
  });

  it('is not confused by names written in the other alphabet', () => {
    const ru = [
      { start: 0, end: 1, text: 'Декстер сказал Debra, что пойдёт в Miami Metro завтра утром.' },
    ];
    const en = [
      {
        start: 0,
        end: 1,
        text: 'He told Дебра that we are going to Miami tomorrow, and I know it.',
      },
    ];
    expect(detectLanguage(ru)).toBe('ru');
    expect(detectLanguage(en)).toBe('en');
  });

  it('does not take other Latin-script languages for English', () => {
    expect(detectLanguage(makeCues(ES_LINES, 30))).toBe('other');
  });

  it('is not diluted by sound descriptions in an SDH track', () => {
    const cues: Cue[] = [
      { start: 0, end: 1, text: '[ominous music playing]' },
      { start: 1, end: 2, text: 'Hello, Dexter.' },
      { start: 4, end: 5, text: '(door slams)\nTonight is the night.' },
    ];
    const [track] = analyzeTracks([{ label: '(English) SDH', cues }], { durationSec: null }).tracks;
    expect(track!.lang).toBe('en');
  });

  it('says unknown when there is too little text to judge', () => {
    expect(detectLanguage([])).toBe('unknown');
    expect(detectLanguage([{ start: 0, end: 1, text: 'Buenos dias.' }])).toBe('unknown');
  });

  it('puts other scripts into other', () => {
    expect(
      detectLanguage([{ start: 0, end: 1, text: 'مرحبا بك في هذا المسلسل الجديد اليوم يا صديقي' }]),
    ).toBe('other');
  });
});

// ------------------------------------------------------------ player 1: everything is there

describe('player 1 (four tracks)', () => {
  const result = analyzeTracks(player1(), { durationSec: EPISODE_SEC });

  it('classifies each track', () => {
    expect(result.tracks.map(({ lang, type }) => [lang, type])).toEqual([
      ['ru', 'forced'],
      ['ru', 'full'],
      ['en', 'full'],
      ['en', 'sdh'],
    ]);
  });

  it('is case A: English full and Russian full, forced and SDH are not used', () => {
    expect(result.decision).toEqual({ case: 'A', en: 2, ru: 1, translateFrom: null });
  });

  it('strips sound descriptions from the SDH track', () => {
    const sdh = result.tracks[3]!;
    expect(sdh.cues.some((cue) => /\[|\]|door slams/.test(cue.text))).toBe(false);
    expect(sdh.cues.length).toBeLessThan(860); // cues that were only a sound description are gone
  });
});

// ------------------------------------------------------------ player 2: only a forced track

describe('player 2 (one forced track)', () => {
  const tracks: TrackInput[] = [{ label: 'Рус. форсированные - 1', cues: makeCues(RU_LINES, 35) }];

  it('is case C: forced subtitles are not subtitles', () => {
    const result = analyzeTracks(tracks, { durationSec: EPISODE_SEC });
    expect(result.tracks[0]).toMatchObject({ lang: 'ru', type: 'forced' });
    expect(result.decision).toEqual({ case: 'C', en: null, ru: null, translateFrom: null });
  });

  it('is case C even when the duration is unknown, because of the label', () => {
    expect(analyzeTracks(tracks, { durationSec: null }).decision.case).toBe('C');
  });
});

// ------------------------------------------------------------ forced detection without a label

describe('forced detection', () => {
  it('uses the length relative to the longest track', () => {
    const result = analyzeTracks(
      [
        { label: 'Russian 1', cues: makeCues(RU_LINES, 30) },
        { label: 'English', cues: makeCues(EN_LINES, 800) },
      ],
      { durationSec: null },
    );
    expect(result.tracks.map((t) => t.type)).toEqual(['forced', 'full']);
    expect(result.decision).toMatchObject({ case: 'B', en: 1, ru: null, translateFrom: 'en' });
  });

  it('uses cues per minute when a long video has a single short track', () => {
    const result = analyzeTracks([{ label: 'Track 1', cues: makeCues(RU_LINES, 25) }], {
      durationSec: 3000,
    });
    expect(result.tracks[0]!.type).toBe('forced');
    expect(result.decision.case).toBe('C');
  });

  it('does not take a short clip for a forced track', () => {
    const result = analyzeTracks([{ label: 'English', cues: makeCues(EN_LINES, 15) }], {
      durationSec: 120,
    });
    expect(result.tracks[0]!.type).toBe('full');
    expect(result.decision).toMatchObject({ case: 'B', translateFrom: 'en' });
  });

  it('does not judge by length when nothing can be compared and the duration is unknown', () => {
    const result = analyzeTracks([{ label: 'English', cues: makeCues(EN_LINES, 12) }], {
      durationSec: null,
    });
    expect(result.tracks[0]!.type).toBe('full');
  });
});

// ------------------------------------------------------------ the other cases

describe('decision', () => {
  it('case B: only English, translate English into Russian', () => {
    const result = analyzeTracks(
      [
        { label: '(Russian) forced', cues: makeCues(RU_LINES, 40) },
        { label: '(English) full', cues: makeCues(EN_LINES, EPISODE_CUES) },
      ],
      { durationSec: EPISODE_SEC },
    );
    expect(result.decision).toEqual({ case: 'B', en: 1, ru: null, translateFrom: 'en' });
  });

  it('case B: only Russian, translate Russian into English', () => {
    const result = analyzeTracks([{ label: 'Русский', cues: makeCues(RU_LINES, EPISODE_CUES) }], {
      durationSec: EPISODE_SEC,
    });
    expect(result.decision).toEqual({ case: 'B', en: null, ru: 0, translateFrom: 'ru' });
  });

  it('uses an SDH track when it is the only one for the language', () => {
    const result = analyzeTracks(
      [{ label: '(English) SDH', cues: makeCues(EN_LINES, 860, withSounds) }],
      {
        durationSec: EPISODE_SEC,
      },
    );
    expect(result.tracks[0]!.type).toBe('sdh');
    expect(result.decision).toMatchObject({ case: 'B', en: 0, translateFrom: 'en' });
  });

  it('detects SDH by content when the label says nothing', () => {
    const result = analyzeTracks(
      [{ label: 'English', cues: makeCues(EN_LINES, 800, withSounds) }],
      {
        durationSec: EPISODE_SEC,
      },
    );
    expect(result.tracks[0]!.type).toBe('sdh');
  });

  it('does not take a regular track for SDH because of a few bracketed words', () => {
    const cues = makeCues(EN_LINES, 800, (text, i) => (i === 100 ? '(laughs)' : text));
    const result = analyzeTracks([{ label: 'English', cues }], { durationSec: EPISODE_SEC });
    expect(result.tracks[0]!.type).toBe('full');
  });

  it('picks the track with more cues among equal ones', () => {
    const result = analyzeTracks(
      [
        { label: 'English (old)', cues: makeCues(EN_LINES, 600) },
        { label: 'English (new)', cues: makeCues(EN_LINES, 790) },
      ],
      { durationSec: EPISODE_SEC },
    );
    expect(result.decision.en).toBe(1);
  });

  it('ignores empty tracks and languages other than English and Russian', () => {
    const result = analyzeTracks(
      [
        { label: 'Español', cues: makeCues(ES_LINES, EPISODE_CUES) },
        { label: 'Broken', cues: [] },
      ],
      { durationSec: EPISODE_SEC },
    );
    expect(result.tracks.map((t) => [t.lang, t.type])).toEqual([
      ['other', 'full'],
      ['unknown', 'empty'],
    ]);
    expect(result.decision.case).toBe('C');
  });

  it('case C when there are no tracks at all', () => {
    expect(analyzeTracks([], { durationSec: null }).decision).toEqual({
      case: 'C',
      en: null,
      ru: null,
      translateFrom: null,
    });
  });
});
