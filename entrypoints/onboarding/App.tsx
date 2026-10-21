import { useEffect, useState } from 'preact/hooks';
import { t, textDirection, uiLanguage } from '../../src/lib/i18n';
import { watchUiLanguage } from '../../src/lib/ui-language';
import { useAccessDismissed, useAccount, useAllSitesAllowed } from '../sidepanel/hooks';
import { Onboarding } from '../sidepanel/Onboarding';
import { Logo } from '../sidepanel/ui';

const CLOSE_AFTER_MS = 1500;

/** Closes the small window we are in; a tab of a normal window (when the page is opened by hand) is left alone. */
async function closeThisWindow(): Promise<void> {
  const current = await browser.windows.getCurrent().catch(() => null);
  if (current?.type === 'popup' && current.id !== undefined)
    await browser.windows.remove(current.id);
}

/**
 * The small window. It opens by itself after the installation (and on a click on the icon while
 * something is left to do): the language, the sign-in and, if it was taken away, the access to the
 * sites. When all of that is answered it says so and closes; the icon then opens the side panel.
 */
export function App() {
  const [language, setLanguage] = useState(uiLanguage());
  document.documentElement.lang = language;
  document.documentElement.dir = textDirection();
  useEffect(() => watchUiLanguage(setLanguage), []);

  const account = useAccount();
  const allowed = useAllSitesAllowed();
  const dismissed = useAccessDismissed();
  const done = Boolean(account) && (allowed === true || dismissed);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => void closeThisWindow(), CLOSE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [done]);

  return (
    <div class="onboarding">
      <header class="header">
        <Logo />
        <span class="brand">Double Sub</span>
      </header>
      {account === undefined ? null : done ? (
        <p class="card done" data-testid="onboarding-done">
          {t('welcome_done')}
        </p>
      ) : (
        <Onboarding />
      )}
    </div>
  );
}
