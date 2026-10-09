import { describe, expect, it } from 'vitest';
import { AGAIN_DELAY_MS, gapLabel, grade, isDue, newSrs, normalizeSrs } from '../src/lib/srs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

describe('spaced repetition', () => {
  it('a new word is due at once', () => {
    expect(isDue(newSrs(NOW), NOW)).toBe(true);
  });

  it('"good" answers stretch the gap: 1 day, 3 days, then by the ease', () => {
    let srs = newSrs(NOW);
    srs = grade(srs, 'good', NOW);
    expect(srs.interval).toBe(1);
    expect(srs.due).toBe(NOW + DAY);
    srs = grade(srs, 'good', NOW + DAY);
    expect(srs.interval).toBe(3);
    srs = grade(srs, 'good', NOW + 4 * DAY);
    expect(srs.interval).toBe(Math.round(3 * 2.5));
    expect(isDue(srs, NOW + 4 * DAY)).toBe(false);
  });

  it('"again" brings the word back in ten minutes and counts a lapse', () => {
    const learned = grade(grade(newSrs(NOW), 'good', NOW), 'good', NOW);
    const forgotten = grade(learned, 'again', NOW);
    expect(forgotten.due).toBe(NOW + AGAIN_DELAY_MS);
    expect(forgotten.reps).toBe(0);
    expect(forgotten.lapses).toBe(1);
    expect(forgotten.ease).toBeLessThan(learned.ease);
  });

  it('"easy" jumps further than "good" and "hard" grows slowest', () => {
    const base = grade(grade(newSrs(NOW), 'good', NOW), 'good', NOW);
    const easy = grade(base, 'easy', NOW).interval;
    const good = grade(base, 'good', NOW).interval;
    const hard = grade(base, 'hard', NOW).interval;
    expect(easy).toBeGreaterThan(good);
    expect(good).toBeGreaterThan(hard);
    expect(hard).toBeGreaterThanOrEqual(base.interval);
  });

  it('the ease never falls below the floor', () => {
    let srs = newSrs(NOW);
    for (let i = 0; i < 20; i++) srs = grade(srs, 'again', NOW);
    expect(srs.ease).toBe(1.3);
  });

  it('labels the next gap for the buttons', () => {
    const srs = newSrs(NOW);
    expect(gapLabel(srs, 'again', NOW)).toBe('10 мин');
    expect(gapLabel(srs, 'good', NOW)).toBe('1 дн');
    expect(gapLabel(srs, 'easy', NOW)).toBe('4 дн');
  });

  it('repairs a broken record', () => {
    expect(normalizeSrs(undefined, 5)).toEqual({
      due: 5,
      interval: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
    });
    expect(normalizeSrs({ due: 'x', ease: 0.1, reps: -3 }, 9)).toMatchObject({
      due: 9,
      ease: 1.3,
      reps: 0,
    });
  });
});
