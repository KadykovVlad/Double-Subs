/**
 * Chrome's built-in on-device Translator API (Chrome 138+, desktop).
 * TypeScript has no types for it yet, so the part we use is declared here.
 */

export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

export interface TranslatorInstance {
  translate(text: string): Promise<string>;
  destroy(): void;
}

export interface TranslatorOptions {
  sourceLanguage: string;
  targetLanguage: string;
}

export interface DownloadProgressEvent extends Event {
  /** 0..1 */
  loaded: number;
}

export interface TranslatorStatic {
  availability(options: TranslatorOptions): Promise<Availability>;
  create(
    options: TranslatorOptions & { monitor?: (monitor: EventTarget) => void },
  ): Promise<TranslatorInstance>;
}

export function getTranslatorApi(scope: object = globalThis): TranslatorStatic | null {
  return (scope as { Translator?: TranslatorStatic }).Translator ?? null;
}

export const EN_RU: TranslatorOptions = { sourceLanguage: 'en', targetLanguage: 'ru' };
export const RU_EN: TranslatorOptions = { sourceLanguage: 'ru', targetLanguage: 'en' };

// ---------------------------------------------------------------- probe

export interface TranslatorProbe {
  /** Where the probe ran: "lab page", "offscreen", "content script: iframe, https://…" */
  context: string;
  apiPresent: boolean;
  enRu: Availability | null;
  ruEn: Availability | null;
  /** Why the API is missing or availability() failed (e.g. permissions policy in an iframe). */
  error: string | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function probeTranslator(
  context: string,
  scope: object = globalThis,
): Promise<TranslatorProbe> {
  const api = getTranslatorApi(scope);
  if (!api) return { context, apiPresent: false, enRu: null, ruEn: null, error: null };
  try {
    const [enRu, ruEn] = await Promise.all([api.availability(EN_RU), api.availability(RU_EN)]);
    return { context, apiPresent: true, enRu, ruEn, error: null };
  } catch (error) {
    return { context, apiPresent: true, enRu: null, ruEn: null, error: errorText(error) };
  }
}

// ---------------------------------------------------------------- batch translation

/**
 * The API translates one string at a time. Ways to translate a block of cues:
 * - sequential: one call per cue, one after another
 * - parallel: one call per cue, all at once (the browser queues them)
 * - joined: one call for the whole block, cues separated by newlines, split afterwards
 */
export type Strategy = 'sequential' | 'parallel' | 'joined';
export const STRATEGIES: Strategy[] = ['sequential', 'parallel', 'joined'];

export interface BatchResult {
  translations: string[];
  /** joined only: the translation came back with a different number of lines than was sent. */
  linesMatched: boolean;
}

/** Cue texts may contain line breaks; inside a joined block a break separates cues. */
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ');

export async function translateBatch(
  translator: TranslatorInstance,
  texts: string[],
  strategy: Strategy,
): Promise<BatchResult> {
  switch (strategy) {
    case 'sequential': {
      const translations: string[] = [];
      for (const text of texts) translations.push(await translator.translate(text));
      return { translations, linesMatched: true };
    }
    case 'parallel':
      return {
        translations: await Promise.all(texts.map((text) => translator.translate(text))),
        linesMatched: true,
      };
    case 'joined': {
      const result = await translator.translate(texts.map(oneLine).join('\n'));
      const lines = result.split('\n').map((line) => line.trim());
      return { translations: lines, linesMatched: lines.length === texts.length };
    }
  }
}

// ---------------------------------------------------------------- benchmark

export interface StrategyTiming {
  strategy: Strategy;
  totalMs: number;
  perCueMs: number;
  linesMatched: boolean;
  error: string | null;
}

export interface BenchmarkResult {
  context: string;
  cueCount: number;
  /** Time to create a translator when the model is already downloaded. */
  createMs: number | null;
  timings: StrategyTiming[];
  /** From the sequential run, for the quality table. */
  translations: string[];
  error: string | null;
}

const round = (ms: number) => Math.round(ms * 10) / 10;

export async function benchmark(
  context: string,
  texts: string[],
  options: TranslatorOptions = EN_RU,
  scope: object = globalThis,
  now: () => number = () => performance.now(),
): Promise<BenchmarkResult> {
  const empty = { context, cueCount: texts.length, createMs: null, timings: [], translations: [] };
  const api = getTranslatorApi(scope);
  if (!api) return { ...empty, error: 'Translator API is not available in this context' };

  let translator: TranslatorInstance;
  const createStart = now();
  try {
    translator = await api.create(options);
  } catch (error) {
    return { ...empty, error: errorText(error) };
  }
  const createMs = round(now() - createStart);

  const timings: StrategyTiming[] = [];
  let translations: string[] = [];
  for (const strategy of STRATEGIES) {
    const start = now();
    try {
      const result = await translateBatch(translator, texts, strategy);
      const totalMs = round(now() - start);
      timings.push({
        strategy,
        totalMs,
        perCueMs: round(totalMs / texts.length),
        linesMatched: result.linesMatched,
        error: null,
      });
      if (strategy === 'sequential') translations = result.translations;
    } catch (error) {
      timings.push({
        strategy,
        totalMs: round(now() - start),
        perCueMs: 0,
        linesMatched: false,
        error: errorText(error),
      });
    }
  }
  translator.destroy();
  return { context, cueCount: texts.length, createMs, timings, translations, error: null };
}

// ---------------------------------------------------------------- model download

/**
 * Downloads the language model. Chrome allows this only inside a user gesture (a click), so call it
 * synchronously from a click handler in an extension page. `onProgress` gets 0..1.
 */
export function downloadModel(
  options: TranslatorOptions,
  onProgress: (loaded: number) => void,
): Promise<void> {
  const api = getTranslatorApi();
  if (!api) return Promise.reject(new Error('Translator API is not available'));
  return api
    .create({
      ...options,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) =>
          onProgress((event as DownloadProgressEvent).loaded),
        );
      },
    })
    .then((translator) => translator.destroy());
}
