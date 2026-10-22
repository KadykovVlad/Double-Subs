import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newKeys, ToastStore } from '../src/panel/toasts';

describe('panel notifications', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows a notification and takes it away after a while', () => {
    const store = new ToastStore(1000);
    const seen: number[] = [];
    store.subscribe((list) => seen.push(list.length));
    store.show({ tone: 'ok', title: 'Saved' });
    expect(store.list()).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(store.list()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.list()).toHaveLength(0);
    expect(seen).toEqual([1, 0]);
  });

  it('keeps a held notification until it is released', () => {
    const store = new ToastStore(1000);
    const id = store.show({ tone: 'info', title: 'Hi' });
    store.hold(id);
    vi.advanceTimersByTime(5000);
    expect(store.list()).toHaveLength(1);
    store.release(id);
    vi.advanceTimersByTime(1000);
    expect(store.list()).toHaveLength(0);
  });

  it('closes on demand, keeps three at most and shows the same notice once', () => {
    const store = new ToastStore(1000);
    const first = store.show({ tone: 'ok', title: 'a' });
    store.show({ tone: 'ok', title: 'b' });
    store.show({ tone: 'ok', title: 'c' });
    store.show({ tone: 'ok', title: 'd' });
    expect(store.list().map((t) => t.title)).toEqual(['b', 'c', 'd']);
    store.close(first); // already gone: nothing happens
    store.show({ tone: 'ok', title: 'd' });
    expect(store.list().map((t) => t.title)).toEqual(['b', 'c', 'd']);
    store.close(store.list()[0]!.id);
    expect(store.list().map((t) => t.title)).toEqual(['c', 'd']);
  });

  it('finds the words saved since the last look', () => {
    expect(newKeys(['en:a', 'en:b'], ['en:c', 'en:a', 'en:b'])).toEqual(['en:c']);
    expect(newKeys(['en:a'], [])).toEqual([]);
  });
});
