import { WORDS_STYLE } from './words-ui';

/** Frosted glass: a translucent grey, the video behind it blurred. */
export const OVERLAY_STYLE = `
  :host { all: initial; }
  .box { position: fixed; overflow: hidden; }
  .bar {
    position: absolute; display: flex; align-items: center; gap: 0.85em; box-sizing: border-box;
    width: var(--bar-width, 70%); max-width: 100%; padding: 0.55em 0.8em 0.55em 0.5em;
    border-radius: calc(1.7em * var(--radius, 1)); color: #fff; pointer-events: auto;
    font-family: var(--font-family, system-ui, sans-serif);
    background: rgb(var(--tint-rgb, 72 72 80) / var(--bar-alpha, 0.5));
    -webkit-backdrop-filter: blur(var(--blur, 28px)) saturate(1.25); backdrop-filter: blur(var(--blur, 28px)) saturate(1.25);
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 0.6em 2em rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.16);
  }
  /* No text: the bar fades out and leaves the layout alone (visibility flips after the fade), so lines come and go smoothly. */
  .bar { transition: opacity 0.14s ease, visibility 0s; }
  .bar.off { opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.14s ease, visibility 0s 0.14s; }
  .grip { display: grid; place-items: center; width: calc(var(--ctl, 24px) * 0.38); font-size: calc(var(--ctl, 24px) * 0.55); align-self: stretch; color: rgba(255, 255, 255, 0.5); cursor: grab; touch-action: none; }
  .grip:hover { color: rgba(255, 255, 255, 0.85); }
  .grip.dragging { cursor: grabbing; }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.14em; text-align: left; }
  .line { max-width: 100%; white-space: normal; text-wrap: pretty; line-height: 1.28; text-shadow: var(--effect, none); }
  .line[hidden] { display: none; }
  .en { font-size: var(--en-size, 22px); font-weight: var(--en-weight, 600); letter-spacing: -0.005em; color: var(--en-color, #fff); }
  .ru { font-size: var(--ru-size, 18px); font-weight: 400; color: var(--ru-color, #e3e3e8); }
  .divider { align-self: stretch; width: 1px; margin: 0.15em 0; background: rgba(255, 255, 255, 0.2); }
  .controls { display: flex; align-items: center; gap: calc(var(--ctl, 24px) * 0.2); }
  .ctl {
    all: unset; box-sizing: border-box; display: grid; place-items: center; width: var(--ctl, 24px); height: var(--ctl, 24px);
    border-radius: 50%; color: rgba(255, 255, 255, 0.9); cursor: pointer;
  }
  .ctl:hover { background: rgba(255, 255, 255, 0.16); }
  .ctl:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.75); outline-offset: 1px; }
  .ctl svg { width: 58%; height: 58%; }
  .ctl.play { width: calc(var(--ctl, 24px) * 1.25); height: calc(var(--ctl, 24px) * 1.25); background: rgba(255, 255, 255, 0.17); }
  .ctl.play:hover { background: rgba(255, 255, 255, 0.28); }
  .ctl.play svg { width: 54%; height: 54%; }
  .ctl.off { color: rgba(255, 255, 255, 0.5); }
  /* A small round cross on the top-right corner: turns the subtitles off (the side panel turns them on). */
  .close {
    all: unset; box-sizing: border-box; position: absolute; top: calc(var(--ctl, 24px) * -0.3); right: calc(var(--ctl, 24px) * -0.3);
    display: grid; place-items: center; width: calc(var(--ctl, 24px) * 0.74); height: calc(var(--ctl, 24px) * 0.74); border-radius: 50%;
    color: rgba(255, 255, 255, 0.85); cursor: pointer; opacity: 0.7; transition: opacity 0.12s, background 0.12s;
    background: rgb(var(--tint-rgb, 72 72 80) / min(1, calc(var(--bar-alpha, 0.5) + 0.25)));
    -webkit-backdrop-filter: blur(var(--blur, 28px)); backdrop-filter: blur(var(--blur, 28px));
    border: 1px solid rgba(255, 255, 255, 0.28); box-shadow: 0 0.2em 0.7em rgba(0, 0, 0, 0.3);
  }
  .bar:hover .close, .close:focus-visible { opacity: 1; }
  .close:hover { background: rgba(255, 255, 255, 0.28); color: #fff; opacity: 1; }
  .close:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.75); outline-offset: 1px; }
  .close svg { width: 62%; height: 62%; }

  /* With the subtitles off: a round button at the bottom right of the video that brings them back. */
  .restore {
    all: unset; box-sizing: border-box; position: absolute; right: 14px; display: grid; place-items: center;
    width: calc(var(--ctl, 24px) * 1.1); height: calc(var(--ctl, 24px) * 1.1); border-radius: 50%; pointer-events: auto;
    color: rgba(255, 255, 255, 0.9); cursor: pointer; opacity: 0.55; transition: opacity 0.12s, background 0.12s;
    background: rgb(var(--tint-rgb, 72 72 80) / min(1, calc(var(--bar-alpha, 0.5) + 0.25)));
    -webkit-backdrop-filter: blur(var(--blur, 28px)); backdrop-filter: blur(var(--blur, 28px));
    border: 1px solid rgba(255, 255, 255, 0.28); box-shadow: 0 0.2em 0.7em rgba(0, 0, 0, 0.3);
  }
  .restore[hidden] { display: none; }
  .restore:hover, .restore:focus-visible { opacity: 1; background: rgba(255, 255, 255, 0.28); color: #fff; }
  .restore:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.75); outline-offset: 1px; }
  .restore svg { width: 60%; height: 60%; }

  .edge { position: absolute; touch-action: none; }
  .edge::after { content: ''; position: absolute; border-radius: 99px; background: rgba(255, 255, 255, 0.9); opacity: 0; transition: opacity 0.12s; box-shadow: 0 0 6px rgba(139, 195, 255, 0.9); }
  .edge:hover::after, .edge.active::after { opacity: 1; }
  .edge.l, .edge.r { top: 14%; bottom: 14%; width: 12px; cursor: ew-resize; }
  .edge.l { left: -5px; } .edge.r { right: -5px; }
  .edge.l::after, .edge.r::after { top: 0; bottom: 0; left: 4px; width: 4px; }
  .edge.t { top: -5px; left: 16%; right: 16%; height: 12px; cursor: ns-resize; }
  .edge.t::after { left: 0; right: 0; top: 4px; height: 4px; }
  .bar:has(.edge:hover), .bar.resizing { border-color: rgba(255, 255, 255, 0.5); }

  .panel {
    position: absolute; display: flex; flex-direction: column; gap: 0.2em; box-sizing: border-box;
    width: 21em; max-width: 96%; padding: 0.4em 0.4em 0.5em; border-radius: 1.1em; color: #fff; pointer-events: auto;
    font-family: ui-sans-serif, system-ui, -apple-system, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
    background: rgb(var(--tint-rgb, 72 72 80) / var(--panel-alpha, 0.66));
    -webkit-backdrop-filter: blur(var(--blur, 28px)) saturate(1.25); backdrop-filter: blur(var(--blur, 28px)) saturate(1.25);
    border: 1px solid rgba(255, 255, 255, 0.2); box-shadow: 0 0.6em 2em rgba(0, 0, 0, 0.28);
  }
  .panel[hidden] { display: none; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 1em; padding: 0.4em 0.7em; border-radius: 0.6em; }
  .row .label { color: rgba(255, 255, 255, 0.92); }
  .sect { display: flex; flex-direction: column; padding-bottom: 0.2em; }
  .sect + .sect { border-top: 1px solid rgba(255, 255, 255, 0.12); padding-top: 0.2em; }
  .sect-title { padding: 0.5em 0.7em 0.1em; color: rgba(255, 255, 255, 0.55); font-size: 0.82em; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
  .swatches { display: flex; align-items: center; gap: 0.4em; }
  .sw { all: unset; box-sizing: border-box; width: 1.25em; height: 1.25em; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.3); cursor: pointer; }
  .sw[aria-pressed='true'] { border-color: #fff; box-shadow: 0 0 0 2px rgba(139, 195, 255, 0.85); }
  .sw:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .color-input { appearance: none; -webkit-appearance: none; width: 1.7em; height: 1.4em; padding: 0; border: 0; border-radius: 0.4em; background: transparent; cursor: pointer; }
  .color-input::-webkit-color-swatch-wrapper { padding: 0; }
  .color-input::-webkit-color-swatch { border: 2px solid rgba(255, 255, 255, 0.3); border-radius: 0.4em; }
  .sel { all: unset; box-sizing: border-box; padding: 0.3em 0.6em; border-radius: 0.5em; background: rgba(255, 255, 255, 0.16); color: #fff; cursor: pointer; }
  .sel option { color: #000; }
  .more, .back { all: unset; box-sizing: border-box; margin: 0.4em 0.4em 0; padding: 0.55em; text-align: center; border-radius: 0.7em; background: rgba(255, 255, 255, 0.14); cursor: pointer; }
  .more:hover, .back:hover { background: rgba(255, 255, 255, 0.26); }
  .more:focus-visible, .back:focus-visible, .sel:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.75); outline-offset: 1px; }
  .switch {
    all: unset; box-sizing: border-box; position: relative; width: 2.4em; height: 1.4em; border-radius: 999px;
    background: rgba(255, 255, 255, 0.22); cursor: pointer; transition: background 0.15s;
  }
  .switch::after {
    content: ''; position: absolute; top: 0.15em; left: 0.15em; width: 1.1em; height: 1.1em; border-radius: 50%;
    background: #fff; transition: transform 0.15s;
  }
  .switch[aria-checked='true'] { background: rgba(139, 195, 255, 0.85); }
  .switch[aria-checked='true']::after { transform: translateX(1em); }
  .switch:focus-visible, .step:focus-visible, .reset:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.75); outline-offset: 1px; }
  .stepper { display: flex; align-items: center; gap: 0.5em; }
  .step, .reset {
    all: unset; box-sizing: border-box; min-width: 1.9em; height: 1.9em; padding: 0 0.6em; display: grid; place-items: center;
    border-radius: 0.55em; background: rgba(255, 255, 255, 0.16); color: #fff; font-weight: 600; cursor: pointer;
  }
  .step:hover, .reset:hover { background: rgba(255, 255, 255, 0.28); }
  .value { min-width: 2.8em; text-align: center; color: rgba(255, 255, 255, 0.85); }

  ${WORDS_STYLE}
`;
