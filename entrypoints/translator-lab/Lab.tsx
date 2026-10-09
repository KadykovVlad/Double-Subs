import { useEffect, useState } from 'preact/hooks';
import type { Direction, OffscreenRequest } from '../../src/lib/offscreen-messages';
import { ensureOffscreen } from '../../src/lib/offscreen';
import { QUALITY_SAMPLE, speedSample } from '../../src/lib/sample-dialogue';
import {
  benchmark,
  EN_RU,
  getTranslatorApi,
  probeTranslator,
  RU_EN,
  type BenchmarkResult,
  type DownloadProgressEvent,
  type TranslatorOptions,
  type TranslatorProbe,
} from '../../src/lib/translator';

const SPEED_TEXTS = speedSample(200);

function askOffscreen<T>(message: OffscreenRequest): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

async function probeOffscreen(): Promise<TranslatorProbe> {
  try {
    await ensureOffscreen();
    return await askOffscreen<TranslatorProbe>({ target: 'offscreen', type: 'probe' });
  } catch (error) {
    return {
      context: 'offscreen',
      apiPresent: false,
      enRu: null,
      ruEn: null,
      error: String(error),
    };
  }
}

interface Download {
  direction: string;
  progress: number;
  ms: number | null;
  error: string | null;
}

/** Downloads a model. Must start inside a click: Chrome needs a user gesture for the download. */
function downloadModel(
  options: TranslatorOptions,
  onProgress: (loaded: number) => void,
): Promise<Download> {
  const direction = `${options.sourceLanguage}→${options.targetLanguage}`;
  const api = getTranslatorApi();
  if (!api)
    return Promise.resolve({
      direction,
      progress: 0,
      ms: null,
      error: 'Translator API отсутствует',
    });

  const start = performance.now();
  return api
    .create({
      ...options,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) =>
          onProgress((event as DownloadProgressEvent).loaded),
        );
      },
    })
    .then((translator) => {
      translator.destroy();
      return { direction, progress: 1, ms: Math.round(performance.now() - start), error: null };
    })
    .catch((error: unknown) => ({ direction, progress: 0, ms: null, error: String(error) }));
}

