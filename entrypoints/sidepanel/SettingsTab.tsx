import { useEffect, useState } from 'preact/hooks';
import { clearHistory } from '../../src/lib/history';
import {
  BAR_OPACITY,
  BAR_WIDTH,
  BOTTOM_OFFSET,
  FONT_FAMILIES,
  FONT_SIZE,
  FONT_WEIGHTS,
  GLASS_BLUR,
  GLASS_RADIUS,
  GLASS_TINTS,
  TEXT_COLORS,
  TEXT_EFFECTS,
  TRANSLATION_SIZE,
  type FontFamily,
  type TextEffect,
} from '../../src/lib/settings';
import type { FrameTranslatorProbe } from '../../src/lib/messages';
import { speakWord } from '../../src/lib/speech';
import type { TranslatorProbe } from '../../src/lib/translator';
import {
  loadVoices,
  moreVoicesHint,
  RANDOM_VOICE,
  voiceOptions,
  type VoiceOption,
} from '../../src/lib/voices';
import type { WordLang } from '../../src/lib/words';
import {
  openTranslatorLab,
  probeTranslatorInFrames,
  type Diagnostics,
} from '../../src/panel/controller';
import { forgetSite, MirrorsSwitch } from './NowTab';
import { useHistory, useKnownSites, useSettings } from './hooks';
import { Button, Card, ColorRow, Icons, RangeRow, SectionTitle, SelectRow, SwitchRow } from './ui';
import { t } from '../../src/lib/i18n';

