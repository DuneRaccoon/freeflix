'use client';
import React, { useState } from 'react';
import Modal from '@/components/ui/fre/Modal';
import { cn } from '@/lib/cn';
import { BackspaceIcon } from '@heroicons/react/24/outline';

interface PasscodePromptProps {
  open: boolean;
  profileName: string;
  expected: string;
  onClose: () => void;
  onSuccess: () => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

const PasscodePrompt: React.FC<PasscodePromptProps> = ({ open, profileName, expected, onClose, onSuccess }) => {
  const [entry, setEntry] = useState('');
  const [error, setError] = useState(false);
  const len = expected.length || 4;

  const reset = () => { setEntry(''); };

  const press = (k: string) => {
    if (k === '' ) return;
    if (k === 'del') { setError(false); setEntry(e => e.slice(0, -1)); return; }
    if (entry.length >= len) return;
    const next = entry + k;
    setError(false);
    setEntry(next);
    if (next.length === len) {
      if (next === expected) { onSuccess(); reset(); }
      else { setError(true); setEntry(''); }
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); setError(false); onClose(); }} label={`Enter passcode for ${profileName}`}>
      <div className="text-center">
        <h2 className="font-display text-2xl text-text">{profileName}</h2>
        <p className="mt-1 font-ui text-sm text-muted">Enter your passcode</p>

        <div className="mt-5 flex justify-center gap-3" aria-hidden="true">
          {Array.from({ length: len }).map((_, i) => (
            <span key={i} className={cn('h-3 w-3 rounded-full border', i < entry.length ? 'border-gold bg-gold' : 'border-hairline bg-transparent')} />
          ))}
        </div>

        {error && <p className="mt-3 font-ui text-sm text-danger">Incorrect passcode</p>}

        <div className="mx-auto mt-6 grid max-w-[240px] grid-cols-3 gap-3">
          {KEYS.map((k, i) =>
            k === '' ? <span key={i} /> : (
              <button
                key={i}
                type="button"
                aria-label={k === 'del' ? 'Delete' : k}
                onClick={() => press(k)}
                className={cn(
                  'grid h-14 place-items-center rounded-full border border-hairline bg-surface-2 font-ui text-lg text-text',
                  'transition-colors hover:border-gold/50 active:bg-gold/10',
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
