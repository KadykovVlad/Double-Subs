import { playerChanged, readPlayerFacts, type PlayerFacts } from '../lib/player-state';

const SETTLE_MS = import.meta.env.VITE_DS_E2E ? 150 : 800;
/**
 * Cues of a track that was just pointed at another file arrive after every event is over, and nothing
 * announces them: the facts are compared now and then, which costs a few property reads.
 */
const POLL_MS = import.meta.env.VITE_DS_E2E ? 300 : 2000;

const VIDEO_EVENTS = [
  'loadstart',
  'loadedmetadata',
  'loadeddata',
  'durationchange',
  'emptied',
] as const;

/**
 * Notices that the player is not what it was when its subtitles were read: another source (the film
 * after an ad, the next episode), a subtitle track added late, cues that arrived, a length that became
 * known. It does not read anything itself; it tells the owner to look again, once things have settled.
 */
export class PlayerWatcher {
  private seen: PlayerFacts;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly stops: Array<() => void> = [];
  private observer: MutationObserver | null = null;

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
    // A player that swaps its <track> elements or their addresses in place, with no event of its own.
    this.observer = new MutationObserver(poke);
    this.observer.observe(this.video, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    const poll = setInterval(() => this.check(), POLL_MS);
    this.stops.push(
      () => clearInterval(poll),
      () => this.observer?.disconnect(),
      () => tracks.removeEventListener('addtrack', poke),
      () => tracks.removeEventListener('removetrack', poke),
    );
  }

  /**
   * The player was read: what it looked like when the reading began is the new point of comparison
   * (a change during a long reading must still show up as a change).
   */
  markSeen(facts: PlayerFacts = readPlayerFacts(this.video)): void {
    this.seen = facts;
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
