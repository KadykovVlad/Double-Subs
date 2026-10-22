import { useEffect, useState } from 'preact/hooks';
import type { Decision, Lang, TrackType } from '../../src/lib/analysis';
import { cleanTitle, displayUrl, formatDuration, historyId } from '../../src/lib/history';
import {
  addKnownSite,
  addKnownSites,
  dismissOffer,
  excludedHostOf,
  MIRRORS_PATTERN,
  originsToOffer,
  removeKnownSite,
  setMirrorsMode,
  setSiteExcluded,
  YOUTUBE_ORIGIN,
} from '../../src/lib/known-sites';
import { originPattern } from '../../src/lib/scan';
import type { TranslationStatus } from '../../src/lib/translation-messages';
import type { VideoReport } from '../../src/lib/types';
import { youtubeBlocked } from '../../src/lib/youtube';
import { directionOf, downloadModel, EN_RU, translatorOptions } from '../../src/lib/translator';
import {
  otherRole,
  shortName,
  SUBTITLE_LANGUAGES,
  type LanguagePair,
} from '../../src/lib/languages';
import { pairOf, type Settings } from '../../src/lib/settings';
import type { Role } from '../../src/lib/analysis';
import { requestAccess, retryTranslation, type PopupState } from '../../src/panel/controller';
import {
  useDismissedOffers,
  useExcludedSites,
  useHistory,
  useKnownSites,
  useMirrorsMode,
  useSettings,
} from './hooks';
import { Button, Card, Icons, Progress, SectionTitle, Spinner, SwitchRow, VideoThumb } from './ui';
import { nameOf, t, titleOf, uiLanguage, type MessageKey } from '../../src/lib/i18n';

const STATUS_KEY: Record<string, MessageKey> = {
  loaded: 'track_loaded',
  empty: 'track_empty',
  timeout: 'track_timeout',
  error: 'track_error',
};
const LANG_KEY: Record<Lang, MessageKey | null> = {
  en: null,
  ru: null,
  other: 'lang_other',
  unknown: 'lang_unknown',
};
const TYPE_KEY: Record<TrackType, MessageKey> = {
  full: 'type_full',
  forced: 'type_forced',
  sdh: 'type_sdh',
  empty: 'type_empty',
};

/** "EN", "RU" stay as they are; the other languages are named in the user's language. */
const langText = (lang: Lang) => (LANG_KEY[lang] ? t(LANG_KEY[lang]!) : lang.toUpperCase());

function decisionText(report: VideoReport, pair: LanguagePair): string {
  const { decision } = report;
  switch (decision.case) {
    case 'A':
      return t('decision_a');
    case 'B': {
      const from = decision.translateFrom!;
      return t('decision_b', shortName(pair[from]), nameOf(pair[otherRole(from)]));
    }
    case 'C':
      return t(youtubeBlocked(report) ? 'youtube_blocked_text' : 'decision_c');
  }
}

function roleOf(decision: Decision, index: number): string {
  if (decision.learn === index) return t('role_learn');
  if (decision.native === index) return t('role_native');
  return '';
}

export const forgetSite = async (origin: string): Promise<void> => {
  await removeKnownSite(origin);
  // The access given for the automatic start goes too (YouTube's is part of the extension and stays).
  if (origin !== YOUTUBE_ORIGIN)
    await browser.permissions.remove({ origins: [originPattern(origin)] }).catch(() => {});
};

export interface NowProps {
  state: PopupState;
  tabId: number | null;
  onGrant: (origin: string) => void;
  onPick: () => void;
  onCancelPick: () => void;
  onRetry: () => void;
  onReload: () => void;
  /** Opens the settings at one of their sections (the tools of this tab lead there). */
  onOpenSettings: (section: SettingsFocus) => void;
}

/** Where a tool of this tab leads in the settings; `styles` also opens "More styles". */
export interface SettingsFocus {
  section: 'account' | 'subtitles' | 'window';
  styles?: boolean;
}

export function NowTab(props: NowProps) {
  return (
    <>
      {props.state.kind === 'selected' && (
        <VideoPreview tabId={props.tabId} pageUrl={props.state.pageUrl ?? props.state.origin} />
      )}
      <ShowSwitch />
      <LanguagesCard />
      <ToolGrid onOpen={props.onOpenSettings} />
      <RememberOffer state={props.state} />
      <StatusCard {...props} />
      {props.state.kind === 'selected' && <WatchingCard />}
    </>
  );
}

