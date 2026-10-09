import { createLineResolver, type LineTexts } from '../lib/cue-index';
import { FONT_FAMILIES, glassAlpha, TEXT_EFFECTS, type Settings } from '../lib/settings';
import { isSubtitleTrack } from '../lib/tracks';
import type { SubtitleLines } from '../lib/types';
import { BarGestures } from './BarGestures';
import { ICONS } from './icons';
import { OVERLAY_STYLE } from './overlay-styles';
import type { Overlay, OverlayOptions } from './overlay-types';
import { clamp } from './panel-options';
import { SettingsPanel } from './SettingsPanel';
import { WordsUi } from './words-ui';
import { escapeHtml, t, textDirection, type MessageKey } from '../lib/i18n';
import { watchUiLanguage } from '../lib/ui-language';
/** The text of a message, ready for innerHTML. */
const h = (key: MessageKey) => escapeHtml(t(key));
/** A title that follows the language: `retranslate()` finds the element by `data-i18n` and writes the text again. */
const label = (key: MessageKey) => `data-i18n="${key}" title="${h(key)}"`;

/** The last text stays on screen this long while the bar fades out, then it is cleared. */
const CLEAR_AFTER_MS = 200;
const VIDEO_EVENTS = [
  'play',
  'playing',
  'pause',
  'seeking',
  'seeked',
  'timeupdate',
  'ratechange',
  'loadedmetadata',
];

/**
 * The subtitle bar over the video, in the video's own frame: a frosted-glass pill with the two
 * lines, a handle to drag it, and buttons for the word voice, play/pause and settings. The host
 * ignores the mouse, only the bar and its panel take it, so player controls keep working; in
 * fullscreen the host moves into the fullscreen element, the only part of the page still shown.
 *
 * The parts: SettingsPanel (the gear window), BarGestures (drag and resize), WordsUi (hover on
 * words). This class draws the lines, lays the bar out and keeps them together.
 */
export class SubtitleOverlay implements Overlay {
  private settings: Settings;
  private resolve: (time: number) => LineTexts;

  private readonly host = document.createElement('double-sub-overlay');
  private readonly root = this.host.attachShadow({ mode: 'open' });
  private readonly box: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly enEl: HTMLElement;
  private readonly ruEl: HTMLElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly gearBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly restoreBtn: HTMLButtonElement;
  private readonly stopLanguage: () => void;

  private readonly panel: SettingsPanel;
  private readonly gestures: BarGestures;
  private readonly wordsUi: WordsUi | null;
  /** The site's own subtitles are hidden while ours are on (see syncSiteSubtitles). */
  private hiddenTracks: TextTrack[] = [];
  private siteHidden = false;
  private hideStyle: HTMLStyleElement | null = null;
  private readonly resizeObserver: ResizeObserver;

