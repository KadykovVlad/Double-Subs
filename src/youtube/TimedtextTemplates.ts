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
  /** Requests the player has sent and not had answered yet, by video and track. */
  private readonly pending = new Map<string, Set<string>>();
  private readonly answerWaiters = new Set<() => void>();

  /**
   * The player has just sent this request: its token is known now, a moment (sometimes seconds)
   * before YouTube answers, so the other line can be requested at once. Its answer is awaited.
   */
  sent(url: string): boolean {
    const videoId = videoIdOf(url);
    const track = trackKeyOfUrl(url);
    if (!videoId || !track || !isPlayerTemplate(url)) return false;
    const ofVideo = this.pending.get(videoId) ?? new Set<string>();
    ofVideo.add(track);
    this.pending.delete(videoId); // the newest video goes last
    this.pending.set(videoId, ofVideo);
    for (const old of this.pending.keys()) {
      if (this.pending.size <= KEEP_VIDEOS) break;
      this.pending.delete(old);
    }
    return this.offer(url);
  }

  /** The answer to a request seen on the page (empty when YouTube gave nothing). See offer. */
  answered(url: string, body: string): boolean {
    const videoId = videoIdOf(url);
    const track = trackKeyOfUrl(url);
    if (videoId && track) this.pending.get(videoId)?.delete(track);
    const template = body ? this.offer(url, body) : false;
    this.answerWaiters.forEach((waiter) => waiter());
    return template;
  }

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

  /**
   * The player's answer that gives this line: the very track, or, for YouTube's translation into a
   * language, its translation of any track into it (the player may translate another track than we
   * would). When the player's request for it is still on its way, its answer is waited for, up to
   * `ms`; null when there is none to wait for (the line is then requested by us).
   */
  async lineFromPlayer(videoId: string, pick: TrackPick, ms: number): Promise<string | null> {
    const exact = trackKeyOfPick(pick);
    const fits = (key: string) =>
      key === exact || (pick.tlang !== null && key.endsWith(`|${pick.tlang}`));
    const find = () =>
      this.answer(videoId, pick) ??
      [...(this.answers.get(videoId)?.entries() ?? [])].find(([key]) => fits(key))?.[1];
    const known = find();
    if (known) return known;
    if (![...(this.pending.get(videoId) ?? [])].some(fits)) return null;
    return new Promise((resolve) => {
      const waiter = () => {
        const body = find();
        const waiting = [...(this.pending.get(videoId) ?? [])].some(fits);
        if (body || !waiting) done(body ?? null);
      };
      const done = (body: string | null) => {
        clearTimeout(timer);
        this.answerWaiters.delete(waiter);
        resolve(body);
      };
      const timer = setTimeout(() => done(find() ?? null), ms);
      this.answerWaiters.add(waiter);
    });
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
      this.pending.delete(old);
    }
  }
}
