/**
 * Cache key of a translation: a hash of the direction and the source texts. The same subtitles give
 * the same key on any site and in any player, and a different cut of the same episode does not.
 */
export async function fingerprint(texts: string[], direction: string): Promise<string> {
  const data = new TextEncoder().encode(`${direction}\n${texts.join('\u0000')}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
