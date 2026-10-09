import { describe, expect, it } from 'vitest';
import { chooseAutoPlayer, normalizeKnownSites } from '../src/lib/known-sites';

describe('normalizeKnownSites', () => {
  it('keeps good records and drops garbage', () => {
    const result = normalizeKnownSites({
      a: { origin: 'https://a.example', addedAt: 5, lastUsed: 6, preferredIndex: 2 },
      b: { origin: 'chrome://settings' },
      c: 'text',
      d: { origin: 'https://d.example', preferredIndex: -1 },
    });
    expect(Object.keys(result)).toEqual(['https://a.example', 'https://d.example']);
    expect(result['https://a.example']).toEqual({
      origin: 'https://a.example',
      addedAt: 5,
      lastUsed: 6,
      preferredIndex: 2,
    });
    expect(result['https://d.example']!.preferredIndex).toBeNull();
    expect(normalizeKnownSites(undefined)).toEqual({});
  });
});

describe('chooseAutoPlayer', () => {
  const big = { width: 640, height: 360 };
  it('picks the biggest visible video', () => {
    expect(
      chooseAutoPlayer(
        [
          { index: 0, ...big },
          { index: 1, width: 1280, height: 720 },
        ],
        null,
      ),
    ).toBe(1);
  });
  it('ignores tiny videos such as previews and ad pixels', () => {
    expect(
      chooseAutoPlayer(
        [
          { index: 0, width: 120, height: 68 },
          { index: 1, width: 1, height: 1 },
        ],
        null,
      ),
    ).toBeNull();
    expect(chooseAutoPlayer([], null)).toBeNull();
  });
  it('prefers the video the user picked before when it is still there', () => {
    const list = [
      { index: 0, ...big },
      { index: 1, width: 1280, height: 720 },
    ];
    expect(chooseAutoPlayer(list, 0)).toBe(0);
    expect(chooseAutoPlayer(list, 5)).toBe(1); // that one is gone
  });
});

import { desiredMatches } from '../src/background/AutoScriptRegistry';
import { MIRRORS_PATTERN, type KnownSites } from '../src/lib/known-sites';

describe('desiredMatches', () => {
  const sites: KnownSites = {
    'https://ga.lordfilm5.pro': {
      origin: 'https://ga.lordfilm5.pro',
      addedAt: 1,
      lastUsed: 1,
      preferredIndex: null,
    },
    'http://10.0.0.7:8080': {
      origin: 'http://10.0.0.7:8080',
      addedAt: 1,
      lastUsed: 1,
      preferredIndex: null,
    },
  };
  it('runs on the known sites that have access, ports left out', () => {
    expect(desiredMatches(sites, false, () => true)).toEqual([
      'http://10.0.0.7/*',
      'https://ga.lordfilm5.pro/*',
    ]);
    expect(desiredMatches(sites, false, (p) => p.includes('lordfilm'))).toEqual([
      'https://ga.lordfilm5.pro/*',
    ]);
  });
  it('with mirrors on and access to all sites it runs everywhere', () => {
    expect(desiredMatches(sites, true, () => true)).toContain(MIRRORS_PATTERN);
  });
  it('mirrors without the access given change nothing', () => {
    expect(desiredMatches(sites, true, (p) => p !== MIRRORS_PATTERN)).not.toContain(
      MIRRORS_PATTERN,
    );
  });
  it('nothing known, nothing to run', () => {
    expect(desiredMatches({}, false, () => true)).toEqual([]);
  });
});

import { originsToOffer, webOrigin } from '../src/lib/known-sites';

describe('originsToOffer', () => {
  const site = (origin: string) => ({ origin, addedAt: 1, lastUsed: 1, preferredIndex: null });
  const none = { known: {}, dismissed: [], mirrorsOn: false };

  it('offers the page, and the player when it sits on another site', () => {
    expect(originsToOffer('https://films.example/watch/1', 'https://cdn.player.net', none)).toEqual(
      ['https://films.example', 'https://cdn.player.net'],
    );
    expect(originsToOffer('https://films.example/watch/1', 'https://films.example', none)).toEqual([
      'https://films.example',
    ]);
  });
  it('offers nothing for pages the browser keeps to itself', () => {
    expect(originsToOffer('chrome://extensions', null, none)).toEqual([]);
    expect(originsToOffer(null, null, none)).toEqual([]);
    expect(webOrigin('file:///a.html')).toBeNull();
  });
  it('leaves out the known, and the ones the user refused', () => {
    const context = {
      known: { 'https://films.example': site('https://films.example') },
      dismissed: ['https://cdn.player.net'],
      mirrorsOn: false,
    };
    expect(originsToOffer('https://films.example/x', 'https://cdn.player.net', context)).toEqual(
      [],
    );
  });
  it('with mirrors on, a mirror of a known site is not offered again; with them off it is', () => {
    const known = { 'https://ga.lordfilm5.pro': site('https://ga.lordfilm5.pro') };
    expect(
      originsToOffer('https://lordfilm7.cc/a', null, { known, dismissed: [], mirrorsOn: true }),
    ).toEqual([]);
    expect(
      originsToOffer('https://lordfilm7.cc/a', null, { known, dismissed: [], mirrorsOn: false }),
    ).toEqual(['https://lordfilm7.cc']);
  });
});
