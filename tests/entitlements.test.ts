import { describe, expect, it } from 'vitest';
import { FREE_PLAN, hasFeature, isPro, normalizeEntitlements } from '../src/lib/entitlements';

describe('entitlements', () => {
  it('the free plan has none of the plan-bound features', () => {
    for (const feature of ['words', 'media', 'asr', 'smartHistory'] as const)
      expect(hasFeature(FREE_PLAN, feature)).toBe(false);
  });

  it('a pro plan without an end has them all', () => {
    const pro = { plan: 'pro', proUntil: null } as const;
    expect(isPro(pro)).toBe(true);
    expect(hasFeature(pro, 'words')).toBe(true);
  });

  it('a pro plan ends at proUntil', () => {
    const pro = { plan: 'pro', proUntil: 1000 } as const;
    expect(isPro(pro, 999)).toBe(true);
    expect(isPro(pro, 1000)).toBe(false);
    expect(hasFeature(pro, 'asr', 2000)).toBe(false);
  });

  it('anything unreadable is the free plan', () => {
    for (const value of [undefined, null, 'pro', 7, {}, { plan: 'gold' }, { proUntil: 5 }])
      expect(normalizeEntitlements(value)).toEqual(FREE_PLAN);
  });

  it('reads a stored pro plan and drops a bad end date', () => {
    expect(normalizeEntitlements({ plan: 'pro', proUntil: 5 })).toEqual({
      plan: 'pro',
      proUntil: 5,
    });
    expect(normalizeEntitlements({ plan: 'pro', proUntil: 'soon' })).toEqual({
      plan: 'pro',
      proUntil: null,
    });
  });
});
