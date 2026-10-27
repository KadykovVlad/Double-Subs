import { useEffect, useState } from 'preact/hooks';
import { t, titleOf, uiLanguage } from '../../src/lib/i18n';
import { SUBTITLE_LANGUAGES } from '../../src/lib/languages';
import { pairOf } from '../../src/lib/settings';
import {
  directionOf,
  downloadModel,
  getTranslatorApi,
  translatorOptions,
  type Availability,
} from '../../src/lib/translator';
import { useSettings } from './hooks';
import { Card, Icons, Progress } from './ui';

type Models = Record<string, Availability>;

/** What the list shows beside a language: the model is there, can be downloaded, or the pair is not offered. */
const MARK: Record<Availability, string> = {
  available: ' ✓',
  downloadable: ' ↓',
  downloading: ' ↓',
  unavailable: ' ✕',
};

/**
 * The language models of Chrome's translator, one per pair. Translation of the missing subtitle line
 * runs on this device, so Chrome needs the model of the pair once: here the user picks a language,
 * sees whether its model (into their own language) is there, and downloads it. The download starts in
 * the click on the button: Chrome allows it only on a gesture of the user.
 */
export function TranslationModels() {
  const [settings] = useSettings();
  const { learn, native } = pairOf(settings);
  const [from, setFrom] = useState(learn);
  const [models, setModels] = useState<Models | null>(null);
  const [download, setDownload] = useState<{ loaded: number } | { error: string } | null>(null);
  const [round, setRound] = useState(0); // bumped after a download: the list is read again
  const api = getTranslatorApi();

  // The language being translated from is never the user's own one.
  const chosen =
    from === native ? (SUBTITLE_LANGUAGES.find((code) => code !== native) ?? from) : from;
  useEffect(() => setFrom(learn === native ? from : learn), [learn, native]);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    const codes = SUBTITLE_LANGUAGES.filter((code) => code !== native);
    void Promise.all(
      codes.map(async (code): Promise<[string, Availability]> => {
        const options = translatorOptions(directionOf(code, native));
        if (!options) return [code, 'unavailable'];
        return [code, await api.availability(options).catch((): Availability => 'unavailable')];
      }),
    ).then((entries) => alive && setModels(Object.fromEntries(entries)));
    return () => {
      alive = false;
    };
  }, [native, round]);

  const status = models?.[chosen];
  const line = `${titleOf(chosen)} → ${titleOf(native)}`;
  const options = [...SUBTITLE_LANGUAGES]
    .filter((code) => code !== native)
    .map((code): [string, string] => [code, titleOf(code)])
    .sort((a, b) => a[1].localeCompare(b[1], uiLanguage()));
  const busy = download !== null && !('error' in download);

  const startDownload = () => {
    const pairOptions = translatorOptions(directionOf(chosen, native));
    if (!pairOptions) return;
    // The first thing the click does: Chrome wants the gesture.
    setDownload({ loaded: 0 });
    downloadModel(pairOptions, (loaded) => setDownload({ loaded }))
      .then(() => {
        setDownload(null);
        setRound((n) => n + 1);
      })
      .catch((error: unknown) => setDownload({ error: String(error) }));
  };

  return (
    <Card class="models" testid="models">
      <p class="muted small">{t('tm_why')}</p>
      {!api ? (
        <p class="muted" data-testid="models-status" data-state="no-api">
          {t('tm_no_api')}
        </p>
      ) : (
        <>
          <div class="models-pick">
            <select
              data-testid="models-language"
              aria-label={t('tm_from')}
              value={chosen}
              onChange={(event) => {
                setFrom(event.currentTarget.value);
                setDownload(null);
              }}
            >
              {options.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                  {models?.[code] ? MARK[models[code]!] : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              class="download-btn"
              data-testid="models-download"
              title={t('trb_download')}
              aria-label={t('trb_download')}
              disabled={busy || status !== 'downloadable'}
              onClick={startDownload}
            >
              {Icons.download}
            </button>
          </div>
          <div class="models-status" data-testid="models-status" data-state={status ?? 'checking'}>
            {download && 'error' in download ? (
              <p class="muted">{t('trb_download_error', download.error)}</p>
            ) : download ? (
              <>
                <p>{t('trb_downloading', Math.round(download.loaded * 100))}</p>
                <Progress value={download.loaded} />
              </>
            ) : status === 'available' ? (
              <p class="ok-text">{t('tm_ready', line)}</p>
            ) : status === 'downloadable' ? (
              <p>{t('tm_needed', line)}</p>
            ) : status === 'downloading' ? (
              <p>{t('tm_busy', line)}</p>
            ) : status === 'unavailable' ? (
              <p class="muted">{t('trb_unavailable', line)}</p>
            ) : (
              <p class="muted">…</p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
