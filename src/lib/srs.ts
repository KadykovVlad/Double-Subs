import { t } from './i18n';
/**
 * Spaced repetition for saved words: every word has a due time, and an answer decides the next gap.
 * The answer is only "remembered" or "not": people judge their own memory poorly, and two choices are
 * honest where four are noise. The gap grows by the ease of the word and by how long it really held,
 * so a word remembered after a long absence counts for more. A word forgotten keeps part of its gap.
 */
export interface Srs {
  /** When the word is due again, ms since epoch. */
  due: number;
  /** The current gap in days (0 while the word is being learned). */
  interval: number;
  /** How fast the gap grows; goes down when the word is hard. */
  ease: number;
  /** Right answers in a row. */
  reps: number;
  lapses: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
export const AGAIN_DELAY_MS = 10 * MINUTE_MS;
const MIN_EASE = 1.3;
const START_EASE = 2.5;
/** What a forgotten word keeps of its gap: it comes back faster than a new one. */
const KEPT_AFTER_LAPSE = 0.25;
/** A late answer counts for at most this many gaps. */
const MAX_LATE = 2;
/** Gaps of a week and more vary a little, or the words of one day would keep coming back together. */
const SPREAD = 0.1;
const SPREAD_FROM_DAYS = 7;

export const newSrs = (now: number): Srs => ({
  due: now,
  interval: 0,
  ease: START_EASE,
  reps: 0,
  lapses: 0,
});

export function normalizeSrs(raw: unknown, savedAt: number): Srs {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Srs>;
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    due: num(r.due, savedAt),
    interval: Math.max(0, num(r.interval, 0)),
    ease: Math.max(MIN_EASE, num(r.ease, START_EASE)),
    reps: Math.max(0, Math.round(num(r.reps, 0))),
    lapses: Math.max(0, Math.round(num(r.lapses, 0))),
  };
}

/** The word after an answer. `spread` is between -1 and 1. */
export function grade(srs: Srs, remembered: boolean, now: number, spread = 0): Srs {
  if (!remembered)
    return {
      ...srs,
      due: now + AGAIN_DELAY_MS,
      interval: Math.floor(srs.interval * KEPT_AFTER_LAPSE),
      reps: 0,
      ease: Math.max(MIN_EASE, srs.ease - 0.2),
      lapses: srs.lapses + 1,
    };
  const reps = srs.reps + 1;
  const held = (now - (srs.due - srs.interval * DAY_MS)) / DAY_MS;
  const base = Math.min(Math.max(srs.interval, held), srs.interval * MAX_LATE);
  const grown =
    reps === 1
      ? Math.max(1, srs.interval)
      : reps === 2
        ? Math.max(3, srs.interval + 1)
        : Math.max(srs.interval + 1, Math.round(base * srs.ease));
  const interval = grown >= SPREAD_FROM_DAYS ? Math.round(grown * (1 + SPREAD * spread)) : grown;
  return { ...srs, reps, interval, due: now + interval * DAY_MS };
}

export const isDue = (srs: Srs, now: number) => srs.due <= now;

export type WordStatus = 'new' | 'review' | 'learned';

/** A gap of three weeks and more: the word is known. */
const LEARNED_DAYS = 21;

/** "New" until the first answer, "learned" once the gap reaches three weeks, "on review" in between. */
export function wordStatus(srs: Srs): WordStatus {
  if (srs.reps === 0 && srs.lapses === 0) return 'new';
  return srs.interval >= LEARNED_DAYS ? 'learned' : 'review';
}

/** "10 min", "1 d", "3 wk" (in the user's language): how long the gap after an answer will be, for the button labels. */
export function gapLabel(srs: Srs, remembered: boolean, now: number): string {
  const ms = grade(srs, remembered, now).due - now;
  if (ms < 60 * MINUTE_MS) return t('gap_min', Math.max(1, Math.round(ms / MINUTE_MS)));
  const days = Math.round(ms / DAY_MS);
  if (days < 14) return t('gap_day', days);
  if (days < 60) return t('gap_week', Math.round(days / 7));
  return t('gap_month', Math.round(days / 30));
}
