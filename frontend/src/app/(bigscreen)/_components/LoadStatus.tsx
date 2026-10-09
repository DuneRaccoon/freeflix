'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

import { useFocusGrid } from '../_focus/useFocusGrid';
import { TitleScreen } from './TitleScreen';

const HOME = '/bigscreen';

/**
 * The loading and failed states both detail screens share.
 *
 * Extracted because a page file cannot export a component, so the movie and show screens
 * each had their own copy — and two copies of a FOCUS-CRITICAL component drift. Everything
 * here exists because of a defect found on this surface:
 *
 * - `apiClient` sets no timeout, so a hung request would otherwise leave a screen reading
 *   "Loading…" with no way to act. The patience timer offers a retry anyway.
 * - The timer restarts after every press, so a retry that itself hangs can be retried
 *   rather than dead-ending on "Trying again…".
 * - A press while a retry is in flight is refused, and the label SAYS so — a control that
 *   silently ignores a press is a defect this project has shipped twice and caught twice.
 * - The retry button takes `autoFocus` because it arrives while focus is on Back and
 *   becomes the grid's (0, 0): nothing else would move DOM focus onto it.
 * - Back is always present, so no state here renders without a focus target. On a remote
 *   there is no Tab and no pointer, so a ringless screen cannot be recovered from.
 */
export function LoadStatus({
  failed,
  onRetry,
  /** "movie" or "show": the only thing that differed between the two copies. */
  noun,
  patienceMs,
}: {
  failed: boolean;
  onRetry: () => void;
  noun: string;
  patienceMs: number;
}) {
  const [waited, setWaited] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    setWaited(false);
    const timer = setTimeout(() => setWaited(true), patienceMs);
    return () => clearTimeout(timer);
  }, [round, patienceMs]);

  const showRetry = failed || waited || pressed;
  const retryable = failed || waited;
  const grid = useFocusGrid({ rowCounts: [showRetry ? 2 : 1] });

  const press = () => {
    if (!retryable) return; // the label says "Trying again…"; a press has nothing to add
    setPressed(true);
    setRound((r) => r + 1);
    onRetry();
  };

  return (
    <TitleScreen
      art={null}
      title={failed ? `Couldn’t load this ${noun}` : 'Loading…'}
      overview={null}
      actions={
        <>
          {showRetry && (
            <button type="button" className="bs-btn" autoFocus {...grid.focusProps(0, 0)} onClick={press}>
              {retryable ? 'Try again' : 'Trying again…'}
            </button>
          )}
          <Link href={HOME} className="bs-btn bs-btn--ghost" draggable={false} {...grid.focusProps(0, showRetry ? 1 : 0)}>
            Back
          </Link>
          {failed ? (
            <p role="alert" className="bs-title__alert">
              Check that the box is reachable, then try again.
            </p>
          ) : (
            <p role="status" className="bs-title__note">
              Loading this {noun}…
            </p>
          )}
        </>
      }
    />
  );
}
