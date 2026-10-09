import { playerChanged, readPlayerFacts, type PlayerFacts } from '../lib/player-state';

const SETTLE_MS = import.meta.env.VITE_DS_E2E ? 150 : 800;

const VIDEO_EVENTS = ['loadstart', 'loadedmetadata', 'durationchange', 'emptied'] as const;

/**
 * Notices that the player is not what it was when its subtitles were read: another source (the film
 * after an ad, the next episode), a subtitle track added late, cues that arrived, a length that became
 * known. It does not read anything itself; it tells the owner to look again, once things have settled.
 */
export class PlayerWatcher {
  private seen: PlayerFacts;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly stops: Array<() => void> = [];

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onChange: () => void,
  ) {
    this.seen = readPlayerFacts(video);
  }

  start(): void {
    const poke = () => this.schedule();
    for (const name of VIDEO_EVENTS) {
      this.video.addEventListener(name, poke);
      this.stops.push(() => this.video.removeEventListener(name, poke));
    }
    const tracks = this.video.textTracks;
    tracks.addEventListener('addtrack', poke);
    tracks.addEventListener('removetrack', poke);
    this.stops.push(
      () => tracks.removeEventListener('addtrack', poke),
      () => tracks.removeEventListener('removetrack', poke),
    );
  }

  /** The player was read just now: what it looked like then is the new point of comparison. */
  markSeen(): void {
    this.seen = readPlayerFacts(this.video);
  }

  /** Compares at once (for the owner's own timer, when no event tells of a change, e.g. cues added by a script). */
  check(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (playerChanged(this.seen, readPlayerFacts(this.video))) this.onChange();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.stops.forEach((stop) => stop());
    this.stops.length = 0;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.check(), SETTLE_MS);
  }
}
