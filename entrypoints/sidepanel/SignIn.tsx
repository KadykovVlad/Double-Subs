import { useEffect, useRef, useState } from 'preact/hooks';
import {
  AccountError,
  cancelTelegramSignIn,
  pendingTelegramLogin,
  PROVIDERS,
  requestSignIn,
  sendEmailCode,
  startTelegramSignIn,
  verifyEmailCode,
  waitForTelegram,
  type AccountErrorCode,
  type Provider,
  type TelegramLogin,
} from '../../src/lib/account';
import { t, type MessageKey } from '../../src/lib/i18n';
import { Button } from './ui';

/** What the user is told for each failure; closing the Google window is their choice, not an error. */
const ERROR_TEXT: Partial<Record<AccountErrorCode, MessageKey>> = {
  network: 'account_error_network',
  bad_email: 'auth_error_bad_email',
  too_many: 'auth_error_too_many',
  bad_code: 'auth_error_bad_code',
  code_expired: 'auth_error_code_expired',
  login_expired: 'auth_error_link_expired',
  identity_taken: 'auth_error_identity_taken',
  provider_taken: 'auth_error_provider_taken',
  last_method: 'auth_error_last_method',
  not_configured: 'auth_error_not_configured',
};

/** The text for a failure, or null when there is nothing to say (the user cancelled). */
export function errorText(failure: unknown): string | null {
  const code = failure instanceof AccountError ? failure.code : 'server';
  if (code === 'cancelled') return null;
  return t(ERROR_TEXT[code] ?? 'account_error');
}

/** The name of a way in as the user knows it. */
export const providerName = (provider: Provider) =>
  provider === 'email' ? t('auth_method_email') : provider === 'google' ? 'Google' : 'Telegram';

type Run = (task: () => Promise<unknown>) => Promise<boolean>;

function GoogleButton({ link, run, busy }: { link: boolean; run: Run; busy: boolean }) {
  return (
    <Button
      block
      testid={link ? 'add-google' : 'sign-in'}
      disabled={busy}
      onClick={() => void run(() => requestSignIn({ link }))}
    >
      {t(link ? 'auth_add_google' : busy ? 'account_signing_in' : 'account_sign_in')}
    </Button>
  );
}

/** An address, then the code from the letter sent to it. */
function EmailForm({ link, run, busy }: { link: boolean; run: Run; busy: boolean }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  const send = async (to: string) => {
    if (await run(() => sendEmailCode(to, { link }))) {
      setSentTo(to.trim());
      setCode('');
    }
  };
  const verify = () => void run(() => verifyEmailCode(sentTo!, code, { link }));

  if (sentTo === null)
    return (
      <form
        class="auth-row"
        onSubmit={(event) => {
          event.preventDefault();
          void send(email);
        }}
      >
        <input
          class="field"
          type="email"
          autocomplete="email"
          placeholder={t('auth_email_placeholder')}
          aria-label={t('auth_email_placeholder')}
          data-testid="email-input"
          value={email}
          onInput={(event) => setEmail(event.currentTarget.value)}
        />
        <button class="btn secondary" type="submit" data-testid="email-send" disabled={busy}>
          {t('auth_email_send')}
        </button>
      </form>
    );

  return (
    <form
      class="auth-code"
      onSubmit={(event) => {
        event.preventDefault();
        verify();
      }}
    >
      <p class="small" data-testid="email-sent">
        {t('auth_email_sent', sentTo)}
      </p>
      <div class="auth-row">
        <input
          class="field"
          inputMode="numeric"
          autocomplete="one-time-code"
          maxLength={7}
          placeholder={t('auth_code_placeholder')}
          aria-label={t('auth_code_placeholder')}
          data-testid="email-code"
          value={code}
          onInput={(event) => setCode(event.currentTarget.value)}
        />
        <button class="btn" type="submit" data-testid="email-verify" disabled={busy}>
          {t('auth_code_submit')}
        </button>
      </div>
      <div class="auth-links">
        <button
          class="link"
          type="button"
          data-testid="email-resend"
          disabled={busy}
          onClick={() => void send(sentTo)}
        >
          {t('auth_email_resend')}
        </button>
        <button
          class="link"
          type="button"
          data-testid="email-change"
          onClick={() => setSentTo(null)}
        >
          {t('auth_email_change')}
        </button>
      </div>
    </form>
  );
}

/**
 * The bot opens in a new tab, and the panel waits for the user to press Start there. A wait that
 * was going on when the panel closed (Telegram took the focus) goes on when it opens again.
 */
function TelegramButton({
  link,
  setError,
}: {
  link: boolean;
  setError: (text: string | null) => void;
}) {
  const [login, setLogin] = useState<TelegramLogin | null>(null);
  const stop = useRef<AbortController | null>(null);

  const wait = (pending: TelegramLogin) => {
    stop.current?.abort();
    const controller = new AbortController();
    stop.current = controller;
    setLogin(pending);
    waitForTelegram(pending, controller.signal)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorText(failure));
      })
      .finally(() => {
        if (stop.current === controller) setLogin(null);
      });
  };

  useEffect(() => {
    void pendingTelegramLogin().then((pending) => {
      if (pending && pending.linking === link) wait(pending);
    });
    return () => stop.current?.abort();
  }, []);

  const begin = async () => {
    setError(null);
    try {
      const started = await startTelegramSignIn({ link });
      void browser.tabs.create({ url: started.link });
      wait(started);
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  if (!login)
    return (
      <Button
        block
        variant="secondary"
        testid={link ? 'add-telegram' : 'telegram-sign-in'}
        onClick={() => void begin()}
      >
        {t(link ? 'auth_add_telegram' : 'auth_telegram')}
      </Button>
    );

  return (
    <div class="auth-wait" data-testid="telegram-waiting">
      <p class="small">{t('auth_telegram_waiting')}</p>
      <div class="auth-links">
        <a
          class="link"
          href={login.link}
          target="_blank"
          rel="noreferrer"
          data-testid="telegram-open"
        >
          {t('auth_telegram_open_again')}
        </a>
        <button
          class="link"
          type="button"
          data-testid="telegram-cancel"
          onClick={() => {
            stop.current?.abort();
            setLogin(null);
            void cancelTelegramSignIn();
          }}
        >
          {t('auth_cancel')}
        </button>
      </div>
    </div>
  );
}

/**
 * The three ways in: Google, a code by email, the Telegram bot. Used by the gate before the panel,
 * and (with `link`) by the account block, to add the ways the account does not have yet.
 */
export function SignInForm({
  link = false,
  providers = PROVIDERS,
}: {
  link?: boolean;
  providers?: readonly Provider[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run: Run = async (task) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const parts = providers.map((provider) =>
    provider === 'google' ? (
      <GoogleButton key="google" link={link} run={run} busy={busy} />
    ) : provider === 'email' ? (
      <EmailForm key="email" link={link} run={run} busy={busy} />
    ) : (
      <TelegramButton key="telegram" link={link} setError={setError} />
    ),
  );

  return (
    <div class="auth">
      {parts.flatMap((part, i) =>
        i === 0
          ? [part]
          : [
              <div class="auth-or" key={`or-${i}`}>
                {t('auth_or')}
              </div>,
              part,
            ],
      )}
      {error && (
        <p class="small error" role="alert" data-testid="account-error">
          {error}
        </p>
      )}
    </div>
  );
}
