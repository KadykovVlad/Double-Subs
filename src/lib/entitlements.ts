/** The features the plan decides: everything else (dual subtitles, history, hover translation) is free. */
export type Feature = 'words' | 'media' | 'asr' | 'smartHistory';

export type Plan = 'free' | 'pro';

export interface Entitlements {
  plan: Plan;
  /** End of the paid period, ms since the epoch; null = no end (the development switch, a lifetime plan). */
  proUntil: number | null;
}

export const FREE_PLAN: Entitlements = { plan: 'free', proUntil: null };

/** What the free plan has among the plan-bound features: nothing yet. */
const FREE_FEATURES: readonly Feature[] = [];

export function isPro(entitlements: Entitlements, now = Date.now()): boolean {
  return (
    entitlements.plan === 'pro' && (entitlements.proUntil === null || entitlements.proUntil > now)
  );
}

export function hasFeature(
  entitlements: Entitlements,
  feature: Feature,
  now = Date.now(),
): boolean {
  return FREE_FEATURES.includes(feature) || isPro(entitlements, now);
}

/** Anything unreadable in the storage is the free plan: a damaged value must not open a paid feature. */
export function normalizeEntitlements(value: unknown): Entitlements {
  if (typeof value !== 'object' || value === null) return FREE_PLAN;
  const { plan, proUntil } = value as Record<string, unknown>;
  if (plan !== 'pro') return FREE_PLAN;
  return { plan, proUntil: typeof proUntil === 'number' && proUntil > 0 ? proUntil : null };
}

const KEY = 'entitlements';

export async function loadEntitlements(): Promise<Entitlements> {
  const stored = await browser.storage.local.get(KEY);
  return normalizeEntitlements(stored[KEY]);
}

export async function saveEntitlements(entitlements: Entitlements): Promise<void> {
  await browser.storage.local.set({ [KEY]: entitlements });
}

/** Calls `listener` whenever the plan changes anywhere (panel, any frame). */
export function watchEntitlements(listener: (entitlements: Entitlements) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && KEY in changes) listener(normalizeEntitlements(changes[KEY]!.newValue));
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
