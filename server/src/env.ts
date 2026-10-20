export interface Env {
  DB: D1Database;
  /** OAuth client id of the extension: the audience every Google ID token must carry. */
  GOOGLE_CLIENT_ID: string;
  /** Signs the access tokens (HS256); at least 32 random bytes. */
  SESSION_SECRET: string;
  /** chrome-extension://<id>, comma-separated: the origins that get CORS answers. */
  EXTENSION_ORIGINS: string;
  /** Tests only: Google's signing keys as a JWKS document, instead of fetching them from Google. */
  GOOGLE_JWKS?: string;
}
