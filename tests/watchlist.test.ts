import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addToWatchlist,
  loadWatchlist,
  MAX_WATCHLIST,
  normalizeWatchItem,
  removeFromWatchlist,
  saveWatchlist,
  watchId,
  watchUrl,
} from '../src/lib/watchlist';

describe('the address of a thing to watch', () => {
  it('keeps a web address without its fragment', () => {
    expect(watchUrl(' https://films.example/a?id=5#t=3 ')).toBe('https://films.example/a?id=5');
    expect(watchUrl('http://films.example/a')).toBe('http://films.example/a');
  });

  it('takes an address written without its beginning', () => {
    expect(watchUrl('films.example/a')).toBe('https://films.example/a');
  });

  it('refuses what is not a web address', () => {
    for (const bad of [
      '',
      'not a link',
      'word',
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'ftp://films.example/a',
      'chrome://settings',
      'https://user:secret@films.example/a',
    ])
      expect(watchUrl(bad)).toBeNull();
  });

  it('one YouTube video is one thing, whatever the place or the playlist', () => {
    expect(watchId('https://www.youtube.com/watch?v=abc&t=30s&list=x')).toBe(
      watchId('https://www.youtube.com/watch?v=abc'),
    );
    expect(watchId('https://www.youtube.com/watch?v=abc')).not.toBe(
      watchId('https://www.youtube.com/watch?v=def'),
    );
  });

  it('elsewhere the query tells videos apart', () => {
    expect(watchId('https://films.example/watch?id=1')).not.toBe(
      watchId('https://films.example/watch?id=2'),
    );
  });
});

describe('a thing from the storage or the server', () => {
  it('is rebuilt from its address, whatever it claims', () => {
    expect(
      normalizeWatchItem({
        id: 'other',
        url: 'https://films.example/a',
        title: 'A film - YouTube',
        host: 'evil.example',
        addedAt: 5,
      }),
    ).toEqual({
      id: 'https://films.example/a',
      url: 'https://films.example/a',
      title: 'A film',
      host: 'films.example',
      addedAt: 5,
    });
  });

  it('with no title goes by its site, a long title is cut', () => {
    const url = 'https://films.example/a';
    expect(normalizeWatchItem({ url })?.title).toBe('films.example');
    expect(normalizeWatchItem({ url, title: 'x'.repeat(1000) })?.title).toHaveLength(300);
  });

  it('is left out when it is not one', () => {
    expect(normalizeWatchItem({ url: 'javascript:alert(1)' })).toBeNull();
    expect(normalizeWatchItem({ title: 'no address' })).toBeNull();
    expect(normalizeWatchItem('nonsense')).toBeNull();
    expect(normalizeWatchItem(null)).toBeNull();
  });
});

describe('the list', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
          set: async (items: Record<string, unknown>) => void Object.assign(store, items),
        },
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  const add = (url: string, title = 'A film') => addToWatchlist({ url, title });

  it('the newest goes first', async () => {
    expect(await add('https://films.example/a')).toBe('added');
    expect(await add('https://films.example/b')).toBe('added');
    expect((await loadWatchlist()).map((item) => item.url)).toEqual([
      'https://films.example/b',
      'https://films.example/a',
    ]);
  });

  it('the same address is not added twice', async () => {
    await add('https://films.example/a#one');
    expect(await add('https://films.example/a#two')).toBe('exists');
    expect(await loadWatchlist()).toHaveLength(1);
  });

  it('what is not a web address is not added', async () => {
    expect(await add('javascript:alert(1)')).toBe('bad-url');
    expect(await loadWatchlist()).toEqual([]);
  });

  it('a full list says so and takes nothing more', async () => {
    await saveWatchlist(
      Array.from({ length: MAX_WATCHLIST }, (_, index) => ({
        id: `https://films.example/${index}`,
        url: `https://films.example/${index}`,
        title: 'A film',
        host: 'films.example',
        addedAt: index,
      })),
    );
    expect(await add('https://films.example/one-more')).toBe('full');
    expect(await loadWatchlist()).toHaveLength(MAX_WATCHLIST);
  });

  it('a thing can be taken off', async () => {
    await add('https://films.example/a');
    await add('https://films.example/b');
    await removeFromWatchlist('https://films.example/a');
    expect((await loadWatchlist()).map((item) => item.id)).toEqual(['https://films.example/b']);
  });
});
