import { subtitleFileUrls } from './subtitle-files';
import { isSubtitleTrack } from './tracks';

/** What the player looks like from the point of view of the subtitles: when it changes, they must be read again. */
export interface PlayerFacts {
  src: string;
  /** Length in seconds; null until the player knows it (a live stream, or the metadata is not loaded). */
  durationSec: number | null;
  /** Subtitle tracks the player has, and how many cues all of them hold now. */
  tracks: number;
  cues: number;
  /**
   * Subtitle files the page has requested (players that draw their own subtitles), the newest first.
   * The addresses, not their number: the list is capped, so once it is full a file of the next
   * episode would leave a count unchanged.
   */
  files: string;
  /** The addresses of the player's <track> elements: a player may swap them in place and keep their number. */
  trackSources: string;
  /** The first cue of the first track that has cues: another episode with as many cues still starts differently. */
  cueHead: string;
}

export function readPlayerFacts(video: HTMLVideoElement): PlayerFacts {
  const tracks = Array.from(video.textTracks).filter(isSubtitleTrack);
  return {
    src: video.currentSrc || video.src,
    durationSec: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
    tracks: tracks.length,
    cues: tracks.reduce((sum, track) => sum + (track.cues?.length ?? 0), 0),
    files: subtitleFileUrls().join('\n'),
    trackSources: Array.from(video.querySelectorAll('track'))
      .map((track) => track.getAttribute('src') ?? '')
      .join('\n'),
    cueHead: cueHeadOf(tracks),
  };
}

function cueHeadOf(tracks: TextTrack[]): string {
  for (const track of tracks) {
    const cue = track.cues?.[0] as VTTCue | undefined;
    if (cue) return `${cue.startTime}|${cue.text}`;
  }
  return '';
}

/**
 * What to compare against once a reading is over. The facts from before it are kept, so that a change
 * during a long reading still shows up, except for one thing: cues that grew from nothing, and the
 * files the loading of the tracks left in the page's resource list, are the reading's own doing (it is
 * what loads the tracks), not news.
 */
export function factsAfterReading(before: PlayerFacts, after: PlayerFacts): PlayerFacts {
  const grewFromNothing = before.cues === 0 && before.cueHead === '';
  const rest = (facts: PlayerFacts): PlayerFacts => ({ ...facts, cues: 0, cueHead: '', files: '' });
  return grewFromNothing && !playerChanged(rest(before), rest(after)) ? after : before;
}

/** Under this a video is a trailer, an ad or a splash, not the film: the length alone cannot say, so it only softens the message. */
const SHORT_VIDEO_SEC = 90;

/** The player has not started its film yet: no length known, or a short clip that may be an ad before it. */
export function mayBeBeforeTheFilm(facts: PlayerFacts): boolean {
  return facts.durationSec === null || facts.durationSec < SHORT_VIDEO_SEC;
}

/**
 * True when the subtitles must be read again. The length is compared by whole seconds (players
 * refine it a little while loading), and a source that appears from nothing counts too.
 */
export function playerChanged(before: PlayerFacts, now: PlayerFacts): boolean {
  if (before.src !== now.src) return true;
  if (before.tracks !== now.tracks || before.cues !== now.cues || before.files !== now.files)
    return true;
  if (before.trackSources !== now.trackSources || before.cueHead !== now.cueHead) return true;
  const a = before.durationSec === null ? null : Math.round(before.durationSec);
  const b = now.durationSec === null ? null : Math.round(now.durationSec);
  return a !== b;
}
