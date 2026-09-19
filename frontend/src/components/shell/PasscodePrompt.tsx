'use client';
import React, { useState } from 'react';
import Modal from '@/components/ui/fre/Modal';
import { cn } from '@/lib/cn';
import { BackspaceIcon } from '@heroicons/react/24/outline';

interface PasscodePromptProps {
  open: boolean;
  profileName: string;
  /** Digit count from the profile's settings — the code itself never reaches the browser. */
  length: number;
  onClose: () => void;
  /** Verifies server-side; resolves true when the code was accepted. */
  /** `true` accepts and closes. `false` means the code was wrong. A string is shown
   *  verbatim instead — used for a throttled attempt, which is NOT a wrong code. */
  onSubmit: (code: string) => Promise<boolean | string>;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

const PasscodePrompt: React.FC<PasscodePromptProps> = ({ open, profileName, length, onClose, onSubmit }) => {
  const [entry, setEntry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const len = length || 4;

  const close = () => { setEntry(''); setError(null); onClose(); };

  const press = async (k: string) => {
    if (checking || k === '') return;
    if (k === 'del') { setError(null); setEntry(e => e.slice(0, -1)); return; }
    if (entry.length >= len) return;
    const next = entry + k;
    setError(null);
    setEntry(next);
    if (next.length < len) return;

    setChecking(true);
    try {
      const result = await onSubmit(next);
      // On success the caller swaps this modal away; clearing keeps a re-open clean.
      setEntry('');
      if (result !== true) {
        setError(typeof result === 'string' ? result : 'Incorrect passcode');
      }
    } catch {
      setEntry('');
      setError('Incorrect passcode');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal open={open} onClose={close} label={`Enter passcode for ${profileName}`}>
      <div className="text-center">
        <h2 className="font-display text-2xl text-text">{profileName}</h2>
        <p className="mt-1 font-ui text-sm text-muted">Enter your passcode</p>

        <div className={cn('mt-5 flex justify-center gap-3', error && 'animate-pulse')} aria-hidden="true">
          {Array.from({ length: len }).map((_, i) => (
            <span key={i} className={cn(
              'h-3 w-3 rounded-full border',
              error ? 'border-danger' : i < entry.length ? 'border-gold bg-gold' : 'border-hairline bg-transparent',
            )} />
          ))}
        </div>

        {error && <p role="alert" className="mt-3 font-ui text-sm text-danger">{error}</p>}

        <div className="mx-auto mt-6 grid max-w-[240px] grid-cols-3 gap-3">
          {KEYS.map((k, i) =>
            k === '' ? <span key={i} /> : (
              <button
                key={i}
                type="button"
                aria-label={k === 'del' ? 'Delete' : k}
                disabled={checking}
                onClick={() => { void press(k); }}
                className={cn(
                  'grid h-14 place-items-center rounded-full border border-hairline bg-surface-2 font-ui text-lg text-text',
                  'transition-colors hover:border-gold/50 active:bg-gold/10',
                  'disabled:opacity-50',
                  'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                )}
              >
                {k === 'del' ? <BackspaceIcon className="h-5 w-5" /> : k}
              </button>
            ),
          )}
        </div>
      </div>
    </Modal>
  );
};

export default PasscodePrompt;
