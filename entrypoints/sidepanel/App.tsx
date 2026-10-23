import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { SelectedMessage } from '../../src/lib/messages';
import type { StatusMessage } from '../../src/lib/translation-messages';
import {
  cancelPick,
  detect,
  getTargetTabId,
  hasFixedTab,
  reloadAndDetect,
  requestAccess,
  type PopupState,
} from '../../src/panel/controller';
import { HistoryTab } from './HistoryTab';
import { NowTab, type SettingsFocus } from './NowTab';
import { SettingsTab } from './SettingsTab';
import { WordsTab, dueWords } from './WordsTab';
import { refreshPlan } from '../../src/lib/account';
import {
  useAccessDismissed,
  useAccount,
  useAllSitesAllowed,
  useEntitlements,
  useSavedWords,
} from './hooks';
import { Onboarding } from './Onboarding';
import { hasFeature, isPro } from '../../src/lib/entitlements';
import { Icons, Logo, Toasts } from './ui';
import { loadSavedWords, watchSavedWords } from '../../src/lib/saved-words';
import { newKeys, showToast } from '../../src/panel/toasts';
import { PRO_NUDGE_KEY } from '../../src/lib/entitlements';
import { t, textDirection, uiLanguage, type MessageKey } from '../../src/lib/i18n';
import {
  chooseUiLanguage,
  languageName,
  UI_LANGUAGES,
  watchUiLanguage,
} from '../../src/lib/ui-language';

type TabId = 'now' | 'words' | 'history' | 'settings';

const TABS: Array<{ id: TabId; label: MessageKey; icon: preact.JSX.Element }> = [
  { id: 'now', label: 'tab_now', icon: Icons.now },
  { id: 'words', label: 'tab_words', icon: Icons.words },
  { id: 'history', label: 'tab_history', icon: Icons.history },
  { id: 'settings', label: 'tab_settings', icon: Icons.settings },
];

const SWITCH_DEBOUNCE_MS = 700;

