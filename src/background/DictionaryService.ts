import { Dictionary, type DictionaryData, type WordInfo } from '../lib/dictionary';
import { isValidLookupMessage } from '../lib/dictionary-messages';

const FILE = '/dictionary-en.json';

/** The English dictionary: read from the extension's own file on the first question, then kept in memory. */
export class DictionaryService {
  private loading: Promise<Dictionary> | null = null;

  async lookup(message: unknown): Promise<WordInfo | null> {
    if (!isValidLookupMessage(message)) return null;
    try {
      return (await this.dictionary()).lookup(message.word);
    } catch {
      this.loading = null; // read it again next time
      return null;
    }
  }

  private dictionary(): Promise<Dictionary> {
    this.loading ??= fetch(browser.runtime.getURL(FILE as '/popup.html'))
      .then((response) => response.json() as Promise<DictionaryData>)
      .then((data) => new Dictionary(data));
    return this.loading;
  }
}
