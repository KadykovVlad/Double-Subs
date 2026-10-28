import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// The first schema, with a user signed in by Google before there were other ways in: the later
// migrations must keep that user, their session and their synced data (see migrations.test.ts).
const [first, ...later] = env.TEST_MIGRATIONS;
await applyD1Migrations(env.DB, [first!]);
if (
  later.length > 0 &&
  !(await env.DB.prepare("SELECT 1 FROM users WHERE id = 'legacy-user'").first())
) {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, google_sub, email, created_at) VALUES ('legacy-user', 'legacy-sub', 'old@example.com', 1)",
    ),
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, refresh_hash, expires_at, created_at) VALUES ('legacy-session', 'legacy-user', 'x', 9999999999999, 1)",
    ),
    env.DB.prepare(
      "INSERT INTO items (user_id, kind, key, data, updated_at, deleted, seq) VALUES ('legacy-user', 'words', 'en:go', '{}', 1, 0, 1)",
    ),
  ]);
}
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
