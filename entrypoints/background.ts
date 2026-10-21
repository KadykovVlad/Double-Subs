import { AgentLauncher } from '../src/background/AgentLauncher';
import { AccountError, loadAccount, signIn } from '../src/lib/account';
import { ALL_SITES_PATTERN, loadAccessDismissed, loadMirrorsMode } from '../src/lib/known-sites';
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
  // While something is left to do (sign in, answer the question about the sites) the icon wears a
  // mark and a click on it opens the small onboarding window; when it is done a click opens the side
  // panel. Chrome lets an extension open its small window by itself, but not the side panel.
  const syncOnboarding = async (): Promise<boolean> => {
    const [account, everywhere, dismissed, granted] = await Promise.all([
      loadAccount(),
      loadMirrorsMode(),
      loadAccessDismissed(),
      browser.permissions.contains({ origins: [ALL_SITES_PATTERN] }),
    ]);
    const todo = !account || (!(everywhere && granted) && !dismissed);
    await browser.action.setBadgeText({ text: todo ? '!' : '' });
    if (todo) await browser.action.setBadgeBackgroundColor({ color: '#4a68f5' });
    await browser.action.setPopup({ popup: todo ? 'onboarding.html' : '' });
    await browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: !todo });
    return todo;
  };
  const keepOnboardingInStep = () =>
    void syncOnboarding().catch(() => {
      // Whatever went wrong, the side panel must stay reachable.
      void browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    });
  keepOnboardingInStep();

  browser.runtime.onInstalled.addListener((details) => {
    void registry.sync();
    // A new user is met by the small window under the icon; if Chrome refuses (no window in focus), the mark is there.
    if (details.reason === 'install' && !import.meta.env.VITE_DS_E2E)
      void syncOnboarding()
        .then(async (todo) => {
          if (todo) await browser.action.openPopup();
        })
        .catch(() => {});
    else keepOnboardingInStep();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    // 'account': the registration of the automatic start follows the sign-in and the sign-out.
    if ('knownSites' in changes || 'mirrorsMode' in changes || 'account' in changes)
      void registry.sync();
    if ('account' in changes || 'mirrorsMode' in changes || 'accessBannerDismissed' in changes)
      keepOnboardingInStep();
  });
  browser.permissions.onAdded.addListener(() => {
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
        void signIn()
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
