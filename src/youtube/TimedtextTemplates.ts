import {
  hasToken,
  isPlayerTemplate,
  trackKeyOfPick,
  trackKeyOfUrl,
  videoIdOf,
  type TrackPick,
} from '../lib/youtube';

/** Answers of this many videos are kept: the current one and a few before it. */
const KEEP_VIDEOS = 4;

/**
 * The subtitle requests YouTube's player made, one per video: our template for loading other tracks
 * of that video with the player's token. Requests of anyone else on the page (other extensions) are
 * ignored, and a template that turned out to give nothing can be dropped to wait for a fresh one.
 * The answers the player got are kept too, by video and track: that track needs no request of ours.
 */
export class TimedtextTemplates {
  private readonly byVideo = new Map<string, string>();
  private readonly answers = new Map<string, Map<string, string>>();
  private readonly listeners = new Set<(videoId: string) => void>();

  /** A request seen on the page, with its answer. Returns true when it became the template of its video. */
  offer(url: string, body = ''): boolean {
    const videoId = videoIdOf(url);
    if (!videoId || !isPlayerTemplate(url)) return false;
    if (body) this.keepAnswer(videoId, url, body);
    const known = this.byVideo.get(videoId);
    // The same request again (the player repeats it): nothing new to tell.
    if (known === url) return false;
    // A request with the token is not replaced by one without it.
    if (known && hasToken(known) && !hasToken(url)) return false;
    this.byVideo.set(videoId, url);
    this.listeners.forEach((listener) => listener(videoId));
    return true;
  }

  get(videoId: string): string | null {
    return this.byVideo.get(videoId) ?? null;
  }

  /** What the player got for this very track of this video, if it asked for it. */
  answer(videoId: string, pick: TrackPick): string | null {
    return this.answers.get(videoId)?.get(trackKeyOfPick(pick)) ?? null;
  }

  drop(videoId: string): void {
    this.byVideo.delete(videoId);
  }

  onTemplate(listener: (videoId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private keepAnswer(videoId: string, url: string, body: string): void {
    const track = trackKeyOfUrl(url);
    if (!track) return;
    const ofVideo = this.answers.get(videoId) ?? new Map<string, string>();
    ofVideo.set(track, body);
    this.answers.delete(videoId); // the newest video goes last
    this.answers.set(videoId, ofVideo);
    for (const old of this.answers.keys()) {
      if (this.answers.size <= KEEP_VIDEOS) break;
      this.answers.delete(old);
    }
  }
}
