import { useEffect, useState } from 'preact/hooks';
import { t, textDirection, uiLanguage } from '../../src/lib/i18n';
import { watchUiLanguage } from '../../src/lib/ui-language';
import { useAccessDismissed, useAccount, useAllSitesAllowed } from '../sidepanel/hooks';
import { Onboarding } from '../sidepanel/Onboarding';
import { Logo } from '../sidepanel/ui';

const CLOSE_AFTER_MS = 1500;

/**
 * The small window under the icon. It opens by itself after the installation (and on a click on the
 * icon while something is left to do): the language, access to the sites, the sign-in. When all of
 * that is answered it says so and closes; the icon then opens the side panel.
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
    const timer = setTimeout(() => window.close(), CLOSE_AFTER_MS);
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
