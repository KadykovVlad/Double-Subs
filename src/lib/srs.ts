import { t } from './i18n';
/**
 * Spaced repetition for saved words, a simplified SM-2: every word has a due time; the answer
 * ("again", "hard", "good", "easy") decides how long the next gap is. A word never seen before is due at once.
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

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
export const AGAIN_DELAY_MS = 10 * MINUTE_MS;
const MIN_EASE = 1.3;
const START_EASE = 2.5;

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

/** The word after an answer. */
export function grade(srs: Srs, rating: Rating, now: number): Srs {
  switch (rating) {
    case 'again':
      return {
        ...srs,
        due: now + AGAIN_DELAY_MS,
        interval: 0,
        reps: 0,
        ease: Math.max(MIN_EASE, srs.ease - 0.2),
        lapses: srs.lapses + 1,
      };
    case 'hard': {
      const interval = Math.max(1, Math.round(Math.max(1, srs.interval) * 1.2));
      return {
        ...srs,
        due: now + interval * DAY_MS,
        interval,
        ease: Math.max(MIN_EASE, srs.ease - 0.15),
      };
    }
    case 'good': {
      const reps = srs.reps + 1;
      const interval =
        reps === 1
          ? 1
          : reps === 2
            ? 3
            : Math.max(srs.interval + 1, Math.round(srs.interval * srs.ease));
      return { ...srs, reps, interval, due: now + interval * DAY_MS };
    }
    case 'easy': {
      const reps = srs.reps + 1;
      const interval =
        srs.interval === 0
          ? 4
          : Math.max(srs.interval + 2, Math.round(srs.interval * srs.ease * 1.3));
      return { ...srs, reps, interval, due: now + interval * DAY_MS, ease: srs.ease + 0.15 };
    }
  }
}

export const isDue = (srs: Srs, now: number) => srs.due <= now;

/** "10 min", "1 d", "3 wk" (in the user's language): how long the gap after an answer will be, for the button labels. */
export function gapLabel(srs: Srs, rating: Rating, now: number): string {
  const ms = grade(srs, rating, now).due - now;
  if (ms < 60 * MINUTE_MS) return t('gap_min', Math.max(1, Math.round(ms / MINUTE_MS)));
  const days = Math.round(ms / DAY_MS);
  if (days < 14) return t('gap_day', days);
  if (days < 60) return t('gap_week', Math.round(days / 7));
  return t('gap_month', Math.round(days / 30));
}
