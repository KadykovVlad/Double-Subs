/** OAuth client of the extension in Google Cloud Console (type Web application); public by design. */
export const GOOGLE_CLIENT_ID =
  '265593746967-gle7m26ptk75neles0hm2krrhlkm56kj.apps.googleusercontent.com';

const PRODUCTION_API = 'https://double-sub-api.doublesub-ext.workers.dev';

/** The server of accounts and sync; the test build can point to a fake one (`e2eApi` in the storage). */
export async function apiBase(): Promise<string> {
  if (import.meta.env.VITE_DS_E2E) {
    const { e2eApi } = await browser.storage.local.get('e2eApi');
    if (typeof e2eApi === 'string') return e2eApi;
  }
  return PRODUCTION_API;
}
