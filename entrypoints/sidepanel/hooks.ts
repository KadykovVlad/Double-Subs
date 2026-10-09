import { useEffect, useState } from 'preact/hooks';
import { loadHistory, watchHistory, type HistoryEntry } from '../../src/lib/history';
import {
  loadDismissed,
  loadKnownSites,
  loadMirrorsMode,
  watchDismissed,
  watchKnownSites,
  watchMirrorsMode,
  type KnownSites,
} from '../../src/lib/known-sites';
import { loadSavedWords, watchSavedWords, type SavedWord } from '../../src/lib/saved-words';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  updateSettings,
  watchSettings,
  type Settings,
} from '../../src/lib/settings';

/** The bar on the page changes the same settings (voice, size, position): the panel follows. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    void loadSettings().then(setSettings);
    return watchSettings(setSettings);
  }, []);
  return [settings, (patch) => void updateSettings(patch).then(setSettings)];
}

export function useKnownSites(): KnownSites {
  const [sites, setSites] = useState<KnownSites>({});
  useEffect(() => {
    void loadKnownSites().then(setSites);
    return watchKnownSites(setSites);
  }, []);
  return sites;
}

export function useSavedWords(): SavedWord[] {
  const [words, setWords] = useState<SavedWord[]>([]);
  useEffect(() => {
    void loadSavedWords().then(setWords);
    return watchSavedWords(setWords);
  }, []);
  return words;
}

export function useHistory(): HistoryEntry[] {
  const [list, setList] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    void loadHistory().then(setList);
    return watchHistory(setList);
  }, []);
  return list;
}

export function useMirrorsMode(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    void loadMirrorsMode().then(setOn);
    return watchMirrorsMode(setOn);
  }, []);
  return on;
}

export function useDismissedOffers(): string[] {
  const [origins, setOrigins] = useState<string[]>([]);
  useEffect(() => {
    void loadDismissed().then(setOrigins);
    return watchDismissed(setOrigins);
  }, []);
  return origins;
}
