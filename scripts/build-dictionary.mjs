// Builds public/dictionary-en.json from Wiktionary (via kaikki.org) for the most frequent English words:
//   npm run build:dictionary
// It downloads the whole English Wiktionary (about 3 GB, streamed, nothing is kept) and a frequency list
// made from film subtitles (hermitdave/FrequencyWords), and writes the file the extension ships.
// Output: { forms: { inflected: lemma }, entries: { lemma: { i?: ipa, s: [[pos, meaning, meaning?], ...] } } }
// Wiktionary text is CC BY-SA 3.0: the store description and the privacy page name it.
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

const FREQUENCY_URL =
  'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt';
const WIKTIONARY_URL = 'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl';
const OUTPUT = new URL('../public/dictionary-en.json', import.meta.url);

const WORDS = 30000;
const GLOSS_CHARS = 110;
const SENSES_PER_POS = 2;
const POS_PER_WORD = 2;

const rank = new Map();
const frequency = await (await fetch(FREQUENCY_URL)).text();
for (const line of frequency.split('\n')) {
  const word = line.split(' ')[0];
  if (word && /^[a-z]+(?:'[a-z]+)?$/.test(word) && !rank.has(word) && rank.size < WORDS)
    rank.set(word, rank.size);
}

/** Senses nobody means when they say a word in a film. */
const RARE = new Set([
  'obsolete',
  'archaic',
  'dialectal',
  'nonstandard',
  'rare',
  'dated',
  'historical',
  'misspelling',
  'alt-of',
  'abbreviation',
  'initialism',
]);
/** A form entry that is a real inflection, not "supplement of" or "informal form of". */
const INFLECTION =
  /\b(plural|past|participle|singular|comparative|superlative|present|gerund|continuative|inflection)\b/i;
const POS_KEEP = new Set([
  'noun',
  'verb',
  'adj',
  'adv',
  'pron',
  'prep',
  'conj',
  'intj',
  'det',
  'num',
  'particle',
  'name',
  'article',
  'contraction',
]);

const entries = new Map(); // lemma -> { pos -> glosses[] }, ipa
const candidates = new Map(); // inflected -> Set of lemmas (the ordinary senses only)

// WIKTIONARY_FILE: a copy of the file already downloaded (saves the 3 GB when the rules are tuned).
const source = process.env.WIKTIONARY_FILE
  ? createReadStream(process.env.WIKTIONARY_FILE)
  : Readable.fromWeb((await fetch(WIKTIONARY_URL)).body);
const lines = createInterface({ input: source, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line) continue;
  const word = JSON.parse(line);
  const w = word.word;
  if (!w || !rank.has(w) || !POS_KEEP.has(word.pos)) continue;
  const slot = entries.get(w) ?? { ipa: null, pos: new Map() };
  for (const sense of word.senses ?? []) {
    const tags = sense.tags ?? [];
    if (tags.some((t) => RARE.has(t))) continue;
    const gloss = sense.glosses?.at(-1);
    if (!gloss) continue;
    if (sense.form_of?.length) {
      const lemma = sense.form_of[0].word;
      if (lemma && lemma !== w && rank.has(lemma) && INFLECTION.test(gloss))
        (candidates.get(w) ?? candidates.set(w, new Set()).get(w)).add(lemma);
      continue;
    }
    if (
      /^(alternative|misspelling|obsolete|eye dialect|pronunciation spelling|the name of the|the \w+ letter|a letter)/i.test(
        gloss,
      ) ||
      /\bletter of the\b/i.test(gloss)
    )
      continue;
    const list = slot.pos.get(word.pos) ?? [];
    if (list.length < SENSES_PER_POS)
      list.push(
        gloss.length > GLOSS_CHARS ? `${gloss.slice(0, GLOSS_CHARS - 1).trimEnd()}…` : gloss,
      );
    slot.pos.set(word.pos, list);
  }
  if (!slot.ipa) {
    const sounds = (word.sounds ?? []).filter((s) => s.ipa);
    slot.ipa =
      (sounds.find((s) => (s.tags ?? []).includes('General-American')) ?? sounds[0])?.ipa ?? null;
  }
  if (slot.pos.size > 0) entries.set(w, slot);
}

// A form points to its lemma, even when Wiktionary also has an article of its own for the form
// ("is", "saw", "left"): in a film they are the forms.
const forms = {};
for (const [form, lemmas] of candidates) {
  const lemma = [...lemmas]
    .filter((l) => entries.has(l))
    .sort((a, b) => rank.get(a) - rank.get(b))[0];
  if (!lemma) continue;
  forms[form] = lemma;
}

const out = { forms, entries: {} };
for (const [w, slot] of [...entries].sort((a, b) => rank.get(a[0]) - rank.get(b[0]))) {
  // Function words first ("the" is a determiner before it is an adverb); the rest in Wiktionary's order.
  const early = (pos) =>
    ['article', 'det', 'pron', 'prep', 'conj', 'contraction'].includes(pos) ? 0 : 1;
  const s = [...slot.pos]
    .sort((a, b) => early(a[0]) - early(b[0]))
    .slice(0, POS_PER_WORD)
    .map(([pos, glosses]) => [pos, ...glosses]);
  out.entries[w] = slot.ipa ? { i: slot.ipa, s } : { s };
}
writeFileSync(OUTPUT, JSON.stringify(out));
console.error(`entries ${Object.keys(out.entries).length}, forms ${Object.keys(forms).length}`);
