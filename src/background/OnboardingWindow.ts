/** The small window that asks for the sign-in (and, if it was taken away, the access to the sites). */
export const ONBOARDING_WIDTH = 400;
export const ONBOARDING_HEIGHT = 600;
const WINDOW_KEY = 'onboardingWindowId';
/** How far from the right edge and how far down from the top of the browser window the small one is put. */
const MARGIN_RIGHT = 24;
const OFFSET_TOP = 80;

interface Anchor {
  left?: number;
  top?: number;
  width?: number;
}

/** Top right of the browser window, under the toolbar, where the icons of the extensions are. */
export function placeBeside(anchor: Anchor | null): { left?: number; top?: number } {
  if (!anchor || anchor.left === undefined || anchor.top === undefined || !anchor.width) return {};
  return {
    left: Math.max(0, anchor.left + anchor.width - ONBOARDING_WIDTH - MARGIN_RIGHT),
    top: anchor.top + OFFSET_TOP,
  };
}

/**
 * Shows the window: the one already open is brought forward, otherwise a new small window (no address
 * bar) is made. Unlike the drop-down under the icon it stays when Google's window takes the focus.
 */
export async function openOnboardingWindow(): Promise<void> {
  const stored = (await browser.storage.session.get(WINDOW_KEY))[WINDOW_KEY];
  if (typeof stored === 'number') {
    const open = await browser.windows.get(stored).then(
      () => true,
      () => false,
    );
    if (open) {
      await browser.windows.update(stored, { focused: true });
      return;
    }
  }
  const anchor = await browser.windows.getLastFocused().catch(() => null);
  const created = await browser.windows.create({
    url: browser.runtime.getURL('/onboarding.html'),
    type: 'popup',
    width: ONBOARDING_WIDTH,
    height: ONBOARDING_HEIGHT,
    focused: true,
    ...placeBeside(anchor),
  });
  if (created?.id !== undefined) await browser.storage.session.set({ [WINDOW_KEY]: created.id });
}
