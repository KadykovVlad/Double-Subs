/**
 * Does an address belong to a site the user already has? Pirate-style sites change their mirror all
 * the time ("lordfilm5.pro" today, "new-lordfilm.cc" tomorrow) but keep their name in the address, so
 * a site is known by its name as well as by its exact address. Addresses given as numbers
 * (192.168.0.5) have no name and are only known exactly.
 */

const MIN_BRAND_LENGTH = 5;
/** "co.uk", "com.ua": the name is the label before these. */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne']);

export const isIpHost = (host: string) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || /^\[.*\]$/.test(host);

const stripMirrorNoise = (label: string) => label.toLowerCase().replace(/[-_]?\d+$/, '');

/** The labels of an address that can carry a name: no "www", no top-level domain. */
function nameLabels(host: string): string[] {
  const labels = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
    .filter(Boolean);
  if (labels.length < 2) return [];
  const last = labels.length - 1;
  const secondLevel =
    labels.length >= 3 && SECOND_LEVEL.has(labels[last - 1]!) && labels[last]!.length === 2;
  return labels.slice(0, secondLevel ? last - 1 : last);
}

/**
 * The name of a site: "ga.lordfilm5.pro" → "lordfilm". Null for addresses without one (numbers,
 * "localhost") and for names too short to tell sites apart.
 */
export function brandOf(host: string): string | null {
  if (isIpHost(host)) return null;
  const labels = nameLabels(host);
  const name = labels[labels.length - 1];
  if (!name) return null;
  const brand = stripMirrorNoise(name);
  return brand.length >= MIN_BRAND_LENGTH ? brand : null;
}

/** The address is one of the known ones, or carries the name of one of them. */
export function matchKnownHost(host: string, knownHosts: string[]): boolean {
  const lower = host.toLowerCase();
  const candidates = isIpHost(lower) ? [] : nameLabels(lower).map(stripMirrorNoise);
  return knownHosts.some((known) => {
    if (known.toLowerCase() === lower) return true;
    const brand = brandOf(known);
    return brand !== null && candidates.some((label) => label.includes(brand));
  });
}

/** Hosts of the origins in the list ("https://ga.lordfilm5.pro" → "ga.lordfilm5.pro"). */
export function hostsOf(origins: string[]): string[] {
  return origins.flatMap((origin) => {
    try {
      return [new URL(origin).hostname];
    } catch {
      return [];
    }
  });
}
