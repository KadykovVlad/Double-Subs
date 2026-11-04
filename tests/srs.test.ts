import { describe, expect, it } from 'vitest';
import {
  AGAIN_DELAY_MS,
  gapLabel,
  grade,
  isDue,
  newSrs,
  normalizeSrs,
  wordStatus,
} from '../src/lib/srs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

describe('spaced repetition', () => {
  it('a new word is due at once', () => {
    expect(isDue(newSrs(NOW), NOW)).toBe(true);
  });

  it('answers remembered stretch the gap: 1 day, 3 days, then by the ease', () => {
    let srs = grade(newSrs(NOW), true, NOW);
    expect(srs.interval).toBe(1);
    expect(srs.due).toBe(NOW + DAY);
    srs = grade(srs, true, NOW + DAY);
    expect(srs.interval).toBe(3);
    srs = grade(srs, true, NOW + 4 * DAY);
    expect(srs.interval).toBe(8);
  });

  it('a word forgotten comes back in ten minutes and counts a lapse', () => {
    const learned = grade(grade(newSrs(NOW), true, NOW), true, NOW);
    const forgotten = grade(learned, false, NOW);
    expect(forgotten.due).toBe(NOW + AGAIN_DELAY_MS);
    expect(forgotten.reps).toBe(0);
    expect(forgotten.lapses).toBe(1);
    expect(forgotten.ease).toBeLessThan(learned.ease);
  });

  it('a word long known keeps part of its gap: it is relearned faster than a new one', () => {
    const known = { ...newSrs(NOW), interval: 40, reps: 6, due: NOW };
    const forgotten = grade(known, false, NOW);
    expect(forgotten.interval).toBe(10);
    expect(grade(forgotten, true, NOW + DAY).interval).toBe(10);
  });

  it('a word remembered after a longer absence than planned goes further', () => {
    const planned = { ...newSrs(NOW), interval: 10, reps: 3, due: NOW };
    const onTime = grade(planned, true, NOW).interval;
    const late = grade(planned, true, NOW + 8 * DAY).interval;
    expect(late).toBeGreaterThan(onTime);
  });

  it('being very late counts for two gaps at most', () => {
    const planned = { ...newSrs(NOW), interval: 10, reps: 3, due: NOW };
    expect(grade(planned, true, NOW + 300 * DAY).interval).toBe(50);
  });

  it('long gaps vary a little, so words of one day do not keep coming back together', () => {
    const planned = { ...newSrs(NOW), interval: 10, reps: 3, due: NOW };
    expect(grade(planned, true, NOW, 1).interval).toBe(28);
    expect(grade(planned, true, NOW, -1).interval).toBe(23);
    expect(grade(newSrs(NOW), true, NOW, 1).interval).toBe(1); // short ones do not
  });

  it('the ease never falls below the floor', () => {
    let srs = newSrs(NOW);
    for (let i = 0; i < 20; i++) srs = grade(srs, false, NOW);
    expect(srs.ease).toBe(1.3);
  });

  it('labels the next gap for the buttons', () => {
    const srs = newSrs(NOW);
    expect(gapLabel(srs, false, NOW)).toBe('10 мин');
    expect(gapLabel(srs, true, NOW)).toBe('1 дн');
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

describe('word status', () => {
  it('is new until the first answer, on review after it, learned at three weeks', () => {
    const fresh = newSrs(NOW);
    expect(wordStatus(fresh)).toBe('new');
    expect(wordStatus(grade(fresh, true, NOW))).toBe('review');
    expect(wordStatus(grade(fresh, false, NOW))).toBe('review');
    expect(wordStatus({ ...fresh, reps: 5, interval: 21 })).toBe('learned');
  });
});
