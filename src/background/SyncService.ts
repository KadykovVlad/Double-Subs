import { accountOwner, authedCall, loadAccount } from '../lib/account';
import { clearSiteLists } from '../lib/known-sites';
import { loadHistory, MAX_HISTORY, normalizeHistory, saveHistory } from '../lib/history';
import type { HistoryEntry } from '../lib/history';
import { loadSavedWords, normalizeSavedWord, saveSavedWords } from '../lib/saved-words';
import type { SavedWord } from '../lib/saved-words';
import { loadSettings } from '../lib/settings';
import {
  loadSyncedSites,
  parseSyncedSite,
  saveSyncedSites,
  siteKey,
  siteTime,
  type SyncedSite,
} from '../lib/synced-sites';
import {
  loadSyncedSettings,
  parseSyncedSetting,
  saveSyncedSettings,
  settingTime,
  type SyncedSetting,
} from '../lib/synced-settings';
import {
  changesSince,
  emptySyncState,
  loadSyncState,
  merge,
  saveSyncState,
  seenAfter,
  snapshot,
  takeChunk,
  type Collection,
  type SyncChange,
  type SyncState,
} from '../lib/sync';

/** A saved word or a changed setting goes to the server soon after the user is done. */
const WORDS_DELAY_MS = 5000;
/** A playing video writes to the history every 15 seconds; the server hears of it far less often. */
const HISTORY_EVERY_MS = 5 * 60 * 1000;
/** Short of the 30 seconds after which Chrome ends an idle service worker with its timers. */
const HISTORY_DELAY_MS = 20_000;

const words: Collection<SavedWord> = {
  kind: 'words',
  enabled: async () => true,
  load: loadSavedWords,
  save: saveSavedWords,
  idOf: (word) => word.key,
  timeOf: (word) => word.savedAt,
  parse: normalizeSavedWord,
  arrange: (list) => [...list].sort((a, b) => b.savedAt - a.savedAt),
};

const history: Collection<HistoryEntry> = {
  kind: 'history',
  // "Keep history" off: what the user watched does not leave the browser.
  enabled: async () => (await loadSettings()).keepHistory,
  load: loadHistory,
  save: saveHistory,
  idOf: (entry) => entry.id,
  timeOf: (entry) => entry.lastAt,
  parse: (data) => normalizeHistory([data])[0] ?? null,
  arrange: (list) => [...list].sort((a, b) => b.lastAt - a.lastAt).slice(0, MAX_HISTORY),
};

const settings: Collection<SyncedSetting> = {
  kind: 'settings',
  enabled: async () => true,
  load: loadSyncedSettings,
  save: saveSyncedSettings,
  idOf: (setting) => setting.name,
  timeOf: settingTime,
  parse: parseSyncedSetting,
  arrange: (list) => list,
};

const sites: Collection<SyncedSite> = {
  kind: 'sites',
  enabled: async () => true,
  load: loadSyncedSites,
  save: saveSyncedSites,
  idOf: siteKey,
  timeOf: siteTime,
  parse: parseSyncedSite,
  arrange: (list) => list,
};

interface SyncAnswer {
  cursor: number;
  changes: SyncChange[];
  more: boolean;
  reset: boolean;
}

function isSyncAnswer(value: unknown): value is SyncAnswer {
  const answer = value as Partial<SyncAnswer> | null;
  return typeof answer?.cursor === 'number' && Array.isArray(answer.changes);
}

/**
 * Brings the words, the history, the settings and the sites of this browser and of the server together: when the user signs in,
 * when the panel opens, and after a change. It only runs here, so one synchronisation runs at a time.
 * Failing is no problem: what was not told stays different from `seen`, and goes next time.
 */
export class SyncService {
  private running: Promise<void> | null = null;
  private runAgain = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Synchronises now; asked while one is running, runs once more after it. */
  run(): Promise<void> {
    return this.start(false);
  }

