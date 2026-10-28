# Double Sub server

Accounts and sync for the extension: a Cloudflare Worker with a D1 (SQLite) database.
Three ways in lead to one user: Google, a code by email (sent through Resend), and a Telegram bot.

## API

| Method | Path | Body / auth | Answer |
|---|---|---|---|
| GET | `/health` | | `{ ok }` |
| POST | `/auth/google` | `{ idToken }` (Google ID token, audience = `GOOGLE_CLIENT_ID`) | `{ accessToken, refreshToken, expiresAt }`; with `Bearer`: `{ linked }` |
| POST | `/auth/email/start` | `{ email, lang }` (optional `Bearer`: add the address) | `{ ok }`: a letter with a 6-digit code |
| POST | `/auth/email/verify` | `{ email, code }` (`Bearer` if the start had one) | tokens, or `{ linked }` |
| POST | `/auth/telegram/start` | (optional `Bearer`: add Telegram) | `{ loginId, secret, link, expiresAt }` |
| POST | `/auth/telegram/poll` | `{ loginId, secret }` (`Bearer` if the start had one) | `{ pending }`, tokens, or `{ linked }`; 410 when old or used |
| POST | `/telegram/webhook` | Telegram's update, header `x-telegram-bot-api-secret-token` | `{ ok }` |
| POST | `/auth/refresh` | `{ refreshToken }` | new tokens; the old refresh token stops working |
| POST | `/auth/logout` | `{ refreshToken }` | `{ ok }` |
| GET | `/me` | `Bearer <accessToken>` | `{ email, name, plan, proUntil, methods: [{ provider, label }] }` |
| DELETE | `/me` | `Bearer` | deletes the account, its ways in and all its synced data |
| DELETE | `/me/methods/:provider` | `Bearer` | `{ methods }`; 409 `last_method` for the only one |
| POST | `/sync` | `Bearer`, `{ cursor, changes: [{ kind, key, data, updatedAt, deleted }] }` | `{ cursor, changes, more, reset }` |

- Ways in (`identities`): `google` (Google's sub), `email` (the address, lower case), `telegram` (the
  Telegram user id), at most one of each per user. Google and a code for the same address are one
  user. A way in started with an access token is added to that user (409 `identity_taken` when it
  belongs to somebody else, `provider_taken` when the user has another one of that kind).
- Email codes: 6 digits, kept as an HMAC with `SESSION_SECRET`, 10 minutes, 5 tries (counted before the
  comparison), one use. Letters: one a minute and five an hour per address, twenty an hour per
  network address. Errors: `bad_email`, `too_many` (429), `bad_code`, `code_expired`.
- Telegram: the extension opens `link` (`t.me/<bot>?start=<loginId>`); the user presses Start; the bot's
  webhook marks the login as theirs; the extension, which alone has `secret`, polls and gets the
  session once. Logins live 10 minutes.
- Access tokens live 1 hour, refresh tokens 30 days and are replaced on every refresh. A replaced
  refresh token used again ends the session (it may have been stolen).
- `kind` is `words`, `history`, `settings` or `sites`. A change is stored only when its `updatedAt` is
  later than the stored one (at an equal time a deletion wins); a time ahead of the server's clock is
  taken as now. Deletions stay as tombstones so other browsers learn about them.
- `/sync` stores the changes, then returns everything after `cursor` (up to 500 per page; `more: true`
  means ask again with the new cursor). `reset: true` means the cursor is unknown: start again from 0.
- Limits: body 1 MB, 500 changes per request, 16 KB per item.
- CORS answers only the origins in `EXTENSION_ORIGINS`.

## Develop

```sh
npm ci
npm test            # the Worker in workerd with a local D1; Google is replaced by a test key
npm run compile
npm run dev         # local server: copy .dev.vars.example to .dev.vars (not committed)
```

## Deploy

You need: a Cloudflare account, a domain (for the letters, and for an address other than workers.dev),
a Resend account, a Telegram bot, and a Google OAuth client. Each secret is put with
`npx wrangler secret put <NAME>` (it asks for the value; it is never written to a file).

1. **Cloudflare and the database.** `npx wrangler login`. The database exists already (`database_id` in
   `wrangler.toml`); for a new one: `npx wrangler d1 create double-sub` and put the printed id there.
   Then `npm run migrate:remote` (applies `0001` and `0002`; `0002` keeps existing users, their sessions
   and data: it is tested in `test/migrations.test.ts`).
2. **Session secret.** `openssl rand -base64 48` → `SESSION_SECRET`.
3. **Google.** Google Cloud Console → APIs & Services → Credentials → OAuth client ID, type **Web
   application**. Authorized redirect URI: `https://kbipbdkmdaghooihkcmdjhfmeoimgnbm.chromiumapp.org/`
   (what `chrome.identity.getRedirectURL()` returns; the ID comes from the key in `wxt.config.ts`; the
   store's package has no key, so after the first upload add a second URI with the store's ID). Its client
   id → `GOOGLE_CLIENT_ID`.
4. **Domain.** Any cheap one (nobody sees it). Add it to Cloudflare (Websites → Add a domain) and set
   the name servers at the registrar to the two Cloudflare gives.
5. **Letters (Resend).** resend.com → Domains → Add domain (yours, or a subdomain like `mail.example.com`)
   → add the DNS records it lists in Cloudflare → Verify. API Keys → Create (sending access) →
   `RESEND_API_KEY`. In `wrangler.toml` uncomment `MAIL_FROM` with an address of that domain.
6. **Telegram bot.** In Telegram, @BotFather → `/newbot` → a name and a username ending in `bot`. The
   token → `TELEGRAM_BOT_TOKEN`; the username without `@` → `TELEGRAM_BOT_NAME` in `wrangler.toml`.
   `openssl rand -hex 32` → `TELEGRAM_WEBHOOK_SECRET`.
7. **Address of the API.** In `wrangler.toml` uncomment `routes` with `api.<your domain>`. `npm run deploy`.
8. **Tell Telegram where the bot lives** (once, and again only if the address changes):
   ```sh
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://api.<your domain>/telegram/webhook \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET> -d 'allowed_updates=["message"]'
   ```
   `getWebhookInfo` on the same address shows whether it works.
9. **The extension.** Build it for that address: `VITE_DS_API=https://api.<your domain> npm run build`.
   `EXTENSION_ORIGINS` in `wrangler.toml` has the development ID; after the first store upload add
   `,chrome-extension://<store id>` and deploy again.

### Users in Russia: a proxy in front

Russian providers throttle connections to Cloudflare (since June 2025, to the first 16 KB of an
answer), so neither workers.dev nor a domain served through Cloudflare is reliable there without a VPN.
What works: a small server outside Russia that is **not** behind Cloudflare forwards the requests to
the Worker. In Cloudflare DNS the record of `api.<your domain>` then points to that server with the
proxy (orange cloud) **off**, and step 7 uses workers.dev (or another name) for the Worker itself.
With Caddy (it gets the certificate by itself):

```
api.example.com {
	reverse_proxy https://double-sub-api.<your account>.workers.dev {
		header_up Host {upstream_hostport}
		header_up X-Real-IP {remote_host}
		header_up X-Proxy-Secret "<PROXY_SECRET>"
	}
}
```

`openssl rand -hex 32` → `PROXY_SECRET` (the same value in the Worker and in the Caddyfile): with it
the Worker believes the proxy about the user's address; without it every user would share the limits
per network address. The Telegram webhook may still point to the Worker directly.

`GOOGLE_JWKS` and `MAIL_OUTBOX` exist for development and tests only: never set them in production
(the first replaces Google's keys, the second keeps letters in the database instead of sending them).
