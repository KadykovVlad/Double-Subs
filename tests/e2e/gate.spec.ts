import { expect, test, type Page } from '@playwright/test';
import {
  launchWithExtension,
  openPanelTab,
  openPopupFor,
  type ExtensionSession,
} from './extension';
import { startFakeApi, type FakeApi } from './fake-api';
import { startFixtureServer, type FixtureServer } from './server';

/** The extension works for signed-in users only: before the sign-in nothing happens on any page. */
let session: ExtensionSession;
let fixtures: FixtureServer;
let api: FakeApi;
let counter = 0;

test.beforeAll(async () => {
  fixtures = await startFixtureServer('localhost');
  session = await launchWithExtension({ signedIn: false });
});

test.afterAll(async () => {
  await session.close();
  await fixtures.close();
});

test.beforeEach(async () => {
  api = await startFakeApi();
  await session.worker.evaluate(
    (origin) => chrome.storage.local.set({ e2eApi: origin }),
    api.origin,
  );
});

test.afterEach(async () => {
  await Promise.all(session.context.pages().map((page) => page.close()));
  await session.resetStorage();
  await api.close();
});

const overlay = (page: Page) => page.locator('double-sub-overlay');
const registeredIds = async () =>
  (
    await session.worker.evaluate(async () =>
      (await chrome.scripting.getRegisteredContentScripts()).flatMap((s) => s.matches ?? []),
    )
  ).filter((match) => !match.includes('youtube'));

const signInDirectly = () =>
  session.worker.evaluate(() =>
    chrome.storage.local.set({
      account: {
        email: 'e2e@example.com',
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: Date.now() + 3_600_000,
      },
    }),
  );
const signOutDirectly = () => session.worker.evaluate(() => chrome.storage.local.remove('account'));

async function openVideo(): Promise<Page> {
  const page = await session.context.newPage();
  await page.goto(`${fixtures.origin}/shadow-video.html?test=${++counter}`);
  await page.locator('video').evaluate(
    (v: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        const go = () => {
          v.addEventListener('seeked', () => resolve(), { once: true });
          v.currentTime = 1.5;
        };
        if (v.readyState >= 1) go();
        else v.addEventListener('loadedmetadata', go, { once: true });
      }),
  );
  return page;
}

test('signed out the panel offers only the sign-in and the page is left alone; signing in starts the subtitles', async () => {
  const page = await openVideo();
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('gate')).toBeVisible();
  await page.waitForTimeout(3500); // longer than the agent's check interval
  await expect(overlay(page)).toHaveCount(0);

  await panel.getByTestId('sign-in').click();
  await expect(overlay(page).locator('.en')).toHaveText('Hello, Dexter.');
});

test('signing out takes the subtitles from the page and brings the sign-in back', async () => {
  const page = await openVideo();
  const panel = await openPopupFor(session, page);
  await panel.getByTestId('sign-in').click();
  await expect(overlay(page).locator('.en')).toHaveText('Hello, Dexter.');

  await openPanelTab(panel, 'settings');
  await panel.getByTestId('sign-out').click();
  await expect(panel.getByTestId('gate')).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);
});

test('the automatic start follows the account: off after the sign-out, back on after the sign-in', async () => {
  await signInDirectly();
  const page = await openVideo();
  const panel = await openPopupFor(session, page);
  await panel.getByTestId('auto-start').check();
  await expect.poll(registeredIds).toEqual(['http://localhost/*']);
  await expect(overlay(page).locator('.en')).toHaveText('Hello, Dexter.');

  await signOutDirectly();
  await expect.poll(registeredIds).toEqual([]);
  await expect(overlay(page)).toHaveCount(0);
  const signedOut = await openVideo();
  await signedOut.waitForTimeout(3500);
  await expect(overlay(signedOut)).toHaveCount(0);

  await signInDirectly();
  await expect.poll(registeredIds).toEqual(['http://localhost/*']);
  const back = await openVideo();
  await expect(overlay(back).locator('.en')).toHaveText('Hello, Dexter.');
});

test('the welcome page shows the access and offers the sign-in as the second step', async () => {
  // The test build does not open it by itself (a stray tab would disturb every other test).
  expect(session.context.pages().some((p) => p.url().includes('welcome.html'))).toBe(false);

  const welcome = await session.context.newPage();
  await welcome.goto(`chrome-extension://${session.extensionId}/welcome.html`);
  // The test build already holds the access (its manifest lists localhost), so the page shows it as allowed;
  // the button itself opens a question of Chrome that a headless browser cannot answer.
  await expect(welcome.getByTestId('access-allowed')).toBeVisible();
  await expect(welcome.getByTestId('sign-in')).toBeVisible();

  await welcome.getByTestId('sign-in').click();
  await expect(welcome.getByTestId('account-email')).toHaveText('Вы вошли как learner@example.com');
  await expect(welcome.getByTestId('welcome-done')).toBeVisible();
  await expect(welcome.getByTestId('sign-in')).toHaveCount(0);
});
