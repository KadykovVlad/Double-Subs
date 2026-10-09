import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { MAX_ENTRIES, openTranslationCache } from '../src/translation/cache';
import { currentCueIndex, nextChunkStart } from '../src/translation/chunks';
import { fingerprint } from '../src/translation/fingerprint';
import { handleTranslationRequest } from '../src/translation/handler';
import { polishTranslation, toTranslatorText } from '../src/translation/polish';
import { TranslatorPool } from '../src/translation/pool';
import {
  runTranslation,
  TranslationError,
  type TranslationService,
  type TranslationUpdate,
} from '../src/translation/session';
import type { Cue } from '../src/lib/types';
import type { TranslatorInstance, TranslatorStatic } from '../src/lib/translator';

const cues = (count: number, textOf = (i: number) => `line ${i}`): Cue[] =>
  Array.from({ length: count }, (_, i) => ({ start: i * 3, end: i * 3 + 2, text: textOf(i) }));

// ------------------------------------------------------------ polish

describe('polishTranslation', () => {
  it('capitalises the first letter of every line, keeping a dialogue dash', () => {
    expect(polishTranslation('ты меня услышал.')).toBe('Ты меня услышал.');
    expect(polishTranslation('- привет.\n- здравствуй.')).toBe('- Привет.\n- Здравствуй.');
    expect(polishTranslation('«хорошо иметь это по-своему»')).toBe('«Хорошо иметь это по-своему»');
  });

  it('leaves correct text, digits and symbols alone and cleans whitespace', () => {
    expect(polishTranslation('Уже готово.')).toBe('Уже готово.');
    expect(polishTranslation('  2 раза  в день ')).toBe('2 раза в день');
    expect(polishTranslation('…и всё')).toBe('…и всё');
    expect(polishTranslation('')).toBe('');
  });

  it('works for English targets too', () => {
    expect(polishTranslation('you heard me.')).toBe('You heard me.');
  });
});

describe('toTranslatorText', () => {
  it('joins the lines of a cue, because the translator takes one string', () => {
    expect(toTranslatorText('- Hi.\n- Hello.')).toBe('- Hi. - Hello.');
  });
});

// ------------------------------------------------------------ chunks

describe('currentCueIndex', () => {
  const list = cues(10); // cue i is on screen from 3i to 3i+2

  it('is the cue on screen, or the next one between cues', () => {
    expect(currentCueIndex(list, 0)).toBe(0);
    expect(currentCueIndex(list, 7)).toBe(2);
    expect(currentCueIndex(list, 8.5)).toBe(3);
  });

  it('is the last cue when the video is past all of them, and 0 for an empty list', () => {
    expect(currentCueIndex(list, 1000)).toBe(9);
    expect(currentCueIndex([], 5)).toBe(0);
  });
});

describe('nextChunkStart', () => {
  const allPending = () => true;

  it('starts with the chunk that holds the current cue', () => {
    expect(nextChunkStart(allPending, 100, 20, 45)).toBe(40);
    expect(nextChunkStart(allPending, 100, 20, 0)).toBe(0);
  });

  it('then goes forward and wraps around to the earlier chunks', () => {
    const done = new Set<number>();
    const pending = (i: number) => !done.has(i);
    const order: number[] = [];
    for (
      let start = nextChunkStart(pending, 100, 20, 45);
      start !== null;
      start = nextChunkStart(pending, 100, 20, 45)
    ) {
      order.push(start);
      for (let i = start; i < start + 20; i++) done.add(i);
    }
    expect(order).toEqual([40, 60, 80, 0, 20]);
  });

  it('skips chunks with nothing left and returns null when everything is done', () => {
    expect(nextChunkStart((i) => i >= 60, 100, 20, 0)).toBe(60);
    expect(nextChunkStart(() => false, 100, 20, 0)).toBeNull();
    expect(nextChunkStart(allPending, 0, 20, 0)).toBeNull();
  });

  it('handles a last chunk shorter than the others', () => {
    expect(nextChunkStart((i) => i >= 90, 95, 20, 0)).toBe(80);
  });
});

// ------------------------------------------------------------ fingerprint