  private start(onlyIfChanged: boolean): Promise<void> {
    if (this.running) {
      this.runAgain = true;
      return this.running;
    }
    this.running = this.loop(onlyIfChanged).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** A word or a setting changed. */
  changed(): void {
    clearTimeout(this.timer);
    this.timer = this.later(WORDS_DELAY_MS);
  }

  /** The history changed; a word waiting for its turn takes it along. */
  async historyChanged(): Promise<void> {
    if (this.timer !== undefined) return;
    const state = await loadSyncState();
    if (Date.now() - (state?.lastAt ?? 0) < HISTORY_EVERY_MS) return;
    if (this.timer === undefined) this.timer = this.later(HISTORY_DELAY_MS);
  }

  private later(delay: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.timer = undefined;
      void this.start(true);
    }, delay);
  }

  private async loop(onlyIfChanged: boolean): Promise<void> {
    await this.synchronise({ onlyIfChanged }).catch(report);
    while (this.runAgain) {
      this.runAgain = false;
      await this.synchronise({ onlyIfChanged: false }).catch(report);
    }
  }

  private async synchronise(options: { onlyIfChanged: boolean }): Promise<void> {
    const account = await loadAccount();
    if (!account) return;
    const owner = accountOwner(account);
    const state = await this.stateFor(owner);

    const historyOn = await history.enabled();
    const now = Date.now();
    const settingsNow = await snapshot(settings, await settings.load());
    const wordsNow = await snapshot(words, await words.load());
    const historyNow = await snapshot(history, await history.load());
    const sitesNow = await snapshot(sites, await sites.load());
    const settingChanges = changesSince(settings, settingsNow, state.seen.settings, now);
    const siteChanges = changesSince(sites, sitesNow, state.seen.sites, now);
    const wordChanges = changesSince(words, wordsNow, state.seen.words, now);
    // Off: what the user watched stays here, but what the user deleted is deleted everywhere.
    const historyChanges = changesSince(history, historyNow, state.seen.history, now).filter(
      (change) => historyOn || change.deleted,
    );
    const queue = [...settingChanges, ...siteChanges, ...wordChanges, ...historyChanges];
    if (options.onlyIfChanged && queue.length === 0) return;

    const cursor = historyOn && state.historyPaused ? 0 : state.cursor;
    const answer = await this.exchange(cursor, queue);
    if (answer === 'reset') {
      await saveSyncState(emptySyncState(owner));
      return this.synchronise({ onlyIfChanged: false });
    }

    // Signed out, or somebody else signed in, on the way: their lists must not get this data.
    const after = await loadAccount();
    if (!after || accountOwner(after) !== owner) return;

    const next: SyncState = { ...state, cursor: answer.cursor, lastAt: Date.now() };
    next.seen.settings = await this.apply(
      settings,
      seenAfter(settingsNow, settingChanges, state.seen.settings),
      answer.changes,
    );
    next.seen.sites = await this.apply(
      sites,
      seenAfter(sitesNow, siteChanges, state.seen.sites),
      answer.changes,
    );
    next.seen.words = await this.apply(
      words,
      seenAfter(wordsNow, wordChanges, state.seen.words),
      answer.changes,
    );
    // After the settings: "keep history" may have just come from another browser.
    const historyStays = await history.enabled();
    const seenHistory = seenAfter(historyNow, historyChanges, state.seen.history);
    next.seen.history = historyStays
      ? await this.apply(history, seenHistory, answer.changes)
      : seenHistory;
    next.historyPaused = !(historyOn && historyStays);
    await saveSyncState(next);
  }

  /** The state for this user. The lists of somebody else are theirs: they are on the server, not for this user. */
  private async stateFor(owner: string | null): Promise<SyncState> {
    const state = await loadSyncState();
    if (!state) return emptySyncState(owner);
    if (state.owner === null || owner === null || state.owner === owner)
      return { ...state, owner: owner ?? state.owner, seen: { ...state.seen } };
    await saveSavedWords([]);
    await saveHistory([]);
    await clearSiteLists();
    const fresh = emptySyncState(owner);
    await saveSyncState(fresh);
    return fresh;
  }

  /** Tells the server `queue` and takes everything it has after `cursor`. */
  private async exchange(
    cursor: number,
    queue: SyncChange[],
  ): Promise<{ cursor: number; changes: SyncChange[] } | 'reset'> {
    const changes: SyncChange[] = [];
    let position = cursor;
    for (;;) {
      const response = await authedCall('/sync', { cursor: position, changes: takeChunk(queue) });
      if (!response.ok) throw new Error(`sync answered ${response.status}`);
      const answer: unknown = await response.json().catch(() => null);
      if (!isSyncAnswer(answer)) throw new Error('sync answered something else');
      if (answer.reset) return 'reset';
      changes.push(...answer.changes);
      position = answer.cursor;
      if (queue.length === 0 && !answer.more) return { cursor: position, changes };
    }
  }

  /** The server's changes into the list as it is now (the user may have changed it meanwhile). */
  private async apply<T>(
    collection: Collection<T>,
    seen: Record<string, string>,
    remote: SyncChange[],
  ): Promise<Record<string, string>> {
    const current = await snapshot(collection, await collection.load());
    const merged = await merge(collection, current, seen, remote);
    if (merged.list) await collection.save(merged.list);
    return merged.seen;
  }
}

/** Being offline is normal: not a warning, which would land on the extension's error page. */
function report(error: unknown): void {
  console.info('[Double Sub] synchronisation failed:', error);
}
