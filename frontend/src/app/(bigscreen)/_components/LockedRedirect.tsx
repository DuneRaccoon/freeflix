'use client';
import Link from 'next/link';

import { useFocusGrid } from '../_focus/useFocusGrid';
import { TitleScreen } from './TitleScreen';

const HOME = '/bigscreen';
const PROFILES = '/bigscreen/profiles';

/**
 * Both ways on from a screen that has nothing to show, in render order. An ARRAY, so the
 * focus count is `WAYS_OUT.length` rather than a hand-written number: this was the one count
 * on My List not derived from the thing it counts, and both `[3]` and `[1]` in its place
 * failed no test — `[3]` parking the model on a cell no element claims, which leaves NOTHING
 * in the tab order two presses of Right after arriving.
 */
export const WAYS_OUT: readonly { href: string; label: string; ghost?: true }[] = [
  { href: PROFILES, label: 'Who’s watching?' },
  { href: HOME, label: 'Back to home', ghost: true },
];

/**
 * Said on the way out, because nothing else in this journey explains itself: the card the
 * viewer pressed has already gone from the screen, the picker is about to appear
 * unannounced, and after unlocking the title is back where it was.
 */
export const LOCKED_NOTE =
  'This profile is locked. Taking you to “Who’s watching?” so you can enter its passcode.';

/**
 * What a detail screen shows between a 423 and the picker arriving.
 *
 * Its own render, never `LoadStatus(failed=false)`: that claimed to be loading a title the
 * screen had already given up on, and after ten seconds grew a `Try again` that asked nothing
 * (the load effect returns early while redirecting), so its label cycled forever. There is no
 * retry here because there is nothing to retry. It also carries no title action, so a locked
 * profile can never be offered Play. Shared by the movie and show screens so they cannot drift.
 */
export function LockedRedirect() {
  const grid = useFocusGrid({ rowCounts: [WAYS_OUT.length] });
  return (
    <TitleScreen
      art={null}
      title="This profile is locked"
      overview={null}
      actions={
        <>
          {WAYS_OUT.map((way, c) => (
            <Link
              key={way.href}
              href={way.href}
              className={way.ghost ? 'bs-btn bs-btn--ghost' : 'bs-btn'}
              draggable={false}
              {...grid.focusProps(0, c)}
            >
              {way.label}
            </Link>
          ))}
          <p role="status" className="bs-title__note">
            {LOCKED_NOTE}
          </p>
        </>
      }
    />
  );
}
