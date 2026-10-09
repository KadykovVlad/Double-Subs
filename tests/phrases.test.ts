import { describe, expect, it } from 'vitest';
import { runTranslation, type TranslationService } from '../src/translation/session';
import { createLineResolver } from '../src/lib/cue-index';
import { groupAligned, mergeSplitSentences, phrasize } from '../src/lib/phrases';
import type { Cue } from '../src/lib/types';

const cue = (start: number, end: number, text: string): Cue => ({ start, end, text });

describe('mergeSplitSentences', () => {
  it('joins a sentence cut in the middle (the case from a real video)', () => {
    const merged = mergeSplitSentences([
      cue(10, 12, 'But for some reason, he wants to be here,'),
      cue(12, 14, 'freezing his ass off, instead of at home.'),
    ]);
    expect(merged).toEqual([
      cue(
        10,
        14,
        'But for some reason, he wants to be here, freezing his ass off, instead of at home.',
      ),
    ]);
  });

  it('keeps sentences apart: a full stop, a capital letter, a new speaker, a long pause', () => {
    const stop = [cue(0, 2, 'It is over.'), cue(2, 4, 'we should go.')];
    expect(mergeSplitSentences(stop)).toHaveLength(2);
    const capital = [cue(0, 2, 'He said no,'), cue(2, 4, 'Then he left.')];
    expect(mergeSplitSentences(capital)).toHaveLength(2);
    const dash = [cue(0, 2, 'Where are you going,'), cue(2, 4, '- out.')];
    expect(mergeSplitSentences(dash)).toHaveLength(2);
    const pause = [cue(0, 2, 'He waited,'), cue(6, 8, 'and waited.')];
    expect(mergeSplitSentences(pause)).toHaveLength(2);
  });

  it('joins at most three cues and never an endless sentence', () => {
    const parts = Array.from({ length: 8 }, (_, i) =>
      cue(i * 2, i * 2 + 2, i === 0 ? 'first part,' : `part ${i},`),
    );
    const merged = mergeSplitSentences(parts);
    expect(merged.length).toBeGreaterThan(2);
    for (const m of merged) expect(m.end - m.start).toBeLessThanOrEqual(9);
  });

  it('works for Russian as well', () => {
    const merged = mergeSplitSentences([
      cue(0, 2, 'Но почему-то он предпочитает морозить'),
      cue(2, 4, 'задницу здесь, а не сидеть дома.'),
    ]);
    expect(merged).toEqual([
      cue(0, 4, 'Но почему-то он предпочитает морозить задницу здесь, а не сидеть дома.'),
    ]);
  });

  it('leaves automatic captions alone: no punctuation, fragments on purpose', () => {
    const asr = [
      cue(0, 2, 'hello dexter'),
      cue(2, 4, 'tonight is the night'),
      cue(4, 6, 'i am not who you think'),
    ];
    expect(mergeSplitSentences(asr)).toEqual(asr);
  });

  it('leaves a track without such cuts as it is', () => {
    const cues = [cue(0, 2, 'Hello.'), cue(3, 5, 'How are you?'), cue(6, 8, 'Fine.')];
    expect(mergeSplitSentences(cues)).toEqual(cues);
  });
});

describe('groupAligned', () => {
  it('shows the whole phrase in both lines when one track is cut and the other is not', () => {
    const en = [
      cue(10, 12, 'But for some reason, he wants to be here,'),
      cue(12, 14, 'freezing his ass off, instead of at home.'),
    ];
    const ru = [
      cue(10, 14, 'Но почему-то он предпочитает морозить задницу здесь, а не сидеть дома.'),
    ];
    const result = groupAligned(en, ru);
    expect(result.en).toEqual([
      cue(
        10,
        14,
        'But for some reason, he wants to be here, freezing his ass off, instead of at home.',
      ),
    ]);
    expect(result.ru).toEqual(ru);
  });

  it('does the same when the Russian track is the one that is cut', () => {
    const en = [cue(0, 6, 'I do not know what you are talking about.')];
    const ru = [cue(0, 3, 'Я не знаю,'), cue(3, 6, 'о чём ты говоришь.')];
    const result = groupAligned(en, ru);
    expect(result.ru).toEqual([cue(0, 6, 'Я не знаю, о чём ты говоришь.')]);
    expect(result.en).toEqual(en);
  });

  it('leaves cues with a single partner exactly as they were, with their own timing', () => {
    const en = [cue(0, 2, 'Hello.'), cue(3, 5, 'Bye.')];
    const ru = [cue(0.2, 2.1, 'Привет.'), cue(3.1, 5.2, 'Пока.')];
    expect(groupAligned(en, ru)).toEqual({ en, ru });
  });

  it('does not glue a whole scene together when the cuts never meet', () => {
    // English every 2 s, Russian every 3 s: boundaries drift, the knot would run on and on.
    const en = Array.from({ length: 30 }, (_, i) => cue(i * 2, i * 2 + 2, `en ${i}`));
    const ru = Array.from({ length: 20 }, (_, i) => cue(i * 3, i * 3 + 3, `ru ${i}`));
    const result = groupAligned(en, ru);
    for (const c of [...result.en, ...result.ru]) expect(c.end - c.start).toBeLessThanOrEqual(16);
  });

  it('handles an empty track', () => {
    const en = [cue(0, 1, 'a')];
    expect(groupAligned(en, [])).toEqual({ en, ru: [] });
  });
});

