/**
 * The notifications of the panel: a short list the panel shows in its corner. Each one goes by itself
 * after a while; the panel holds it while the pointer is on it.
 */
export type ToastTone = 'ok' | 'info' | 'pro';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  text?: string;
  /** A button inside the notification ("Learn more"); pressing it closes the notification too. */
  action?: { label: string; run: () => void };
}

export const TOAST_MS = 5000;
const MAX_TOASTS = 3;

type Listener = (toasts: Toast[]) => void;

export class ToastStore {
  private toasts: Toast[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private next = 1;

  constructor(private readonly lifetime = TOAST_MS) {}

  show(toast: Omit<Toast, 'id'>): number {
    const id = this.next++;
    // The oldest goes when there are too many; the same notice twice in a row is shown once.
    const last = this.toasts[this.toasts.length - 1];
    if (last && last.title === toast.title && last.text === toast.text) this.close(last.id);
    this.toasts = [...this.toasts, { ...toast, id }].slice(-MAX_TOASTS);
    for (const [known, timer] of this.timers)
      if (!this.toasts.some((item) => item.id === known)) {
        clearTimeout(timer);
        this.timers.delete(known);
      }
    this.arm(id);
    this.emit();
    return id;
  }

  close(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const before = this.toasts.length;
    this.toasts = this.toasts.filter((item) => item.id !== id);
    if (this.toasts.length !== before) this.emit();
  }

  /** The pointer is on the notification: it stays until the pointer leaves. */
  hold(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }

  release(id: number): void {
    if (this.toasts.some((item) => item.id === id)) this.arm(id);
  }

  list(): Toast[] {
    return this.toasts;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private arm(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => this.close(id), this.lifetime),
    );
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.toasts);
  }
}

/** The one store of the panel. */
export const toasts = new ToastStore();
export const showToast = (toast: Omit<Toast, 'id'>) => toasts.show(toast);

/** The keys that are in `next` and were not in `prev`: the words saved since the last look. */
export function newKeys(prev: Iterable<string>, next: Iterable<string>): string[] {
  const known = new Set(prev);
  return [...next].filter((key) => !known.has(key));
}
