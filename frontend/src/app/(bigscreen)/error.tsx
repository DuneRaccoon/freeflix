'use client';

import { useEffect, useRef } from 'react';

/**
 * Error boundary for the whole TV surface.
 *
 * On a television there is no console: without Developer Mode you cannot attach
 * ares-inspect, and an uncaught render error under the App Router shows a blank
 * screen with no way to tell it apart from a dead server or a failed stylesheet.
 * So the message goes on the screen, in 10-foot type, with a focusable retry — a
 * remote can do nothing at all until something has focus.
 *
 * Nested inside (bigscreen)/layout.tsx, so bigscreen.css is already linked and
 * this file adds no styles of its own. Chromium 87 target, same as everything
 * else here; legacy-target.test.ts enforces it.
 */
export default function BigScreenError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const retryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Logged as well as shown, for the case where ares-inspect IS attached.
    console.error('bigscreen render error:', error);
  }, [error]);

  useEffect(() => {
    // preventScroll: giving the remote a focus target must not scroll the message
    // that explains what happened out of view.
    if (retryRef.current) retryRef.current.focus({ preventScroll: true });
  }, []);

  return (
    <div className="bs-error">
      <h1>This screen could not be drawn</h1>
      <p>
        Freeflix hit an error while rendering. Press OK on Try again. If it keeps
        failing, read the message below and use the web app in the meantime.
      </p>
      <pre>
        {error.message ? error.message : 'No message was provided.'}
        {error.digest ? '\ndigest: ' + error.digest : ''}
      </pre>
      <div className="bs-controls">
        <button className="bs-btn" type="button" ref={retryRef} onClick={() => reset()}>
          Try again
        </button>
        <button
          className="bs-btn bs-btn--ghost"
          type="button"
          onClick={() => window.location.reload()}
        >
          Reload the page
        </button>
      </div>
    </div>
  );
}
