import type { SelectedMessage } from '../lib/messages';
import type { StatusMessage } from '../lib/translation-messages';

/** False once the extension was reloaded or removed: this copy of the agent is orphaned and must go quiet. */
export function isExtensionAlive(): boolean {
  try {
    return Boolean(browser.runtime.id);
  } catch {
    return false;
  }
}

/** The side panel, as the agent sees it: it only needs to be told that something changed. */
export class PanelLink {
  /** A player was chosen (by the user or by itself): the panel refreshes its status. */
  selected(): void {
    void browser.runtime
      .sendMessage({ type: 'selected' } satisfies SelectedMessage)
      .catch(() => {});
  }

  /** The translation moved on, or the selection changed. */
  status(): void {
    void browser.runtime.sendMessage({ type: 'status' } satisfies StatusMessage).catch(() => {});
  }
}