describe('fingerprint', () => {
  it('is the same for the same texts and direction, anywhere', async () => {
    expect(await fingerprint(['a', 'b'], 'en-ru')).toBe(await fingerprint(['a', 'b'], 'en-ru'));
  });

  it('differs when a text, the order or the direction differs', async () => {
    const base = await fingerprint(['a', 'b'], 'en-ru');
    expect(await fingerprint(['a', 'c'], 'en-ru')).not.toBe(base);
    expect(await fingerprint(['b', 'a'], 'en-ru')).not.toBe(base);
    expect(await fingerprint(['a', 'b'], 'ru-en')).not.toBe(base);
    expect(await fingerprint(['ab', ''], 'en-ru')).not.toBe(base); // no boundary confusion
  });
});

// ------------------------------------------------------------ cache

describe('translation cache (IndexedDB)', () => {
  it('stores and returns translations, null for an unknown key', async () => {
    const cache = openTranslationCache();
    expect(await cache.get('missing')).toBeNull();
    await cache.put('k1', ['один', '', 'три']);
    expect(await cache.get('k1')).toEqual(['один', '', 'три']);
  });

  it('overwrites an entry', async () => {
    const cache = openTranslationCache();
    await cache.put('k2', ['a']);
    await cache.put('k2', ['a', 'b']);
    expect(await cache.get('k2')).toEqual(['a', 'b']);
  });

  it('forgets the oldest entries beyond the limit', async () => {
    let clock = 1;
    const cache = openTranslationCache(new IDBFactory(), () => clock++); // an empty database of its own
    for (let i = 0; i < MAX_ENTRIES + 3; i++) await cache.put(`bulk-${i}`, [String(i)]);
    expect(await cache.get('bulk-0')).toBeNull();
    expect(await cache.get('bulk-2')).toBeNull();
    expect(await cache.get('bulk-3')).toEqual(['3']);
    expect(await cache.get(`bulk-${MAX_ENTRIES + 2}`)).toEqual([String(MAX_ENTRIES + 2)]);
  });
});

// ------------------------------------------------------------ session

interface FakeService extends TranslationService {
  calls: string[][];
  cache: Map<string, string[]>;
}

function fakeService(overrides: Partial<TranslationService> = {}): FakeService {
  const calls: string[][] = [];
  const cache = new Map<string, string[]>();
  return {
    calls,
    cache,
    availability: async () => 'available',
    translate: async (_direction, texts) => {
      calls.push(texts);
      return texts.map((text) => text.toLowerCase().replace('line', 'строка'));
    },
    cacheGet: async (key) => cache.get(key) ?? null,
    cachePut: async (key, translations) => void cache.set(key, [...translations]),
    ...overrides,
  };
}

async function run(
  source: Cue[],
  service: TranslationService,
  options: { time?: () => number; chunkSize?: number; signal?: AbortSignal } = {},
) {
  const updates: TranslationUpdate[] = [];
  await runTranslation({
    source,
    direction: 'en-ru',
    getTime: options.time ?? (() => 0),
    service,
    onUpdate: (update) => updates.push(update),
    chunkSize: options.chunkSize ?? 5,
    retryDelayMs: 0,
    signal: options.signal,
  });
  return { updates, last: updates[updates.length - 1]! };
}

