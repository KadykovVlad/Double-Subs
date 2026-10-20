import { loadUiLanguage } from '../lib/ui-language';
import { loadSavedWords, savedKeys, watchSavedWords } from '../lib/saved-words';
import {
  FREE_PLAN,
  hasFeature,
  loadEntitlements,
  watchEntitlements,
  type Entitlements,
} from '../lib/entitlements';
import { DEFAULT_SETTINGS, loadSettings, watchSettings, type Settings } from '../lib/settings';

/**
 * What the user has stored that the agent needs while it works: the settings and which words are
 * saved (none without the words feature: the underline and the saving are Pro). Loaded once, then kept
 * current from the storage; `ready` says the first load is done.
 */
export class UserData {
  settings: Settings = DEFAULT_SETTINGS;
  savedKeys = new Set<string>();
  entitlements: Entitlements = FREE_PLAN;
  private storedKeys = new Set<string>();
  readonly ready: Promise<void>;

  private settingsListeners: Array<(settings: Settings) => void> = [];
  private savedListeners: Array<(keys: Set<string>) => void> = [];

  constructor() {
    this.ready = Promise.all([
      loadSettings().then((loaded) => (this.settings = loaded)),
      loadSavedWords().then((list) => (this.storedKeys = savedKeys(list))),
      loadEntitlements().then((loaded) => (this.entitlements = loaded)),
      loadUiLanguage(),
    ]).then(() => this.refreshKeys());
    watchSettings((next) => {
      this.settings = next;
      this.settingsListeners.forEach((listener) => listener(next));
    });
    watchSavedWords((list) => {
      this.storedKeys = savedKeys(list);
      this.refreshKeys(true);
    });
    watchEntitlements((next) => {
      this.entitlements = next;
      this.refreshKeys(true);
    });
  }

  /** Whether saving words is part of the user's plan. */
  canSaveWords(): boolean {
    return hasFeature(this.entitlements, 'words');
  }

  private refreshKeys(notify = false): void {
    this.savedKeys = this.canSaveWords() ? this.storedKeys : new Set();
    if (notify) this.savedListeners.forEach((listener) => listener(this.savedKeys));
  }

  onSettings(listener: (settings: Settings) => void): () => void {
    this.settingsListeners.push(listener);
    return () => (this.settingsListeners = this.settingsListeners.filter((l) => l !== listener));
  }

  onSavedWords(listener: (keys: Set<string>) => void): () => void {
    this.savedListeners.push(listener);
    return () => (this.savedListeners = this.savedListeners.filter((l) => l !== listener));
  }
}
