import { useState } from 'preact/hooks';
import { AccountError, signIn } from '../../src/lib/account';
import { t } from '../../src/lib/i18n';
import { Button } from './ui';

/** The button that signs in with Google, and what went wrong when it did not. Used by the gate and the welcome page. */
export function SignInForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enter = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn();
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
      <Button block testid="sign-in" disabled={busy} onClick={() => void enter()}>
        {t(busy ? 'account_signing_in' : 'account_sign_in')}
      </Button>
      {error && (
        <p class="small" role="alert" data-testid="account-error">
          {error}
        </p>
      )}
    </>
  );
}
