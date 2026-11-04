import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncService } from '../src/background/SyncService';
import { MAX_HISTORY, type HistoryEntry } from '../src/lib/history';
import type { SavedWord } from '../src/lib/saved-words';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../src/lib/settings';
import { loadSyncedSettings, parseSyncedSetting } from '../src/lib/synced-settings';
import {
  changesSince,
  fingerprint,
  merge,
  normalizeSyncState,
  snapshot,
  syncKey,
  takeChunk,
  type Collection,
  type SyncChange,
} from '../src/lib/sync';

const b64url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const accessToken = (user: string) => `${b64url({ alg: 'HS256' })}.${b64url({ sub: user })}.sig`;
const account = (user: string) => ({
  name: `${user}@example.com`,
  methods: [],
  accessToken: accessToken(user),
  refreshToken: `refresh-${user}`,
  expiresAt: Date.now() + 3_600_000,
});

const word = (name: string, savedAt = 1000, extra: Partial<SavedWord> = {}): SavedWord => ({
  key: `en:${name}`,
  word: name,
  lang: 'en' as SavedWord['lang'],
  translation: 'перевод',
  context: `a line with ${name}`,
  savedAt,
  srs: { due: savedAt, interval: 0, ease: 2.5, reps: 0, lapses: 0 },
  ...extra,
});

const entry = (id: string, lastAt = 1000, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  url: id,
  title: 'A film',
  host: 'example.com',
  firstAt: lastAt,
  lastAt,
  position: 10,
  duration: 100,
  ...extra,
});

// ---------------------------------------------------------------- the server, by its rules

interface Stored extends SyncChange {
  seq: number;
}

/** server/src/sync.ts in short: the later change wins, an equal time goes to the deletion, pages by seq. */
class FakeServer {
  readonly users = new Map<string, { seq: number; items: Map<string, Stored> }>();
  requests: Array<{ user: string; cursor: number; changes: SyncChange[] }> = [];
  failing = false;
  pageSize = 500;
  onRequest: (() => void) | null = null;

  sync(user: string, body: { cursor: number; changes: SyncChange[] }) {
    this.requests.push({ user, cursor: body.cursor, changes: body.changes });
    this.onRequest?.();
    const data = this.users.get(user) ?? { seq: 0, items: new Map<string, Stored>() };
    this.users.set(user, data);
    for (const change of body.changes) {
      const id = `${change.kind}/${change.key}`;
      const old = data.items.get(id);
      if (
        !old ||
        change.updatedAt > old.updatedAt ||
        (change.updatedAt === old.updatedAt && change.deleted && !old.deleted)
      )
        data.items.set(id, { ...change, seq: (data.seq += 1) });
    }
    if (body.cursor > data.seq) return { cursor: 0, changes: [], more: false, reset: true };
    const after = [...data.items.values()]
      .filter((item) => item.seq > body.cursor)
      .sort((a, b) => a.seq - b.seq);
    const page = after.slice(0, this.pageSize);
    const more = after.length > page.length;
    return {
      cursor: more ? page[page.length - 1]!.seq : data.seq,
      changes: page.map((item): SyncChange => ({
        kind: item.kind,
        key: item.key,
        data: item.data,
        updatedAt: item.updatedAt,
        deleted: item.deleted,
      })),
      more,
      reset: false,
    };
  }

  live(user: string, kind: string) {
    return [...(this.users.get(user)?.items.values() ?? [])]
      .filter((item) => item.kind === kind && !item.deleted)
      .map((item) => item.key);
  }
}

/** One browser profile: its own storage, and its own background. */
class Browser {
  readonly store: Record<string, unknown> = {};
  readonly service = new SyncService();

  constructor(user: string | null) {
    if (user) this.store.account = account(user);
  }

