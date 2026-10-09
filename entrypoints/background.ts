import { AgentLauncher } from '../src/background/AgentLauncher';
import { AutoScriptRegistry } from '../src/background/AutoScriptRegistry';
import type { LookupWordMessage } from '../src/lib/dictionary-messages';
import { DictionaryService } from '../src/background/DictionaryService';
import { SpeechService } from '../src/background/SpeechService';
import { TranslationRelay } from '../src/background/TranslationRelay';
import type { AgentRequest, PickedMessage, StartAgentMessage } from '../src/lib/messages';
import type { SpeakMessage } from '../src/lib/speech';
import type { TranslationEnvelope } from '../src/lib/translation-messages';

type Message =
  PickedMessage | TranslationEnvelope | SpeakMessage | StartAgentMessage | LookupWordMessage;

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
  void browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  void registry
    .seedYouTube()
    .then(() => registry.sync())
    .catch(() => {});
  browser.runtime.onInstalled.addListener(() => void registry.sync());
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('knownSites' in changes || 'mirrorsMode' in changes))
      void registry.sync();
  });
  browser.permissions.onAdded.addListener(() => void registry.sync());
  browser.permissions.onRemoved.addListener(() => void registry.sync());

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
      case 'speak':
        speech.speak(message);
        return false;
      case 'start-agent':
        void launcher.launch(message, sender);
        return false;
      case 'lookup-word':
        void dictionary.lookup(message).then(sendResponse);
        return true; // async response
      case 'translation':
        void translation.relay(message).then(sendResponse);
        return true; // async response
    }
    return false;
  });
});
