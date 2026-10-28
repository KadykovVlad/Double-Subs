export interface Env {
  DB: D1Database;
  /** OAuth client id of the extension: the audience every Google ID token must carry. */
  GOOGLE_CLIENT_ID: string;
  /** Signs the access tokens (HS256) and keys the hash of email codes; at least 32 random bytes. */
  SESSION_SECRET: string;
  /** chrome-extension://<id>, comma-separated: the origins that get CORS answers. */
  EXTENSION_ORIGINS: string;
  /** Tests only: Google's signing keys as a JWKS document, instead of fetching them from Google. */
  GOOGLE_JWKS?: string;

  /** Resend's API key (secret): the letters with the codes. Without it nothing is sent. */
  RESEND_API_KEY?: string;
  /** The sender of those letters, an address of a domain verified in Resend: "Double Sub <login@example.com>". */
  MAIL_FROM?: string;
  /** "1": letters go into the dev_outbox table instead of being sent (local development and tests only). */
  MAIL_OUTBOX?: string;

  /** The bot's username without "@": the extension opens t.me/<it>?start=<login id>. */
  TELEGRAM_BOT_NAME?: string;
  /** The bot's token from @BotFather (secret): the bot answers the user. Without it the bot stays silent. */
  TELEGRAM_BOT_TOKEN?: string;
  /** The secret given to setWebhook (secret): Telegram sends it with every update, nobody else knows it. */
  TELEGRAM_WEBHOOK_SECRET?: string;

  /**
   * A reverse proxy in front of the Worker (a server reachable where Cloudflare is not) sends this
   * secret in `x-proxy-secret` and the user's address in `x-real-ip`; without it every request would
   * seem to come from the proxy, and the limits per address would hit everybody at once.
   */
  PROXY_SECRET?: string;
}
