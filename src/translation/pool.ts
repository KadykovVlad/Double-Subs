import { toTranslatorText } from './polish';
import { TranslationError } from './session';
import type { Direction, ModelAvailability } from '../lib/translation-messages';
import type { TranslatorInstance, TranslatorOptions, TranslatorStatic } from '../lib/translator';

const OPTIONS: Record<Direction, TranslatorOptions> = {
  'en-ru': { sourceLanguage: 'en', targetLanguage: 'ru' },
  'ru-en': { sourceLanguage: 'ru', targetLanguage: 'en' },
};

/**
 * Translators of the built-in API, one per direction, created on first use. Lives in the offscreen
 * document, where the API works (stage 4). It never downloads a model: Chrome allows that only after
 * a click, which the popup handles; here a missing model is reported as `needs-model`.
 */
export class TranslatorPool {
  private readonly instances = new Map<
    Direction,
    { api: TranslatorStatic; translator: Promise<TranslatorInstance> }
  >();

  /** `getApi` is asked on every call, so a changed environment (tests) is picked up. */
  constructor(private readonly getApi: () => Promise<TranslatorStatic | null>) {}

  async availability(direction: Direction): Promise<ModelAvailability> {
    const api = await this.getApi();
    if (!api) return 'unavailable';
    const availability = await api
      .availability(OPTIONS[direction])
      .catch(() => 'unavailable' as const);
    if (availability === 'available') return 'available';
    return availability === 'unavailable' ? 'unavailable' : 'needs-model';
  }

  private async translatorFor(direction: Direction): Promise<TranslatorInstance> {
    const availability = await this.availability(direction);
    if (availability !== 'available') throw new TranslationError(availability);

    const api = (await this.getApi())!;
    const existing = this.instances.get(direction);
    if (existing?.api === api) return existing.translator;

    const translator = api.create(OPTIONS[direction]);
    this.instances.set(direction, { api, translator });
    translator.catch(() => this.instances.delete(direction));
    return translator;
  }

  /** One result per text; '' for a text the translator rejected. Sequential: parallel is not faster (stage 4). */
  async translate(direction: Direction, texts: string[]): Promise<string[]> {
    const translator = await this.translatorFor(direction).catch((error: unknown) => {
      throw error instanceof TranslationError ? error : new TranslationError('failed');
    });
    const results: string[] = [];
    for (const text of texts) {
      results.push(await translator.translate(toTranslatorText(text)).catch(() => ''));
    }
    return results;
  }
}
