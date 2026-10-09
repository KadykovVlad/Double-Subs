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
  /** Subtitle files the page has requested (players that draw their own subtitles). */
  files: number;
}

export function readPlayerFacts(video: HTMLVideoElement): PlayerFacts {
  const tracks = Array.from(video.textTracks).filter(isSubtitleTrack);
  return {
    src: video.currentSrc || video.src,
    durationSec: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
    tracks: tracks.length,
    cues: tracks.reduce((sum, track) => sum + (track.cues?.length ?? 0), 0),
    files: subtitleFileUrls().length,
  };
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
  const a = before.durationSec === null ? null : Math.round(before.durationSec);
  const b = now.durationSec === null ? null : Math.round(now.durationSec);
  return a !== b;
}
