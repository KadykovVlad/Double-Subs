import { useEffect, useState } from 'preact/hooks';
import { loadAccount, watchAccount, type Account } from '../../src/lib/account';
import {
  FREE_PLAN,
  loadEntitlements,
  watchEntitlements,
  type Entitlements,
} from '../../src/lib/entitlements';
import { loadHistory, watchHistory, type HistoryEntry } from '../../src/lib/history';
import {
  loadDismissed,
  loadKnownSites,
  ALL_SITES_PATTERN,
  loadAccessDismissed,
  loadExcludedSites,
  loadMirrorsMode,
  watchAccessDismissed,
  watchDismissed,
  watchExcludedSites,
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

/** Who is signed in (null: nobody, undefined: not read yet); the sign-in in any part of the extension shows up here. */
export function useAccount(): Account | null | undefined {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  useEffect(() => {
    void loadAccount().then(setAccount);
    return watchAccount(setAccount);
  }, []);
  return account;
}

/** The plan decides which tabs and features the panel offers. */
export function useEntitlements(): Entitlements {
  const [entitlements, setEntitlements] = useState<Entitlements>(FREE_PLAN);
  useEffect(() => {
    void loadEntitlements().then(setEntitlements);
    return watchEntitlements(setEntitlements);
  }, []);
  return entitlements;
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

/** Is the extension allowed to start by itself on every site: the switch is on and Chrome holds the access. */
export function useAllSitesAllowed(): boolean | undefined {
  const mirrors = useMirrorsMode();
  const [granted, setGranted] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const check = () =>
      void browser.permissions.contains({ origins: [ALL_SITES_PATTERN] }).then(setGranted);
    check();
    browser.permissions.onAdded.addListener(check);
    browser.permissions.onRemoved.addListener(check);
    return () => {
      browser.permissions.onAdded.removeListener(check);
      browser.permissions.onRemoved.removeListener(check);
    };
  }, []);
  return granted === undefined ? undefined : mirrors && granted;
}

/** The user pressed "Not now" on the banner that asks for access to all sites. */
export function useAccessDismissed(): boolean {
  const [dismissed, setDismissed] = useState(true); // hidden until the stored answer is known
  useEffect(() => {
    void loadAccessDismissed().then(setDismissed);
    return watchAccessDismissed(setDismissed);
  }, []);
  return dismissed;
}

/** The hosts of the sites the user switched off. */
export function useExcludedSites(): string[] {
  const [hosts, setHosts] = useState<string[]>([]);
  useEffect(() => {
    void loadExcludedSites().then(setHosts);
    return watchExcludedSites(setHosts);
  }, []);
  return hosts;
}

export function useDismissedOffers(): string[] {
  const [origins, setOrigins] = useState<string[]>([]);
  useEffect(() => {
    void loadDismissed().then(setOrigins);
    return watchDismissed(setOrigins);
  }, []);
  return origins;
}
