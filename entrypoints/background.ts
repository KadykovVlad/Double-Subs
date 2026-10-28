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
  // A new user finds the welcome there: the access to the sites and the sign-in (the panel decides).
  void registry
    .seedYouTube()
    .then(() => registry.sync())
    .catch(() => {});
  // While something is left to do (sign in, answer the question about the sites) the icon wears a
  // mark; the click on it always opens the side panel, which shows the welcome until it is done.
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
    await browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
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
    // A new user is met by the side panel with the welcome. Chrome opens the panel only on a gesture of
    // the user, so this is a try (it works when Chrome counts the installation as one); if it is refused,
    // the mark on the icon is there and one click opens the panel.
    if (details.reason === 'install' && !import.meta.env.VITE_DS_E2E)
      void syncOnboarding()
        .then(async (todo) => {
          if (!todo) return;
          const window = await browser.windows.getLastFocused();
          if (window.id !== undefined) await browser.sidePanel?.open({ windowId: window.id });
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
        void signIn({ link: message.link === true })
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
