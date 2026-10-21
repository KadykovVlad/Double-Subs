import { useState } from 'preact/hooks';
import { t, uiLanguage } from '../../src/lib/i18n';
import { requestAllSites, setAccessDismissed } from '../../src/lib/known-sites';
import { chooseUiLanguage, languageName, UI_LANGUAGES } from '../../src/lib/ui-language';
import { useAccessDismissed, useAccount, useAllSitesAllowed } from './hooks';
import { SignInForm } from './SignIn';
import { Button } from './ui';

/** The button that asks for access to all sites (one question of Chrome), or the word that it was given. */
function AllowAccess() {
  const allowed = useAllSitesAllowed();
  const dismissed = useAccessDismissed();
  const [denied, setDenied] = useState(false);

  if (allowed)
    return (
      <span class="done" data-testid="access-allowed">
        {t('welcome_allowed')}
      </span>
    );
  return (
    <>
      <Button
        block
        testid="allow-access"
        disabled={allowed === undefined}
        // The request is the first thing the click does: Chrome wants the user gesture.
        onClick={() => void requestAllSites().then((granted) => setDenied(!granted))}
      >
        {t('welcome_allow')}
      </Button>
      {denied && (
        <p class="small" role="alert" data-testid="access-denied">
          {t('everywhere_denied')}
        </p>
      )}
      {!dismissed && (
        <Button
          variant="ghost"
          size="sm"
          testid="dismiss-access"
          onClick={() => void setAccessDismissed(true)}
        >
          {t('remember_later')}
        </Button>
      )}
    </>
  );
}

/** The language of the interface, as a labelled choice (the small one in the header is easy to miss). */
function LanguageChoice() {
  return (
    <label class="row">
      <span class="grow label">{t('lang_label')}</span>
      <select
        data-testid="onboarding-language"
        aria-label={t('lang_label')}
        value={uiLanguage()}
        onChange={(event) => void chooseUiLanguage(event.currentTarget.value)}
      >
        {UI_LANGUAGES.map((option) => (
          <option key={option} value={option}>
            {languageName(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** What the panel shows before anybody is signed in: the language, access to the sites, the sign-in. */
export function Onboarding() {
  const account = useAccount();
  return (
    <div class="content" id="panel">
      <section class="card gate" data-testid="gate">
        <h2>{t('welcome_title')}</h2>
        <LanguageChoice />
        <div class="step">
          <h3>{t('welcome_access_title')}</h3>
          <p class="small">{t('welcome_access_text')}</p>
          <AllowAccess />
        </div>
        <div class="step">
          <h3>{t('welcome_signin_title')}</h3>
          {account ? (
            <span class="done" data-testid="account-email">
              {t('account_signed_in', account.email)}
            </span>
          ) : (
            <>
              <p class="small">{t('gate_text')}</p>
              <SignInForm />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