/** The language of the interface, at the top right: a change is saved for every page of the extension. */
function LanguagePicker({ code }: { code: string }) {
  return (
    <label class="lang" title={t('lang_label')}>
      {Icons.globe}
      <select
        data-testid="ui-language"
        aria-label={t('lang_label')}
        value={code}
        onChange={(event) => void chooseUiLanguage(event.currentTarget.value)}
      >
        {UI_LANGUAGES.map((option) => (
          <option key={option} value={option}>
            {languageName(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The panel shows its work only to a signed-in user; before that nothing reads or touches the page. */
export function App() {
  const [language, setLanguage] = useState(uiLanguage());
  document.documentElement.lang = language;
  document.documentElement.dir = textDirection();
  useEffect(() => watchUiLanguage(setLanguage), []);
  const account = useAccount();
  const allowed = useAllSitesAllowed();
  const dismissed = useAccessDismissed();

  // The welcome: until somebody is signed in, and until the question about the sites is answered
  // (allowed, or "not now"). Then the panel goes on to its tabs by itself.
  if (account === undefined || (account && allowed === undefined))
    return <Shell language={language} />; // the account and the access are being read
  if (account === null || (!allowed && !dismissed))
    return (
      <Shell language={language}>
        <Onboarding />
      </Shell>
    );
  return <SignedInApp language={language} />;
}

function Shell({ language, children }: { language: string; children?: ComponentChildren }) {
  return (
    <div class="shell">
      <header class="header">
        <Logo />
        <span class="brand">Double Sub</span>
        <LanguagePicker code={language} />
      </header>
      {children}
    </div>
  );
}

function SignedInApp({ language }: { language: string }) {
  const [chosenTab, setTab] = useState<TabId>('now');
  /** Where the settings open when a tool of the "Now" tab leads there; a new object each time. */
  const [settingsFocus, setSettingsFocus] = useState<SettingsFocus | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [state, setState] = useState<PopupState>({
    kind: 'working',
    text: t('busy_find_player'),
    diagnostics: null,
    pageUrl: null,
  });
  const words = useSavedWords();
  const entitlements = useEntitlements();
  const showWords = hasFeature(entitlements, 'words');
  const pro = isPro(entitlements);
  const dueCount = dueWords(words).length;
  // The words belong to the Pro plan: without it there is no tab (a plan that ends on the tab sends the user back).
  const tabs = TABS.filter((item) => item.id !== 'words' || showWords);
  const tab = tabs.some((item) => item.id === chosenTab) ? chosenTab : 'now';
  const openSettings = (focus: SettingsFocus) => {
    setSettingsFocus({ ...focus });
    setTab('settings');
  };
  useNotices(openSettings);
  /** The panel stays open while the user moves between tabs and pages: always the tab we are showing. */
  const current = useRef<number | null>(null);

  const run = (text: string, task: () => Promise<PopupState>) => {
    setState((prev) => ({
      kind: 'working',
      text,
      diagnostics: prev.diagnostics,
      pageUrl: prev.pageUrl,
    }));
    task()
      .then(setState)
      .catch((error: unknown) =>
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
          diagnostics: null,
          pageUrl: null,
        }),
      );
  };

  useEffect(() => {
    // The agent reports a finished selection and every step of the translation: refresh the status
    // quietly (no "working" screen), one refresh at a time.
    let refreshing = false;
    let again = false;
    const refresh = () => {
      const id = current.current;
      if (id === null) return;
      if (refreshing) {
        again = true;
        return;
      }
      refreshing = true;
      detect(id, { passive: true })
        .then((next) => current.current === id && setState(next))
        .catch(() => {})
        .finally(() => {
          refreshing = false;
          if (again) {
            again = false;
            refresh();
          }
        });
    };
    const onMessage = (message: SelectedMessage | StatusMessage) => {
      if (message?.type === 'selected' || message?.type === 'status') refresh();
    };
    browser.runtime.onMessage.addListener(onMessage);
    // A payment or a change on the server shows up when the panel opens; offline is no problem.
    void refreshPlan().catch(() => {});

    const follow = (id: number) => {
      current.current = id;
      setTabId(id);
      run(t('busy_find_player'), () => detect(id, { noPick: true }));
    };

    getTargetTabId()
      .then((id) => {
        current.current = id;
        setTabId(id);
        run(t('busy_find_player'), () => detect(id));
      })
      .catch((error: unknown) =>
        setState({ kind: 'error', message: String(error), diagnostics: null, pageUrl: null }),
      );

    // The panel is not closed by a click on the page, so it follows the user: another tab, another page.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onActivated = (info: { tabId: number }) => {
      if (hasFixedTab()) return;
      clearTimeout(timer);
      timer = setTimeout(() => follow(info.tabId), SWITCH_DEBOUNCE_MS);
    };
    const onUpdated = (id: number, info: { status?: string }) => {
      if (hasFixedTab() || id !== current.current || info.status !== 'complete') return;
      clearTimeout(timer);
      timer = setTimeout(() => follow(id), SWITCH_DEBOUNCE_MS);
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);

    return () => {
      clearTimeout(timer);
      browser.runtime.onMessage.removeListener(onMessage);
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  const grant = (origin: string) => {
    if (tabId === null) return;
    // requestAccess is called synchronously inside the click: Chrome requires the user gesture.
    const request = requestAccess(origin);
    run(t('busy_wait_access'), async () => {
      const granted = await request;
      if (!granted)
        return { kind: 'denied', origin, diagnostics: state.diagnostics, pageUrl: state.pageUrl };
      return detect(tabId, { afterGrant: true });
    });
  };

  const site = state.kind === 'selected' ? new URL(state.origin).host : '';

  return (
    <div class="shell">
      <header class="header">
        <Logo />
        <span class="brand">Double Sub</span>
        {pro && <span class="pro-badge">PRO</span>}
        <span class="site" title={site}>
          {site}
        </span>
        <LanguagePicker code={language} />
      </header>
      <nav class="tabs" role="tablist" aria-label={t('tabs_label')}>
        {tabs.map((item) => (
          <button
            key={item.id}
            class="tab"
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls="panel"
            data-testid={`tab-${item.id}`}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            {t(item.label)}
            {item.id === 'words' && dueCount > 0 && (
              <span class="count" data-testid="due-badge">
                {dueCount}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div class="content" id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'now' && (
          <NowTab
            state={state}
            tabId={tabId}
            onGrant={grant}
            onPick={() =>
              tabId !== null && run(t('busy_pick'), () => detect(tabId, { forcePick: true }))
            }
            onCancelPick={() => {
              if (tabId === null) return;
              void cancelPick(tabId);
              setState({ kind: 'nothing', diagnostics: state.diagnostics, pageUrl: state.pageUrl });
            }}
            onRetry={() => tabId !== null && run(t('busy_find_player'), () => detect(tabId))}
            onReload={() => tabId !== null && run(t('busy_reload'), () => reloadAndDetect(tabId))}
            onOpenSettings={openSettings}
          />
        )}
        {tab === 'words' && <WordsTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'settings' && (
          <SettingsTab tabId={tabId} diagnostics={state.diagnostics} focus={settingsFocus} />
        )}
      </div>
      <Toasts />
    </div>
  );
}

/**
 * The notifications that come from the page: a word saved by a click in the subtitles, and a click
 * that would have saved one on the free plan. Only changes made while the panel is open count.
 */
function useNotices(openSettings: (focus: SettingsFocus) => void) {
  useEffect(() => {
    let known: string[] | null = null;
    void loadSavedWords().then((list) => {
      known ??= list.map((word) => word.key);
    });
    const stopWords = watchSavedWords((list) => {
      const keys = list.map((word) => word.key);
      const added = known ? newKeys(known, keys) : [];
      known = keys;
      const word = list.find((item) => item.key === added[0]);
      if (word)
        showToast({
          tone: 'ok',
          title: t('toast_saved_title'),
          text: t('toast_saved_text', word.word),
        });
    });
    const onNudge = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local' || !(PRO_NUDGE_KEY in changes)) return;
      showToast({
        tone: 'pro',
        title: t('toast_pro_title'),
        text: t('toast_pro_text'),
        action: { label: t('toast_learn_more'), run: () => openSettings({ section: 'account' }) },
      });
    };
    browser.storage.onChanged.addListener(onNudge);
    return () => {
      stopWords();
      browser.storage.onChanged.removeListener(onNudge);
    };
  }, []);
}
