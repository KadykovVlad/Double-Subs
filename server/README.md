# Double Sub server

Accounts and sync for the extension: a Cloudflare Worker with a D1 (SQLite) database.
Nothing here is used by the extension yet: sign-in and the sync client come next (PLAN, step 3).

## API

| Method | Path | Body / auth | Answer |
|---|---|---|---|
| GET | `/health` | | `{ ok }` |
| POST | `/auth/google` | `{ idToken }` (Google ID token, audience = `GOOGLE_CLIENT_ID`) | `{ accessToken, refreshToken, expiresAt }` |
| POST | `/auth/refresh` | `{ refreshToken }` | new tokens; the old refresh token stops working |
| POST | `/auth/logout` | `{ refreshToken }` | `{ ok }` |
| GET | `/me` | `Bearer <accessToken>` | `{ email, plan, proUntil }` |
| DELETE | `/me` | `Bearer` | deletes the account and all its synced data |
| POST | `/sync` | `Bearer`, `{ cursor, changes: [{ kind, key, data, updatedAt, deleted }] }` | `{ cursor, changes, more, reset }` |

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
npm run dev         # local server; put secrets for it in .dev.vars (not committed)
```

## First deploy (needs your Cloudflare account and a Google OAuth client)

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID, type **Web application**.
   Authorized redirect URI: `https://<extension-id>.chromiumapp.org/` (what `chrome.identity.getRedirectURL()`
   returns). The client id is `GOOGLE_CLIENT_ID`.
2. `npx wrangler login`
3. `npx wrangler d1 create double-sub`, then put the printed `database_id` into `wrangler.toml`.
4. `npm run migrate:remote`
5. `npx wrangler secret put GOOGLE_CLIENT_ID` and `npx wrangler secret put SESSION_SECRET`
   (for the second: `openssl rand -base64 48`).
6. Set `EXTENSION_ORIGINS` in `wrangler.toml` to `chrome-extension://<extension-id>` (comma-separated
   for the store and the development id).
7. `npm run deploy`

`GOOGLE_JWKS` exists for the tests only: never set it in production, it would replace Google's keys.
