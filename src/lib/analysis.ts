import { baseLang, DEFAULT_PAIR, type LanguagePair } from './languages';
import type { Cue } from './types';

/** A base language code ('en', 'de'…) found for a track, or 'other' / 'unknown' when it could not be told. */
export type Lang = string;

/**
 * - full: regular subtitles for all the dialogue
 * - forced: only foreign speech and on-screen text, not usable as subtitles
 * - sdh: subtitles for the deaf, with sound descriptions that get stripped
 * - empty: nothing was loaded
 */
export type TrackType = 'full' | 'forced' | 'sdh' | 'empty';

/** The two lines: the language the user learns and their own one. */
export type Role = 'learn' | 'native';

export interface Decision {
  /** A: both languages exist. B: one of them exists, the other is translated. C: neither. */
  case: 'A' | 'B' | 'C';
  /** Indices into the analysed tracks. */
  learn: number | null;
  native: number | null;
  /** Case B: the line whose track is translated into the other one. */
  translateFrom: Role | null;
}

export interface TrackInput {
  label: string;
  cues: Cue[];
  /** The language the site gives for the track (srclang); only believed where the text cannot tell. */
  declared?: string;
}

interface TrackAnalysis {
  lang: Lang;
  type: TrackType;
  /** Cues with markup (and, for SDH, sound descriptions) removed. */
  cues: Cue[];
}

interface AnalysisOptions {
  /** Video length in seconds, or null if unknown (live stream, metadata not loaded). */
  durationSec: number | null;
  /** The languages of the two lines; English and Russian when not given. */
  pair?: LanguagePair;
}

// ---------------------------------------------------------------- cleaning

const MARKUP = /<\/?[a-zA-Z][^>\n]*>|<\d{1,2}:\d{2}[^>\n]*>/g; // HTML, WebVTT voice/class/timestamp tags
const ASS_TAGS = /\{\\[^}\n]*\}/g; // {\an8}
const MUSIC_NOTES = /[♪♫♬]/g;
const SOUND_DESCRIPTION = /\[[^\]\n]*\]|\([^)\n]*\)/g; // [music], (door slams)
const SPEAKER_LABEL = /^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9 .'-]{1,24}:\s*/; // "DEXTER: Hello"

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lrm;': '',
  '&rlm;': '',
};

interface CleanOptions {
  /** Remove [sound] and (sound) descriptions and ALL-CAPS speaker labels (SDH tracks). */
  stripSoundDescriptions: boolean;
}

/** Plain text of a cue: lines are kept, empty lines are dropped. May return an empty string. */
export function cleanCueText(text: string, options: CleanOptions): string {
  let result = text
    .replace(MARKUP, '')
    .replace(ASS_TAGS, '')
    // Decode after removing markup, otherwise "&lt;i&gt;" would turn into a tag.
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(MUSIC_NOTES, '');

  if (options.stripSoundDescriptions) result = result.replace(SOUND_DESCRIPTION, '');

  return result
    .split('\n')
    .map((line) => {
      const trimmed = line.replace(/\s+/g, ' ').trim();
      return options.stripSoundDescriptions ? trimmed.replace(SPEAKER_LABEL, '').trim() : trimmed;
    })
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Cleans every cue, drops the ones that become empty and sorts by start time. */
export function normalizeCues(cues: Cue[], options: CleanOptions): Cue[] {
  return cues
    .map((cue) => ({ ...cue, text: cleanCueText(cue.text, options) }))
    .filter((cue) => cue.text.length > 0)
    .sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- language

const LATIN = /[A-Za-z]/g;
const CYRILLIC = /[А-Яа-яЁё]/g;
const ANY_LETTER = /\p{L}/gu;
const MIN_LETTERS = 20;
const SCRIPT_SHARE = 0.6;
/** Share of frequent English words in a text; English dialogue is far above, other Latin languages below. */
const ENGLISH_WORD_SHARE = 0.2;

const ENGLISH_WORDS = new Set([
  'the',
  'and',
  'you',
  'your',
  'is',
  'are',
  'was',
  'were',
  'that',
  'this',
  'with',
  'of',
  'to',
  'it',
  'i',
  'in',
  "i'm",
  "it's",
  "don't",
  "you're",
  "that's",
  'not',
  'what',
  'have',
  'my',
  'for',
  'can',
  'we',
  'they',
  'but',
  'just',
  'get',
  'got',
  'going',
  'know',
  'then',
  'there',
  'here',
  'about',
]);

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

/**
 * Only English and Russian are told apart by the text; any other language is `other` here, and the
 * track's own language (trackLanguage) names it.
 */
export function detectLanguage(cues: Cue[]): Lang {
  const text = cues
    .slice(0, 300)
    .map((cue) => cue.text)
    .join(' ');

  const letters = count(text, ANY_LETTER);
  if (letters < MIN_LETTERS) return 'unknown';

  if (count(text, CYRILLIC) / letters >= SCRIPT_SHARE) return 'ru';
  if (count(text, LATIN) / letters < SCRIPT_SHARE) return 'other';

  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length;
  return english / words.length >= ENGLISH_WORD_SHARE ? 'en' : 'other';
}

/** Languages written in Cyrillic, which the text check takes for Russian. */
const CYRILLIC_OTHERS = new Set(['uk', 'be', 'bg', 'sr', 'mk', 'kk', 'ky', 'tg', 'mn']);

/**
 * The language of a track: the text decides for English and Russian (labels and attributes lie);
 * where the text only says "not those", or is Cyrillic but the track says Ukrainian, Bulgarian…,
 * the language the site gives is believed.
 */
export function trackLanguage(detected: Lang, declared: string | undefined): Lang {
  const said = declared ? baseLang(declared) : '';
  if (!said || said === 'en' || said === 'ru') return detected;
  if (detected === 'other') return said;
  if (detected === 'ru' && CYRILLIC_OTHERS.has(said)) return said;
  return detected;
}

// ---------------------------------------------------------------- track type

const FORCED_LABEL = /forced|форс|принудит|foreign|иностран/i;
const SDH_LABEL = /sdh|hard of hearing|hearing.impaired|глух|слабослыш/i;

/** Forced tracks are far shorter than a full track of the same video. */
const FORCED_SHARE_OF_LONGEST = 0.25;
/** Below this many cues there is nothing to compare, so the relative rule is not used. */
const MIN_CUES_FOR_COMPARISON = 20;
/** Full subtitles have around 10–20 cues per minute; forced ones well under one. */
const FORCED_CUES_PER_MINUTE = 1.5;
const MIN_DURATION_FOR_RATE_SEC = 600;

/** Share of cues with sound descriptions above which a track counts as SDH. */
const SDH_MARKER_SHARE = 0.06;
const MIN_SDH_MARKERS = 2;
const SDH_MARKER = /\[[^\]\n]+\]|\([^)\n]{3,}\)|^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9 .'-]{1,24}:/m;

