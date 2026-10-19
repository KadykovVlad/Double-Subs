/**
 * Where an overlay's host element lives. On most sites it sits on the page, fixed over the viewport,
 * and its parts are put at the video's coordinates. Where the site gives a container that moves with
 * the video (YouTube: the player, the reel of a Short), the host lives inside it instead, covering
 * it: when the page scrolls, the browser moves the video and the overlay together, so the overlay
 * cannot lag behind the way coordinates read after the fact do, and it cannot be above the site's own
 * header, which is above that container.
 */
export type OverlayAnchor = () => HTMLElement | null;

/** Above the site's own controls inside the container (YouTube's reach 1001), below its header (2020). */
const ANCHORED_Z = 1500;

const FIXED_STYLE =
  'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
const ANCHORED_STYLE = `all: initial; position: absolute; inset: 0; pointer-events: none; z-index: ${ANCHORED_Z};`;

/**
 * Puts `host` where it belongs and returns whether it is anchored. A fullscreen element that holds
 * the video (and no anchor) takes the host, since a fullscreen <video> shows no children.
 */
export function placeHost(
  host: HTMLElement,
  video: HTMLVideoElement,
  anchor: OverlayAnchor | undefined,
): boolean {
  const container = anchor?.() ?? null;
  const fullscreen = document.fullscreenElement;
  const target =
    container ??
    (fullscreen && fullscreen !== video && fullscreen.contains(video)
      ? fullscreen
      : document.documentElement);
  const style = container ? ANCHORED_STYLE : FIXED_STYLE;
  if (host.style.cssText !== style) host.style.cssText = style;
  if (host.parentNode !== target) target.append(host);
  return container !== null;
}

/** The video's box in the host's own coordinates (the host covers the viewport, or its container). */
export function boxInHost(host: HTMLElement, video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect();
  const origin = host.getBoundingClientRect();
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  };
}
