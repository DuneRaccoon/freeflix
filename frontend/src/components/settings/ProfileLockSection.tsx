'use client';
import React, { useState } from 'react';
import { useUser } from '@/context/UserContext';
import type { UserSettings } from '@/services/users';
import { Button, Numpad } from '@/components/ui/fre';

type Step = 'idle' | 'current' | 'new' | 'confirm';
type Intent = 'set' | 'change' | 'remove';

const MESSAGES = {
  mismatch: "Those didn't match. Start again.",
  wrong: "That isn't the current passcode.",
  throttled: 'Too many attempts. Try again in a few minutes.',
  error: 'Could not save. Try again.',
};

/**
 * Settings → Profile lock: set, change or remove the passcode a profile asks for every
 * time it is chosen. Every numpad is keyed by step plus attempt so each one starts empty.
 */
export default function ProfileLockSection({
  userId,
  settings,
}: {
  userId: string;
  settings: UserSettings | null;
}) {
  const { changePasscode } = useUser();
  const [step, setStep] = useState<Step>('idle');
  const [intent, setIntent] = useState<Intent>('set');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);

  const go = (next: Step, err: string | null = null) => {
    setStep(next);
    setError(err);
    setAttempt((a) => a + 1);
  };

  const begin = (i: Intent) => {
    setIntent(i);
    setCurrent('');
    setChosen('');
    go(i === 'set' ? 'new' : 'current');
  };

  const save = async (body: { current_passcode?: string; new_passcode: string | null }) => {
    setBusy(true);
    try {
      const result = await changePasscode(userId, body);
      if (result === 'ok') go('idle');
      else if (result === 'wrong') go('current', MESSAGES.wrong);
      else go('idle', result === 'throttled' ? MESSAGES.throttled : MESSAGES.error);
    } finally {
      setBusy(false);
    }
  };

  const onCurrent = (code: string) => {
    setCurrent(code);
    if (intent === 'remove') void save({ current_passcode: code, new_passcode: null });
    else go('new');
  };

  const onNew = (code: string) => {
    setChosen(code);
    go('confirm');
  };

  const onConfirm = (code: string) => {
    if (code !== chosen) {
      go('new', MESSAGES.mismatch);
      return;
    }
    void save(intent === 'set' ? { new_passcode: code } : { current_passcode: current, new_passcode: code });
  };

  const key = `${step}-${attempt}`;

  return (
    <div className="rounded-2xl border border-hairline bg-surface-2/60 p-6 space-y-5">
      <h2 className="font-display text-xs font-semibold uppercase tracking-widest text-muted mb-4">
        Profile lock
      </h2>

      {step === 'idle' && (
        <div className="space-y-4">
          <p className="font-ui text-sm text-muted">
            {settings?.has_passcode
              ? 'This profile asks for its passcode every time it is chosen.'
              : 'Ask for a passcode every time this profile is chosen.'}
          </p>
          {error && (
            <p role="alert" className="font-ui text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            {settings?.has_passcode ? (
              <>
                <Button size="sm" onClick={() => begin('change')}>
                  Change passcode
                </Button>
                <Button size="sm" variant="ghost" onClick={() => begin('remove')}>
                  Remove lock
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => begin('set')}>
                Set a passcode
              </Button>
            )}
          </div>
        </div>
      )}

      {step === 'current' && (
        <Numpad
          key={key}
          label="Enter your current passcode"
          length={settings?.passcode_len || 4}
          error={error}
          disabled={busy}
          onComplete={onCurrent}
        />
      )}
      {step === 'new' && (
        <Numpad
          key={key}
          label="Choose a 4–6 digit passcode"
          minLength={4}
          maxLength={6}
          error={error}
          disabled={busy}
          onSubmit={onNew}
        />
      )}
      {step === 'confirm' && (
        <Numpad
          key={key}
          label="Enter it again"
          minLength={4}
          maxLength={6}
          error={error}
          disabled={busy}
          onSubmit={onConfirm}
        />
      )}

      {step !== 'idle' && (
        <div className="flex justify-center">
          <Button size="sm" variant="ghost" onClick={() => go('idle')}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