  /** Runs `task` as if in this browser. */
  private use() {
    const store = this.store;
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: async (keys?: string | string[] | null) => {
            if (keys === undefined || keys === null) return { ...store };
            const names = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(names.filter((k) => k in store).map((k) => [k, store[k]]));
          },
          set: async (items: Record<string, unknown>) => void Object.assign(store, items),
          remove: async (key: string) => void delete store[key],
        },
        onChanged: { addListener() {}, removeListener() {} },
      },
      runtime: { getURL: (path: string) => `chrome-extension://id${path}` },
    });
  }

  async sync() {
    this.use();
    await this.service.run();
  }

  get words() {
    return ((this.store.savedWords as SavedWord[] | undefined) ?? []).map((w) => w.word);
  }

  get history() {
    return ((this.store.history as HistoryEntry[] | undefined) ?? []).map((e) => e.id);
  }

  add(...list: SavedWord[]) {
    this.store.savedWords = [...list, ...((this.store.savedWords as SavedWord[]) ?? [])];
  }

  remove(name: string) {
    this.store.savedWords = (this.store.savedWords as SavedWord[]).filter((w) => w.word !== name);
  }

  /** The user changes settings here. */
  set(change: Partial<Settings>) {
    this.store.settings = { ...(this.store.settings as object), ...change };
  }

  get settings(): Settings {
    return normalizeSettings(this.store.settings);
  }

  edit(name: string, change: Partial<SavedWord>) {
    this.store.savedWords = (this.store.savedWords as SavedWord[]).map((w) =>
      w.word === name ? { ...w, ...change } : w,
    );
  }
}

let server: FakeServer;