function Hero(props: {
  tone?: 'ok' | 'warn';
  icon: preact.JSX.Element;
  title: string;
  testid?: string;
  children?: preact.ComponentChildren;
}) {
  return (
    <div class="hero">
      <span class={`hero-icon ${props.tone ?? ''}`}>{props.icon}</span>
      <div>
        <h2 data-testid={props.testid}>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

function StatusCard({ state, tabId, onGrant, onPick, onCancelPick, onRetry, onReload }: NowProps) {
  const [settings] = useSettings();
  const pair = pairOf(settings);
  switch (state.kind) {
    case 'working':
      return (
        <Card>
          <div class="row">
            <Spinner />
            <p data-testid="status">{state.text}</p>
          </div>
        </Card>
      );

    case 'restricted':
      return (
        <Card>
          <Hero tone="warn" icon={Icons.alert} title={t('hero_restricted')} testid="status">
            <p class="muted">{state.message}</p>
          </Hero>
        </Card>
      );

    case 'needsClick':
      return (
        <Card>
          <Hero icon={Icons.click} title={t('hero_click_title')} testid="status">
            <p class="muted">{t('hero_click_text')}</p>
          </Hero>
        </Card>
      );

    case 'error':
      return (
        <Card>
          <Hero tone="warn" icon={Icons.alert} title={t('hero_error')} testid="status">
            <p class="muted">{state.message}</p>
          </Hero>
          <Button onClick={onRetry} block>
            {t('try_again')}
          </Button>
        </Card>
      );

    case 'selected': {
      const { report } = state;
      const none = report.decision.case === 'C';
      return (
        <>
          <Card>
            <Hero
              tone={none ? 'warn' : 'ok'}
              icon={none ? Icons.alert : Icons.check}
              title={t(none ? 'hero_none' : 'hero_found')}
              testid="status"
            >
              <p class="page-url" data-testid="page-url" title={state.pageUrl ?? state.origin}>
                {displayUrl(state.pageUrl ?? state.origin)}
              </p>
              {!none && (
                <div class="chips">
                  <span class="chip ok">{shortName(pair.learn)}</span>
                  <span class={`chip ${report.decision.case === 'A' ? 'ok' : 'accent'}`}>
                    {shortName(pair.native)}
                    {report.decision.case === 'B' && report.decision.translateFrom === 'learn'
                      ? t('chip_translated')
                      : ''}
                  </span>
                  {report.decision.case === 'B' && report.decision.translateFrom === 'native' && (
                    <span class="chip accent">
                      {t('chip_lang_translated', shortName(pair.learn))}
                    </span>
                  )}
                </div>
              )}
            </Hero>
            <p class="muted" data-testid="decision" data-case={report.decision.case}>
              {decisionText(report, pair)}
            </p>
            {report.decision.case === 'C' && state.others > 0 && (
              <p class="muted" data-testid="others-hint">
                {t('others_hint', state.others)}
              </p>
            )}
            {report.decision.case === 'B' && (
              <TranslationBlock
                report={report}
                pair={pair}
                translation={state.translation}
                onModelReady={() =>
                  tabId !== null ? retryTranslation(tabId, state.frameId) : false
                }
              />
            )}
            <details>
              <summary>{t('tracks_title', report.tracks.length)}</summary>
              {report.tracks.length === 0 ? (
                <p class="muted">{t('tracks_none')}</p>
              ) : (
                <ul class="tracks">
                  {report.tracks.map((track, i) => (
                    <li key={i} data-testid="track">
                      <b>{track.label || t('track_unnamed')}</b>
                      <span class="muted">
                        {track.status === 'loaded'
                          ? t(
                              'track_info',
                              langText(track.lang),
                              t(TYPE_KEY[track.type]),
                              track.usableCueCount,
                            )
                          : t(STATUS_KEY[track.status] ?? 'track_error')}
                        <span class="role">{roleOf(report.decision, i)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </Card>
          <AutoStart origin={state.origin} />
          <SiteSwitch address={state.pageUrl ?? state.origin} />
          <Button variant="secondary" block onClick={onPick}>
            {t('pick_other')}
          </Button>
        </>
      );
    }

    case 'picking':
      return (
        <Card>
          <Hero icon={Icons.click} title={t('picking_title', state.count)} testid="status">
            <p class="muted">{t('picking_text')}</p>
          </Hero>
          <Button variant="secondary" block onClick={onCancelPick}>
            {t('cancel')}
          </Button>
        </Card>
      );

    case 'several':
      return (
        <Card>
          <Hero icon={Icons.search} title={t('several_title', state.count)} testid="status">
            <p class="muted">{t('several_text')}</p>
          </Hero>
          <Button block onClick={onPick}>
            {t('pick_player')}
          </Button>
        </Card>
      );

    case 'needsPermission':
      return (
        <Card>
          <Hero icon={Icons.click} title={t('access_title')} testid="status">
            <p class="muted">{t('access_text')}</p>
          </Hero>
          {state.iframes.map((iframe) => (
            <Button key={iframe.origin} testid="grant" block onClick={() => onGrant(iframe.origin)}>
              {t('access_allow', new URL(iframe.origin).host)}
            </Button>
          ))}
          {state.playersFound > 0 && (
            <Button variant="secondary" block onClick={onPick}>
              {t('access_pick_here')}
            </Button>
          )}
        </Card>
      );

    case 'denied':
      return (
        <Card>
          <Hero
            tone="warn"
            icon={Icons.alert}
            title={t('denied_title', new URL(state.origin).host)}
            testid="status"
          />
          <Button block onClick={onRetry}>
            {t('try_again')}
          </Button>
        </Card>
      );

    case 'nothing':
      return (
        <Card>
          <Hero icon={Icons.search} title={t('nothing_title')} testid="status">
            <p class="muted">{t('nothing_text')}</p>
          </Hero>
          <Button block onClick={onRetry}>
            {t('search_again')}
          </Button>
          <Button variant="secondary" block onClick={onReload}>
            {t('reload_search')}
          </Button>
        </Card>
      );
  }
}

/**
 * On a site the extension does not know yet: "remember it?". One click asks for access to the page
 * (and to the site of the player when it is another one) and puts it on the list, so the next visit
 * finds the player and shows the subtitles without a click on the icon.
 */
function RememberOffer({ state }: { state: PopupState }) {
  const known = useKnownSites();
  const dismissed = useDismissedOffers();
  const mirrorsOn = useMirrorsMode();
  const [later, setLater] = useState<string[]>([]);
  const [denied, setDenied] = useState(false);

  if (state.kind === 'working' || state.kind === 'restricted' || state.kind === 'error')
    return null;
  const offer = originsToOffer(state.pageUrl, state.kind === 'selected' ? state.origin : null, {
    known,
    dismissed: [...dismissed, ...later],
    mirrorsOn,
  });
  if (offer.length === 0) return null;

  const remember = () => {
    setDenied(false);
    // The request is made synchronously inside the click: Chrome requires the user gesture.
    const request = browser.permissions.request({ origins: offer.map(originPattern) });
    void request.then(async (granted) => {
      if (granted) await addKnownSites(offer);
      else setDenied(true);
    });
  };

  const hosts = offer.map((origin) => new URL(origin).host).join(t('remember_and'));
  return (
    <Card class="offer">
      <h2 data-testid="remember-title">{t('remember_title', hosts)}</h2>
      <p class="muted">{t('remember_text')}</p>
      {denied && (
        <p class="muted" data-testid="remember-denied">
          {t('remember_denied')}
        </p>
      )}
      <Button testid="remember-yes" block onClick={remember}>
        {t('remember_yes')}
      </Button>
      <div class="row">
        <Button
          testid="remember-later"
          variant="ghost"
          size="sm"
          onClick={() => setLater([...later, ...offer])}
        >
          {t('remember_later')}
        </Button>
        <span class="grow" />
        <Button
          testid="remember-never"
          variant="ghost"
          size="sm"
          onClick={() => void dismissOffer(offer)}
        >
          {t('remember_never')}
        </Button>
      </div>
    </Card>
  );
}

/** "Work on this site": on unless the user switched the site off; nothing starts by itself on a switched-off site. */
function SiteSwitch({ address }: { address: string }) {
  const excluded = useExcludedSites();
  const host = excludedHostOf(address);
  if (!host) return null;
  return (
    <Card>
      <SwitchRow
        label={t('site_on_label', host)}
        checked={!excluded.includes(host)}
        testid="site-on"
        onChange={(on) => void setSiteExcluded(host, !on)}
      />
    </Card>
  );
}

/** "Start on this site by itself": needs access to the site, which only a click in the panel can ask for. */
function AutoStart({ origin }: { origin: string }) {
  const sites = useKnownSites();
  const [denied, setDenied] = useState(false);
  const known = origin in sites;
  const host = new URL(origin).host;

  const onChange = (checked: boolean) => {
    setDenied(false);
    if (checked) {
      // requestAccess is called synchronously inside the click: Chrome requires the user gesture.
      const request = requestAccess(origin);
      void request.then(async (granted) => {
        if (granted) await addKnownSite(origin);
        else setDenied(true);
      });
    } else {
      void forgetSite(origin);
    }
  };

  return (
    <Card>
      <SwitchRow
        label={t('auto_label', host)}
        hint={t('auto_hint')}
        checked={known}
        testid="auto-start"
        onChange={onChange}
      />
      {denied && (
        <p class="muted" data-testid="auto-denied">
          {t('auto_denied')}
        </p>
      )}
      {known && <MirrorsSwitch />}
    </Card>
  );
}

/** Know the user's sites by their name too (mirrors) and by their numbers: needs access to all sites, which is only used to compare addresses. */
export function MirrorsSwitch() {
  const on = useMirrorsMode();
  const [denied, setDenied] = useState(false);

  const onChange = (checked: boolean) => {
    setDenied(false);
    if (checked) {
      // The request is made synchronously inside the click: Chrome requires the user gesture.
      const request = browser.permissions.request({ origins: [MIRRORS_PATTERN] });
      void request.then(async (granted) => {
        if (granted) await setMirrorsMode(true);
        else setDenied(true);
      });
    } else {
      void setMirrorsMode(false);
      void browser.permissions.remove({ origins: [MIRRORS_PATTERN] }).catch(() => {});
    }
  };

  return (
    <>
      <SwitchRow
        label={t('everywhere_label')}
        hint={t('everywhere_hint')}
        checked={on}
        testid="mirrors"
        onChange={onChange}
      />
      {denied && (
        <p class="muted" data-testid="mirrors-denied">
          {t('everywhere_denied')}
        </p>
      )}
    </>
  );
}

/**
 * Our subtitles on or off, always at the top. The same setting as the cross on the bar and our
 * switch in YouTube's control bar, so all of them follow each other.
 */
function ShowSwitch() {
  const [settings, change] = useSettings();
  return (
    <Card class="dual-card">
      <span class="dual-icon">{Icons.subtitles}</span>
      <SwitchRow
        label={t('watch_show')}
        checked={settings.enabled}
        testid="toggle-overlay"
        onChange={(enabled) => change({ enabled })}
      />
    </Card>
  );
}

/**
 * The video the panel works with: its preview (YouTube's picture, or the site's letter), the title of
 * the tab and, once the history has it, where the user is in it.
 */
function VideoPreview({ tabId, pageUrl }: { tabId: number | null; pageUrl: string }) {
  const [title, setTitle] = useState('');
  const history = useHistory();
  let host = '';
  try {
    host = new URL(pageUrl).host;
  } catch {
    // not a web page: no host to show
  }
  useEffect(() => {
    if (tabId === null) return;
    let alive = true;
    void browser.tabs
      .get(tabId)
      .then((tab) => alive && setTitle(cleanTitle(tab.title ?? '', host)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tabId, pageUrl]);
  const entry = history.find((item) => item.id === historyId(pageUrl));

  return (
    <div class="video-preview" data-testid="video-preview">
      <VideoThumb url={pageUrl} host={host} class="big" />
      <div class="overlay-bar">
        <span class="site-dot" aria-hidden="true">
          {host
            .replace(/^www\./, '')
            .charAt(0)
            .toUpperCase()}
        </span>
        <span class="grow title" data-testid="preview-title" title={title}>
          {title || host}
        </span>
        {entry && entry.duration > 0 && (
          <span class="time" data-testid="preview-time">
            {formatDuration(entry.position)} / {formatDuration(entry.duration)}
          </span>
        )}
      </div>
    </div>
  );
}

const TOOLS: Array<{
  id: string;
  label: MessageKey;
  icon: preact.JSX.Element;
  focus: SettingsFocus;
}> = [
  { id: 'size', label: 'tool_size', icon: Icons.textSize, focus: { section: 'subtitles' } },
  { id: 'colors', label: 'tool_colors', icon: Icons.palette, focus: { section: 'subtitles' } },
  { id: 'window', label: 'tool_window', icon: Icons.window, focus: { section: 'window' } },
  {
    id: 'style',
    label: 'tool_style',
    icon: Icons.brush,
    focus: { section: 'window', styles: true },
  },
  { id: 'more', label: 'tool_more', icon: Icons.more, focus: { section: 'account' } },
];

/** Shortcuts to the look of the subtitles: each opens the settings at its place. */
function ToolGrid({ onOpen }: { onOpen: (focus: SettingsFocus) => void }) {
  return (
    <div class="tool-grid">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          class="tool"
          data-testid={`tool-${tool.id}`}
          onClick={() => onOpen(tool.focus)}
        >
          {tool.icon}
          <span>{t(tool.label)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The language the user learns and their own one, always at the top. Choosing for one line the
 * language of the other swaps them, so the two are never the same.
 */
function choosePair(role: Role, code: string, settings: Settings): Partial<Settings> {
  const { learn, native } = pairOf(settings);
  if (role === 'learn') return { learnLang: code, nativeLang: code === native ? learn : native };
  return { nativeLang: code, learnLang: code === learn ? native : learn };
}

function LanguagesCard() {
  const [settings, change] = useSettings();
  // The languages by their names in the language of the interface, in its alphabetical order.
  const options = SUBTITLE_LANGUAGES.map((code): [string, string] => [code, titleOf(code)]).sort(
    (a, b) => a[1].localeCompare(b[1], uiLanguage()),
  );
  return (
    <div class="lang-grid">
      {(['learn', 'native'] as const).map((role) => (
        <label key={role} class="lang-box">
          <span>{t(role === 'learn' ? 'set_learning' : 'set_native')}</span>
          <select
            data-testid={role === 'learn' ? 'learn-lang' : 'native-lang'}
            value={role === 'learn' ? settings.learnLang : settings.nativeLang}
            onChange={(event) => change(choosePair(role, event.currentTarget.value, settings))}
          >
            {options.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

/** What to do while watching: the switches the user reaches for most. */
function WatchingCard() {
  const [settings, change] = useSettings();
  return (
    <>
      <SectionTitle>{t('watching_title')}</SectionTitle>
      <Card>
        <SwitchRow
          label={t('watch_hover')}
          checked={settings.hoverTranslate}
          testid="toggle-hover"
          onChange={(hoverTranslate) => change({ hoverTranslate })}
        />
        <SwitchRow
          label={t('watch_speak')}
          checked={settings.speakWords}
          testid="toggle-speak"
          disabled={!settings.hoverTranslate}
          onChange={(speakWords) => change({ speakWords })}
        />
        <SwitchRow
          label={t('watch_pause')}
          checked={settings.pauseOnHover}
          testid="toggle-pause"
          disabled={!settings.hoverTranslate}
          onChange={(pauseOnHover) => change({ pauseOnHover })}
        />
      </Card>
    </>
  );
}

/** Machine translation of the missing line (case B): progress, the model download, retry. */
function TranslationBlock({
  report,
  pair,
  translation,
  onModelReady,
}: {
  report: VideoReport;
  pair: LanguagePair;
  translation: TranslationStatus | null;
  onModelReady: () => Promise<void> | false;
}) {
  const [download, setDownload] = useState<{ loaded: number } | { error: string } | null>(null);
  const from = report.decision.translateFrom ?? 'learn';
  const target = pair[otherRole(from)];
  // The line being translated, named by its language ("Русский: готовлю перевод…").
  const line = titleOf(target);

  const startDownload = () => {
    // Chrome allows a model download only inside a click: downloadModel starts synchronously here.
    setDownload({ loaded: 0 });
    downloadModel(translatorOptions(directionOf(pair[from], target)) ?? EN_RU, (loaded) =>
      setDownload({ loaded }),
    )
      .then(async () => {
        setDownload(null);
        await onModelReady();
      })
      .catch((error: unknown) => setDownload({ error: String(error) }));
  };

  if (!translation) {
    return (
      <p class="muted" data-testid="translation">
        {t('trb_preparing', line)}
      </p>
    );
  }

  switch (translation.state) {
    case 'translating':
      return (
        <div data-testid="translation" data-state="translating">
          <p class="muted">{t('trb_progress', line, translation.done, translation.total)}</p>
          <Progress value={translation.done / Math.max(1, translation.total)} />
        </div>
      );
    case 'done':
      return (
        <p class="muted" data-testid="translation" data-state="done">
          {t(translation.fromCache ? 'trb_done_cache' : 'trb_done', line)}
        </p>
      );
    case 'needs-model':
      return (
        <div data-testid="translation" data-state="needs-model">
          <p class="muted">{t('trb_needs_model', line)}</p>
          {download && 'error' in download ? (
            <p class="muted">{t('trb_download_error', download.error)}</p>
          ) : download ? (
            <>
              <p>{t('trb_downloading', Math.round(download.loaded * 100))}</p>
              <Progress value={download.loaded} />
            </>
          ) : null}
          <Button
            testid="download-model"
            block
            disabled={download !== null && !('error' in download)}
            onClick={startDownload}
          >
            {t('trb_download')}
          </Button>
        </div>
      );
    case 'unavailable':
      return (
        <p class="muted" data-testid="translation" data-state="unavailable">
          {t('trb_unavailable', line)}
        </p>
      );
    case 'error':
      return (
        <div data-testid="translation" data-state="error">
          <p class="muted">{t('trb_stopped', line, translation.done, translation.total)}</p>
          <Button testid="retry-translation" block onClick={() => void onModelReady()}>
            {t('retry')}
          </Button>
        </div>
      );
  }
}
