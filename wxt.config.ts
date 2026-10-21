import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import { chromeCode, chromeMessages, readLocales, SOURCE_LANGUAGE } from './scripts/locales';

// The e2e build (VITE_DS_E2E=1) goes to its own folder and has access to localhost,
// because Playwright cannot click the toolbar icon to grant activeTab.
const E2E = Boolean(process.env.VITE_DS_E2E);

// The prototype pages of stages 2-4 (translator lab, translator frame, diagnostics) exist for the
// test and dev builds only; the build that goes to the store does not contain them.
const PRODUCT_ENTRYPOINTS = [
  'background',
  'sidepanel',
  'agent',
  'auto-flag',
  'auto-probe',
  'offscreen',
  'youtube',
  'youtube-main',
  'tiktok-main',
  'welcome',
];

// A fixed key gives the unpacked extension the same ID on every machine (dev, build, e2e):
// the redirect address of the Google sign-in, https://<id>.chromiumapp.org/, and the server's
// CORS origin depend on it. The ID this key gives: kbipbdkmdaghooihkcmdjhfmeoimgnbm. The package for the store (`wxt zip`) has no key: the store gives its own ID.
const DEV_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsv+ygtPx6GUzvxJ8uqhX0n22clAnRrPaRGNEjZ6HXytWzNtJ9RGJIDjnHCffuapoGytJtN/eEjwqC1fqQI7/2YFU8i3flqJxRJ1iraL5YJCWhaMTaQfnHx2lGpvxrnX3wMUKPGm6Ws1Bgo+iBJOTSmn5BNIRrwcB6zdhnaBellpDMbrDsf5KcbOUHJjPboUmDv59NEFFmSBhBLuIPCCKYbwBirMvdM5B/OfBn+m1APNVuzFVRBcGL0xO5gNHynjCPwYZRPlRSWlfWrgx0zpDY6gvKN+ecNyPYtgd/REri062hGW4yhq/n4M7rXiLXD5O+ayfq6RdchI9fhwvIcl/uwIDAQAB';
const forStore = process.argv.some((arg) => arg === 'zip');

const prototypes = E2E || !process.argv.some((arg) => arg === 'build' || arg === 'zip');

export default defineConfig({
  hooks: {
    // locales/*.json → _locales/<code>/messages.json (the language of the interface follows the browser's).
    'build:publicAssets': (_wxt, files) => {
      for (const { code, messages } of readLocales()) {
        files.push({
          relativeDest: `_locales/${chromeCode(code)}/messages.json`,
          contents: chromeMessages(messages),
        });
      }
    },
  },
  outDir: E2E ? '.output-e2e' : '.output',
  filterEntrypoints: prototypes ? undefined : PRODUCT_ENTRYPOINTS,
  vite: () => ({
    plugins: [preact()],
    define: { __DS_PROTOTYPES__: JSON.stringify(prototypes) },
  }),
  manifest: {
    ...(forStore ? {} : { key: DEV_KEY }),
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: SOURCE_LANGUAGE,
    // The built-in Translator API (stable since Chrome 138) is what translates on the device.
    minimum_chrome_version: '138',
    // activeTab: the page the user opened the popup on. scripting: inject the agent there.
    // offscreen: stage 4 prototype of the built-in translator.
    // tts: the system voices that say a word aloud on hover.
    // identity: the Google sign-in window (launchWebAuthFlow) of the account.
    permissions: ['storage', 'activeTab', 'scripting', 'offscreen', 'tts', 'sidePanel', 'identity'],
    // No popup: a click on the icon opens the side panel (see the background).
    action: { default_title: '__MSG_extName__' },
    // Permanent access only to YouTube (stage 5).
    host_permissions: [
      '*://*.youtube.com/*',
      ...(E2E ? ['http://localhost/*', 'http://*.localhost/*'] : []),
    ],
    // A player embedded from another site: access to its origin is requested from the popup.
    optional_host_permissions: ['*://*/*'],
    // Stage 4 prototype: the agent embeds this page with allow="translator" to test the API in page frames.
    ...(prototypes
      ? {
          web_accessible_resources: [
            { resources: ['translator-frame.html'], matches: ['<all_urls>'] },
          ],
        }
      : {}),
  },
});