beforeEach(() => {
  server = new FakeServer();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (String(url).includes('/_locales/'))
      return new Response(JSON.stringify({ hello: { message: 'Bonjour' } }));
    if (server.failing) throw new TypeError('offline');
    const auth = (init.headers as Record<string, string>).authorization ?? '';
    const payload = JSON.parse(atob(auth.replace('Bearer ', '').split('.')[1]!)) as { sub: string };
    const body = JSON.parse(JSON.parse(JSON.stringify(init.body)) as string) as never;
    return new Response(JSON.stringify(server.sync(payload.sub, body)), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------- two browsers, one user

describe('the same user in two browsers', () => {
  it('a word saved in one browser comes to the other', async () => {
    const [one, two] = [new Browser('u1'), new Browser('u1')];
    one.add(word('go'));
    await one.sync();
    await two.sync();
    expect(two.words).toEqual(['go']);
  });

  it('what both browsers have before the first synchronisation is brought together', async () => {
    const [one, two] = [new Browser('u1'), new Browser('u1')];
    one.add(word('go', 1000));
    two.add(word('run', 2000));
    await one.sync();
    await two.sync();
    await one.sync();
    expect(one.words).toEqual(['run', 'go']); // newest first, as the list is kept
    expect(two.words).toEqual(['run', 'go']);
  });

  it('a deleted word goes from the other browser and does not come back', async () => {
    const [one, two] = [new Browser('u1'), new Browser('u1')];
    one.add(word('go'));
    await one.sync();
    await two.sync();
    one.remove('go');
    await one.sync();
    await two.sync();
    await one.sync();
    expect(two.words).toEqual([]);
    expect(one.words).toEqual([]);
  });

  it('a word deleted elsewhere is not brought back by a browser that synchronises for the first time', async () => {
    const [one, two] = [new Browser('u1'), new Browser('u1')];
    one.add(word('go', 1000));
    await one.sync();
    one.remove('go');
    await one.sync();
    two.add(word('go', 1000)); // an old copy: saved before the deletion
    await two.sync();
    expect(two.words).toEqual([]);
  });

  it('a star and a review made in one browser reach the other', async () => {
    const [one, two] = [new Browser('u1'), new Browser('u1')];
    one.add(word('go'));
    await one.sync();
    await two.sync();
    one.edit('go', { favorite: true });
    await one.sync();
    await two.sync();
    expect((two.store.savedWords as SavedWord[])[0]!.favorite).toBe(true);
  });

  it('an old copy does not beat a newer change made elsewhere', async () => {
    const [one, two] = [new Browser('u1'), new Browser('u1')];
    one.add(word('go', 1000));
    await one.sync();
    one.edit('go', { favorite: true });
    await one.sync();
    two.add(word('go', 1000));
    await two.sync();
    expect((two.store.savedWords as SavedWord[])[0]!.favorite).toBe(true);
  });

  it('the history comes along, also for an address longer than a key of the server', async () => {
    const [one, two] = [new Browser('u1'), new Browser('u1')];
    const long = `https://example.com/${'a'.repeat(300)}`;
    one.store.history = [entry(long, 2000), entry('https://example.com/b', 1000)];
    await one.sync();
    expect(server.requests[0]!.changes.every((change) => change.key.length <= 200)).toBe(true);
    await two.sync();
    expect(two.history).toEqual([long, 'https://example.com/b']);
  });

  it('a cleared history is cleared everywhere', async () => {
    const [one, two] = [new Browser('u1'), new Browser('u1')];
    one.store.history = [entry('https://example.com/a')];
    await one.sync();
    await two.sync();
    one.store.history = [];
    await one.sync();
    await two.sync();
    expect(two.history).toEqual([]);
  });

  it('two full histories stay within the limit, and the cut entries are not deleted anywhere', async () => {
    const [one, two] = [new Browser('u1'), new Browser('u1')];
    const many = (from: number) =>
      Array.from({ length: MAX_HISTORY }, (_, i) =>
        entry(`https://example.com/${from + i}`, from + i),
      );
    one.store.history = many(0).reverse();
    two.store.history = many(1000).reverse();
    await one.sync();
    await two.sync();
    await two.sync();
    expect(two.history).toHaveLength(MAX_HISTORY);
    expect(two.history[0]).toBe('https://example.com/1099');
    expect(server.live('u1', 'history')).toHaveLength(2 * MAX_HISTORY);
  });

  it('nothing changed: a second run tells the server nothing', async () => {
    const one = new Browser('u1');
    one.add(word('go'));
    await one.sync();
    await one.sync();
    expect(server.requests[1]!.changes).toEqual([]);
  });
});

// ---------------------------------------------------------------- whose data it is

describe('another user in the same browser', () => {
  it('neither gets the words of the one before, nor sends them to their own account', async () => {
    const shared = new Browser('alice');
    shared.add(word('secret'));
    shared.store.history = [entry('https://example.com/private')];
    await shared.sync();

    shared.store.account = account('bob');
    await shared.sync();

    expect(shared.words).toEqual([]);
    expect(shared.history).toEqual([]);
    expect(server.live('bob', 'words')).toEqual([]);
    expect(server.live('alice', 'words')).toEqual(['en:secret']); // still theirs on the server
  });

  it('the one before finds everything again after signing back in', async () => {
    const shared = new Browser('alice');
    shared.add(word('go'));
    await shared.sync();
    shared.store.account = account('bob');
    await shared.sync();
    shared.store.account = account('alice');
    await shared.sync();
    expect(shared.words).toEqual(['go']);
  });

  it('a sign-out on the way keeps the answer out of the lists', async () => {
    const one = new Browser('u1');
    one.add(word('go'));
    await one.sync();
    const two = new Browser('u1');
    server.onRequest = () => delete two.store.account;
    await two.sync();
    expect(two.words).toEqual([]);
  });

  it('nobody signed in: nothing is sent', async () => {
    const one = new Browser(null);
    one.add(word('go'));
    await one.sync();
    expect(server.requests).toEqual([]);
  });
});

// ---------------------------------------------------------------- what the user asked for, and bad luck

describe('keep history off', () => {
  it('the history does not leave the browser, and what the server has does not come in', async () => {
    const one = new Browser('u1');
    one.store.history = [entry('https://example.com/a')];
    await one.sync();

    const two = new Browser('u1');
    two.store.settings = { keepHistory: false };
    two.store.history = [entry('https://example.com/mine')];
    two.add(word('go'));
    await two.sync();

    expect(server.live('u1', 'history')).toEqual(['https://example.com/a']);
    expect(two.history).toEqual(['https://example.com/mine']);
    expect(server.live('u1', 'words')).toEqual(['en:go']); // the words go on
  });

  it('a history cleared while it is off is cleared on the server too', async () => {
    const one = new Browser('u1');
    one.store.history = [entry('https://example.com/a')];
    await one.sync();
    one.set({ keepHistory: false });
    one.store.history = [];
    await one.sync();

    expect(server.live('u1', 'history')).toEqual([]);
  });
});

describe('settings', () => {
  const clock = (time: number) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(time);
  };

  it('a setting changed in one browser comes to the other', async () => {
    const one = new Browser('u1');
    const two = new Browser('u1');
    await one.sync();
    await two.sync();

    one.set({ fontSize: 40, fontFamily: 'serif' });
    await one.sync();
    await two.sync();

    expect(two.settings.fontSize).toBe(40);
    expect(two.settings.fontFamily).toBe('serif');
  });

  it('a new browser takes the settings of the account, its defaults replace nothing', async () => {
    const one = new Browser('u1');
    one.set({ fontSize: 40 });
    await one.sync();

    const two = new Browser('u1');
    await two.sync();
    await one.sync();

    expect(two.settings.fontSize).toBe(40);
    expect(one.settings.fontSize).toBe(40);
  });

  it('defaults that reach the server first give way to what somebody chose', async () => {
    const fresh = new Browser('u1');
    await fresh.sync();

    const used = new Browser('u1');
    used.set({ fontSize: 40, learnLang: 'ko', nativeLang: 'ru' });
    used.store.panelTheme = 'dark';
    await used.sync();
    await fresh.sync();

    for (const browser of [fresh, used]) {
      expect(browser.settings.fontSize).toBe(40);
      expect(browser.settings.learnLang).toBe('ko');
      expect(browser.store.panelTheme).toBe('dark');
    }
  });

  it('two browsers with their own values: the account keeps the first, for both', async () => {
    const one = new Browser('u1');
    one.set({ fontSize: 40 });
    await one.sync();
    const two = new Browser('u1');
    two.set({ fontSize: 50 });
    await two.sync();

    expect(two.settings.fontSize).toBe(40);
  });

  it('going back to the default on purpose is a change like any other', async () => {
    const one = new Browser('u1');
    one.set({ fontSize: 40 });
    await one.sync();
    const two = new Browser('u1');
    await two.sync();

    one.set({ fontSize: DEFAULT_SETTINGS.fontSize });
    await one.sync();
    await two.sync();

    expect(two.settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });

  it('a change made in the new browser after that goes back', async () => {
    const one = new Browser('u1');
    one.set({ fontSize: 40 });
    await one.sync();
    const two = new Browser('u1');
    await two.sync();

    two.set({ fontSize: 50 });
    await two.sync();
    await one.sync();

    expect(one.settings.fontSize).toBe(50);
  });

  it('different settings changed in two browsers both stay', async () => {
    const one = new Browser('u1');
    const two = new Browser('u1');
    await one.sync();
    await two.sync();

    one.set({ fontSize: 40 });
    two.set({ glassTint: '#1c1c22' });
    await one.sync();
    await two.sync();
    await one.sync();

    for (const browser of [one, two]) {
      expect(browser.settings.fontSize).toBe(40);
      expect(browser.settings.glassTint).toBe('#1c1c22');
    }
  });

  it('the same setting changed in two browsers: the later change stays', async () => {
    const one = new Browser('u1');
    const two = new Browser('u1');
    await one.sync();
    await two.sync();

    clock(2_000_000);
    two.set({ fontSize: 50 });
    await two.sync();
    clock(1_000_000);
    one.set({ fontSize: 40 });
    await one.sync();
    await two.sync();

    expect(one.settings.fontSize).toBe(50);
    expect(two.settings.fontSize).toBe(50);
  });

  it('the two languages of the subtitles travel as a pair', async () => {
    const one = new Browser('u1');
    const two = new Browser('u1');
    await one.sync();
    await two.sync();

    clock(1_000_000);
    one.set({ learnLang: 'ko', nativeLang: 'ru' });
    await one.sync();
    clock(2_000_000);
    two.set({ learnLang: 'en', nativeLang: 'ko' }); // each alone would make ko + ko, which is no pair
    await two.sync();
    await one.sync();

    expect([one.settings.learnLang, one.settings.nativeLang]).toEqual(['en', 'ko']);
  });

  it('the theme and the language of the interface come along, with the texts of the language', async () => {
    const one = new Browser('u1');
    one.store.panelTheme = 'dark';
    one.store.uiLanguage = { code: 'fr', messages: { hello: 'Bonjour' } };
    await one.sync();

    const two = new Browser('u1');
    await two.sync();

    expect(two.store.panelTheme).toBe('dark');
    expect(two.store.uiLanguage).toEqual({ code: 'fr', messages: { hello: 'Bonjour' } });
  });

  it('the switch of the moment and the voices of the system stay in their browser', async () => {
    const one = new Browser('u1');
    one.set({
      enabled: false,
      voiceEn: 'Samantha',
      voiceRu: 'Milena',
      voicesOther: { ko: 'Yuna' },
    });
    await one.sync();

    const two = new Browser('u1');
    await two.sync();

    expect(two.settings.enabled).toBe(true);
    expect(two.settings.voiceEn).toBe('');
    expect(two.settings.voiceRu).toBe('');
    expect(two.settings.voicesOther).toEqual({});
  });

  it('every setting is decided: it follows the account or stays here on purpose', async () => {
    await new Browser('u1').sync();
    const names = (await loadSyncedSettings()).map((setting) => setting.name);
    const stayHere = ['enabled', 'voiceEn', 'voiceRu', 'voicesOther'];
    const pair = ['learnLang', 'nativeLang'];
    for (const name of Object.keys(DEFAULT_SETTINGS))
      expect([...names, ...stayHere, ...pair]).toContain(name);
  });

  it('what does not fit a setting is left out, and the rest comes', async () => {
    const one = new Browser('u1');
    await one.sync();
    server.users.get('u1')!.items.set('settings/fontSize', {
      kind: 'settings',
      key: 'fontSize',
      data: { name: 'fontSize', value: 'huge' },
      updatedAt: Date.now(),
      deleted: false,
      seq: (server.users.get('u1')!.seq += 1),
    });
    const two = new Browser('u1');
    two.set({ fontSize: 30 });
    await two.sync();

    expect(two.settings.fontSize).toBe(30);
    expect(parseSyncedSetting({ name: 'enabled', value: false })).toBeNull();
    expect(parseSyncedSetting({ name: 'fontSize', value: 500 })).toBeNull();
    expect(parseSyncedSetting({ name: 'fontFamily', value: 'comic' })).toBeNull();
    expect(
      parseSyncedSetting({ name: 'languages', value: { learn: 'ko', native: 'ko' } }),
    ).toBeNull();
    expect(parseSyncedSetting({ name: 'theme', value: 'pink' })).toBeNull();
    expect(parseSyncedSetting({ name: 'uiLanguage', value: 'klingon' })).toBeNull();
    expect(parseSyncedSetting('nonsense')).toBeNull();
    expect(parseSyncedSetting({ name: 'fontSize', value: 24 })).toEqual({
      name: 'fontSize',
      value: 24,
    });
  });

  it('another user signing in gets their own settings, not the ones before', async () => {
    const elsewhere = new Browser('u2');
    elsewhere.set({ fontSize: 50 });
    await elsewhere.sync();

    const shared = new Browser('u1');
    shared.set({ fontSize: 40 });
    await shared.sync();
    shared.store.account = account('u2');
    await shared.sync();

    expect(shared.settings.fontSize).toBe(50);
  });

  it('a browser that synchronised before settings were synced reads what it passed', async () => {
    const state = normalizeSyncState({
      owner: 'u1',
      cursor: 500,
      seen: { words: { 'en:go': 'print' }, history: {} },
      lastAt: 1,
    });
    expect(state?.cursor).toBe(0);
    expect(state?.seen.words).toEqual({ 'en:go': 'print' });

    const known = { owner: 'u1', cursor: 500, seen: { words: {}, history: {}, settings: {} } };
    expect(normalizeSyncState(known)?.cursor).toBe(500);
  });

  it('nothing changed: settings tell the server nothing the second time', async () => {
    const one = new Browser('u1');
    await one.sync();
    server.requests = [];
    await one.sync();
    expect(server.requests[0]?.changes).toEqual([]);
  });
});

describe('keep history, now that it follows the account', () => {
  it('a browser where it is off does not get it switched on by the sign-in', async () => {
    const one = new Browser('u1');
    await one.sync();

    const two = new Browser('u1');
    two.set({ keepHistory: false });
    await two.sync();
    await one.sync();

    expect(two.settings.keepHistory).toBe(false);
    expect(one.settings.keepHistory).toBe(false);
  });

  it("not even when the account has it on by somebody's choice", async () => {
    const one = new Browser('u1');
    await one.sync();
    one.set({ keepHistory: false });
    await one.sync();
    one.set({ keepHistory: true });
    await one.sync();

    const two = new Browser('u1');
    two.set({ keepHistory: false });
    await two.sync();

    expect(two.settings.keepHistory).toBe(false);
  });

  it('off in one browser: the other stops taking the history in the same synchronisation', async () => {
    const one = new Browser('u1');
    const two = new Browser('u1');
    await two.sync();
    one.store.history = [entry('https://example.com/a')];
    await one.sync();
    one.set({ keepHistory: false });
    await one.sync();

    await two.sync();

    expect(two.settings.keepHistory).toBe(false);
    expect(two.history).toEqual([]);
  });

  it('switched on again: what passed while it was off is read after all', async () => {
    const one = new Browser('u1');
    const two = new Browser('u1');
    await two.sync();
    one.store.history = [entry('https://example.com/a')];
    await one.sync();
    one.set({ keepHistory: false });
    await one.sync();
    await two.sync();

    one.set({ keepHistory: true });
    await one.sync();
    await two.sync();
    await two.sync();

    expect(two.settings.keepHistory).toBe(true);
    expect(two.history).toEqual(['https://example.com/a']);
  });

  it('switched on elsewhere: the entries that come with it are taken at once', async () => {
    const one = new Browser('u1');
    const two = new Browser('u1');
    one.set({ keepHistory: false });
    await one.sync();
    await two.sync();

    one.set({ keepHistory: true });
    one.store.history = [entry('https://example.com/b')];
    await one.sync();
    await two.sync();

    expect(two.history).toEqual(['https://example.com/b']);
  });
});

describe('a server that fails or forgets', () => {
  it('offline: nothing is lost, and the change goes next time', async () => {
    const one = new Browser('u1');
    one.add(word('go'));
    server.failing = true;
    await one.sync();
    expect(one.words).toEqual(['go']);
    server.failing = false;
    await one.sync();
    expect(server.live('u1', 'words')).toEqual(['en:go']);
  });

  it('a change made while the request is on its way beats what the answer brings', async () => {
    const [one, two] = [new Browser('u1'), new Browser('u1')];
    one.add(word('go'));
    await one.sync();
    await two.sync();
    one.edit('go', { favorite: true });
    await one.sync();

    // The answer carries the star from the other browser, and the user has just changed the word here.
    server.onRequest = () => {
      two.edit('go', { translation: 'идти' });
      server.onRequest = null;
    };
    await two.sync();
    expect((two.store.savedWords as SavedWord[])[0]!.translation).toBe('идти');

    await two.sync();
    const told = server.requests[server.requests.length - 1]!.changes;
    expect(told).toHaveLength(1);
    expect((told[0]!.data as SavedWord).translation).toBe('идти');
  });

  it('asks page after page until the server has no more', async () => {
    const one = new Browser('u1');
    one.add(word('a'), word('b'), word('c'));
    await one.sync();
    server.pageSize = 1;
    const two = new Browser('u1');
    await two.sync();
    expect(two.words.sort()).toEqual(['a', 'b', 'c']);
  });

  it('a forgotten cursor: starts again and sends everything', async () => {
    const one = new Browser('u1');
    one.add(word('go'));
    await one.sync();
    server.users.clear();
    await one.sync();
    expect(server.live('u1', 'words')).toEqual(['en:go']);
  });
});

describe('when the server hears of a change', () => {
  beforeEach(() => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));

  it('a saved word goes after a few seconds, several in one request', async () => {
    const one = new Browser('u1');
    await one.sync();
    server.requests = [];
    one.add(word('go'));
    one.service.changed();
    one.add(word('run'));
    one.service.changed();
    await vi.advanceTimersByTimeAsync(4000);
    expect(server.requests).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(server.requests).toHaveLength(1));
    expect(server.requests[0]!.changes).toHaveLength(2);
  });

  it('its own writing into the list asks the server nothing', async () => {
    const one = new Browser('u1');
    await one.sync();
    server.requests = [];
    one.service.changed();
    await vi.advanceTimersByTimeAsync(6000);
    await Promise.resolve();
    expect(server.requests).toEqual([]);
  });

  it('a playing video does not reach the server every time the history is written', async () => {
    const one = new Browser('u1');
    one.store.history = [entry('https://example.com/a')];
    await one.sync();
    server.requests = [];
    one.store.history = [entry('https://example.com/a', 2000)];
    await one.service.historyChanged();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.requests).toEqual([]);
  });

  it('after a while the history goes too', async () => {
    const one = new Browser('u1');
    one.store.history = [entry('https://example.com/a')];
    await one.sync();
    server.requests = [];
    (one.store.syncState as { lastAt: number }).lastAt = Date.now() - 6 * 60 * 1000;
    one.store.history = [entry('https://example.com/a', 2000)];
    await one.service.historyChanged();
    await vi.advanceTimersByTimeAsync(21_000);
    await vi.waitFor(() => expect(server.requests).toHaveLength(1));
  });
});