describe('runTranslation', () => {
  it('translates everything chunk by chunk, with the translated cues keeping the source timing', async () => {
    const service = fakeService();
    const { last, updates } = await run(cues(12), service);

    expect(service.calls.map((texts) => texts.length)).toEqual([5, 5, 2]);
    expect(last.status).toEqual({ state: 'done', total: 12, fromCache: false });
    expect(last.cues).toHaveLength(12);
    expect(last.cues[0]).toEqual({ start: 0, end: 2, text: 'Строка 0' }); // translated and capitalised
    expect(last.cues[11]).toEqual({ start: 33, end: 35, text: 'Строка 11' });
    // Progress is reported after each chunk, then the final state.
    expect(updates.map((u) => (u.status.state === 'translating' ? u.status.done : 'done'))).toEqual(
      [0, 5, 10, 12, 'done'],
    );
  });

  it('starts with the chunk around the playback position and re-prioritises after a seek', async () => {
    const service = fakeService();
    const source = cues(30);
    let time = 3 * 17; // cue 17 is on screen
    const seen: string[] = [];
    const tracking: TranslationService = {
      ...service,
      translate: async (direction, texts) => {
        seen.push(texts[0]!);
        if (seen.length === 1) time = 0; // the user seeks back to the start after the first chunk
        return service.translate(direction, texts);
      },
    };
    await run(source, tracking, { time: () => time });
    // First the chunk with cue 17 (15–19), then, after the seek to 0, the chunks from the start.
    expect(seen).toEqual(['line 15', 'line 0', 'line 5', 'line 10', 'line 20', 'line 25']);
  });

  it('uses a complete cache without translating anything', async () => {
    const service = fakeService();
    const source = cues(6);
    await run(source, service);
    service.calls.length = 0;

    const { last, updates } = await run(source, service);
    expect(service.calls).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(last.status).toEqual({ state: 'done', total: 6, fromCache: true });
    expect(last.cues).toHaveLength(6);
  });

  it('resumes from a partly filled cache and shows the cached lines at once', async () => {
    const service = fakeService();
    const source = cues(10);
    const key = await fingerprint(
      source.map((c) => c.text),
      'en-ru',
    );
    service.cache.set(key, ['Один', 'Два', 'Три', 'Четыре', 'Пять', '', '', '', '', '']);

    const { updates } = await run(source, service);
    expect(updates[0]!.cues.map((c) => c.text)).toEqual(['Один', 'Два', 'Три', 'Четыре', 'Пять']);
    expect(service.calls).toEqual([['line 5', 'line 6', 'line 7', 'line 8', 'line 9']]);
  });

  it('ignores a cache entry that does not fit the subtitles', async () => {
    const service = fakeService();
    const source = cues(4);
    service.cache.set(
      await fingerprint(
        source.map((c) => c.text),
        'en-ru',
      ),
      ['only one'],
    );
    const { last } = await run(source, service);
    expect(last.cues.map((c) => c.text)).toEqual(['Строка 0', 'Строка 1', 'Строка 2', 'Строка 3']);
  });

  it('saves progress in the cache', async () => {
    const service = fakeService();
    const source = cues(8);
    await run(source, service);
    const saved = service.cache.get(
      await fingerprint(
        source.map((c) => c.text),
        'en-ru',
      ),
    );
    expect(saved).toEqual(
      [
        'Строка 0',
        'Строка 1',
        'Строка 2',
        'Строка 3',
        'Строка 4',
        'Строка 5',
        'Строка 6',
        'Строка 7',
      ].map((t) => t),
    );
  });

  it('reports a missing model and does not translate', async () => {
    const service = fakeService({ availability: async () => 'needs-model' });
    const { last } = await run(cues(6), service);
    expect(last.status).toEqual({ state: 'needs-model' });
    expect(service.calls).toEqual([]);
  });

  it('reports an unavailable translator', async () => {
    const { last } = await run(cues(6), fakeService({ availability: async () => 'unavailable' }));
    expect(last.status).toEqual({ state: 'unavailable' });
  });

  it('reports a model that disappears mid-way and keeps what was translated', async () => {
    const service = fakeService();
    let calls = 0;
    const flaky: TranslationService = {
      ...service,
      translate: async (direction, texts) => {
        if (++calls === 2) throw new TranslationError('needs-model');
        return service.translate(direction, texts);
      },
    };
    const { last } = await run(cues(15), flaky);
    expect(last.status).toEqual({ state: 'needs-model' });
    expect(last.cues).toHaveLength(5);
  });

  it('retries a failed chunk and carries on', async () => {
    const service = fakeService();
    let failures = 1;
    const flaky: TranslationService = {
      ...service,
      translate: async (direction, texts) => {
        if (failures-- > 0) throw new TranslationError('failed');
        return service.translate(direction, texts);
      },
    };
    const { last } = await run(cues(5), flaky);
    expect(last.status).toEqual({ state: 'done', total: 5, fromCache: false });
    expect(last.cues).toHaveLength(5);
  });

  it('gives up with an error after repeated failures', async () => {
    const broken = fakeService({
      translate: async () => {
        throw new TranslationError('failed');
      },
    });
    const { last } = await run(cues(30), broken);
    expect(last.status).toMatchObject({ state: 'error', done: 0, total: 30 });
  });

  it('retries a single line the translator skipped, and drops it if it still fails', async () => {
    const service = fakeService({
      translate: async (_direction, texts) =>
        texts.map((text) =>
          text === 'line 1' ? '' : text === 'line 2' ? (texts.length === 1 ? 'второй' : '') : text,
        ),
    });
    const { last } = await run(cues(4), service);
    expect(last.cues.map((c) => c.text)).toEqual(['Line 0', 'Второй', 'Line 3']);
    expect(last.status.state).toBe('done');
  });

  it('stops when aborted and does not report afterwards', async () => {
    const controller = new AbortController();
    const service = fakeService();
    const aborting: TranslationService = {
      ...service,
      translate: async (direction, texts) => {
        controller.abort();
        return service.translate(direction, texts);
      },
    };
    const { updates } = await run(cues(30), aborting, { signal: controller.signal });
    expect(updates.every((u) => u.status.state === 'translating')).toBe(true);
  });

  it('does nothing for an empty source', async () => {
    const { last } = await run([], fakeService());
    expect(last.status).toEqual({ state: 'done', total: 0, fromCache: false });
  });
});

