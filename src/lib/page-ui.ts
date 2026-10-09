/** Top-most layer: our UI must stay above player controls. */
const Z_TOP = '2147483647';

/** A host element with an open shadow root, so page styles cannot leak into our UI. */
export function createShadowHost(name: string): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement(name);
  host.style.cssText = `all: initial; position: fixed; inset: 0; pointer-events: none; z-index: ${Z_TOP};`;
  const root = host.attachShadow({ mode: 'open' });
  document.documentElement.append(host);
  return { host, root };
}