// ---------------------------------------------------------------- the parts

const plain: Collection<SavedWord> = {
  kind: 'words',
  enabled: async () => true,
  load: async () => [],
  save: async () => {},
  idOf: (item) => item.key,
  timeOf: (item) => item.savedAt,
  parse: (data) => data as SavedWord,
  arrange: (list) => list,
};

describe('comparing', () => {
  it('a thing the server may not know keeps its time, a changed one is of now', async () => {
    const list = [word('new', 111), word('changed', 222)];
    const seen = { 'en:changed': 'another print' };
    const changes = changesSince(plain, await snapshot(plain, list), seen, 999);
    expect(changes.map((c) => [c.key, c.updatedAt])).toEqual([
      ['en:new', 111],
      ['en:changed', 999],
    ]);
  });

  it('what has gone is told as a deletion of now', async () => {
    const changes = changesSince(plain, await snapshot(plain, []), { 'en:gone': 'x' }, 999);
    expect(changes).toEqual([
      { kind: 'words', key: 'en:gone', data: null, updatedAt: 999, deleted: true },
    ]);
  });

  it('a thing too big for the server stays here, and does not stop the others', async () => {
    const list = [word('huge', 1, { context: 'x'.repeat(20_000) }), word('small')];
    const changes = changesSince(plain, await snapshot(plain, list), {}, 999);
    expect(changes.map((c) => c.key)).toEqual(['en:small']);
  });

  it('the order of the fields is no change', async () => {
    expect(await fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(
      await fingerprint({ b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(await fingerprint({ a: 1 })).not.toBe(await fingerprint({ a: 2 }));
  });

  it('a short id is its own key, a long one a hash', async () => {
    expect(await syncKey('en:go')).toBe('en:go');
    const long = await syncKey('x'.repeat(500));
    expect(long).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(long.length).toBeLessThanOrEqual(200);
  });
});

describe('requests within the limits of the server', () => {
  const change = (size: number): SyncChange => ({
    kind: 'words',
    key: 'k',
    data: 'x'.repeat(size),
    updatedAt: 1,
    deleted: false,
  });

  it('at most 400 changes at a time', () => {
    const queue = Array.from({ length: 1000 }, () => change(1));
    expect(takeChunk(queue)).toHaveLength(400);
    expect(queue).toHaveLength(600);
  });

  it('under a megabyte at a time', () => {
    const queue = Array.from({ length: 100 }, () => change(15_000));
    const chunk = takeChunk(queue);
    expect(JSON.stringify(chunk).length).toBeLessThan(1024 * 1024);
    expect(chunk.length + queue.length).toBe(100);
  });
});

describe('merging', () => {
  it('skips what is not a thing of the list, or came under the wrong key', async () => {
    const parse = (data: unknown) => (typeof data === 'object' ? (data as SavedWord) : null);
    const remote: SyncChange[] = [
      { kind: 'words', key: 'en:a', data: 'not a word', updatedAt: 1, deleted: false },
      { kind: 'words', key: 'en:b', data: word('other'), updatedAt: 1, deleted: false },
    ];
    const merged = await merge({ ...plain, parse }, new Map(), {}, remote);
    expect(merged.list).toBeNull();
  });

  it('leaves the list alone when nothing changed', async () => {
    const item = word('go');
    const current = await snapshot(plain, [item]);
    const seen = { 'en:go': current.get('en:go')!.print };
    const remote: SyncChange[] = [
      { kind: 'words', key: 'en:go', data: item, updatedAt: 1, deleted: false },
    ];
    expect((await merge(plain, current, seen, remote)).list).toBeNull();
  });
});
