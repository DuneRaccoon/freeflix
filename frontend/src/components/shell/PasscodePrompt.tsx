'use client';
import React, { useState } from 'react';
import { Modal, Numpad, Field, Input, Button } from '@/components/ui/fre';
import { usersService } from '@/services/users';

interface PasscodePromptProps {
  open: boolean;
  profileId: string;
  profileName: string;
  /** Digit count from the profile's settings — the code itself never reaches the browser. */
  length: number;
  /** Decides what "Forgot code?" does: an owner resets with the account password, anyone else gets an email. */
  accountRole: 'owner' | 'member' | null;
  onClose: () => void;
  /** `true` accepts and closes. `false` means the code was wrong. A string is shown
   *  verbatim instead — used for a throttled attempt, which is NOT a wrong code. */
  onSubmit: (code: string) => Promise<boolean | string>;
  /** Owner reset succeeded: the code is cleared server-side. */
  onReset: () => void;
}

type Mode = 'code' | 'password' | 'emailed';

const QUIET_LINK =
  'font-ui text-sm text-muted underline underline-offset-4 transition-colors hover:text-text ' +
  'disabled:opacity-50 ' +
  'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]';

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

const PasscodePrompt: React.FC<PasscodePromptProps> = ({
  open, profileId, profileName, length, accountRole, onClose, onSubmit, onReset,
}) => {
  const [mode, setMode] = useState<Mode>('code');
  // Bumped after every refused submit: the remount is what clears the Numpad's entry.
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const submitCode = async (code: string) => {
    setChecking(true);
    setError(null);
    setLinkError(null);
    try {
      // On success the caller swaps this modal away.
      const result = await onSubmit(code);
      if (result !== true) {
        setError(typeof result === 'string' ? result : 'Incorrect passcode');
        setAttempt(a => a + 1);
      }
    } catch {
      setError('Incorrect passcode');
      setAttempt(a => a + 1);
    } finally {
      setChecking(false);
    }
  };

  const forgot = async () => {
    setLinkError(null);
    if (accountRole === 'owner') { setMode('password'); return; }
    if (sending) return;
    setSending(true);
    try {
      await usersService.requestPasscodeResetLink(profileId);
      setMode('emailed');
    } catch {
      setLinkError('Could not send the email. Try again.');
    } finally {
      setSending(false);
    }
  };

  const back = () => {
    setMode('code');
    setPassword('');
    setResetError(null);
    setError(null);
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetting) return;
    setResetting(true);
    setResetError(null);
    try {
      await usersService.resetPasscodeWithPassword(profileId, password);
      onReset();
    } catch (err) {
      // Part A answers a throttled attempt with the same 403, so there is no 429 branch.
      setResetError(statusOf(err) === 403 ? 'Incorrect password' : 'Could not reset the passcode. Try again.');
      setResetting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} label={`Enter passcode for ${profileName}`}>
      <div className="text-center">
        <h2 className="font-display text-2xl text-text">{profileName}</h2>

        {mode === 'code' && (
          <div className="mt-1">
            <Numpad
              key={attempt}
              label="Enter your passcode"
              length={length || 4}
              onComplete={(code) => { void submitCode(code); }}
              error={error}
              disabled={checking}
            />
            {linkError && <p role="alert" className="mt-4 font-ui text-sm text-danger">{linkError}</p>}
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={() => { void forgot(); }}
                disabled={checking || sending}
                aria-busy={sending || undefined}
                className={QUIET_LINK}
              >
                Forgot code?
              </button>
            </div>
          </div>
        )}

        {mode === 'password' && (
          // No numpad here, so digits typed into the field cannot feed one.
          <form onSubmit={submitReset} className="mt-5 flex flex-col gap-5 text-left">
            <Field label="Account password" htmlFor="passcode-reset-password" error={resetError ?? undefined}>
              <Input
                id="passcode-reset-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={resetting}
              />
            </Field>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={back} disabled={resetting}>Back</Button>
              <Button type="submit" variant="primary" isLoading={resetting} disabled={!password}>Reset passcode</Button>
            </div>
          </form>
        )}

        {mode === 'emailed' && (
          // No Back: the code the person forgot is still the only thing the numpad accepts.
          <div className="mt-5 flex flex-col items-center gap-5">
            <p className="font-ui text-sm text-muted">Check your email for a link that removes this passcode.</p>
            <Button type="button" variant="primary" onClick={onClose} autoFocus>Done</Button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default PasscodePrompt;
