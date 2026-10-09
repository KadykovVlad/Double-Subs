import { describe, expect, it } from 'vitest';
import { mayBeBeforeTheFilm, playerChanged, type PlayerFacts } from '../src/lib/player-state';

const facts = (patch: Partial<PlayerFacts> = {}): PlayerFacts => ({
  src: 'blob:film',
  durationSec: 5400,
  tracks: 2,
  cues: 800,
  files: 0,
  ...patch,
});

describe('playerChanged', () => {
  it('the same player is not a change', () => {
    expect(playerChanged(facts(), facts())).toBe(false);
  });

  it('another source: the film after an ad, or the next episode', () => {
    expect(playerChanged(facts({ src: 'ad.mp4', durationSec: 30 }), facts())).toBe(true);
  });

  it('a track added late, and cues that arrived later', () => {
    expect(playerChanged(facts({ tracks: 0, cues: 0 }), facts())).toBe(true);
    expect(playerChanged(facts({ cues: 0 }), facts())).toBe(true);
  });

  it('the length that became known counts, a refinement of a fraction of a second does not', () => {
    expect(playerChanged(facts({ durationSec: null }), facts())).toBe(true);
    expect(playerChanged(facts({ durationSec: 5400.2 }), facts({ durationSec: 5400.4 }))).toBe(
      false,
    );
    expect(playerChanged(facts({ durationSec: 30 }), facts({ durationSec: 5400 }))).toBe(true);
  });
});

describe('mayBeBeforeTheFilm', () => {
  it('no length yet, or a short clip: the film may be still to come', () => {
    expect(mayBeBeforeTheFilm(facts({ durationSec: null }))).toBe(true);
    expect(mayBeBeforeTheFilm(facts({ durationSec: 30 }))).toBe(true);
  });

  it('a long video is the film', () => {
    expect(mayBeBeforeTheFilm(facts({ durationSec: 1500 }))).toBe(false);
  });
});
