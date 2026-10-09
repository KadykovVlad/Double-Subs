import { describe, expect, it } from 'vitest';
import {
  cleanTitle,
  displayUrl,
  historyId,
  MAX_HISTORY,
  normalizeHistory,
  resumeUrl,
  upsertEntry,
  type HistoryEntry,
} from '../src/lib/history';

const entry = (id: string, lastAt: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  url: `https://${id}.example/watch`,
  title: id,
  host: `${id}.example`,
  firstAt: lastAt,
  lastAt,
  position: 0,
  duration: 100,
  ...extra,
});

describe('historyId', () => {
  it('tells YouTube videos apart by v and ignores the rest', () => {
    expect(historyId('https://www.youtube.com/watch?v=abc&t=30s&list=x')).toBe(
      'https://www.youtube.com/watch?v=abc',
    );
    expect(historyId('https://www.youtube.com/watch?v=abc')).not.toBe(
      historyId('https://www.youtube.com/watch?v=def'),
    );
  });
  it('is the page without query and fragment elsewhere', () => {
    expect(historyId('https://site.example/series/1.html?utm=1#player')).toBe(
      'https://site.example/series/1.html',
    );
  });
});

describe('upsertEntry', () => {
  it('puts the entry first and keeps the first time seen', () => {
    const list = upsertEntry([entry('a', 1), entry('b', 2)], entry('a', 10, { position: 42 }));
    expect(list.map((e) => e.id)).toEqual(['a', 'b']);
    expect(list[0]).toMatchObject({ firstAt: 1, lastAt: 10, position: 42 });
  });
  it('is cut to the limit, oldest out', () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < MAX_HISTORY + 5; i++) list = upsertEntry(list, entry(`v${i}`, i));
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0]!.id).toBe(`v${MAX_HISTORY + 4}`);
    expect(list.some((e) => e.id === 'v0')).toBe(false);
  });
});

describe('titles, links, repair', () => {
  it('cleans the YouTube suffix and falls back to the host', () => {
    expect(cleanTitle('Dexter: Resurrection - YouTube', 'www.youtube.com')).toBe(
      'Dexter: Resurrection',
    );
    expect(cleanTitle('   ', 'site.example')).toBe('site.example');
  });
  it('resumes a YouTube video at the stopped second only', () => {
    const yt = entry('yt', 1, { url: 'https://www.youtube.com/watch?v=abc', position: 125.7 });
    expect(resumeUrl(yt)).toBe('https://www.youtube.com/watch?v=abc&t=125s');
    expect(resumeUrl({ ...yt, position: 3 })).toBe('https://www.youtube.com/watch?v=abc');
    const other = entry('o', 1, { position: 500 });
    expect(resumeUrl(other)).toBe(other.url);
  });
  it('drops broken records', () => {
    expect(normalizeHistory('x')).toEqual([]);
    expect(
      normalizeHistory([
        { id: 'a', url: 'javascript:alert(1)' },
        { id: 'b', url: 'https://b.example/x', duration: -5 },
      ]),
    ).toEqual([expect.objectContaining({ id: 'b', duration: 0, position: 0 })]);
  });
});

describe('displayUrl', () => {
  it('shows an address for people', () => {
    expect(displayUrl('https://www.youtube.com/watch?v=abc#t=5')).toBe('youtube.com/watch?v=abc');
    expect(displayUrl('https://ga.lordfilm5.pro/serialy/43252-dekster.html')).toBe(
      'ga.lordfilm5.pro/serialy/43252-dekster.html',
    );
    expect(displayUrl('https://site.example/')).toBe('site.example');
    expect(displayUrl('not a url')).toBe('not a url');
  });
});
