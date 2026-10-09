import {
  FONT_FAMILIES,
  FONT_WEIGHTS,
  GLASS_TINTS,
  TEXT_COLORS,
  TEXT_EFFECTS,
  type Settings,
} from '../lib/settings';
import { clamp, FORMAT, STEPS, STYLE_DEFAULTS, weightLabel, type StepKey } from './panel-options';
import { escapeHtml, t, textDirection, type MessageKey } from '../lib/i18n';
/** The text of a message, ready for innerHTML. */
const h = (key: MessageKey) => escapeHtml(t(key));

type SwitchKey = 'speakWords' | 'hoverTranslate' | 'pauseOnHover';
type ColorKey = 'colorEn' | 'colorRu' | 'glassTint';
type SelectKey = 'fontFamily' | 'fontWeight' | 'textEffect';
type Page = 'main' | 'styles';

export interface PanelHost {
  settings(): Settings;
  /** The user changed settings in the panel: apply them and tell the owner. */
  change(patch: Partial<Settings>): void;
  /** The panel opened, closed or changed its page: the bar redraws (the gear shows its state). */
  changed(): void;
}

/**
 * The settings window over the video: two pages (the usual settings, and "more styles"). It draws
 * itself from the current settings, turns clicks into `change()` calls, and closes on Escape or a
 * click anywhere but on itself and its gear.
 */
export class SettingsPanel {
  private open = false;
  private page: Page = 'main';

  constructor(
    private readonly el: HTMLElement,
    private readonly gear: HTMLElement,
    private readonly host: PanelHost,
  ) {
    el.dir = textDirection(); // the texts of the window read right to left in Arabic, Hebrew, Persian
    el.addEventListener('click', this.onClick);
    // Selects and colour fields report with `change` (the colour one when its picker closes).
    el.addEventListener('change', this.onChange);
    document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    window.addEventListener('keydown', this.onKey, true);
  }

