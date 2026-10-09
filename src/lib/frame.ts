/** Human-readable description of the frame a script runs in (for debug logs). */
export function describeFrame(win: Pick<Window, 'top' | 'self' | 'location'>): string {
  const kind = win.top === win.self ? 'top frame' : 'iframe';
  return `${kind}, ${win.location.origin}`;
}
