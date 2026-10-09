import { hasToken, isPlayerTemplate, videoIdOf } from '../lib/youtube';

/**
 * The subtitle requests YouTube's player made, one per video: our template for loading other tracks
 * of that video with the player's token. Requests of anyone else on the page (other extensions) are
 * ignored, and a template that turned out to give nothing can be dropped to wait for a fresh one.
 */
export class TimedtextTemplates {
  private readonly byVideo = new Map<string, string>();
  private readonly listeners = new Set<(videoId: string) => void>();

  /** A request seen on the page. Returns true when it became the template of its video. */
  offer(url: string): boolean {
    const videoId = videoIdOf(url);
    if (!videoId || !isPlayerTemplate(url)) return false;
    // A request with the token is not replaced by one without it.
    const known = this.byVideo.get(videoId);
    if (known && hasToken(known) && !hasToken(url)) return false;
    this.byVideo.set(videoId, url);
    this.listeners.forEach((listener) => listener(videoId));
    return true;
  }

  get(videoId: string): string | null {
    return this.byVideo.get(videoId) ?? null;
  }

  drop(videoId: string): void {
    this.byVideo.delete(videoId);
  }

  onTemplate(listener: (videoId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
