import { overlap } from './align';
import type { Cue, SubtitleLines } from './types';

/**
 * Subtitle files cut sentences where it suits the screen, and two tracks of the same film are cut in
 * different places. Shown as they are, one line carries half a sentence while the other carries the
 * whole of it. These helpers put whole phrases on both lines:
 * - a sentence cut in the middle is joined again (also before it is translated, so the translator
 *   sees the whole sentence);
 * - when one cue of a track covers several cues of the other, those several are shown together.
 */

const MAX_JOIN_CUES = 3;
const MAX_JOIN_CHARS = 170;
const MAX_JOIN_SECONDS = 9;
/** A pause longer than this is a new thought, whatever the punctuation says. */
const MAX_GAP_SECONDS = 1;
const MAX_GROUP_CUES = 6;
const MAX_GROUP_SECONDS = 16;
/** Two cues only belong together if they overlap by more than this share of the shorter one. */
const MIN_OVERLAP_SHARE = 0.25;

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const joinText = (cues: Cue[]) => flat(cues.map((cue) => cue.text).join(' '));

/** The text ends a sentence: a full stop, question or exclamation mark, ellipsis, or a closing quote after one. */
const endsSentence = (text: string) => /[.!?…][)"'»”’\]]*$/.test(flat(text));
/** The next cue goes on with the same sentence: it begins in lower case and is not a new speaker's dash. */
const continues = (text: string) => {
  const t = flat(text);
  if (/^[-–—]/.test(t)) return false;
  const first = t.match(/\p{L}/u)?.[0];
  return Boolean(first) && first === first!.toLowerCase() && first !== first!.toUpperCase();
};

/**
 * Subtitles written by people have punctuation; automatic captions have none, and their cues are
 * fragments on purpose. Only the first kind has sentences to put back together.
 */
const hasPunctuation = (cues: Cue[]) =>
  cues.filter((cue) => /[.,!?…:;]/.test(cue.text)).length >= cues.length * 0.3;

/** Joins cues of one track that are halves of the same sentence. */
export function mergeSplitSentences(cues: Cue[]): Cue[] {
  if (!hasPunctuation(cues)) return cues;
  const result: Cue[] = [];
  let group: Cue[] = [];
  const flush = () => {
    if (group.length === 0) return;
    result.push(
      group.length === 1
        ? group[0]!
        : {
            start: group[0]!.start,
            end: Math.max(...group.map((c) => c.end)),
            text: joinText(group),
          },
    );
    group = [];
  };
  for (const cue of cues) {
    const last = group[group.length - 1];
    const fits =
      last !== undefined &&
      group.length < MAX_JOIN_CUES &&
      !endsSentence(last.text) &&
      continues(cue.text) &&
      cue.start - last.end <= MAX_GAP_SECONDS &&
      cue.start - last.end >= -0.3 &&
      joinText([...group, cue]).length <= MAX_JOIN_CHARS &&
      cue.end - group[0]!.start <= MAX_JOIN_SECONDS;
    if (!fits) flush();
    group.push(cue);
  }
  flush();
  return result;
}

const parent = (roots: number[], x: number): number => {
  while (roots[x] !== x) {
    roots[x] = roots[roots[x]!]!;
    x = roots[x]!;
  }
  return x;
};

/** The cue of `others` that overlaps `cue` the most, if the overlap is real. */
function bestMatch(cue: Cue, others: Cue[]): number {
  let best = -1;
  let bestOverlap = 0;
  for (let j = 0; j < others.length; j++) {
    const other = others[j]!;
    if (other.start >= cue.end) break;
    const amount = overlap(cue, other);
    const shorter = Math.min(cue.end - cue.start, other.end - other.start);
    if (amount > bestOverlap && amount >= MIN_OVERLAP_SHARE * shorter) {
      best = j;
      bestOverlap = amount;
    }
  }
  return best;
}

/**
 * Where one cue of a track covers several cues of the other track, those cues are shown together
 * for the whole stretch, so that both lines always hold the whole phrase. A cue that has a single
 * partner keeps its own timing. A knot that would grow too big is left as it was.
 */
export function groupAligned(learn: Cue[], native: Cue[]): { learn: Cue[]; native: Cue[] } {
  if (learn.length === 0 || native.length === 0) return { learn, native };

  // Items 0..learn.length-1 are cues of the learning line, the rest those of the native one.
  const roots = Array.from({ length: learn.length + native.length }, (_, i) => i);
  const union = (a: number, b: number) => (roots[parent(roots, a)] = parent(roots, b));
  learn.forEach((cue, i) => {
    const j = bestMatch(cue, native);
    if (j >= 0) union(i, learn.length + j);
  });
  native.forEach((cue, j) => {
    const i = bestMatch(cue, learn);
    if (i >= 0) union(learn.length + j, i);
  });

  const groups = new Map<number, { learn: number[]; native: number[] }>();
  for (let k = 0; k < roots.length; k++) {
    const root = parent(roots, k);
    const group = groups.get(root) ?? { learn: [], native: [] };
    (k < learn.length ? group.learn : group.native).push(k < learn.length ? k : k - learn.length);
    groups.set(root, group);
  }

  const mergedLearn = new Map<number, Cue>();
  const mergedNative = new Map<number, Cue>();
  const consumedLearn = new Set<number>();
  const consumedNative = new Set<number>();
  const consecutive = (list: number[]) =>
    list.every((value, idx) => idx === 0 || value === list[idx - 1]! + 1);

  for (const group of groups.values()) {
    if (
      group.learn.length < 1 ||
      group.native.length < 1 ||
      (group.learn.length === 1 && group.native.length === 1)
    )
      continue;
    const learnCues = group.learn.map((i) => learn[i]!);
    const nativeCues = group.native.map((j) => native[j]!);
    const all = [...learnCues, ...nativeCues];
    const start = Math.min(...all.map((c) => c.start));
    const end = Math.max(...all.map((c) => c.end));
    if (
      group.learn.length > MAX_GROUP_CUES ||
      group.native.length > MAX_GROUP_CUES ||
      end - start > MAX_GROUP_SECONDS
    )
      continue;
    if (!consecutive(group.learn) || !consecutive(group.native)) continue;
    mergedLearn.set(group.learn[0]!, { start, end, text: joinText(learnCues) });
    mergedNative.set(group.native[0]!, { start, end, text: joinText(nativeCues) });
    group.learn.slice(1).forEach((i) => consumedLearn.add(i));
    group.native.slice(1).forEach((j) => consumedNative.add(j));
  }

  const build = (cues: Cue[], merged: Map<number, Cue>, consumed: Set<number>) =>
    cues.flatMap((cue, i) => (consumed.has(i) ? [] : [merged.get(i) ?? cue]));
  return {
    learn: build(learn, mergedLearn, consumedLearn),
    native: build(native, mergedNative, consumedNative),
  };
}

/** Whole phrases on both lines (see the top of the file). */
export function phrasize(lines: SubtitleLines): SubtitleLines {
  const learn = lines.learn ? mergeSplitSentences(lines.learn) : null;
  const native = lines.native ? mergeSplitSentences(lines.native) : null;
  if (!learn || !native) return { learn, native };
  return groupAligned(learn, native);
}