  setDirection(dir: 'ltr' | 'rtl'): void {
    this.el.dir = dir;
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  close(): void {
    this.setOpen(false);
  }

  /** Redraws from the settings (they may have changed from outside); keeps the scroll position. */
  render(): void {
    this.el.hidden = !this.open;
    if (!this.open) return;
    const scroll = this.el.scrollTop;
    this.el.innerHTML = this.page === 'main' ? this.mainPage() : this.stylesPage();
    this.el.scrollTop = scroll;
  }

  /** Calmer than the subtitles: about 60% of their size, never tiny or huge. */
  scaleTo(subtitleFontSize: number): void {
    this.el.style.fontSize = `${clamp(subtitleFontSize * 0.6, 13, 19)}px`;
  }

  /** The panel opens above the bar, on its right edge; in a small video it scrolls instead of covering the bar and its gear. */
  placeAbove(bar: DOMRect, video: DOMRect): void {
    this.el.style.right = `${Math.max(0, video.right - bar.right)}px`;
    this.el.style.bottom = `${Math.max(0, video.bottom - bar.top) + 8}px`;
    this.el.style.maxHeight = `${Math.max(80, bar.top - video.top - 16)}px`;
    this.el.style.overflowY = 'auto';
  }

  destroy(): void {
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    window.removeEventListener('keydown', this.onKey, true);
  }

  // ---------------------------------------------------------------- state

  private setOpen(open: boolean): void {
    this.open = open;
    if (!open) this.page = 'main';
    this.render();
    this.host.changed();
  }

  private setPage(page: Page): void {
    this.page = page;
    this.render();
    this.host.changed();
  }

  // ---------------------------------------------------------------- events

  private readonly onDocumentPointerDown = (event: PointerEvent) => {
    if (!this.open) return;
    // Only the panel itself and its gear keep it open: a click anywhere else, the bar included, closes it.
    const path = event.composedPath();
    if (!path.includes(this.el) && !path.includes(this.gear)) this.close();
  };

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.open) this.close();
  };

  private readonly onClick = (event: Event) => {
    const target = event.target as HTMLElement;
    const settings = this.host.settings();
    const sw = target.closest<HTMLElement>('[data-switch]');
    if (sw) {
      const key = sw.dataset.switch as SwitchKey;
      return this.host.change({ [key]: !settings[key] });
    }
    const swatch = target.closest<HTMLElement>('[data-swatch]');
    if (swatch) return this.host.change({ [swatch.dataset.key!]: swatch.dataset.swatch });
    if (target.closest('[data-more]')) return this.setPage('styles');
    if (target.closest('[data-back]')) return this.setPage('main');
    if (target.closest('[data-reset-styles]')) return this.host.change({ ...STYLE_DEFAULTS });
    const step = target.closest<HTMLElement>('[data-step]');
    if (step) {
      const key = step.dataset.key as StepKey;
      const range = STEPS[key];
      const next = settings[key] + Number(step.dataset.step) * range.step;
      return this.host.change({ [key]: clamp(Math.round(next * 100) / 100, range.min, range.max) });
    }
    if (target.closest('[data-reset]')) this.host.change({ offsetX: 0, bottomOffset: 10 });
  };

  private readonly onChange = (event: Event) => {
    const el = event.target as HTMLInputElement | HTMLSelectElement;
    const selectKey = el.dataset.select;
    if (selectKey)
      this.host.change({ [selectKey]: selectKey === 'fontWeight' ? Number(el.value) : el.value });
    const colorKey = el.dataset.colorInput;
    if (colorKey) this.host.change({ [colorKey]: el.value });
  };

  // ---------------------------------------------------------------- the two pages

  private mainPage(): string {
    return `
      <div class="sect"><div class="sect-title">${h('bar_sec_learning')}</div>
        ${this.stepperRow('fontSize', 'bar_size')}
        ${this.colorRow('colorEn', 'bar_color', TEXT_COLORS)}
      </div>
      <div class="sect"><div class="sect-title">${h('bar_sec_native')}</div>
        ${this.stepperRow('translationSize', 'bar_size')}
        ${this.colorRow('colorRu', 'bar_color', TEXT_COLORS)}
      </div>
      <div class="sect"><div class="sect-title">${h('bar_sec_window')}</div>
        ${this.stepperRow('barWidth', 'set_width')}
        ${this.stepperRow('barOpacity', 'bar_opacity')}
        <div class="row"><span class="label">${h('bar_position')}</span><button class="reset" type="button" data-reset>${h('bar_reset')}</button></div>
      </div>
      <div class="sect"><div class="sect-title">${h('bar_sec_words')}</div>
        ${this.switchRow('speakWords', 'bar_speak')}
        ${this.switchRow('hoverTranslate', 'bar_hover')}
        ${this.switchRow('pauseOnHover', 'bar_pause')}
      </div>
      <button class="more" type="button" data-more>${h('bar_more')}</button>`;
  }

  private stylesPage(): string {
    return `
      <button class="back" type="button" data-back>${h('back')}</button>
      <div class="sect"><div class="sect-title">${h('bar_sec_text')}</div>
        ${this.selectRow(
          'fontFamily',
          'bar_font',
          Object.entries(FONT_FAMILIES).map(([k, v]) => [k, t(v.label)]),
        )}
        ${this.selectRow(
          'fontWeight',
          'bar_weight',
          FONT_WEIGHTS.map((w) => [w, weightLabel(w)]),
        )}
        ${this.selectRow(
          'textEffect',
          'bar_effect',
          Object.entries(TEXT_EFFECTS).map(([k, v]) => [k, t(v.label)]),
        )}
      </div>
      <div class="sect"><div class="sect-title">${h('bar_sec_glass')}</div>
        ${this.colorRow('glassTint', 'bar_glass_color', GLASS_TINTS)}
        ${this.stepperRow('glassBlur', 'bar_blur')}
        ${this.stepperRow('glassRadius', 'bar_radius')}
      </div>
      <button class="more" type="button" data-reset-styles>${h('bar_reset_styles')}</button>`;
  }

  // ---------------------------------------------------------------- rows

  private switchRow(key: SwitchKey, labelKey: MessageKey): string {
    const label = h(labelKey);
    return `
      <div class="row"><span class="label">${label}</span>
        <button class="switch" type="button" role="switch" data-switch="${key}" aria-checked="${this.host.settings()[key]}" aria-label="${label}"></button>
      </div>`;
  }

  private stepperRow(key: StepKey, labelKey: MessageKey): string {
    const label = h(labelKey);
    return `
      <div class="row"><span class="label">${label}</span>
        <span class="stepper">
          <button class="step" type="button" data-step="-1" data-key="${key}" aria-label="${escapeHtml(t('bar_smaller', t(labelKey)))}">−</button>
          <span class="value" data-value="${key}">${FORMAT[key](this.host.settings()[key])}</span>
          <button class="step" type="button" data-step="1" data-key="${key}" aria-label="${escapeHtml(t('bar_bigger', t(labelKey)))}">+</button>
        </span>
      </div>`;
  }

  private colorRow(key: ColorKey, labelKey: MessageKey, palette: string[]): string {
    const label = h(labelKey);
    const current = this.host.settings()[key];
    return `
      <div class="row"><span class="label">${label}</span>
        <span class="swatches" data-colors="${key}">
          ${palette
            .map(
              (c) =>
                `<button class="sw" type="button" data-swatch="${c}" data-key="${key}" style="background:${c}" aria-label="${label} ${c}" aria-pressed="${current === c}"></button>`,
            )
            .join('')}
          <input class="color-input" type="color" data-color-input="${key}" value="${current}" aria-label="${escapeHtml(t('color_custom', t(labelKey)))}" />
        </span>
      </div>`;
  }

  private selectRow(
    key: SelectKey,
    labelKey: MessageKey,
    options: Array<[string | number, string]>,
  ): string {
    const label = h(labelKey);
    const current = String(this.host.settings()[key]);
    return `
      <div class="row"><span class="label">${label}</span>
        <select class="sel" data-select="${key}" aria-label="${label}">
          ${options.map(([value, text]) => `<option value="${value}"${current === String(value) ? ' selected' : ''}>${escapeHtml(text)}</option>`).join('')}
        </select>
      </div>`;
  }
}