  private shown: LineTexts = { en: null, ru: null };
  /** Whether the lines on screen are made of hoverable words; a change of the setting redraws them. */
  private renderedAsWords: boolean;
  private clearTimer = 0;
  private frame = 0;
  /** Something changed since the last layout: redo it. Reading and writing styles 60 times a second under a blurred backdrop would make the lines stutter. */
  private dirty = true;
  private lastRect = '';
  private layoutCount = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    lines: SubtitleLines,
    settings: Settings,
    private readonly options: OverlayOptions = {},
  ) {
    this.settings = settings;
    this.resolve = createLineResolver(lines);

    this.host.style.cssText =
      'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
    this.root.innerHTML = this.markup();
    const q = <T extends HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!;
    this.box = q('.box');
    this.bar = q('.bar');
    this.enEl = q('.en');
    this.ruEl = q('.ru');
    this.soundBtn = q('.sound');
    this.playBtn = q('.play');
    this.gearBtn = q('.gear');
    this.closeBtn = q('.close');
    this.restoreBtn = q('.restore');

    this.wordsUi = options.words
      ? new WordsUi(this.root, video, options.words, () => this.settings)
      : null;
    this.wordsUi?.setSaved(options.savedKeys ?? new Set());
    this.renderedAsWords = Boolean(this.wordsUi && settings.hoverTranslate);
    this.syncSiteSubtitles();

    this.panel = new SettingsPanel(q('.panel'), this.gearBtn, {
      settings: () => this.settings,
      change: (patch) => this.change(patch),
      changed: () => {
        this.renderControls();
        this.kick();
      },
    });
    this.gestures = new BarGestures(this.bar, {
      video,
      settings: () => this.settings,
      preview: (patch) => {
        this.settings = { ...this.settings, ...patch };
        this.kick();
      },
      commit: (patch) => {
        options.onSettingsChange?.(patch);
        this.panel.render();
      },
    });

    this.listen();
    this.stopLanguage = watchUiLanguage(() => this.retranslate());
    this.resizeObserver = new ResizeObserver(() => this.kick());
    this.resizeObserver.observe(video);

    this.place();
    this.renderControls();
    this.render(true);
    this.layout();
    this.kick();
  }

  // ---------------------------------------------------------------- the Overlay interface

  setLines(lines: SubtitleLines): void {
    this.resolve = createLineResolver(lines);
    this.render(true);
  }

  setSettings(next: Settings): void {
    // While the bar is being dragged the local position is the truth, not the storage echo.
    const keep = this.gestures.active
      ? {
          offsetX: this.settings.offsetX,
          bottomOffset: this.settings.bottomOffset,
          barWidth: this.settings.barWidth,
          fontSize: this.settings.fontSize,
          translationSize: this.settings.translationSize,
        }
      : {};
    this.settings = { ...next, ...keep };
    this.syncSiteSubtitles();
    this.renderControls();
    this.panel.render();
    this.kick();
  }

  setSaved(keys: Set<string>): void {
    this.wordsUi?.setSaved(keys);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.clearTimer);
    VIDEO_EVENTS.forEach((name) => this.video.removeEventListener(name, this.kick));
    this.video.removeEventListener('play', this.onPlayState);
    this.video.removeEventListener('pause', this.onPlayState);
    window.removeEventListener('resize', this.kick);
    window.removeEventListener('scroll', this.kick, true);
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    this.resizeObserver.disconnect();
    this.stopLanguage();
    this.panel.destroy();
    this.wordsUi?.destroy();
    this.showSitesOwnSubtitles();
    this.host.remove();
  }

  // ---------------------------------------------------------------- building

  private markup(): string {
    return `<style>${OVERLAY_STYLE}</style>
      <div class="box">
        <div class="bar off">
          <div class="edge l" data-edge="l" ${label('bar_width')}></div><div class="edge r" data-edge="r" ${label('bar_width')}></div><div class="edge t" data-edge="t" ${label('bar_text_size')}></div>
          <button class="close" type="button" aria-label="${h('bar_close')}" ${label('bar_close')} data-testid="close">${ICONS.close}</button>
          <div class="grip" ${label('bar_drag')} data-testid="grip">${ICONS.grip}</div>
          <div class="text"><div class="line en" hidden></div><div class="line ru" hidden></div></div>
          <div class="divider"></div>
          <div class="controls">
            <button class="ctl sound" type="button" aria-label="${h('bar_sound')}" ${label('bar_sound')}></button>
            <button class="ctl play" type="button" aria-label="${h('bar_play')}" ${label('bar_play')}></button>
            <button class="ctl gear" type="button" aria-label="${h('bar_settings')}" ${label('bar_settings')}>${ICONS.gear}</button>
          </div>
        </div>
        <div class="panel" hidden></div>
        <button class="restore" type="button" hidden aria-label="${h('bar_show')}" ${label('bar_show')} data-testid="restore">${ICONS.subtitles}</button>
      </div>`;
  }

  /** The language of the interface changed: the titles of the buttons are written again (the window and the tip draw themselves anew). */
  private retranslate(): void {
    this.root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const text = t(el.dataset.i18n as MessageKey);
      el.title = text;
      if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', text);
    });
    this.panel.setDirection(textDirection());
    this.panel.render();
  }

  /**
   * The site's own rendering of the same subtitles would double ours, so it is hidden while ours
   * are on. With ours off it is given back, so the video is never left without subtitles by us.
   */
  private syncSiteSubtitles(): void {
    if (this.settings.enabled && !this.siteHidden) this.hideSitesOwnSubtitles();
    else if (!this.settings.enabled && this.siteHidden) this.showSitesOwnSubtitles();
  }

  private hideSitesOwnSubtitles(): void {
    this.siteHidden = true;
    this.hiddenTracks = Array.from(this.video.textTracks).filter(
      (t) => isSubtitleTrack(t) && t.mode === 'showing',
    );
    this.hiddenTracks.forEach((track) => (track.mode = 'hidden'));
    if (this.options.hideSelector) {
      this.hideStyle = document.createElement('style');
      this.hideStyle.textContent = `${this.options.hideSelector} { display: none !important; }`;
      (document.head ?? document.documentElement).append(this.hideStyle);
    }
  }

  private showSitesOwnSubtitles(): void {
    this.siteHidden = false;
    this.hiddenTracks.forEach((track) => (track.mode = 'showing'));
    this.hiddenTracks = [];
    this.hideStyle?.remove();
    this.hideStyle = null;
  }

  private listen(): void {
    // None of this may reach the player: in fullscreen the overlay sits inside its container. Stopped at
    // the root, after the handlers of the words (also on the root) and of the buttons have run.
    const stopIt = (event: Event) => event.stopPropagation();
    for (const type of ['click', 'mousedown', 'mouseup', 'dblclick', 'contextmenu'])
      this.root.addEventListener(type, stopIt);

    this.soundBtn.addEventListener('click', () =>
      this.change({ speakWords: !this.settings.speakWords }),
    );
    this.playBtn.addEventListener('click', () => {
      if (this.video.paused) void this.video.play().catch(() => {});
      else this.video.pause();
    });
    this.gearBtn.addEventListener('click', () => this.panel.toggle());
    this.closeBtn.addEventListener('click', () => this.change({ enabled: false }));
    this.restoreBtn.addEventListener('click', () => this.change({ enabled: true }));

    VIDEO_EVENTS.forEach((name) => this.video.addEventListener(name, this.kick));
    this.video.addEventListener('play', this.onPlayState);
    this.video.addEventListener('pause', this.onPlayState);
    window.addEventListener('resize', this.kick);
    window.addEventListener('scroll', this.kick, true);
    document.addEventListener('fullscreenchange', this.onFullscreen);
  }

  /** A fullscreen <video> shows no children at all: the overlay can only live next to it. */
  private place(): void {
    const fullscreen = document.fullscreenElement;
    const target =
      fullscreen && fullscreen !== this.video && fullscreen.contains(this.video)
        ? fullscreen
        : document.documentElement;
    if (this.host.parentNode !== target) target.append(this.host);
  }

  // ---------------------------------------------------------------- settings changed in the bar

  private change(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    this.syncSiteSubtitles();
    this.options.onSettingsChange?.(patch);
    this.renderControls();
    this.panel.render();
    this.kick();
  }

  private renderControls(): void {
    const { speakWords } = this.settings;
    this.soundBtn.innerHTML = speakWords ? ICONS.soundOn : ICONS.soundOff;
    this.soundBtn.classList.toggle('off', !speakWords);
    this.soundBtn.setAttribute('aria-pressed', String(speakWords));
    this.playBtn.innerHTML = this.video.paused ? ICONS.play : ICONS.pause;
    this.playBtn.dataset.state = this.video.paused ? 'paused' : 'playing';
    this.gearBtn.setAttribute('aria-expanded', String(this.panel?.isOpen ?? false));
  }

  // ---------------------------------------------------------------- layout

  private layout(): void {
    // Test build only: lets e2e tests see how often the layout is redone.
    if (import.meta.env.VITE_DS_E2E) this.host.dataset.layouts = String(++this.layoutCount);
    const { box, bar, settings } = this;
    const rect = this.video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      box.style.display = 'none';
      return;
    }
    Object.assign(box.style, {
      display: '',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    this.applyLook();

    // Off: only the round button that brings the subtitles back, above the player's own controls.
    this.restoreBtn.hidden = settings.enabled;
    bar.style.display = settings.enabled ? '' : 'none';
    if (!settings.enabled) {
      this.panel.close();
      this.restoreBtn.style.bottom = `${(settings.bottomOffset / 100) * rect.height}px`;
      return;
    }

    // Centred plus the user's shift, kept inside the video.
    const barWidth = bar.offsetWidth;
    const center = rect.width / 2 + (settings.offsetX / 100) * rect.width;
    bar.style.left = `${clamp(center, barWidth / 2, Math.max(barWidth / 2, rect.width - barWidth / 2))}px`;
    bar.style.transform = 'translateX(-50%)';
    bar.style.bottom = `${(settings.bottomOffset / 100) * rect.height}px`;

    this.panel.scaleTo(settings.fontSize);
    if (this.panel.isOpen) this.panel.placeAbove(bar.getBoundingClientRect(), rect);
  }

  /** Sizes, colours, glass: the settings as CSS variables (the glass ones on the host, so the panel and the tip share them). */
  private applyLook(): void {
    const { host, bar, settings } = this;
    bar.style.fontSize = `${settings.fontSize}px`;
    bar.style.setProperty('--en-size', `${settings.fontSize}px`);
    bar.style.setProperty('--ru-size', `${settings.translationSize}px`);
    bar.style.setProperty('--bar-width', `${settings.barWidth}%`);
    bar.style.setProperty('--en-color', settings.colorEn);
    bar.style.setProperty('--ru-color', settings.colorRu);
    bar.style.setProperty('--en-weight', String(settings.fontWeight));
    bar.style.setProperty('--font-family', FONT_FAMILIES[settings.fontFamily].css);
    bar.style.setProperty('--effect', TEXT_EFFECTS[settings.textEffect].css);
    // Buttons keep a handy size whatever the subtitle size is.
    bar.style.setProperty('--ctl', `${clamp(settings.fontSize * 0.62, 22, 34)}px`);
    host.style.setProperty('--bar-alpha', String(glassAlpha(settings.barOpacity)));
    host.style.setProperty(
      '--panel-alpha',
      String(Math.min(0.92, glassAlpha(settings.barOpacity) + 0.16)),
    );
    host.style.setProperty('--blur', `${settings.glassBlur}px`);
    host.style.setProperty('--radius', String(settings.glassRadius / 100));
    const tint = parseInt(settings.glassTint.slice(1), 16);
    host.style.setProperty('--tint-rgb', `${tint >> 16} ${(tint >> 8) & 255} ${tint & 255}`);
  }

  // ---------------------------------------------------------------- lines

  private showLine(el: HTMLElement, text: string | null, lang: 'en' | 'ru'): void {
    el.hidden = !text;
    if (text && this.wordsUi && this.settings.hoverTranslate)
      this.wordsUi.renderLine(el, text, lang);
    else el.textContent = text ?? '';
  }

  private render(force = false): void {
    const asWords = Boolean(this.wordsUi && this.settings.hoverTranslate);
    if (asWords !== this.renderedAsWords) {
      this.renderedAsWords = asWords;
      force = true;
    }
    const next = this.resolve(this.video.currentTime);
    const empty = !next.en && !next.ru;
    if (!empty) {
      clearTimeout(this.clearTimer);
      this.clearTimer = 0;
      if (force || next.en !== this.shown.en || next.ru !== this.shown.ru) this.dirty = true;
      if (force || next.en !== this.shown.en) this.showLine(this.enEl, next.en, 'en');
      if (force || next.ru !== this.shown.ru) this.showLine(this.ruEl, next.ru, 'ru');
      this.shown = next;
    } else if (this.shown.en || this.shown.ru) {
      if (force) this.clearLines();
      else if (!this.clearTimer)
        this.clearTimer = window.setTimeout(() => this.clearLines(), CLEAR_AFTER_MS);
    }
    // No text, no bar: the video stays clean between lines. It stays while the panel is open or the bar is being moved.
    this.bar.classList.toggle('off', empty && !this.panel.isOpen && !this.gestures.active);
  }

  private clearLines(): void {
    this.clearTimer = 0;
    this.showLine(this.enEl, null, 'en');
    this.showLine(this.ruEl, null, 'ru');
    this.shown = { en: null, ru: null };
    this.dirty = true;
  }

  // ---------------------------------------------------------------- the loop

  /** Every frame while playing (cue changes are found here); the layout is redone only when something changed. */
  private readonly tick = () => {
    this.frame = 0;
    this.render();
    const r = this.video.getBoundingClientRect();
    const key = `${r.left}|${r.top}|${r.width}|${r.height}`;
    if (this.dirty || key !== this.lastRect) {
      this.lastRect = key;
      this.dirty = false;
      this.layout();
    }
    if (!this.video.paused) this.frame = requestAnimationFrame(this.tick);
  };

  private readonly kick = () => {
    this.dirty = true;
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  };

  private readonly onFullscreen = () => {
    this.place();
    this.kick();
  };

  private readonly onPlayState = () => {
    this.renderControls();
    this.kick();
  };
}
