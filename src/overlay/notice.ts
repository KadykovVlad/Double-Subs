export type NoticeTone = 'ok' | 'info' | 'warn';

export interface Notice {
  /** Shows a short message in the corner of the video; it goes away by itself unless `sticky`. */
  show(text: string, tone: NoticeTone, options?: { sticky?: boolean }): void;
  hide(): void;
  destroy(): void;
}

const VISIBLE_MS = 4500;

const STYLE = `
  :host { all: initial; }
  .box { position: fixed; overflow: hidden; pointer-events: none; }
  .chip {
    position: absolute; top: 12px; right: 12px; display: flex; align-items: center; gap: 8px; max-width: calc(100% - 24px);
    box-sizing: border-box; padding: 6px 14px 6px 8px; border-radius: 99px; color: #fff;
    font: 600 13px/1.35 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    background: rgba(30, 31, 40, 0.66); border: 1px solid rgba(255, 255, 255, 0.18);
    -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3);
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.3);
    opacity: 0; visibility: hidden; transform: translateY(-6px);
    transition: opacity 0.18s ease, transform 0.18s ease, visibility 0s 0.18s;
  }
  .chip.on { opacity: 1; visibility: visible; transform: none; transition: opacity 0.18s ease, transform 0.18s ease; }
  .mark { flex: none; width: 20px; height: 20px; }
  .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #7d92ff; box-shadow: 0 0 0 3px rgba(125, 146, 255, 0.25); }
  .dot.ok { background: #46c98b; box-shadow: 0 0 0 3px rgba(70, 201, 139, 0.25); }
  .dot.warn { background: #f0a63a; box-shadow: 0 0 0 3px rgba(240, 166, 58, 0.25); }
  .text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#4a68f5"/><rect x="7" y="10.5" width="18" height="3.4" rx="1.7" fill="#fff"/><rect x="7" y="17.5" width="11.5" height="3.4" rx="1.7" fill="#fff" opacity="0.7"/></svg>`;

/**
 * A small chip in the corner of the video that says what Double Sub found and does ("Subtitles found
 * · EN + RU", translation progress). It never takes the mouse, so the player stays usable, and in
 * fullscreen it moves into the fullscreen element like the subtitle bar does.
 */
export function createNotice(video: HTMLVideoElement): Notice {
  const host = document.createElement('double-sub-notice');
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLE}</style>
    <div class="box"><div class="chip" role="status" aria-live="polite">${MARK}<span class="dot"></span><span class="text"></span></div></div>`;
  const box = root.querySelector<HTMLElement>('.box')!;
  const chip = root.querySelector<HTMLElement>('.chip')!;
  const dot = root.querySelector<HTMLElement>('.dot')!;
  const text = root.querySelector<HTMLElement>('.text')!;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let shown = false;

  const place = () => {
    const fullscreen = document.fullscreenElement;
    const target =
      fullscreen && fullscreen !== video && fullscreen.contains(video)
        ? fullscreen
        : document.documentElement;
    if (host.parentNode !== target) target.append(host);
  };

  const layout = () => {
    frame = 0;
    const rect = video.getBoundingClientRect();
    box.style.display = rect.width === 0 || rect.height === 0 ? 'none' : '';
    Object.assign(box.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    if (shown) frame = requestAnimationFrame(layout);
  };

  const onFullscreen = () => {
    place();
    layout();
  };
  document.addEventListener('fullscreenchange', onFullscreen);

  const hide = () => {
    clearTimeout(timer);
    shown = false;
    chip.classList.remove('on');
  };

  return {
    show(message, tone, options = {}) {
      clearTimeout(timer);
      place();
      text.textContent = message;
      dot.className = `dot ${tone === 'info' ? '' : tone}`.trim();
      shown = true;
      if (!frame) frame = requestAnimationFrame(layout);
      chip.classList.add('on');
      if (!options.sticky) timer = setTimeout(hide, VISIBLE_MS);
    },
    hide,
    destroy() {
      hide();
      cancelAnimationFrame(frame);
      document.removeEventListener('fullscreenchange', onFullscreen);
      host.remove();
    },
  };
}
