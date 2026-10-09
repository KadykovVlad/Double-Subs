import {
  BAR_WIDTH,
  BOTTOM_OFFSET,
  FONT_SIZE,
  OFFSET_X,
  TRANSLATION_SIZE,
  type Settings,
} from '../lib/settings';
import { clamp } from './panel-options';

export interface GestureHost {
  video: HTMLVideoElement;
  settings(): Settings;
  /** Changes the settings on screen only (every pointer move); nothing is stored yet. */
  preview(patch: Partial<Settings>): void;
  /** The gesture is over: store the result once. */
  commit(patch: Partial<Settings>): void;
}

/** Follows one pointer from press to release on `target`, with pointer capture. */
function followPointer(
  target: HTMLElement,
  event: PointerEvent,
  onMove: (move: PointerEvent) => void,
  onEnd: () => void,
): void {
  target.setPointerCapture(event.pointerId);
  const end = () => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
    onEnd();
  };
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

/**
 * The gestures on the bar itself: the handle moves it over the video; the side edges set its width
 * (it stays centred, so both sides move) and the top edge sets the text size. While one is going on
 * `active` is true, so the bar does not hide and storage echoes do not fight the pointer.
 */
export class BarGestures {
  active = false;

  constructor(
    private readonly bar: HTMLElement,
    private readonly host: GestureHost,
  ) {
    bar.querySelector<HTMLElement>('.grip')!.addEventListener('pointerdown', this.onGrip);
    for (const edge of bar.querySelectorAll<HTMLElement>('.edge'))
      edge.addEventListener('pointerdown', (event) => this.onEdge(edge, event));
  }

  private videoSize(): DOMRect | null {
    const rect = this.host.video.getBoundingClientRect();
    return rect.width === 0 || rect.height === 0 ? null : rect;
  }

  private readonly onGrip = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = this.videoSize();
    if (!rect) return;
    const grip = event.currentTarget as HTMLElement;
    const { offsetX, bottomOffset } = this.host.settings();
    const start = { x: event.clientX, y: event.clientY, offsetX, bottom: bottomOffset };
    this.active = true;
    grip.classList.add('dragging');

    followPointer(
      grip,
      event,
      (move) =>
        this.host.preview({
          offsetX: clamp(
            start.offsetX + ((move.clientX - start.x) / rect.width) * 100,
            OFFSET_X.min,
            OFFSET_X.max,
          ),
          bottomOffset: clamp(
            start.bottom - ((move.clientY - start.y) / rect.height) * 100,
            BOTTOM_OFFSET.min,
            BOTTOM_OFFSET.max,
          ),
        }),
      () => {
        this.active = false;
        grip.classList.remove('dragging');
        // Stored once, at the end: every frame would flood the storage.
        const { offsetX: x, bottomOffset: y } = this.host.settings();
        this.host.commit({ offsetX: x, bottomOffset: y });
      },
    );
  };

  private onEdge(edge: HTMLElement, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const rect = this.videoSize();
    if (!rect) return;
    const side = edge.dataset.edge!;
    const start = { x: event.clientX, y: event.clientY, ...this.host.settings() };
    this.active = true;
    edge.classList.add('active');
    this.bar.classList.add('resizing');

    followPointer(
      edge,
      event,
      (move) => {
        if (side === 'l' || side === 'r') {
          const grow = ((move.clientX - start.x) / rect.width) * 100 * 2 * (side === 'r' ? 1 : -1);
          this.host.preview({
            barWidth: clamp(Math.round(start.barWidth + grow), BAR_WIDTH.min, BAR_WIDTH.max),
          });
        } else {
          const factor = clamp(1 - (move.clientY - start.y) / (rect.height * 0.3), 0.5, 2);
          this.host.preview({
            fontSize: clamp(Math.round(start.fontSize * factor), FONT_SIZE.min, FONT_SIZE.max),
            translationSize: clamp(
              Math.round(start.translationSize * factor),
              TRANSLATION_SIZE.min,
              TRANSLATION_SIZE.max,
            ),
          });
        }
      },
      () => {
        this.active = false;
        edge.classList.remove('active');
        this.bar.classList.remove('resizing');
        const { barWidth, fontSize, translationSize } = this.host.settings();
        this.host.commit({ barWidth, fontSize, translationSize });
      },
    );
  }
}
