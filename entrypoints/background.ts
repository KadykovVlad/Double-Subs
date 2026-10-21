import { AgentLauncher } from '../src/background/AgentLauncher';
import { AccountError, clearStaleSignIn, loadAccount, signInOnce } from '../src/lib/account';
import {
  accessGranted,
  addsAllSites,
  ALL_SITES_PATTERN,
  loadAccessDismissed,
  loadMirrorsMode,
  setMirrorsMode,
} from '../src/lib/known-sites';
import { openOnboardingWindow } from '../src/background/OnboardingWindow';
import { AutoScriptRegistry } from '../src/background/AutoScriptRegistry';
import type { LookupWordMessage } from '../src/lib/dictionary-messages';
import { DictionaryService } from '../src/background/DictionaryService';
import { SpeechService } from '../src/background/SpeechService';
import { TranslationRelay } from '../src/background/TranslationRelay';
import type {
  AgentRequest,
  InjectTikTokMainMessage,
  PickedMessage,
  SignInMessage,
  StartAgentMessage,
} from '../src/lib/messages';
import type { SpeakMessage } from '../src/lib/speech';
import type { TranslationEnvelope } from '../src/lib/translation-messages';

type Message =
  | PickedMessage
  | TranslationEnvelope
  | SpeakMessage
  | StartAgentMessage
  | SignInMessage
  | InjectTikTokMainMessage
  | LookupWordMessage;

/**
 * The service worker only wires the parts together: each job has its own class in src/background/.
 * - AutoScriptRegistry: the script that runs on the user's sites
 * - AgentLauncher: starts the agent where that script finds a known site
 * - SpeechService: reads words aloud
 * - DictionaryService: the meaning and dictionary form of a word
 * - TranslationRelay: carries translation requests to the offscreen document
 */
export default defineBackground(() => {
  const registry = new AutoScriptRegistry();
  const launcher = new AgentLauncher();
  const speech = new SpeechService();
  const dictionary = new DictionaryService();
  const translation = new TranslationRelay();

  // A click on the toolbar icon opens the side panel; the same click gives us access to the page (activeTab).
  // (While onboarding is not finished, the click opens the small window instead, see syncOnboarding.)
  void registry
    .seedYouTube()
    .then(() => registry.sync())
    .catch(() => {});
  // While something is left to do (sign in, the access to the sites if it was taken away) the icon wears
  // a mark and a click on it opens the small onboarding window; when it is done a click opens the side
  // panel. Chrome lets an extension open a window by itself, but not the side panel.
  const syncOnboarding = async (): Promise<boolean> => {
    const [account, everywhere, dismissed, held] = await Promise.all([
      loadAccount(),
      loadMirrorsMode(),
      loadAccessDismissed(),
      browser.permissions.contains({ origins: [ALL_SITES_PATTERN] }),
    ]);
    const todo = !account || (!accessGranted(held, everywhere) && !dismissed);
    await browser.action.setBadgeText({ text: todo ? '!' : '' });
    if (todo) await browser.action.setBadgeBackgroundColor({ color: '#4a68f5' });
    await browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: !todo });
    return todo;
  };
  const keepOnboardingInStep = () =>
    void syncOnboarding().catch(() => {
      // Whatever went wrong, the side panel must stay reachable.
      void browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    });
  void browser.action.setPopup({ popup: '' }).catch(() => {}); // an earlier version used a drop-down
  void clearStaleSignIn().catch(() => {}); // a sign-in cannot be running in a background that has just started
  keepOnboardingInStep();

  browser.runtime.onInstalled.addListener((details) => {
    void registry.sync();
    // A new user is met by the small window; if Chrome refuses, the mark on the icon is there.
    if (details.reason === 'install' && !import.meta.env.VITE_DS_E2E)
      void syncOnboarding()
        .then(async (todo) => {
          if (todo) await openOnboardingWindow();
        })
        .catch(() => {});
    else keepOnboardingInStep();
  });
  // A click on the icon while something is left to do: the small window (the panel does not open then).
  browser.action.onClicked.addListener(() => {
    void syncOnboarding()
      .then(async (todo) => {
        if (todo) await openOnboardingWindow();
      })
      .catch(() => {});
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    // 'account': the registration of the automatic start follows the sign-in and the sign-out.
    if ('knownSites' in changes || 'mirrorsMode' in changes || 'account' in changes)
      void registry.sync();
    if ('account' in changes || 'mirrorsMode' in changes || 'accessBannerDismissed' in changes)
      keepOnboardingInStep();
  });
  browser.permissions.onAdded.addListener((added) => {
    // The access was given in a window that may have closed meanwhile: the switch is turned on here.
    if (addsAllSites(added)) void setMirrorsMode(true);
    void registry.sync();
    keepOnboardingInStep();
  });
  browser.permissions.onRemoved.addListener(() => {
    void registry.sync();
    keepOnboardingInStep();
  });

  browser.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    switch (message?.type) {
      case 'picked': {
        // A video was picked in one frame: leave pick mode in all frames of that tab.
        const tabId = sender.tab?.id;
        if (tabId !== undefined)
          void browser.tabs
            .sendMessage(tabId, { type: 'stopPick' } satisfies AgentRequest)
            .catch(() => {});
        return false;
      }
      case 'sign-in':
        void signInOnce()
          .then(() => sendResponse({ ok: true }))
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              code: error instanceof AccountError ? error.code : 'server',
            }),
          );
        return true; // async response
      case 'speak':
        void loadAccount().then((account) => account && speech.speak(message));
        return false;
      case 'start-agent':
        void launcher.launch(message, sender);
        return false;
      case 'inject-tiktok-main':
        void launcher.injectTikTokMain(message, sender);
        return false;
      case 'lookup-word':
        void loadAccount()
          .then((account) => (account ? dictionary.lookup(message) : null))
          .then(sendResponse);
        return true; // async response
      case 'translation':
        void translation.relay(message).then(sendResponse);
        return true; // async response
    }
    return false;
  });
});
