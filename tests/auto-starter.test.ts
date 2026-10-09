import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/known-sites', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/known-sites')>()),
  loadKnownSites: async () => ({}),
  watchKnownSites: () => () => {},
}));
vi.mock('../src/agent/PageScanner', () => ({ isShown: () => true }));
vi.mock('../src/agent/host', () => ({ isExtensionAlive: () => true }));

import { AutoStarter, type AutoHost } from '../src/agent/AutoStarter';

interface FakeVideo {
  isConnected: boolean;
  getBoundingClientRect: () => { width: number; height: number };
}
const video = (width = 640, height = 360): FakeVideo => ({
  isConnected: true,
  getBoundingClientRect: () => ({ width, height }),
});

let page: { videos: FakeVideo[]; iframes: number; href: string };
let events: EventTarget;

beforeEach(() => {
  vi.useFakeTimers();
  page = { videos: [], iframes: 0, href: 'https://site.example/series/1' };
  events = new EventTarget();
  vi.stubGlobal('window', events);
  vi.stubGlobal('document', {
    getElementsByTagName: (tag: string) =>
      tag === 'video' ? page.videos : { length: page.iframes },
  });
  vi.stubGlobal('location', {
    get href() {
      return page.href;
    },
    hostname: 'site.example',
    origin: 'https://site.example',
  });
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface FakeSession {
  video: FakeVideo;
  isYouTube: boolean;
  recheck: () => void;
}

function makeHost(overrides: { failOnce?: boolean } = {}) {
  let failed = false;
  const host = {
    session: null as FakeSession | null,
    picking: false,
    videos: vi.fn(() => page.videos as unknown as HTMLVideoElement[]),
    open: vi.fn(async (v: HTMLVideoElement, quiet: boolean) => {
      void quiet;
      if (overrides.failOnce && !failed) {
        failed = true;
        throw new Error('broken player');
      }
      host.session = { video: v as unknown as FakeVideo, isYouTube: false, recheck: vi.fn() };
    }),
    closeSession: vi.fn(() => {
      host.session = null;
    }),
  };
  return host;
}
const starterFor = (host: ReturnType<typeof makeHost>) =>
  new AutoStarter(host as unknown as AutoHost);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('AutoStarter', () => {
  it('starts the subtitles at once when the player is already there', async () => {
    page.videos = [video()];
    const host = makeHost();
    starterFor(host).start();
    await advance(0);
    expect(host.open).toHaveBeenCalledTimes(1);
  });

  it('ignores tiny videos such as previews', async () => {
    page.videos = [video(120, 68)];
    const host = makeHost();
    starterFor(host).start();
    await advance(5000);
    expect(host.open).not.toHaveBeenCalled();
  });

  it('a click that loads the player is followed by a quick look, not by waiting for the timer', async () => {
    const host = makeHost();
    starterFor(host).start();
    await advance(0);
    expect(host.open).not.toHaveBeenCalled();

    events.dispatchEvent(new Event('click')); // the user presses the play button of the page
    page.videos = [video()]; // the player appears a moment later
    await advance(800); // well before the 1.5 s timer
    expect(host.open).toHaveBeenCalledTimes(1);
  });

  it('another address means another episode: the old subtitles go and the new player is taken', async () => {
    page.videos = [video()];
    const host = makeHost();
    const starter = starterFor(host);
    starter.start();
    await advance(0);
    const first = host.session!.video;

    const next = video();
    page.videos = [next];
    page.href = 'https://site.example/series/2';
    events.dispatchEvent(new Event('popstate'));
    expect(host.closeSession).toHaveBeenCalledTimes(1);
    await advance(300);
    expect(host.session!.video).toBe(next);
    expect(host.session!.video).not.toBe(first);
  });

  it('notices a new address even when no event comes', async () => {
    page.videos = [video()];
    const host = makeHost();
    starterFor(host).start();
    await advance(0);
    page.href = 'https://site.example/series/9';
    await advance(1600); // the timer looks at the address
    expect(host.closeSession).toHaveBeenCalled();
  });

  it('leaves YouTube to its own follower: the same player stays across addresses', async () => {
    page.videos = [video()];
    const host = makeHost();
    starterFor(host).start();
    await advance(0);
    host.session!.isYouTube = true;
    page.href = 'https://www.youtube.com/watch?v=other';
    events.dispatchEvent(new Event('popstate'));
    expect(host.closeSession).not.toHaveBeenCalled();
  });

  it('does not touch the page while the user is picking a player', async () => {
    page.videos = [video()];
    const host = makeHost();
    host.picking = true;
    starterFor(host).start();
    await advance(5000);
    expect(host.open).not.toHaveBeenCalled();
  });

  it('after a failure it waits before trying again, then tries again', async () => {
    page.videos = [video()];
    const host = makeHost({ failOnce: true });
    starterFor(host).start();
    await advance(0);
    expect(host.open).toHaveBeenCalledTimes(1);
    await advance(8000);
    expect(host.open).toHaveBeenCalledTimes(1); // still waiting
    await advance(4000);
    expect(host.open).toHaveBeenCalledTimes(2);
    expect(host.session).not.toBeNull();
  });

  it('a player already taken is asked every few ticks whether it has changed, for as long as it stays', async () => {
    page.videos = [video()];
    const host = makeHost();
    starterFor(host).start();
    await advance(0);
    await advance(10_000);
    const calls = host.session!.recheck as ReturnType<typeof vi.fn>;
    expect(calls.mock.calls.length).toBeGreaterThan(0);
    calls.mockClear();
    await advance(60_000); // a film that starts a minute after the ad is still caught
    expect(calls.mock.calls.length).toBeGreaterThan(0);
    expect(host.open).toHaveBeenCalledTimes(1); // asking does not reopen anything by itself
  });

  it('stops looking after stop()', async () => {
    const host = makeHost();
    const starter = starterFor(host);
    starter.start();
    starter.stop();
    page.videos = [video()];
    events.dispatchEvent(new Event('click'));
    await advance(10_000);
    expect(host.open).not.toHaveBeenCalled();
  });
});
