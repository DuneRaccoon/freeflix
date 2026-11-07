'use client';
import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { BackspaceIcon } from '@heroicons/react/24/outline';

interface NumpadCommon { label: string; error?: string | null; disabled?: boolean }
interface FixedNumpadProps extends NumpadCommon { length: number; onComplete: (code: string) => void }
interface VariableNumpadProps extends NumpadCommon { minLength: number; maxLength: number; onSubmit: (code: string) => void }
export type NumpadProps = FixedNumpadProps | VariableNumpadProps;

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

const keyClass = cn(
  'grid h-14 place-items-center rounded-full border border-hairline bg-surface-2 font-ui text-lg text-text',
  'transition-colors hover:border-gold/50 active:bg-gold/10',
  'disabled:opacity-50',
  'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
);

/**
 * A 3x4 passcode keypad that owns the entry and draws the dots.
 *
 * Fixed mode (`length`) calls `onComplete` once when the entry reaches `length`.
 * Variable mode (`minLength`/`maxLength`) never submits by itself: OK or Enter calls
 * `onSubmit` once the entry is at least `minLength`.
 *
 * The Numpad keeps its entry after a submit. To clear it, the parent remounts it with a new `key`.
 * Physical keys are handled on the root's onKeyDown, never on window, so a field elsewhere on the
 * page keeps its own typing.
 */
export function Numpad(props: NumpadProps) {
  const { label, error, disabled = false } = props;
  const fixed = 'length' in props;
  const max = fixed ? props.length : props.maxLength;
  const min = fixed ? props.length : props.minLength;

  const [entry, setEntry] = useState('');
  // The ref is the source of truth so two quick presses never read a stale entry.
  const entryRef = useRef('');
  const rootRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => { rootRef.current?.focus(); }, []);

  const commit = (next: string) => { entryRef.current = next; setEntry(next); };

  const addDigit = (d: string) => {
    if (disabled || entryRef.current.length >= max) return;
    const next = entryRef.current + d;
    commit(next);
    const p = propsRef.current;
    if ('length' in p && next.length === p.length) p.onComplete(next);
  };
  const del = () => { if (!disabled) commit(entryRef.current.slice(0, -1)); };
  const ok = () => {
    const p = propsRef.current;
    if (disabled || !('minLength' in p) || entryRef.current.length < p.minLength) return;
    p.onSubmit(entryRef.current);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); addDigit(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); del(); }
    else if (e.key === 'Enter' && !fixed) { e.preventDefault(); ok(); }
  };

  const showError = !!error && entry.length === 0;
  const status = fixed ? `${entry.length} of ${max} digits entered` : `${entry.length} digits entered`;

  const digitBtn = (d: string) => (
    <button key={d} type="button" aria-label={d} disabled={disabled} onClick={() => addDigit(d)} className={keyClass}>{d}</button>
  );

  return (
    <div role="group" aria-label={label} tabIndex={-1} ref={rootRef} onKeyDown={onKeyDown} className="text-center outline-none">
      <p className="font-ui text-sm text-muted">{label}</p>
      <p aria-live="polite" className="sr-only">{status}</p>

      <div className={cn('mt-5 flex justify-center gap-3', showError && 'animate-pulse')} aria-hidden="true">
        {Array.from({ length: max }).map((_, i) => {
          const filled = i < entry.length;
          return (
            <span
              key={i}
              data-dot
              {...(filled ? { 'data-filled': '' } : {})}
              className={cn(
                'h-3 w-3 rounded-full border',
                showError ? 'border-danger' : filled ? 'border-gold bg-gold' : 'border-hairline bg-transparent',
              )}
            />
          );
        })}
      </div>

      {showError && <p role="alert" className="mt-3 font-ui text-sm text-danger">{error}</p>}

      <div className="mx-auto mt-6 grid max-w-[240px] grid-cols-3 gap-3">
        {DIGITS.map(digitBtn)}
        {fixed ? <span /> : (
          <button
            type="button"
            aria-label="OK"
            disabled={disabled || entry.length < min}
            onClick={ok}
            className={keyClass}
          >OK</button>
        )}
        {digitBtn('0')}
        <button type="button" aria-label="Delete" disabled={disabled} onClick={del} className={keyClass}>
          <BackspaceIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export default Numpad;
