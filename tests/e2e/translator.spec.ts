import { expect, test } from '@playwright/test';
import {
  launchWithExtension,
  openPanelTab,
  openPopupFor,
  type ExtensionSession,
} from './extension';
import { startFixtureServer, type FixtureServer } from './server';

/**
 * Stage 4 prototype: where Chrome exposes the built-in Translator API.
 * These facts decide where translation runs, so a Chrome update that changes them must fail here.
 * The model itself is not downloaded in tests (that needs a user click and a download).
 */
let session: ExtensionSession;
let servers: FixtureServer[] = [];
let pageOrigin: string;

test.beforeAll(async () => {
  const player = await startFixtureServer('localhost');
  const page = await startFixtureServer('localhost', { IFRAME_ORIGIN: player.origin });
  servers = [player, page];
  pageOrigin = page.origin;
  session = await launchWithExtension();
});

test.afterAll(async () => {
  await session.close();
  await Promise.all(servers.map((s) => s.close()));
});

const usable = /^(available|downloadable|downloading)$/;

test('the lab page and an offscreen document both have the Translator API', async () => {
  const lab = await session.context.newPage();
  await lab.goto(`chrome-extension://${session.extensionId}/translator-lab.html`);

  const rows = lab.getByTestId('probe-row');
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    const [, api, enRu, ruEn, error] = await row.locator('td').allInnerTexts();
    expect(error, 'no error (an offscreen reason Chrome rejects would show here)').toBe('');
    expect(api).toBe('есть');
    expect(enRu).toMatch(usable);
    expect(ruEn).toMatch(usable);
  }
});

test('in page frames: the top frame can translate, a cross-origin player iframe cannot', async () => {
  const site = await session.context.newPage();
  await site.goto(`${pageOrigin}/top-with-iframe.html?probe=1`);
  const popup = await openPopupFor(session, site);
  await expect(popup.getByTestId('status')).toHaveText('Субтитры найдены');

  await openPanelTab(popup, 'settings');
  await popup.locator('details.diag summary').click();
  await popup.getByTestId('probe-translator').click();
  const probes = popup.getByTestId('translator-probe');
  await expect(probes).toHaveCount(2);

  const top = probes.filter({ hasText: 'top frame' });
  await expect(top).toContainText(/content script: EN→RU (available|downloadable|downloading)/);
  await expect(top).toContainText(/наш iframe: EN→RU (available|downloadable|downloading)/);

  // Permissions policy: the API is off in a cross-origin iframe, and a nested iframe cannot get it back.
  const player = probes.filter({ hasText: /^iframe,/ });
  await expect(player).toContainText('content script: EN→RU unavailable');
  await expect(player).toContainText('наш iframe: EN→RU unavailable');
});
