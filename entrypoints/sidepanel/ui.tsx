import type { ComponentChildren, JSX } from 'preact';
import { t, uiLanguage } from '../../src/lib/i18n';

/** Small building blocks of the panel: icons, switch, rows, buttons. Styles are in panel.css. */

const icon = (body: JSX.Element) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {body}
  </svg>
);

export const Icons = {
  now: icon(
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M7 14h6M7 10.5h10" />
    </>,
  ),
  words: icon(
    <>
      <path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1z" />
    </>,
  ),
  history: icon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>,
  ),
  settings: icon(
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>,
  ),
  globe: icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" />
    </>,
  ),
  check: icon(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  alert: icon(
    <>
      <path d="M12 8v5M12 16.5v.01" />
      <path d="M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
    </>,
  ),
  search: icon(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>,
  ),
  click: icon(
    <>
      <path d="M9 9l9.5 3.5-4 1.5-1.5 4L9 9z" />
      <path d="M5 5l1.5 1.5M5 11H3M11 5V3" />
    </>,
  ),
  volume: icon(
    <>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
    </>,
  ),
  trash: icon(
    <>
      <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
    </>,
  ),
  play: icon(<path d="M8 5.5v13l10.5-6.5L8 5.5z" />),
  tray: icon(
    <>
      <path d="M4 13l2.5-7h11L20 13v5H4v-5z" />
      <path d="M4 13h5l1 2h4l1-2h5" />
    </>,
  ),
};

/** The brand mark: two subtitle lines in a rounded square. */
export function Logo() {
  return (
    <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <rect x="7" y="10.5" width="18" height="3.4" rx="1.7" fill="#fff" />
      <rect x="7" y="17.5" width="11.5" height="3.4" rx="1.7" fill="#fff" opacity="0.7" />
    </svg>
  );
}

export function Card({
  children,
  class: className = '',
}: {
  children: ComponentChildren;
  class?: string;
}) {
  return <section class={`card ${className}`}>{children}</section>;
}

export const SectionTitle = ({ children }: { children: ComponentChildren }) => (
  <h3 class="section-title">{children}</h3>
);

/** A row with a switch: the whole row is the click target. */
export function SwitchRow(props: {
  label: string;
  hint?: string;
  checked: boolean;
  testid?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label class="row">
      <span class="grow">
        <span class="label">{props.label}</span>
        {props.hint && <span class="hint">{props.hint}</span>}
      </span>
      <input
        class="switch"
        type="checkbox"
        role="switch"
        data-testid={props.testid}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

export function Button(props: {
  children: ComponentChildren;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm';
  block?: boolean;
  disabled?: boolean;
  testid?: string;
  title?: string;
}) {
  const classes = [
    'btn',
    props.variant && props.variant !== 'primary' ? props.variant : '',
    props.size ?? '',
    props.block ? 'block' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      class={classes}
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      data-testid={props.testid}
      title={props.title}
    >
      {props.children}
    </button>
  );
}

export function Empty({
  icon: iconNode,
  title,
  children,
}: {
  icon: JSX.Element;
  title: string;
  children?: ComponentChildren;
}) {
  return (
    <div class="empty">
      {iconNode}
      <b>{title}</b>
      {children && <p class="small">{children}</p>}
    </div>
  );
}

export const Spinner = () => <span class="spinner" role="progressbar" aria-label={t('loading')} />;

export function Progress({ value }: { value: number }) {
  return (
    <div class="progress" aria-hidden="true">
      <i style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}

/** A slider for a number; `scale` turns 0.5 into 50 for display. */
export function RangeRow(props: {
  label: string;
  testid: string;
  min: number;
  max: number;
  step: number;
  value: number;
  suffix?: string;
  scale?: number;
  onChange: (value: number) => void;
}) {
  const k = props.scale ?? 1;
  return (
    <label class="row">
      <span class="grow label">{props.label}</span>
      <input
        type="range"
        data-testid={props.testid}
        min={props.min * k}
        max={props.max * k}
        step={props.step * k}
        value={props.value * k}
        onInput={(event) => props.onChange(Number(event.currentTarget.value) / k)}
      />
      <span class="range-value">
        {Math.round(props.value * k)}
        {props.suffix ?? ''}
      </span>
    </label>
  );
}

export function ColorRow(props: {
  label: string;
  testid: string;
  value: string;
  palette: string[];
  onChange: (color: string) => void;
}) {
  return (
    <div class="row">
      <span class="grow label">{props.label}</span>
      <span class="swatches">
        {props.palette.map((color) => (
          <button
            key={color}
            type="button"
            class="swatch"
            style={{ background: color }}
            aria-label={`${props.label} ${color}`}
            aria-pressed={props.value === color}
            data-testid={`${props.testid}-${color.slice(1)}`}
            onClick={() => props.onChange(color)}
          />
        ))}
        <input
          type="color"
          data-testid={props.testid}
          value={props.value}
          aria-label={t('color_custom', props.label)}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      </span>
    </div>
  );
}

export function SelectRow(props: {
  label: string;
  testid: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label class="row">
      <span class="grow label">{props.label}</span>
      <select
        data-testid={props.testid}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "just now", "12 min ago", "yesterday, 21:40", "3 Oct" (in the language of the interface). */
export function timeAgo(ts: number, now = Date.now()): string {
  const minutes = Math.floor((now - ts) / 60000);
  if (minutes < 1) return t('time_now');
  if (minutes < 60) return t('time_minutes', minutes);
  const date = new Date(ts);
  const language = uiLanguage();
  const time = date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  const today = new Date(now);
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(today) - dayStart(date)) / 86_400_000);
  if (days === 0) return t('time_today', time);
  if (days === 1) return t('time_yesterday', time);
  return date.toLocaleDateString(language, { day: 'numeric', month: 'short' });
}