// ------------------------------------------------------------ pool + handler

function fakeApi(availability: 'available' | 'downloadable' | 'unavailable' = 'available') {
  let created = 0;
  const translator: TranslatorInstance = {
    translate: async (text) => {
      if (text === 'boom') throw new Error('rejected');
      return `RU:${text}`;
    },
    destroy() {},
  };
  const api: TranslatorStatic = {
    availability: async () => availability,
    create: async () => {
      created++;
      return translator;
    },
  };
  return { api, created: () => created };
}

describe('TranslatorPool', () => {
  it('translates sequentially and creates one translator per direction', async () => {
    const { api, created } = fakeApi();
    const pool = new TranslatorPool(async () => api);
    expect(await pool.translate('en-ru', ['a', '- b\nc'])).toEqual(['RU:a', 'RU:- b c']);
    await pool.translate('en-ru', ['d']);
    expect(created()).toBe(1);
    await pool.translate('ru-en', ['e']);
    expect(created()).toBe(2);
  });

  it('returns an empty string for a text the translator rejects', async () => {
    const pool = new TranslatorPool(async () => fakeApi().api);
    expect(await pool.translate('en-ru', ['a', 'boom', 'c'])).toEqual(['RU:a', '', 'RU:c']);
  });

  it('maps availability: downloadable means the model is needed, no API means unavailable', async () => {
    expect(
      await new TranslatorPool(async () => fakeApi('downloadable').api).availability('en-ru'),
    ).toBe('needs-model');
    expect(
      await new TranslatorPool(async () => fakeApi('unavailable').api).availability('en-ru'),
    ).toBe('unavailable');
    expect(await new TranslatorPool(async () => null).availability('en-ru')).toBe('unavailable');
  });

  it('never tries to download a model by itself', async () => {
    const { api, created } = fakeApi('downloadable');
    await expect(
      new TranslatorPool(async () => api).translate('en-ru', ['a']),
    ).rejects.toMatchObject({ code: 'needs-model' });
    expect(created()).toBe(0);
  });
});

describe('handleTranslationRequest', () => {
  const pool = new TranslatorPool(async () => fakeApi().api);
  const cache = openTranslationCache();

  it('answers every request type', async () => {
    expect(
      await handleTranslationRequest({ type: 'availability', direction: 'en-ru' }, pool, cache),
    ).toEqual({ ok: true, value: 'available' });
    expect(
      await handleTranslationRequest(
        { type: 'translate', direction: 'en-ru', texts: ['x'] },
        pool,
        cache,
      ),
    ).toEqual({ ok: true, value: ['RU:x'] });
    await handleTranslationRequest(
      { type: 'cache-put', key: 'h1', translations: ['а'] },
      pool,
      cache,
    );
    expect(await handleTranslationRequest({ type: 'cache-get', key: 'h1' }, pool, cache)).toEqual({
      ok: true,
      value: ['а'],
    });
  });

  it('turns errors into error replies instead of throwing', async () => {
    const needsModel = new TranslatorPool(async () => fakeApi('downloadable').api);
    expect(
      await handleTranslationRequest(
        { type: 'translate', direction: 'en-ru', texts: ['x'] },
        needsModel,
        cache,
      ),
    ).toEqual({ ok: false, code: 'needs-model' });
    const broken = {
      availability: async () => {
        throw new Error('x');
      },
    } as unknown as TranslatorPool;
    // An unexpected error keeps its text for diagnostics; the known codes need none.
    expect(
      await handleTranslationRequest({ type: 'availability', direction: 'en-ru' }, broken, cache),
    ).toEqual({
      ok: false,
      code: 'failed',
      detail: 'Error: x',
    });
  });
});
