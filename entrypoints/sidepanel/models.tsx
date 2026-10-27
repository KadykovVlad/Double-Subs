import { useEffect, useRef, useState } from 'preact/hooks';
import { t, titleOf } from '../../src/lib/i18n';
import { SUBTITLE_LANGUAGES, type LanguagePair } from '../../src/lib/languages';
import type { Direction } from '../../src/lib/offscreen-messages';
import {
  downloadModel,
  getTranslatorApi,
  pairAvailability,
  pairDirections,
  translatorOptions,
  type Availability,
} from '../../src/lib/translator';
import { Icons, Progress } from './ui';

type Role = 'learn' | 'native';

/** What the list of languages shows beside a language: its models are there, to download, or not offered. */
export const MODEL_MARK: Record<Availability, string> = {
  available: ' ✓',
  downloadable: ' ↓',
  downloading: ' ↓',
  unavailable: ' ✕',
};

const availabilityOf = async (direction: Direction): Promise<Availability> => {
  const api = getTranslatorApi();
  const options = translatorOptions(direction);
  if (!api || !options) return 'unavailable';
  return api.availability(options).catch((): Availability => 'unavailable');
};

/**
 * The models of Chrome's translator for the pair of languages: their state, the download and its
 * progress. Choosing a language starts the download of what the pair lacks at once (the choice is the
 * gesture Chrome wants); a button is there for the case Chrome refused or the model was dropped.
 */
export function useTranslationModels(pair: LanguagePair, onReady: () => void) {
  const api = getTranslatorApi();
  const [states, setStates] = useState<Record<string, Availability>>({});
  const [marks, setMarks] = useState<Record<Role, Record<string, Availability>>>({
    learn: {},
    native: {},
  });
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [round, setRound] = useState(0);
  const busy = useRef(false);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    if (!api) return;
    let alive = true;
    void (async () => {
      const own: Record<string, Availability> = {};
      for (const direction of pairDirections(pair.learn, pair.native))
        own[direction] = await availabilityOf(direction);
      // Each candidate of a list against the other language of the pair.
      const against = async (role: Role, other: string) => {
        const entries = await Promise.all(
          SUBTITLE_LANGUAGES.filter((code) => code !== other).map(
            async (code): Promise<[string, Availability]> => [
              code,
              pairAvailability(
                await Promise.all(pairDirections(code, other).map((d) => availabilityOf(d))),
              ),
            ],
          ),
        );
        return [role, Object.fromEntries(entries)] as const;
      };
      const [learnMarks, nativeMarks] = await Promise.all([
        against('learn', pair.native),
        against('native', pair.learn),
      ]);
      if (!alive) return;
      setStates(own);
      setMarks({ learn: learnMarks[1], native: nativeMarks[1] });
    })();
    return () => {
      alive = false;
    };
  }, [pair.learn, pair.native, round]);

  /** Downloads what `target` lacks, one model after another; the click that chose it is the gesture. */
  const download = async (target: LanguagePair = pair) => {
    if (!api || busy.current) return;
    busy.current = true;
    try {
      for (const direction of pairDirections(target.learn, target.native)) {
        const options = translatorOptions(direction);
        if (!options || (await availabilityOf(direction)) !== 'downloadable') continue;
        setErrors((old) => ({ ...old, [direction]: '' }));
        setProgress((old) => ({ ...old, [direction]: 0 }));
        try {
          await downloadModel(options, (loaded) =>
            setProgress((old) => ({ ...old, [direction]: loaded })),
          );
        } catch (error) {
          setErrors((old) => ({ ...old, [direction]: String(error) }));
        }
        setProgress((old) => {
          const next = { ...old };
          delete next[direction];
          return next;
        });
      }
    } finally {
      busy.current = false;
      setRound((n) => n + 1);
      const left = await Promise.all(
        pairDirections(target.learn, target.native).map((d) => availabilityOf(d)),
      );
      if (left.every((state) => state === 'available')) ready.current();
    }
  };

  return { api, states, marks, progress, errors, download };
}

export type TranslationModels = ReturnType<typeof useTranslationModels>;

/**
 * Under the two lists of languages: what the pair still lacks. Nothing at all when the models are
 * there. The download button is the same click Chrome wants for a download started by hand.
 */
export function ModelsRow({ pair, models }: { pair: LanguagePair; models: TranslationModels }) {
  if (!models.api) return null;
  const lines = pairDirections(pair.learn, pair.native)
    .map((direction) => {
      const [from, to] = direction.split('-') as [string, string];
      return {
        direction,
        label: `${titleOf(from)} → ${titleOf(to)}`,
        state: models.states[direction],
        loaded: models.progress[direction],
        error: models.errors[direction],
      };
    })
    .filter((line) => line.state !== undefined && line.state !== 'available');
  if (lines.length === 0) return null;
  const downloading = Object.keys(models.progress).length > 0;

  return (
    <div class="models-row" data-testid="models-status">
      {lines.map((line) => (
        <div key={line.direction} class="model-line" data-direction={line.direction}>
          <div class="grow">
            {line.loaded !== undefined ? (
              <>
                <p>
                  {line.label}: {t('trb_downloading', Math.round(line.loaded * 100))}
                </p>
                <Progress value={line.loaded} />
              </>
            ) : line.state === 'unavailable' ? (
              <p class="muted">{t('trb_unavailable', line.label)}</p>
            ) : line.state === 'downloading' ? (
              <p>{t('tm_busy', line.label)}</p>
            ) : (
              <p>{t('tm_needed', line.label)}</p>
            )}
            {line.error && <p class="muted">{t('trb_download_error', line.error)}</p>}
          </div>
          {line.state === 'downloadable' && line.loaded === undefined && (
            <button
              type="button"
              class="download-btn sm"
              data-testid="models-download"
              title={t('trb_download')}
              aria-label={t('trb_download')}
              disabled={downloading}
              onClick={() => void models.download()}
            >
              {Icons.download}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
