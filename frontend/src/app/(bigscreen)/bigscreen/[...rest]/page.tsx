'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
 * ONE control, wired through the focus grid so the ring is drawn and there is a focus target
 * on mount. Back goes home explicitly: the set's native Back would walk history, and history
 * can lead out of `(bigscreen)`, which a remote cannot type its way back from. `replace`, as
 * the profiles screen does: this is not somewhere to return to.
 */
const HOME = '/bigscreen';

export default function NotBuiltYetPage() {
  const router = useRouter();
  useBackKey(() => router.replace(HOME));
  const grid = useFocusGrid({ rowCounts: [1] });

  return (
    <main className="bs-page">
      <h1>This screen is not built yet</h1>
      <p>Details and playback for this title are coming in a later update to the TV app.</p>
      <div className="bs-controls">
        <Link href={HOME} className="bs-btn" draggable={false} {...grid.focusProps(0, 0)}>
          Back to Home
        </Link>
      </div>
    </main>
  );
}
