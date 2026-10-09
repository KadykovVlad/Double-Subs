import { describe, expect, it } from 'vitest';
import { QUALITY_SAMPLE, speedSample } from '../src/lib/sample-dialogue';
import {
  benchmark,
  probeTranslator,
  translateBatch,
  type TranslatorInstance,
  type TranslatorStatic,
} from '../src/lib/translator';

/** Fake translator: upper-cases text and records calls; `joinedLines` changes what a joined call returns. */
function fakeTranslator(options: { delayMs?: number; mangleJoined?: boolean } = {}) {
  const calls: string[] = [];
  let active = 0;
  let maxActive = 0;
  const translator: TranslatorInstance = {
    async translate(text) {
      calls.push(text);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
      active--;
      const result = text.toUpperCase();
      return options.mangleJoined && text.includes('\n') ? result.replace('\n', ' ') : result;
    },
    destroy() {},
  };
  return { translator, calls, maxActive: () => maxActive };
}

describe('translateBatch', () => {
  const texts = ['one', 'two\nlines', 'three'];

  it('sequential: one call per cue, in order, never concurrent', async () => {
    const fake = fakeTranslator({ delayMs: 1 });
    const result = await translateBatch(fake.translator, texts, 'sequential');
    expect(result).toEqual({ translations: ['ONE', 'TWO\nLINES', 'THREE'], linesMatched: true });
    expect(fake.calls).toHaveLength(3);
    expect(fake.maxActive()).toBe(1);
  });

  it('parallel: one call per cue, all at once, results in order', async () => {
    const fake = fakeTranslator({ delayMs: 1 });
    const result = await translateBatch(fake.translator, texts, 'parallel');
    expect(result.translations).toEqual(['ONE', 'TWO\nLINES', 'THREE']);
    expect(fake.maxActive()).toBe(3);
  });

  it('joined: a single call, line breaks inside a cue do not split it', async () => {
    const fake = fakeTranslator();
    const result = await translateBatch(fake.translator, texts, 'joined');
    expect(fake.calls).toEqual(['one\ntwo lines\nthree']);
    expect(result).toEqual({ translations: ['ONE', 'TWO LINES', 'THREE'], linesMatched: true });
  });

  it('joined: reports when the translation merged lines', async () => {
    const fake = fakeTranslator({ mangleJoined: true });
    const result = await translateBatch(fake.translator, texts, 'joined');
    expect(result.linesMatched).toBe(false);
  });
});

describe('probeTranslator', () => {
  it('reports a missing API', async () => {
    expect(await probeTranslator('somewhere', {})).toEqual({
      context: 'somewhere',
      apiPresent: false,
      enRu: null,
      ruEn: null,
      error: null,
    });
  });

  it('reports availability for both directions', async () => {
    const Translator: Partial<TranslatorStatic> = {
      availability: async ({ sourceLanguage }) =>
        sourceLanguage === 'en' ? 'available' : 'downloadable',
    };
    expect(await probeTranslator('lab', { Translator })).toMatchObject({
      apiPresent: true,
      enRu: 'available',
      ruEn: 'downloadable',
      error: null,
    });
  });

  it('reports why availability failed (e.g. blocked by permissions policy)', async () => {
    const Translator: Partial<TranslatorStatic> = {
      availability: async () => {
        throw new DOMException('Access denied', 'NotAllowedError');
      },
    };
    expect((await probeTranslator('iframe', { Translator })).error).toBe(
      'NotAllowedError: Access denied',
    );
  });
});

describe('benchmark', () => {
  it('times every strategy and keeps the sequential translations', async () => {
    const fake = fakeTranslator();
    let clock = 0;
    const Translator: Partial<TranslatorStatic> = { create: async () => fake.translator };
    const result = await benchmark(
      'lab',
      ['a', 'b'],
      undefined,
      { Translator },
      () => (clock += 10),
    );

    expect(result.error).toBeNull();
    expect(result.createMs).toBe(10);
    expect(result.timings.map((t) => [t.strategy, t.totalMs, t.perCueMs, t.linesMatched])).toEqual([
      ['sequential', 10, 5, true],
      ['parallel', 10, 5, true],
      ['joined', 10, 5, true],
    ]);
    expect(result.translations).toEqual(['A', 'B']);
  });

  it('reports a failed create() (e.g. the model is not downloaded and there is no user gesture)', async () => {
    const Translator: Partial<TranslatorStatic> = {
      create: async () => {
        throw new DOMException('Requires a user gesture', 'NotAllowedError');
      },
    };
    const result = await benchmark('offscreen', ['a'], undefined, { Translator });
    expect(result.error).toBe('NotAllowedError: Requires a user gesture');
    expect(result.timings).toEqual([]);
  });

  it('reports a missing API without throwing', async () => {
    expect((await benchmark('content script', ['a'], undefined, {})).error).toMatch(
      /not available/,
    );
  });
});

describe('sample dialogue', () => {
  it('has 50 quality lines with references', () => {
    expect(QUALITY_SAMPLE).toHaveLength(50);
    expect(QUALITY_SAMPLE.every((line) => line.en && line.reference)).toBe(true);
  });

  it('builds 200 unique lines for the speed test, starting with the quality sample', () => {
    const lines = speedSample(200);
    expect(lines).toHaveLength(200);
    expect(new Set(lines).size).toBe(200);
    expect(lines.slice(0, 50)).toEqual(QUALITY_SAMPLE.map((line) => line.en));
  });
});
