'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useFocusGrid } from '../../_focus/useFocusGrid';
import { useBackKey } from '../../_focus/useBackKey';

/**
 * /bigscreen/<anything not built yet> — where Home's cards land until their screens exist.
 *
 * WHY THIS FILE EXISTS. Home's cards link to `/bigscreen/movie/{id}`, `/show/{id}` and
 * `/watch/{id}`, which a later stage builds. Without a route Next serves its bare built-in
 * 404 with no layout and no stylesheet; the TV page unmounts, taking its focus grid AND its
 * Back handler with it, and a remote has nothing left to press. One OK on any card would end
 * the session. This catch-all keeps the viewer inside `(bigscreen)` with something focused.
 *
 * A static segment beats a catch-all, so `/bigscreen/pair`, `/diag` and `/profiles` are
 * untouched, and `/bigscreen` itself is `page.tsx` (a catch-all needs one segment).
 *
 * THE ATTEMPTED PATH IS SHOWN. A catch-all that says only "not built yet" makes a typo
 * (`/bigscreen/profile`, one letter off `profiles`) or a mistyped `href` in a later stage
 * read as a feature that is merely pending. Printing the path lets someone reading it off
 * the screen tell a gap from a mistake. It comes from the segments the route already
 * receives (`useParams`), not `window.location`, so it cannot disagree with what matched.
 *
 * ONE control, wired through the focus grid so the ring is drawn and there is a focus target
 * on mount. Back goes home explicitly: the set's native Back would walk history, and history
 * can lead out of `(bigscreen)`, which a remote cannot type its way back from. `replace`, as
 * the profiles screen does: this is not somewhere to return to.
 */
const HOME = '/bigscreen';

/** `/bigscreen/<segments>`, as the viewer's remote (or a typo) arrived at it. */
function attemptedPath(rest: string | string[] | undefined): string {
  const segments = Array.isArray(rest) ? rest : rest ? [rest] : [];
  return [HOME, ...segments.map(safeDecode)].join('/');
}

// Params may arrive percent-encoded; a malformed escape must not take the screen down.
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export default function NotBuiltYetPage() {
  const router = useRouter();
  useBackKey(() => router.replace(HOME));
  const grid = useFocusGrid({ rowCounts: [1] });
  const attempted = attemptedPath(useParams<{ rest?: string | string[] }>()?.rest);

  return (
    <main className="bs-page">
      <h1>This screen is not built yet</h1>
      <p>Details and playback for this title are coming in a later update to the TV app.</p>
      <p className="bs-pair-url">Looked for {attempted}</p>
      <div className="bs-controls">
        <Link href={HOME} className="bs-btn" draggable={false} {...grid.focusProps(0, 0)}>
          Back to Home
        </Link>
      </div>
    </main>
  );
}
