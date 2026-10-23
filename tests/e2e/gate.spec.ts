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

test('before the sign-in the panel is one card: language, access to the sites, sign-in; no page is opened', async () => {
  const page = await openVideo();
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('gate')).toBeVisible();
  await expect(panel.getByTestId('onboarding-language')).toBeVisible();
  await expect(panel.getByTestId('allow-access')).toBeVisible();
  await expect(panel.getByTestId('sign-in')).toBeVisible();

  // The access is one click (the test build holds it already, so Chrome asks nothing) and is remembered.
  await panel.getByTestId('allow-access').click();
  await expect(panel.getByTestId('access-allowed')).toBeVisible();
  const mirrors = await session.worker.evaluate(
    async () => (await chrome.storage.local.get('mirrorsMode')).mirrorsMode,
  );
  expect(mirrors).toBe(true);
});

test('the language of the card can be chosen before signing in', async () => {
  const page = await openVideo();
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('sign-in')).toHaveText('Войти через Google');
  await panel.getByTestId('onboarding-language').selectOption('en');
  await expect(panel.getByTestId('sign-in')).toHaveText('Sign in with Google');
  await expect(panel.getByTestId('allow-access')).toHaveText('Allow access');
  // The other choice of the session stays as it was for the tests that follow.
  await panel.getByTestId('onboarding-language').selectOption('ru');
  await expect(panel.getByTestId('sign-in')).toHaveText('Войти через Google');
});

/** The sites question is open (the tests are seeded with it answered). */
const openSitesQuestion = () =>
  session.worker.evaluate(() => chrome.storage.local.set({ accessBannerDismissed: false }));

test('the welcome in the panel: access to the sites and the sign-in; when both are answered the panel goes on to its tabs', async () => {
  await openSitesQuestion();
  const page = await openVideo();
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('gate')).toBeVisible();
  await expect(panel.getByTestId('allow-access')).toBeVisible();
  await expect(panel.getByTestId('sign-in')).toBeVisible();

  await panel.getByTestId('allow-access').click(); // the test build holds the access, so Chrome asks nothing
  await expect(panel.getByTestId('access-allowed')).toBeVisible();
  await expect(panel.getByTestId('tab-now')).toHaveCount(0); // not signed in yet

  await panel.getByTestId('sign-in').click();
  await expect(panel.getByTestId('gate')).toHaveCount(0);
  await expect(panel.getByTestId('tab-now')).toBeVisible();
});

test('signed in, but the sites not answered: the welcome stays with the access step, "Not now" lets the panel go on', async () => {
  await signInDirectly();
  await openSitesQuestion();
  const page = await openVideo();
  const panel = await openPopupFor(session, page);
  await expect(panel.getByTestId('gate')).toBeVisible();
  await expect(panel.getByTestId('account-email')).toBeVisible(); // the sign-in step is done
  await expect(panel.getByTestId('sign-in')).toHaveCount(0);

  await panel.getByTestId('dismiss-access').click();
  await expect(panel.getByTestId('gate')).toHaveCount(0);
  await expect(panel.getByTestId('tab-now')).toBeVisible();
});

test('the icon always opens the side panel; the mark says there is something to do', async () => {
  const state = () =>
    session.worker.evaluate(async () => ({
      badge: await chrome.action.getBadgeText({}),
      popup: await chrome.action.getPopup({}),
      panelOnClick: (await chrome.sidePanel.getPanelBehavior()).openPanelOnActionClick,
    }));
  const fresh = async () => {
    const now = await state();
    return { ...now, popup: now.popup.replace(/^chrome-extension:\/\/[^/]+\/?/, '') };
  };

  // Nobody is signed in: the mark; no small window, a click opens the panel.
  await expect.poll(fresh).toEqual({ badge: '!', popup: '', panelOnClick: true });

  // Signed in, and the question about the sites was answered ("not now" is the seed): nothing left.
  await signInDirectly();
  await expect.poll(fresh).toEqual({ badge: '', popup: '', panelOnClick: true });

  // Signed in, but the sites were not answered yet: the mark again.
  await openSitesQuestion();
  await expect.poll(fresh).toEqual({ badge: '!', popup: '', panelOnClick: true });

  // The user allowed all sites: done.
  await session.worker.evaluate(() => chrome.storage.local.set({ mirrorsMode: true }));
  await expect.poll(fresh).toEqual({ badge: '', popup: '', panelOnClick: true });
});
