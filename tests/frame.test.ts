import { describe, expect, it } from 'vitest';
import { describeFrame } from '../src/lib/frame';

describe('describeFrame', () => {
  it('detects the top frame', () => {
    const self = {};
    const win = { top: self, self, location: { origin: 'https://example.com' } };
    expect(describeFrame(win as never)).toBe('top frame, https://example.com');
  });

  it('detects an iframe', () => {
    const win = { top: {}, self: {}, location: { origin: 'https://cdn.example.com' } };
    expect(describeFrame(win as never)).toBe('iframe, https://cdn.example.com');
  });
});
