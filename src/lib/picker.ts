import { createShadowHost } from './page-ui';
import { escapeHtml, t } from './i18n';

/**
 * Pick mode: draws a frame with a "choose" label over every given video, plus a hint on top
 * (the popup closes itself in pick mode, so the page has to explain what to do).
 * Our layer sits above the player's own controls, which usually cover the <video> and would
 * swallow clicks. Returns a function that leaves pick mode.
 */
export function startPicking(
  videos: HTMLVideoElement[],
  onPick: (video: HTMLVideoElement) => void,
  onCancel: () => void,
): () => void {
  const { host, root } = createShadowHost('double-sub-picker');
  root.innerHTML = `
    <style>
      .box {
        position: fixed; box-sizing: border-box; pointer-events: auto; cursor: pointer;
        border: 3px solid #8b5cf6; border-radius: 6px; background: rgba(139, 92, 246, 0.18);
        display: flex; align-items: center; justify-content: center;
      }
      .box:hover { background: rgba(139, 92, 246, 0.32); }
      .label {
        padding: 8px 14px; border-radius: 6px; background: #8b5cf6; color: #fff;
        font: 600 15px/1.2 system-ui, sans-serif;
      }
      .hint {
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        padding: 10px 16px; border-radius: 8px; background: rgba(20, 20, 24, 0.92); color: #fff;
        font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        white-space: nowrap;
      }
    </style>
    <div class="hint" role="status">${escapeHtml(t('picker_hint'))}</div>`;

  const boxes = videos.map((video, index) => {
    const box = document.createElement('div');
    box.className = 'box';
    box.dataset.dsPick = String(index);
    box.innerHTML = `<span class="label">${escapeHtml(t('picker_this'))}</span>`;
    box.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onPick(video);
    });
    root.append(box);
    return { video, box };
  });

  const layout = () => {
    for (const { video, box } of boxes) {
      const rect = video.getBoundingClientRect();
      Object.assign(box.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    }
  };

  // Follow scrolling, resizing and player layout changes while pick mode is on.
  let frame = 0;
  const loop = () => {
    layout();
    frame = requestAnimationFrame(loop);
  };
  layout();
  frame = requestAnimationFrame(loop);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onCancel();
  };
  window.addEventListener('keydown', onKey, true);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('keydown', onKey, true);
    host.remove();
  };
}
