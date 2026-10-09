import { t, type MessageKey } from './i18n';
/** The file built by scripts/build-dictionary.mjs from Wiktionary. */
export interface DictionaryData {
  /** An inflected form → its dictionary form ("went" → "go"). */
  forms: Record<string, string>;
  /** `i`: pronunciation; `s`: per part of speech [pos, meaning, meaning?]. */
  entries: Record<string, { i?: string; s: string[][] }>;
}

export interface WordSense {
  /** noun, verb, adj, adv … as Wiktionary names them. */
  pos: string;
  meanings: string[];
}

/** What the dictionary knows about a word the user pointed at. */
export interface WordInfo {
  /** The dictionary form: "go" for "went". */
  lemma: string;
  /** The word was an inflected form of `lemma`, not the lemma itself. */
  inflected: boolean;
  ipa: string | null;
  senses: WordSense[];
}

/**
 * What the contractions of speech stand for. The frequency list the dictionary is built from splits
 * them at the apostrophe, so they are not in the file; subtitles are full of them.
 */
const CONTRACTIONS: Record<string, string> = {
  "i'm": 'I am',
  "you're": 'you are',
  "he's": 'he is / he has',
  "she's": 'she is / she has',
  "it's": 'it is / it has',
  "we're": 'we are',
  "they're": 'they are',
  "that's": 'that is',
  "there's": 'there is',
  "what's": 'what is',
  "who's": 'who is',
  "here's": 'here is',
  "let's": 'let us',
  "i've": 'I have',
  "you've": 'you have',
  "we've": 'we have',
  "they've": 'they have',
  "i'll": 'I will',
  "you'll": 'you will',
  "he'll": 'he will',
  "she'll": 'she will',
  "we'll": 'we will',
  "they'll": 'they will',
  "it'll": 'it will',
  "i'd": 'I would / I had',
  "you'd": 'you would / you had',
  "he'd": 'he would / he had',
  "she'd": 'she would / she had',
  "we'd": 'we would / we had',
  "they'd": 'they would / they had',
  "don't": 'do not',
  "doesn't": 'does not',
  "didn't": 'did not',
  "can't": 'cannot',
  "couldn't": 'could not',
  "won't": 'will not',
  "wouldn't": 'would not',
  "shouldn't": 'should not',
  "isn't": 'is not',
  "aren't": 'are not',
  "wasn't": 'was not',
  "weren't": 'were not',
  "haven't": 'have not',
  "hasn't": 'has not',
  "hadn't": 'had not',
  "ain't": 'am not / is not / are not',
  "y'all": 'you all',
  gotta: 'got to',
  wanna: 'want to',
  gonna: 'going to',
};

/** Same word for "Don't", "don’t" and "DON'T". */
const normalize = (word: string) =>
  word
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^'+|'+$/g, '');

/**
 * Candidate dictionary forms of a word the file has no entry for, most likely first. Wiktionary lists
 * the common inflections as forms; this only fills the gaps (a rare plural, "-ing" of a rare verb).
 */
export function stemCandidates(word: string): string[] {
  const out: string[] = [];
  const add = (stem: string) => stem.length >= 2 && stem !== word && out.push(stem);
  if (word.endsWith("'s")) add(word.slice(0, -2));
  if (word.endsWith('ies')) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) add(word.slice(0, -2));
  if (word.endsWith('s')) add(word.slice(0, -1));
  if (word.endsWith('ied')) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('ed')) {
    add(word.slice(0, -2));
    add(word.slice(0, -1));
    if (/(.)\1ed$/.test(word)) add(word.slice(0, -3)); // stopped → stop
  }
  if (word.endsWith('ing')) {
    add(word.slice(0, -3));
    add(`${word.slice(0, -3)}e`);
    if (/(.)\1ing$/.test(word)) add(word.slice(0, -4)); // running → run
  }
  if (word.endsWith('er') || word.endsWith('est')) add(word.replace(/(er|est)$/, ''));
  return out;
}

/** Looks words up in the data: the dictionary form, how it is said, what it means. */
export class Dictionary {
  constructor(private readonly data: DictionaryData) {}

  lookup(raw: string): WordInfo | null {
    const word = normalize(raw);
    if (!word) return null;
    const expansion = CONTRACTIONS[word];
    if (expansion)
      return {
        lemma: word,
        inflected: false,
        ipa: null,
        senses: [{ pos: 'contraction', meanings: [expansion] }],
      };
    const lemma = this.lemmaOf(word);
    const entry = lemma ? this.data.entries[lemma] : undefined;
    if (!lemma || !entry) return null;
    return {
      lemma,
      inflected: lemma !== word,
      ipa: entry.i ?? null,
      senses: entry.s.map(([pos, ...meanings]) => ({ pos: pos!, meanings })),
    };
  }

  private lemmaOf(word: string): string | null {
    const known = this.data.forms[word];
    if (known) return known;
    if (this.data.entries[word]) return word;
    return stemCandidates(word).find((stem) => this.data.entries[stem]) ?? null;
  }
}

const POS_NAME: Record<string, MessageKey> = {
  noun: 'pos_noun',
  verb: 'pos_verb',
  adj: 'pos_adj',
  adv: 'pos_adv',
  pron: 'pos_pron',
  prep: 'pos_prep',
  conj: 'pos_conj',
  intj: 'pos_intj',
  det: 'pos_det',
  num: 'pos_num',
  particle: 'pos_particle',
  name: 'pos_name',
  article: 'pos_article',
  contraction: 'pos_contraction',
};

/** The part of speech as the user reads it ("verb", "глаг."). */
export const posName = (pos: string) => (POS_NAME[pos] ? t(POS_NAME[pos]!) : pos);

/** For the saved-word card: the first meaning of the first part of speech. */
export function shortDefinition(info: WordInfo): string | null {
  const first = info.senses[0];
  return first?.meanings[0] ? `${posName(first.pos)} ${first.meanings[0]}` : null;
}
