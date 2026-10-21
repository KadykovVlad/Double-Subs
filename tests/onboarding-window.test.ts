import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ONBOARDING_HEIGHT,
  ONBOARDING_WIDTH,
  openOnboardingWindow,
  placeBeside,
} from '../src/background/OnboardingWindow';

describe('where the small window goes', () => {
  it('top right of the browser window, under the toolbar', () => {
    expect(placeBeside({ left: 100, top: 50, width: 1400 })).toEqual({
      left: 100 + 1400 - ONBOARDING_WIDTH - 24,
      top: 130,
    });
  });

  it('never off the left edge of a narrow or off-screen window', () => {
    expect(placeBeside({ left: 0, top: 0, width: 300 })).toEqual({ left: 0, top: 80 });
  });

  it('lets Chrome choose when the browser window is not known', () => {
    expect(placeBeside(null)).toEqual({});
    expect(placeBeside({ left: 5 })).toEqual({});
  });
});

describe('opening the small window', () => {
  let session: Record<string, unknown>;
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let open: Set<number>;

  beforeEach(() => {
    session = {};
    open = new Set();
    create = vi.fn(async () => {
      open.add(7);
      return { id: 7 };
    });
    update = vi.fn(async () => ({}));
    vi.stubGlobal('browser', {
      storage: {
        session: {
          get: async (key: string) => (key in session ? { [key]: session[key] } : {}),
          set: async (items: Record<string, unknown>) => void Object.assign(session, items),
        },
      },
      runtime: { getURL: (path: string) => `chrome-extension://abc${path}` },
      windows: {
        getLastFocused: async () => ({ left: 0, top: 0, width: 1200 }),
        get: async (id: number) => {
          if (!open.has(id)) throw new Error('No window with id');
          return { id };
        },
        create,
        update,
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('makes a small window without an address bar that is not closed by losing the focus', async () => {
    await openOnboardingWindow();
    expect(create).toHaveBeenCalledWith({
      url: 'chrome-extension://abc/onboarding.html',
      type: 'popup',
      width: ONBOARDING_WIDTH,
      height: ONBOARDING_HEIGHT,
      focused: true,
      left: 1200 - ONBOARDING_WIDTH - 24,
      top: 80,
    });
    expect(session.onboardingWindowId).toBe(7);
  });

  it('brings the window forward instead of making a second one', async () => {
    await openOnboardingWindow();
    await openOnboardingWindow();
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(7, { focused: true });
  });

  it('makes a new one when the user has closed the old', async () => {
    await openOnboardingWindow();
    open.clear(); // closed
    await openOnboardingWindow();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
