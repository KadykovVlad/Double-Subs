import { loadSettings } from '../lib/settings';
import { isValidSpeakMessage, SPEECH_RATE, VOICE_LANG, type SpeakMessage } from '../lib/speech';
import { chooseVoice, loadVoices } from '../lib/voices';

/** Says a hovered word aloud with a system voice (chrome.tts). A new word cuts off the one being spoken. */
export class SpeechService {
  speak(message: SpeakMessage): void {
    if (!isValidSpeakMessage(message)) return;
    void this.say(message).catch(() => {});
  }

  private async say(message: SpeakMessage): Promise<void> {
    const saved = message.voice ?? (await this.savedVoice(message.lang));
    const voiceName = chooseVoice(saved, await loadVoices(), message.lang);
    if (import.meta.env.VITE_DS_E2E) {
      // Test build: Playwright's Chromium has no voices, so what would be said is kept for the test.
      const { e2eSpoken } = await browser.storage.local.get('e2eSpoken');
      await browser.storage.local.set({
        e2eSpoken: [
          ...((e2eSpoken as unknown[]) ?? []),
          { text: message.text, lang: message.lang, voice: saved === '' ? '' : (voiceName ?? '') },
        ],
      });
      return;
    }
    await browser.tts.speak(message.text, {
      lang: VOICE_LANG[message.lang],
      rate: SPEECH_RATE,
      enqueue: false,
      ...(voiceName ? { voiceName } : {}),
    });
  }

  private async savedVoice(lang: SpeakMessage['lang']): Promise<string> {
    const settings = await loadSettings();
    return lang === 'en' ? settings.voiceEn : settings.voiceRu;
  }
}