export function Lab() {
  const [probes, setProbes] = useState<TranslatorProbe[]>([]);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [speed, setSpeed] = useState<BenchmarkResult[]>([]);
  const [quality, setQuality] = useState<{ enRu: string[]; ruEn: string[] }>({
    enRu: [],
    ruEn: [],
  });
  const [busy, setBusy] = useState<string | null>(null);

  const refreshProbes = async () => {
    setProbes([await probeTranslator('лаборатория (страница расширения)'), await probeOffscreen()]);
  };

  useEffect(() => {
    void refreshProbes();
  }, []);

  const download = () => {
    // Both create() calls start synchronously inside the click.
    const runs = [EN_RU, RU_EN].map((options) =>
      downloadModel(options, (loaded) =>
        setProgress((prev) => ({
          ...prev,
          [`${options.sourceLanguage}→${options.targetLanguage}`]: loaded,
        })),
      ),
    );
    setBusy('download');
    void Promise.all(runs).then(async (results) => {
      setDownloads(results);
      await refreshProbes();
      setBusy(null);
    });
  };

  const runSpeed = async (where: 'lab' | 'offscreen') => {
    setBusy(`speed-${where}`);
    let result: BenchmarkResult;
    if (where === 'lab') {
      result = await benchmark('лаборатория', SPEED_TEXTS);
    } else {
      await ensureOffscreen();
      result = await askOffscreen<BenchmarkResult>({
        target: 'offscreen',
        type: 'benchmark',
        texts: SPEED_TEXTS,
        direction: 'en-ru' satisfies Direction,
      });
    }
    setSpeed((prev) => [...prev.filter((r) => r.context !== result.context), result]);
    if (result.translations.length > 0) {
      setQuality((prev) => ({
        ...prev,
        enRu: result.translations.slice(0, QUALITY_SAMPLE.length),
      }));
    }
    setBusy(null);
  };

  const runBackTranslation = async () => {
    setBusy('ru-en');
    const result = await benchmark(
      'лаборатория RU→EN',
      QUALITY_SAMPLE.map((line) => line.reference),
      RU_EN,
    );
    setQuality((prev) => ({ ...prev, ruEn: result.translations }));
    setSpeed((prev) => [...prev.filter((r) => r.context !== result.context), result]);
    setBusy(null);
  };

  const report = JSON.stringify(
    {
      userAgent: navigator.userAgent,
      probes,
      downloads,
      speed: speed.map((result) => ({ ...result, translations: result.translations.length })),
      quality: QUALITY_SAMPLE.map((line, i) => ({
        en: line.en,
        chrome: quality.enRu[i] ?? null,
        reference: line.reference,
        backToEn: quality.ruEn[i] ?? null,
      })),
    },
    null,
    2,
  );

  return (
    <main class="lab">
      <h1>Лаборатория перевода</h1>
      <p class="muted">
        Прототип этапа 4. Проверяем, где в Chrome работает встроенный переводчик, как быстро он
        переводит и насколько хорошо.
      </p>

      <section>
        <h2>1. Где доступен переводчик</h2>
        <table>
          <thead>
            <tr>
              <th>Где</th>
              <th>API</th>
              <th>EN→RU</th>
              <th>RU→EN</th>
              <th>Ошибка</th>
            </tr>
          </thead>
          <tbody>
            {probes.map((probe) => (
              <tr key={probe.context} data-testid="probe-row">
                <td>{probe.context}</td>
                <td>{probe.apiPresent ? 'есть' : 'нет'}</td>
                <td>{probe.enRu ?? '—'}</td>
                <td>{probe.ruEn ?? '—'}</td>
                <td>{probe.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="muted">
          available — готов; downloadable — модель нужно скачать (шаг 2); unavailable — эта пара
          языков не поддерживается. Проверка на странице сайта: popup → «Диагностика» → «Проверить
          переводчик».
        </p>
        <button onClick={() => void refreshProbes()}>Обновить</button>
      </section>

      <section>
        <h2>2. Скачать модели</h2>
        <p class="muted">
          Скачивание разрешено только по клику пользователя, поэтому оно здесь, а не в фоне.
        </p>
        <button data-testid="download" disabled={busy !== null} onClick={download}>
          Скачать EN→RU и RU→EN
        </button>
        {Object.entries(progress).map(([direction, loaded]) => (
          <p key={direction}>
            {direction}: {Math.round(loaded * 100)}%
          </p>
        ))}
        {downloads.map((d) => (
          <p key={d.direction}>
            {d.direction}: {d.error ? `ошибка — ${d.error}` : `готово за ${d.ms} мс`}
          </p>
        ))}
      </section>

      <section>
        <h2>3. Скорость: 200 реплик EN→RU</h2>
        <button
          data-testid="bench-lab"
          disabled={busy !== null}
          onClick={() => void runSpeed('lab')}
        >
          Запустить здесь
        </button>
        <button
          data-testid="bench-offscreen"
          disabled={busy !== null}
          onClick={() => void runSpeed('offscreen')}
        >
          Запустить в offscreen
        </button>
        {busy?.startsWith('speed') && <p>Перевожу… это может занять до минуты.</p>}
        {speed.map((result) => (
          <div key={result.context} data-testid="bench-result">
            <h3>{result.context}</h3>
            {result.error ? (
              <p class="error">{result.error}</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Способ</th>
                    <th>Всего, мс</th>
                    <th>На реплику, мс</th>
                    <th>Строки совпали</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>создание переводчика</td>
                    <td>{result.createMs}</td>
                    <td />
                    <td />
                  </tr>
                  {result.timings.map((t) => (
                    <tr key={t.strategy}>
                      <td>{t.strategy}</td>
                      <td>{t.totalMs}</td>
                      <td>{t.perCueMs}</td>
                      <td>{t.error ?? (t.linesMatched ? 'да' : 'НЕТ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </section>

      <section>
        <h2>4. Качество: 50 реплик</h2>
        <p class="muted">
          «Эталон» — перевод, написанный Claude, для сравнения. Сначала запустите шаг 3, затем
          обратный перевод.
        </p>
        <button
          disabled={busy !== null || quality.enRu.length === 0}
          onClick={() => void runBackTranslation()}
        >
          Перевести эталон обратно RU→EN
        </button>
        <table class="quality">
          <thead>
            <tr>
              <th>Оригинал</th>
              <th>Chrome EN→RU</th>
              <th>Эталон</th>
              <th>Chrome RU→EN (по эталону)</th>
            </tr>
          </thead>
          <tbody>
            {QUALITY_SAMPLE.map((line, i) => (
              <tr key={line.en}>
                <td>{line.en}</td>
                <td>{quality.enRu[i] ?? ''}</td>
                <td>{line.reference}</td>
                <td>{quality.ruEn[i] ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>5. Отчёт</h2>
        <p class="muted">
          Скопируйте и пришлите в чат: там нет ничего, кроме результатов этой страницы и версии
          Chrome.
        </p>
        <button onClick={() => void navigator.clipboard.writeText(report)}>
          Скопировать отчёт
        </button>
        <textarea data-testid="report" readOnly rows={8} value={report} />
      </section>
    </main>
  );
}