function looksLikeSdh(label: string, rawCues: Cue[]): boolean {
  if (SDH_LABEL.test(label)) return true;
  const markers = rawCues.filter((cue) => SDH_MARKER.test(cue.text.replace(MARKUP, ''))).length;
  return markers >= MIN_SDH_MARKERS && markers / rawCues.length >= SDH_MARKER_SHARE;
}

function looksForced(
  label: string,
  cueCount: number,
  longestCount: number,
  durationSec: number | null,
): boolean {
  if (FORCED_LABEL.test(label)) return true;
  if (
    longestCount >= MIN_CUES_FOR_COMPARISON &&
    cueCount < longestCount * FORCED_SHARE_OF_LONGEST
  ) {
    return true;
  }
  return (
    durationSec !== null &&
    durationSec >= MIN_DURATION_FOR_RATE_SEC &&
    cueCount / (durationSec / 60) < FORCED_CUES_PER_MINUTE
  );
}

// ---------------------------------------------------------------- analysis

const BASIC: CleanOptions = { stripSoundDescriptions: false };
const SDH: CleanOptions = { stripSoundDescriptions: true };

export function analyzeTracks(
  tracks: TrackInput[],
  options: AnalysisOptions,
): { tracks: TrackAnalysis[]; decision: Decision } {
  const basic = tracks.map((track) => normalizeCues(track.cues, BASIC));
  const longest = Math.max(0, ...basic.map((cues) => cues.length));

  const analysed: TrackAnalysis[] = tracks.map((track, i) => {
    const cues = basic[i]!;
    if (cues.length === 0) return { lang: 'unknown', type: 'empty', cues: [] };

    // Sound descriptions ("[tense music]") carry no dialogue and would dilute the language signal.
    const lang = trackLanguage(detectLanguage(normalizeCues(track.cues, SDH)), track.declared);
    if (looksForced(track.label, cues.length, longest, options.durationSec)) {
      return { lang, type: 'forced', cues };
    }
    if (looksLikeSdh(track.label, track.cues)) {
      return { lang, type: 'sdh', cues: normalizeCues(track.cues, SDH) };
    }
    return { lang, type: 'full', cues };
  });

  return { tracks: analysed, decision: decide(analysed, options.pair) };
}

/**
 * The best usable track of a language: a full one first, SDH only when there is no full one.
 * Among equals the one with more cues wins; forced and empty tracks are never used.
 */
function bestTrack(tracks: TrackAnalysis[], lang: Lang): number | null {
  for (const type of ['full', 'sdh'] as const) {
    let best: number | null = null;
    tracks.forEach((track, i) => {
      if (track.lang !== lang || track.type !== type) return;
      if (best === null || track.cues.length > tracks[best]!.cues.length) best = i;
    });
    if (best !== null) return best;
  }
  return null;
}

export function decide(tracks: TrackAnalysis[], pair: LanguagePair = DEFAULT_PAIR): Decision {
  const learn = bestTrack(tracks, pair.learn);
  const native = bestTrack(tracks, pair.native);

  if (learn !== null && native !== null) return { case: 'A', learn, native, translateFrom: null };
  if (learn !== null) return { case: 'B', learn, native: null, translateFrom: 'learn' };
  if (native !== null) return { case: 'B', learn: null, native, translateFrom: 'native' };
  return { case: 'C', learn: null, native: null, translateFrom: null };
}
