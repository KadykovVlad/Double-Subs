import { useEffect, useState } from 'preact/hooks';
import { useAccount } from '../sidepanel/hooks';
import { SignInForm } from '../sidepanel/SignIn';
import { Button, Card, Logo } from '../sidepanel/ui';
import { t, textDirection, uiLanguage } from '../../src/lib/i18n';
import { ALL_SITES_PATTERN, setMirrorsMode } from '../../src/lib/known-sites';
import { watchUiLanguage } from '../../src/lib/ui-language';

/** The first page after the installation: access to the sites (one click, one Chrome question), then the sign-in. */
export function App() {
  const [language, setLanguage] = useState(uiLanguage());
  document.documentElement.lang = language;
  document.documentElement.dir = textDirection();
  useEffect(() => watchUiLanguage(setLanguage), []);

  const account = useAccount();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    void browser.permissions.contains({ origins: [ALL_SITES_PATTERN] }).then(setAllowed);
  }, []);

  const allow = () => {
    // permissions.request must be the first thing the click does: Chrome wants the user gesture.
    void browser.permissions.request({ origins: [ALL_SITES_PATTERN] }).then(async (granted) => {
      if (granted) await setMirrorsMode(true);
      setAllowed(granted);
    });
  };

  return (
    <main class="welcome">
      <Logo />
      <h1>{t('welcome_title')}</h1>

      <Card class="step">
        <h2>{t('welcome_access_title')}</h2>
        <p class="small">{t('welcome_access_text')}</p>
        {allowed ? (
          <span class="done" data-testid="access-allowed">
            {t('welcome_allowed')}
          </span>
        ) : (
          <Button block testid="allow-access" onClick={allow}>
            {t('welcome_allow')}
          </Button>
        )}
      </Card>

      <Card class="step">
        <h2>{t('welcome_signin_title')}</h2>
        {account === undefined ? null : account ? (
          <>
            <span class="done" data-testid="account-email">
              {t('account_signed_in', account.email)}
            </span>
            <p class="small" data-testid="welcome-done">
              {t('welcome_done')}
            </p>
          </>
        ) : (
          <SignInForm />
        )}
      </Card>
    </main>
  );
}
