'use client';
import { useEffect } from 'react';
import { captureShell, tabStore } from '../_data/shellSession';

/**
 * Captures `?from=app` once, as early as any client code on this surface runs.
 *
 * IT LIVES IN THE LAYOUT, NOT ON HOME. The shell always lands on `/bigscreen`, so capturing on
 * the home screen would work today — and would break silently the first time anything else is
 * made the entry point (a relaunch deep-link, a paired device handing over a title). The layout
 * is the one component every TV route mounts under.
 *
 * It renders nothing. A `<script>` in the layout head would run earlier still, but the layout is
 * a server component and inline script injection is the one thing this surface has no need to
 * start doing: nothing reads the flag before a screen has mounted.
 */
export function ShellFlag() {
  useEffect(() => {
    captureShell(window.location.search, tabStore());
  }, []);
  return null;
}
