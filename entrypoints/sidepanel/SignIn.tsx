import { useState } from 'preact/hooks';
import { AccountError, requestSignIn } from '../../src/lib/account';
import { t } from '../../src/lib/i18n';
import { useSignInState } from './hooks';
import { Button } from './ui';

/** The button that signs in with Google, and what went wrong when it did not. Used by the small window and the panel. */
export function SignInForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The background keeps the progress: a window opened while a sign-in runs (or after one failed) shows it.
  const shared = useSignInState();
  const running = busy || (shared !== null && 'running' in shared);
  const failure =
    error ??
    (shared !== null && 'error' in shared
      ? t(shared.error === 'network' ? 'account_error_network' : 'account_error')
      : null);

  const enter = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestSignIn();
    } catch (failure) {
      const code = failure instanceof AccountError ? failure.code : 'server';
      // Closing the Google window is the user's choice, not an error.
      if (code !== 'cancelled')
        setError(t(code === 'network' ? 'account_error_network' : 'account_error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button block testid="sign-in" disabled={running} onClick={() => void enter()}>
        {t(running ? 'account_signing_in' : 'account_sign_in')}
      </Button>
      {failure && !running && (
        <p class="small" role="alert" data-testid="account-error">
          {failure}
        </p>
      )}
    </>
  );
}
