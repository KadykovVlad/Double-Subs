-- One row per Google account. plan/pro_until are written by the payment webhook later, never by the client.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  pro_until INTEGER,
  -- Last number given to a synced change of this user: pulls ask for everything after a number.
  sync_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- A signed-in browser. Only the hash of its refresh token is stored; the token is replaced on every refresh.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- What the extension syncs, one row per thing: kind 'words' (key = wordKey), 'history' (key = entry id),
-- 'settings' and 'sites' (one row each). data is the JSON the extension stores; null once deleted.
CREATE TABLE items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  data TEXT,
  -- When the user made the change (the client's clock, never ahead of the server's): the later change wins.
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  -- When the server took the change (users.sync_seq): what a pull pages by.
  seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, key)
);
CREATE INDEX items_seq ON items(user_id, seq);
