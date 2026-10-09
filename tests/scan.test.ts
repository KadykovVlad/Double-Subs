import { describe, expect, it } from 'vitest';
import type { FrameScan } from '../src/lib/messages';
import {
  isSubtitleUrl,
  isVisibleBox,
  originPattern,
  summarizeScans,
  toOrigin,
} from '../src/lib/scan';

const box = { width: 640, height: 360, display: 'block', visibility: 'visible', opacity: '1' };

describe('isVisibleBox', () => {
  it('accepts a player-sized visible box', () => {
    expect(isVisibleBox(box)).toBe(true);
  });

  it('rejects hidden, transparent and tiny boxes', () => {
    expect(isVisibleBox({ ...box, display: 'none' })).toBe(false);
    expect(isVisibleBox({ ...box, visibility: 'hidden' })).toBe(false);
    expect(isVisibleBox({ ...box, opacity: '0' })).toBe(false);
    expect(isVisibleBox({ ...box, width: 0, height: 0 })).toBe(false); // display:none ad video
    expect(isVisibleBox({ ...box, width: 120, height: 90 })).toBe(false);
  });
});

describe('toOrigin', () => {
  it('returns the origin of http(s) URLs', () => {
    expect(toOrigin('https://cdn.example.com:8443/a/b.html?x=1')).toBe(
      'https://cdn.example.com:8443',
    );
  });

  it('returns null for non-web URLs', () => {
    expect(toOrigin('about:blank')).toBeNull();
    expect(toOrigin('javascript:void(0)')).toBeNull();
    expect(toOrigin('not a url')).toBeNull();
  });
});

describe('originPattern', () => {
  it('drops the port, which match patterns do not allow', () => {
    expect(originPattern('http://127.0.0.1:4200')).toBe('http://127.0.0.1/*');
    expect(originPattern('https://cdn.example.com')).toBe('https://cdn.example.com/*');
  });
});

describe('isSubtitleUrl', () => {
  it('recognises subtitle files and YouTube timedtext', () => {
    expect(isSubtitleUrl('https://x.cloud/1/abc/sub_eng-3.vtt?t=token&b=1')).toBe(true);
    expect(isSubtitleUrl('https://x.com/subs/ep1.srt')).toBe(true);
    expect(isSubtitleUrl('https://www.youtube.com/api/timedtext?v=1&lang=en')).toBe(true);
  });

  it('ignores other resources', () => {
    expect(isSubtitleUrl('https://x.com/app.js')).toBe(false);
    expect(isSubtitleUrl('https://x.com/vtt-player.css')).toBe(false);
    expect(isSubtitleUrl('blob:https://x.com/123')).toBe(false);
  });
});

function scan(overrides: Partial<FrameScan>): FrameScan {
  return {
    url: 'https://site.com/',
    origin: 'https://site.com',
    isTop: true,
    videos: [],
    iframes: [],
    subtitleResources: [],
    selected: null,
    translation: null,
    ...overrides,
  };
}

const video = (index: number, visible = true) => ({
  index,
  width: visible ? 640 : 0,
  height: visible ? 360 : 0,
  visible,
  trackCount: 1,
});

const iframe = (origin: string, visible = true) => ({
  url: `${origin}/player.html`,
  origin,
  width: 640,
  height: 360,
  visible,
});

describe('summarizeScans', () => {
  it('lists only visible videos as player candidates', () => {
    const summary = summarizeScans([
      { frameId: 0, scan: scan({ videos: [video(0), video(1, false)] }) },
    ]);
    expect(summary.players).toEqual([{ frameId: 0, origin: 'https://site.com', video: video(0) }]);
  });

  it('reports visible iframes from origins we could not reach, once per origin', () => {
    const summary = summarizeScans([
      {
        frameId: 0,
        scan: scan({
          iframes: [
            iframe('https://cdn.player.com'),
            iframe('https://cdn.player.com'),
            iframe('https://ads.com', false),
            iframe('https://reached.com'),
          ],
        }),
      },
      { frameId: 5, scan: scan({ isTop: false, origin: 'https://reached.com' }) },
    ]);
    expect(summary.unreached.map((i) => i.origin)).toEqual(['https://cdn.player.com']);
  });

  it('remembers an earlier selection', () => {
    const report = {
      tracks: [],
      decision: { case: 'C' as const, en: null, ru: null, translateFrom: null },
    };
    const summary = summarizeScans([
      { frameId: 0, scan: scan({}) },
      { frameId: 3, scan: scan({ origin: 'https://cdn.player.com', selected: report }) },
    ]);
    expect(summary.selected).toEqual({
      frameId: 3,
      origin: 'https://cdn.player.com',
      report,
      translation: null,
    });
  });
});
