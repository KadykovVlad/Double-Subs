import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { exportJWK, generateKeyPair } from 'jose';
import { defineConfig } from 'vitest/config';

/**
 * The tests run the Worker in workerd with a local D1. Google is replaced by a key made here: the
 * Worker gets its public half as GOOGLE_JWKS, the tests sign "Google" tokens with the private half.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
  const privateJwk = { ...(await exportJWK(privateKey)), kid: 'test', alg: 'RS256' };
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_GOOGLE_PRIVATE_JWK: JSON.stringify(privateJwk),
            GOOGLE_JWKS: JSON.stringify({ keys: [publicJwk] }),
            GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
            SESSION_SECRET: 'test-secret-that-is-long-enough-0123456789',
            EXTENSION_ORIGINS: 'chrome-extension://abcdefghijklmnop',
          },
        },
      }),
    ],
    test: { include: ['test/**/*.test.ts'], setupFiles: ['test/setup.ts'] },
  };
});
