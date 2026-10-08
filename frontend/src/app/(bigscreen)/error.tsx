'use client';

import { useEffect } from 'react';
import { useFocusGrid } from './_focus/useFocusGrid';
import { useBackKey } from './_focus/useBackKey';

/**
 * Error boundary for the whole TV surface.
 *
 * On a television there is no console: without Developer Mode you cannot attach
 * ares-inspect, and an uncaught render error under the App Router shows a blank
 * screen with no way to tell it apart from a dead server or a failed stylesheet.
 * So the message goes on the screen, in 10-foot type, with a focusable retry — a
 * remote can do nothing at all until something has focus.
 *
 * BOTH buttons are reachable (one row of two through `useFocusGrid`) and Back is handled.
 * "Try again" only re-renders the same tree, so a deterministic throw simply throws again;
 * "Reload the page" re-fetches everything and is the one that recovers, so a remote that
 * could only ever reach the first would be stuck in a loop.
 *
 * BACK does a full load of the TV home, not `router.replace`. The boundary is what is
 * showing precisely because the React tree is in an unknown state: a hard navigation
 * discards it, works from any route (including home itself, where a client `replace` to
 * the same URL would not reset the boundary), and cannot walk history out of `(bigscreen)`
 * the way the set's native Back would.
 *
 * Nested inside (bigscreen)/layout.tsx, so bigscreen.css is already linked and
 * this file adds no styles of its own. It stays inside the TV performance budget,
 * same as everything else here; legacy-target.test.ts enforces it.
 */
export default function BigScreenError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const grid = useFocusGrid({ rowCounts: [2] });
  useBackKey(() => window.location.assign('/bigscreen'));

  useEffect(() => {
    // Logged as well as shown, for the case where ares-inspect IS attached.
    console.error('bigscreen render error:', error);
  }, [error]);

  return (
    <div className="bs-error">
      <h1>This screen could not be drawn</h1>
      <p>
        Freeflix hit an error while drawing this screen. Press OK to reload, which fetches
        everything again. Try again only re-draws, which helps if the fault was passing.
        Back returns to Home.
      </p>
      <pre>
        {error.message ? error.message : 'No message was provided.'}
        {error.digest ? '\ndigest: ' + error.digest : ''}
      </pre>
      <div className="bs-controls">
        {/* Reload is FIRST, and therefore the one focus lands on. `reset()` only re-renders
            the same tree, so a deterministic render fault throws again and the first control
            a viewer presses would be a no-op loop. Reload re-fetches everything and is the
            one that actually recovers; Try again stays for a fault that was passing. */}
        <button
          className="bs-btn"
          type="button"
          {...grid.focusProps(0, 0)}
          onClick={() => window.location.reload()}
        >
          Reload the page
        </button>
        <button
          className="bs-btn bs-btn--ghost"
          type="button"
          {...grid.focusProps(0, 1)}
          onClick={() => reset()}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
