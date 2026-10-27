import { describe, expect, it } from 'vitest';
import {
  factsAfterReading,
  mayBeBeforeTheFilm,
  playerChanged,
  type PlayerFacts,
} from '../src/lib/player-state';

const facts = (patch: Partial<PlayerFacts> = {}): PlayerFacts => ({
  src: 'blob:film',
  durationSec: 5400,
  tracks: 2,
  cues: 800,
  files: '',
  trackSources: 'en.vtt',
  cueHead: '1|Hello',
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

  it('a new subtitle file counts even when the list of files is as long as before (it is capped)', () => {
    const six = (last: string) => ['a', 'b', 'c', 'd', 'e', last].join('\n');
    expect(playerChanged(facts({ files: six('ep1.vtt') }), facts({ files: six('ep2.vtt') }))).toBe(
      true,
    );
    expect(playerChanged(facts({ files: six('ep1.vtt') }), facts({ files: six('ep1.vtt') }))).toBe(
      false,
    );
  });

  it('tracks swapped in place or cues of another episode count when every number stays the same', () => {
    expect(
      playerChanged(facts({ trackSources: 'ep1.vtt' }), facts({ trackSources: 'ep2.vtt' })),
    ).toBe(true);
    expect(playerChanged(facts({ cueHead: '1|Hello' }), facts({ cueHead: '1|Bye' }))).toBe(true);
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

describe('factsAfterReading', () => {
  const empty = facts({ cues: 0, cueHead: '' });

  it('cues that grew from nothing during the reading are its own doing, not a change', () => {
    expect(playerChanged(empty, facts())).toBe(true);
    expect(playerChanged(factsAfterReading(empty, facts()), facts())).toBe(false);
  });

  it('the track files the reading itself made the page request are not news either', () => {
    const loaded = facts({ files: 'en.vtt' });
    expect(playerChanged(factsAfterReading(empty, loaded), loaded)).toBe(false);
  });

  it('a source or tracks that changed during the reading still show as a change', () => {
    const moved = facts({ src: 'blob:next' });
    expect(playerChanged(factsAfterReading(empty, moved), moved)).toBe(true);
    const swapped = facts({ trackSources: 'ep2.vtt' });
    expect(playerChanged(factsAfterReading(empty, swapped), swapped)).toBe(true);
  });

  it('cues that were there and changed are news', () => {
    const next = facts({ cueHead: '1|Bye' });
    expect(playerChanged(factsAfterReading(facts(), next), next)).toBe(true);
  });
});