export function SettingsTab({
  tabId,
  diagnostics,
}: {
  tabId: number | null;
  diagnostics: Diagnostics | null;
}) {
  const [settings, change] = useSettings();
  const sites = Object.values(useKnownSites());
  const history = useHistory();

  return (
    <>
      <SectionTitle>{t('set_learning')}</SectionTitle>
      <Card>
        <div class="row">
          <span class="grow label">{t('set_size')}</span>
          <span class="stepper">
            <button
              type="button"
              data-testid="font-smaller"
              aria-label={t('set_smaller')}
              onClick={() => change({ fontSize: settings.fontSize - FONT_SIZE.step })}
            >
              −
            </button>
            <span class="value" data-testid="font-scale">
              {settings.fontSize} px
            </span>
            <button
              type="button"
              data-testid="font-bigger"
              aria-label={t('set_bigger')}
              onClick={() => change({ fontSize: settings.fontSize + FONT_SIZE.step })}
            >
              +
            </button>
          </span>
        </div>
        <ColorRow
          label={t('set_color')}
          testid="color-en"
          value={settings.colorEn}
          palette={TEXT_COLORS}
          onChange={(colorEn) => change({ colorEn })}
        />
        <VoiceRow
          lang="en"
          label={t('set_voice')}
          value={settings.voiceEn}
          onChange={(voiceEn) => change({ voiceEn })}
        />
      </Card>

      <SectionTitle>{t('set_native')}</SectionTitle>
      <Card>
        <RangeRow
          label={t('set_size')}
          testid="translation-size"
          min={TRANSLATION_SIZE.min}
          max={TRANSLATION_SIZE.max}
          step={TRANSLATION_SIZE.step}
          value={settings.translationSize}
          suffix=" px"
          onChange={(translationSize) => change({ translationSize })}
        />
        <ColorRow
          label={t('set_color')}
          testid="color-ru"
          value={settings.colorRu}
          palette={TEXT_COLORS}
          onChange={(colorRu) => change({ colorRu })}
        />
        <VoiceRow
          lang="ru"
          label={t('set_voice')}
          value={settings.voiceRu}
          onChange={(voiceRu) => change({ voiceRu })}
        />
      </Card>

      <SectionTitle>{t('set_window')}</SectionTitle>
      <Card>
        <RangeRow
          label={t('set_width')}
          testid="bar-width"
          min={BAR_WIDTH.min}
          max={BAR_WIDTH.max}
          step={BAR_WIDTH.step}
          value={settings.barWidth}
          suffix="%"
          onChange={(barWidth) => change({ barWidth })}
        />
        <RangeRow
          label={t('set_opacity')}
          testid="bar-opacity"
          min={BAR_OPACITY.min}
          max={BAR_OPACITY.max}
          step={BAR_OPACITY.step}
          scale={100}
          value={settings.barOpacity}
          suffix="%"
          onChange={(barOpacity) => change({ barOpacity })}
        />
        <div class="row">
          <span class="grow label">{t('set_position')}</span>
          <Button
            variant="secondary"
            size="sm"
            testid="lines-lower"
            onClick={() => change({ bottomOffset: settings.bottomOffset - BOTTOM_OFFSET.step })}
          >
            {t('set_lower')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            testid="lines-higher"
            onClick={() => change({ bottomOffset: settings.bottomOffset + BOTTOM_OFFSET.step })}
          >
            {t('set_higher')}
          </Button>
        </div>
        <details class="more-styles">
          <summary>{t('set_more_styles')}</summary>
          <SelectRow
            label={t('set_font')}
            testid="font-family"
            value={settings.fontFamily}
            options={Object.entries(FONT_FAMILIES).map(([key, f]) => [key, t(f.label)])}
            onChange={(value) => change({ fontFamily: value as FontFamily })}
          />
          <SelectRow
            label={t('set_weight')}
            testid="font-weight"
            value={String(settings.fontWeight)}
            options={FONT_WEIGHTS.map((w) => [String(w), String(w)])}
            onChange={(value) => change({ fontWeight: Number(value) })}
          />
          <SelectRow
            label={t('set_effect')}
            testid="text-effect"
            value={settings.textEffect}
            options={Object.entries(TEXT_EFFECTS).map(([key, e]) => [key, t(e.label)])}
            onChange={(value) => change({ textEffect: value as TextEffect })}
          />
          <ColorRow
            label={t('set_glass')}
            testid="glass-tint"
            value={settings.glassTint}
            palette={GLASS_TINTS}
            onChange={(glassTint) => change({ glassTint })}
          />
          <RangeRow
            label={t('set_blur')}
            testid="glass-blur"
            min={GLASS_BLUR.min}
            max={GLASS_BLUR.max}
            step={GLASS_BLUR.step}
            value={settings.glassBlur}
            suffix=" px"
            onChange={(glassBlur) => change({ glassBlur })}
          />
          <RangeRow
            label={t('set_radius')}
            testid="glass-radius"
            min={GLASS_RADIUS.min}
            max={GLASS_RADIUS.max}
            step={GLASS_RADIUS.step}
            value={settings.glassRadius}
            suffix="%"
            onChange={(glassRadius) => change({ glassRadius })}
          />
        </details>
      </Card>

      <SectionTitle>{t('set_sites')}</SectionTitle>
      <Card>
        {sites.length === 0 ? (
          <p class="muted" data-testid="known-sites">
            {t('set_sites_empty')}
          </p>
        ) : (
          <ul class="list" data-testid="known-sites">
            {sites.map((site) => (
              <li key={site.origin} data-testid="known-site">
                <span class="grow">{new URL(site.origin).host}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  testid="forget-site"
                  onClick={() => void forgetSite(site.origin)}
                >
                  {t('remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <MirrorsSwitch />
      </Card>

      <SectionTitle>{t('set_history')}</SectionTitle>
      <Card>
        <SwitchRow
          label={t('set_keep_history')}
          hint={t('set_keep_history_hint')}
          checked={settings.keepHistory}
          testid="toggle-history"
          onChange={(keepHistory) => change({ keepHistory })}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={history.length === 0}
          onClick={() => void clearHistory()}
        >
          {t('set_clear_history', history.length)}
        </Button>
      </Card>

      {__DS_PROTOTYPES__ && diagnostics && tabId !== null && (
        <DiagnosticsView tabId={tabId} diagnostics={diagnostics} />
      )}
      {__DS_PROTOTYPES__ && (
        <Button variant="secondary" block onClick={openTranslatorLab}>
          Лаборатория перевода (прототип)
        </Button>
      )}
    </>
  );
}

/**
 * The voices of the system for one language, built-in ones grouped by accent. Picking one says a
 * sample word at once; "a different voice every word" gives variety. The count is whatever the
 * system has: more can be added in its speech settings.
 */
function VoiceRow(props: {
  lang: WordLang;
  label: string;
  value: string;
  onChange: (name: string) => void;
}) {
  const [options, setOptions] = useState<VoiceOption[]>([]);
  useEffect(() => {
    void loadVoices().then((all) => setOptions(voiceOptions(all, props.lang)));
  }, [props.lang]);

  const local = options.filter((v) => !v.remote);
  const online = options.filter((v) => v.remote);
  const accents = [...new Set(local.map((v) => v.accent))];
  const sample = props.lang === 'en' ? 'Hello, world' : 'Привет, мир';
  const choose = (name: string) => {
    props.onChange(name);
    speakWord(sample, props.lang, name === RANDOM_VOICE ? undefined : name);
  };

  return (
    <>
      <div class="row">
        <span class="grow label">
          {props.label}
          <span class="hint">
            {local.length > 0 ? t('voices_count', local.length) : t('voices_none')}
          </span>
        </span>
        <select
          data-testid={`voice-${props.lang}`}
          value={props.value}
          onChange={(event) => choose(event.currentTarget.value)}
        >
          <option value="">{t('voice_auto')}</option>
          <option value={RANDOM_VOICE}>{t('voice_random')}</option>
          {accents.map((accent) => (
            <optgroup key={accent} label={accent}>
              {local
                .filter((v) => v.accent === accent)
                .map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
            </optgroup>
          ))}
          {online.length > 0 && (
            <optgroup label={t('voice_online')}>
              {online.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          class="icon-btn"
          type="button"
          title={t('listen')}
          aria-label={t('listen_item', props.label)}
          data-testid={`voice-preview-${props.lang}`}
          onClick={() =>
            speakWord(
              sample,
              props.lang,
              props.value === RANDOM_VOICE ? undefined : props.value || undefined,
            )
          }
        >
          {Icons.volume}
        </button>
      </div>
      {local.length < 10 && (
        <p class="muted small" data-testid={`voice-hint-${props.lang}`}>
          {moreVoicesHint(navigator.userAgent)}
        </p>
      )}
    </>
  );
}

function probeText(probe: TranslatorProbe | null): string {
  if (!probe) return 'не ответил';
  if (probe.error) return `ошибка: ${probe.error}`;
  if (!probe.apiPresent) return 'API нет';
  return `EN→RU ${probe.enRu}, RU→EN ${probe.ruEn}`;
}

/** Prototype checks of stages 2-4: only in the dev and test builds. */
function DiagnosticsView({ tabId, diagnostics }: { tabId: number; diagnostics: Diagnostics }) {
  const [probes, setProbes] = useState<FrameTranslatorProbe[] | null>(null);
  const check = () => {
    setProbes([]);
    void probeTranslatorInFrames(
      tabId,
      diagnostics.frames.map((f) => f.frameId),
    ).then(setProbes);
  };
  return (
    <Card>
      <details class="diag">
        <summary>Диагностика</summary>
        <p>Внедрение во все фреймы: {diagnostics.allFramesError ?? 'успешно'}</p>
        <ul>
          {diagnostics.frames.map((f) => (
            <li key={f.frameId}>
              фрейм {f.frameId}: {f.origin}, видео {f.visibleVideos}/{f.videos}
            </li>
          ))}
        </ul>
        <p data-testid="diag-subs">
          Субтитры, запрошенные до запуска: {diagnostics.subtitleResources.length}
          {diagnostics.subtitleResources.map((url) => (
            <span key={url} class="url">
              {url}
            </span>
          ))}
        </p>
        <Button testid="probe-translator" onClick={check}>
          Проверить переводчик на этой странице
        </Button>
        {probes?.length === 0 && <p>Проверяю…</p>}
        <ul>
          {probes?.map((probe) => (
            <li key={probe.frame} data-testid="translator-probe">
              <b>{probe.frame}</b>
              <br />
              content script: {probeText(probe.contentScript)}
              <br />
              наш iframe: {probeText(probe.extensionFrame)}
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