describe('what is on screen', () => {
  it('both lines hold the whole phrase at every moment of it', () => {
    const lines = phrasize({
      en: [
        cue(10, 12, 'But for some reason, he wants to be here,'),
        cue(12, 14, 'freezing his ass off, instead of at home.'),
      ],
      ru: [cue(10, 14, 'Но почему-то он предпочитает морозить задницу здесь, а не сидеть дома.')],
    });
    const at = createLineResolver(lines);
    for (const t of [10.1, 11.9, 12.1, 13.9]) {
      expect(at(t)).toEqual({
        en: 'But for some reason, he wants to be here, freezing his ass off, instead of at home.',
        ru: 'Но почему-то он предпочитает морозить задницу здесь, а не сидеть дома.',
      });
    }
    expect(at(14.5)).toEqual({ en: null, ru: null });
  });

  it('a cut that punctuation does not reveal is still matched to the other track', () => {
    const lines = phrasize({
      en: [cue(0, 2, 'Come here,'), cue(2, 4, 'Right now.')],
      ru: [cue(0, 4, 'Иди сюда, прямо сейчас.')],
    });
    expect(lines.en).toEqual([cue(0, 4, 'Come here, Right now.')]);
    expect(lines.ru).toEqual([cue(0, 4, 'Иди сюда, прямо сейчас.')]);
  });

  it('only the English track: the sentence is whole, ready to be translated as one', () => {
    const lines = phrasize({
      en: [cue(0, 2, 'He wants to be here,'), cue(2, 4, 'freezing his ass off.')],
      ru: null,
    });
    expect(lines.en).toEqual([cue(0, 4, 'He wants to be here, freezing his ass off.')]);
    expect(lines.ru).toBeNull();
  });
});

/** Cuts the same sentences in two different ways, many times: nothing may be lost, doubled or reordered. */
describe('random cuts', () => {
  const words = (text: string) => text.split(/\s+/).filter(Boolean);

  function cutTrack(sentences: string[], seed: number): Cue[] {
    let state = seed;
    const rand = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const cues: Cue[] = [];
    sentences.forEach((sentence, s) => {
      const w = words(sentence);
      const cuts = rand() < 0.5 ? 1 : 2 + Math.floor(rand() * 2);
      const size = Math.ceil(w.length / cuts);
      for (let k = 0; k < cuts && k * size < w.length; k++) {
        const part = w.slice(k * size, (k + 1) * size).join(' ');
        const t0 = s * 8 + k * (6 / cuts);
        cues.push(cue(t0, t0 + 6 / cuts, part));
      }
    });
    return cues;
  }

  const sentences = Array.from(
    { length: 12 },
    (_, i) => `sentence number ${i} goes on, and on with some more words, until the end of it.`,
  );

  it('keeps every word once and in order, in both tracks, for 200 different cuttings', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const en = cutTrack(sentences, seed);
      const ru = cutTrack(
        sentences.map((s) => s.replace('sentence', 'фраза')),
        seed * 7919,
      );
      const result = phrasize({ en, ru });
      expect(words(result.en!.map((c) => c.text).join(' '))).toEqual(
        words(en.map((c) => c.text).join(' ')),
      );
      expect(words(result.ru!.map((c) => c.text).join(' '))).toEqual(
        words(ru.map((c) => c.text).join(' ')),
      );
      for (const c of [...result.en!, ...result.ru!]) expect(c.end).toBeGreaterThan(c.start);
    }
  });

  it('whatever was on screen before is still on screen: every original cue lies inside a shown one', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const en = cutTrack(sentences, seed);
      const ru = cutTrack(sentences, seed + 1000);
      const result = phrasize({ en, ru });
      for (const original of en) {
        const mid = (original.start + original.end) / 2;
        const shown = createLineResolver(result)(mid).en ?? '';
        expect(shown.replace(/\s+/g, ' ')).toContain(original.text);
      }
    }
  });
});

describe('translation of cut sentences', () => {
  /** A translator that wraps the whole text it was given: if a sentence arrives in halves, it shows. */
  const service: TranslationService = {
    availability: async () => 'available',
    translate: async (_direction, texts) => texts.map((text) => `[${text}]`),
    cacheGet: async () => null,
    cachePut: async () => {},
  };

  it('every sentence reaches the translator whole and comes back whole, in every cutting', async () => {
    const sentences = Array.from(
      { length: 6 },
      (_, i) => `part ${i} of the sentence goes on, and on with some more words.`,
    );
    for (let seed = 1; seed <= 30; seed++) {
      let state = seed;
      const rand = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
      const cues: Cue[] = sentences.flatMap((sentence, s) => {
        const w = sentence.split(' ');
        const at = 3 + Math.floor(rand() * (w.length - 6));
        return [
          cue(s * 6, s * 6 + 3, w.slice(0, at).join(' ').replace(/\.$/, ',')),
          cue(s * 6 + 3, s * 6 + 6, w.slice(at).join(' ')),
        ];
      });
      const { en } = phrasize({ en: cues, ru: null });
      let last: Cue[] = [];
      await runTranslation({
        source: en!,
        direction: 'en-ru',
        getTime: () => 0,
        service,
        onUpdate: (u) => (last = u.cues),
      });
      expect(last).toHaveLength(en!.length);
      last.forEach((translated, i) => {
        // The translator was given the whole of what is shown in English.
        expect(translated.text.replace(/^\[|\]$/g, '').toLowerCase()).toBe(
          en![i]!.text.toLowerCase(),
        );
        expect(translated.start).toBe(en![i]!.start);
        expect(translated.end).toBe(en![i]!.end);
      });
    }
  });
});
