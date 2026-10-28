-- Three ways to sign in (Google, a code by email, Telegram), all leading to one user.
--
-- users is not rebuilt: D1 keeps foreign keys on, and dropping the table would cascade and wipe every
-- session and synced item. Its google_sub column (NOT NULL UNIQUE) is no longer read; a user made from
-- now on gets the placeholder 'user:<id>' there, and email is '' when nobody told us one (Telegram).

-- How a person proves who they are: provider 'google' (subject = Google's sub), 'email' (the address,
-- lower case) or 'telegram' (the Telegram user id). One of each provider per user at most.
CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What the user sees for it: the email address, or @username / the name in Telegram.
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject),
  UNIQUE (user_id, provider)
);

INSERT INTO identities (provider, subject, user_id, label, created_at)
  SELECT 'google', google_sub, id, email, created_at FROM users;

-- A code sent by email: only its keyed hash is kept; it ends after a few wrong tries or ten minutes.
CREATE TABLE email_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  -- A signed-in user who adds this address to their account (null: a plain sign-in).
  link_user_id TEXT,
  created_at INTEGER NOT NULL
);

-- A sign-in through the Telegram bot: the extension holds the id and the secret and asks until the
-- bot has been told /start <id> by somebody; then it is used once and removed.
CREATE TABLE telegram_logins (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  telegram_id TEXT,
  label TEXT,
  link_user_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Fixed-window counters: how many times a key (an address, an IP) did something in the current window.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- Development and tests only (MAIL_OUTBOX=1): the letters that would have been sent.
CREATE TABLE dev_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
