import { useEffect, useRef, useState } from 'preact/hooks';
import { signOut } from '../../src/lib/account';
import { FREE_PLAN, isPro, saveEntitlements } from '../../src/lib/entitlements';
import { clearHistory } from '../../src/lib/history';
import { setSiteExcluded } from '../../src/lib/known-sites';
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
  voiceFor,
  voicePatch,
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
import { sampleWord } from '../../src/lib/languages';
import type { WordLang } from '../../src/lib/words';
import {
  openTranslatorLab,
  probeTranslatorInFrames,
  type Diagnostics,
} from '../../src/panel/controller';
import { forgetSite, MirrorsSwitch, type SettingsFocus } from './NowTab';
import {
  useAccount,
  useEntitlements,
  useExcludedSites,
  useHistory,
  useKnownSites,
  useSettings,
} from './hooks';
import { Button, Card, ColorRow, Icons, RangeRow, SectionTitle, SelectRow, SwitchRow } from './ui';
import { t, type MessageKey } from '../../src/lib/i18n';
import type { JSX } from 'preact';

export function SettingsTab({
  tabId,
  diagnostics,
  focus = null,
}: {
  tabId: number | null;
  diagnostics: Diagnostics | null;
  /** The section to show first (a tool of the "Now" tab led here). */
  focus?: SettingsFocus | null;
}) {
  useEffect(() => {
    // Coming from another tab the page has just been built: no smooth scroll, it would be cut short.
    if (!focus) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() =>
        revealSection(focus.section, { ...focus, instant: true }),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [focus]);

  const [settings, change] = useSettings();
  const sites = Object.values(useKnownSites());
  const history = useHistory();
  const entitlements = useEntitlements();

  return (
    <div class="settings">
      <div class="settings-grid">
        <SettingsNav sections={VISIBLE_SECTIONS} />
        <div class="settings-body">
          <section id="set-account" class="settings-section">
            <AccountCard />
          </section>
          <section id="set-subtitles" class="settings-section">
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
              <LineVoice lang={settings.learnLang} />
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
              <LineVoice lang={settings.nativeLang} />
            </Card>
          </section>
          <section id="set-window" class="settings-section">
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
                  onClick={() =>
                    change({ bottomOffset: settings.bottomOffset - BOTTOM_OFFSET.step })
                  }
                >
                  {t('set_lower')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  testid="lines-higher"
                  onClick={() =>
                    change({ bottomOffset: settings.bottomOffset + BOTTOM_OFFSET.step })
                  }
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
          </section>
          <section id="set-sites" class="settings-section">
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

            <SwitchedOffSites />
          </section>
          <section id="set-history" class="settings-section">
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
          </section>
          {__DS_PROTOTYPES__ && (
            <section id="set-dev" class="settings-section">
              <Card>
                <SwitchRow
                  label="Pro (для разработки)"
                  hint="Только в dev- и e2e-сборках: настоящий план придёт с сервера"
                  testid="dev-pro"
                  checked={isPro(entitlements)}
                  onChange={(on) =>
                    void saveEntitlements(on ? { plan: 'pro', proUntil: null } : FREE_PLAN)
                  }
                />
              </Card>
              {diagnostics && tabId !== null && (
                <DiagnosticsView tabId={tabId} diagnostics={diagnostics} />
              )}
              <Button variant="secondary" block onClick={openTranslatorLab}>
                Лаборатория перевода (прототип)
              </Button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Brings a section (or one block of it) into view and makes it blink three times, so the eye finds
 * it. The last section cannot reach the top of the page: the page scrolls as far as it goes and the
 * section is seen at the bottom.
 */
function revealSection(
  id: SectionId,
  options: { styles?: boolean; target?: string; instant?: boolean } = {},
) {
  const section = document.getElementById(`set-${id}`);
  if (!section) return;
  if (options.styles) section.querySelector('details')?.setAttribute('open', '');
  const block = options.target
    ? section.querySelector(options.target)?.closest<HTMLElement>('.row, details')
    : null;
  const blinking = block
    ? [block]
    : options.styles
      ? [...section.querySelectorAll<HTMLElement>('details')]
      : [...section.querySelectorAll<HTMLElement>('.card')];
  const smooth = !options.instant && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scroll = (behavior: ScrollBehavior) =>
    (block ?? section).scrollIntoView({ behavior, block: block ? 'center' : 'start' });
  scroll(smooth ? 'smooth' : 'auto');
  // The blinking starts when the scroll has mostly arrived; blinking again restarts it.
  setTimeout(
    () => {
      // A page that was still settling (fonts, lists) may have moved the block: put it back in view.
      if (!smooth) scroll('auto');
      for (const element of blinking) {
        element.classList.remove('blink');
        void element.offsetWidth;
        element.classList.add('blink');
        setTimeout(() => element.classList.remove('blink'), BLINK_MS);
      }
    },
    smooth ? 380 : 120,
  );
}

const BLINK_MS = 1650;

type SectionId = 'account' | 'subtitles' | 'window' | 'sites' | 'history' | 'dev';

const SECTIONS: Array<{ id: SectionId; label: MessageKey; icon: JSX.Element }> = [
  { id: 'account', label: 'nav_account', icon: Icons.user },
  { id: 'subtitles', label: 'nav_subtitles', icon: Icons.subtitles },
  { id: 'window', label: 'nav_window', icon: Icons.window },
  { id: 'sites', label: 'nav_sites', icon: Icons.globe },
  { id: 'history', label: 'nav_history', icon: Icons.history },
  { id: 'dev', label: 'nav_dev', icon: Icons.tool },
];

const VISIBLE_SECTIONS = SECTIONS.filter((section) => section.id !== 'dev' || __DS_PROTOTYPES__);

/**
 * The contents of the settings: every section stays on the page, a click scrolls to it and the one
 * being read is lit (followed on scroll). A rail on the left in a wide panel, a strip of chips in a narrow one (panel.css).
 */
function SettingsNav({ sections }: { sections: typeof SECTIONS }) {
  const [current, setCurrent] = useState<SectionId>('account');

  /** After a click the chosen section stays lit until the user scrolls by hand. */
  const chosen = useRef(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (chosen.current) return;
      const ids = sections.map((section) => section.id);
      const page = document.scrollingElement ?? document.documentElement;
      // At the bottom a short last section never reaches the top: it is the one being read.
      if (page.scrollTop + innerHeight >= page.scrollHeight - 4 && page.scrollTop > 0) {
        setCurrent(ids[ids.length - 1]!);
        return;
      }
      // Otherwise the last section whose top went under the sticky tabs and contents.
      let reading = ids[0]!;
      for (const id of ids) {
        const top = document.getElementById(`set-${id}`)?.getBoundingClientRect().top;
        if (top !== undefined && top <= 150) reading = id;
      }
      setCurrent(reading);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const byHand = () => {
      chosen.current = false;
    };
    const hand = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    addEventListener('scroll', onScroll, { passive: true });
    for (const type of hand) addEventListener(type, byHand, { passive: true });
    return () => {
      removeEventListener('scroll', onScroll);
      for (const type of hand) removeEventListener(type, byHand);
      cancelAnimationFrame(frame);
    };
  }, [sections]);

  const go = (id: SectionId) => {
    setCurrent(id);
    chosen.current = true;
    revealSection(id);
  };

  return (
    <nav class="settings-nav" aria-label={t('set_nav_label')}>
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          aria-current={current === section.id ? 'true' : undefined}
          data-testid={`settings-nav-${section.id}`}
          onClick={() => go(section.id)}
        >
          {section.icon}
          <span>{t(section.label)}</span>
        </button>
      ))}
    </nav>
  );
}

/**
 * The voices of the system for one language, built-in ones grouped by accent. Picking one says a
 * sample word at once; "a different voice every word" gives variety. The count is whatever the
 * system has: more can be added in its speech settings.
 */
/** The voice of a line's words, for whatever language the line is in. */
function LineVoice({ lang }: { lang: string }) {
  const [settings, change] = useSettings();
  return (
    <VoiceRow
      lang={lang}
      label={t('set_voice')}
      value={voiceFor(settings, lang)}
      onChange={(name) => change(voicePatch(settings, lang, name))}
    />
  );
}

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
  const sample = sampleWord(props.lang);
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

/** Who is signed in and on which plan; the sign-in itself is the gate before the panel (App). */
function AccountCard() {
  const account = useAccount();
  const entitlements = useEntitlements();
  if (!account) return null;

  return (
    <>
      <SectionTitle>{t('account_title')}</SectionTitle>
      <Card>
        <div class="row" data-testid="account-email">
          <span class="grow label">{t('account_signed_in', account.email)}</span>
        </div>
        <div class="row" data-testid="account-plan">
          <span class="grow hint">
            {t(isPro(entitlements) ? 'account_plan_pro' : 'account_plan_free')}
          </span>
        </div>
        <Button variant="secondary" size="sm" testid="sign-out" onClick={() => void signOut()}>
          {t('account_sign_out')}
        </Button>
      </Card>
      <PlanCards pro={isPro(entitlements)} />
    </>
  );
}

const FREE_FEATURES: MessageKey[] = ['feat_dual', 'feat_sites', 'feat_hover', 'feat_history'];
/** The Pro features; `soon` ones are promised, not there yet. */
const PRO_FEATURES: Array<{ key: MessageKey; soon?: boolean }> = [
  { key: 'feat_all_free' },
  { key: 'feat_words' },
  { key: 'feat_media', soon: true },
  { key: 'feat_asr', soon: true },
  { key: 'feat_smart_history', soon: true },
];

/** What each plan gives, the current one marked. There is no payment yet: the way to Pro says "soon". */
function PlanCards({ pro }: { pro: boolean }) {
  return (
    <div class="plans">
      <Card class="plan-card" testid="plan-free">
        <div class="plan-head">
          <h3>{t('plan_free_title')}</h3>
          <span class="badge-free">FREE</span>
        </div>
        <p class="muted small">{t('plan_free_text')}</p>
        <ul class="plan-list">
          {FREE_FEATURES.map((key) => (
            <li key={key}>
              {Icons.check}
              {t(key)}
            </li>
          ))}
        </ul>
        {!pro && <PlanCurrent />}
      </Card>
      <Card class="plan-card pro" testid="plan-pro">
        <div class="plan-head">
          <span class="crown">{Icons.crown}</span>
          <h3>Pro</h3>
          <span class="pro-badge">PRO</span>
        </div>
        <p class="muted small">{t('plan_pro_text')}</p>
        <ul class="plan-list">
          {PRO_FEATURES.map(({ key, soon }) => (
            <li key={key}>
              {Icons.check}
              <span>
                {t(key)}
                {soon && <span class="soon">{t('plan_soon')}</span>}
              </span>
            </li>
          ))}
        </ul>
        {pro ? (
          <PlanCurrent />
        ) : (
          <Button block disabled testid="plan-upgrade">
            {t('plan_upgrade')} · {t('plan_soon')}
          </Button>
        )}
      </Card>
    </div>
  );
}

const PlanCurrent = () => (
  <Button variant="secondary" block disabled testid="plan-current">
    {t('plan_current')}
  </Button>
);

/** The sites the user switched off, each with a button to turn it on again; nothing is shown while there are none. */
function SwitchedOffSites() {
  const excluded = useExcludedSites();
  if (excluded.length === 0) return null;
  return (
    <>
      <SectionTitle>{t('site_off_title')}</SectionTitle>
      <Card>
        <ul class="list">
          {excluded.map((host) => (
            <li key={host}>
              <span class="grow" data-testid="switched-off-site">
                {host}
              </span>
              <Button
                variant="ghost"
                size="sm"
                testid="include-site"
                onClick={() => void setSiteExcluded(host, false)}
              >
                {t('site_off_enable')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
