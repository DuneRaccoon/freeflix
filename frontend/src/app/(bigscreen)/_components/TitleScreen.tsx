import type { ReactNode } from 'react';

import { backgroundImageFor } from './css';
import { Header } from './Header';
import type { FocusProps } from '../_focus/useFocusGrid';

/**
 * The frame both detail screens (movie, show) share: the top bar, a full-bleed backdrop
 * under a scrim, the title block, then the actions row, then whatever the screen puts below.
 *
 * THE BAR IS HERE, AND IT IS THE FIX FOR A REAL DEAD END. When the bar was added it went on
 * the browsing screens only — home, search, My List — on the reasoning that a title screen
 * is "a flow, not a place" and carries its own way back. That was wrong in the one case that
 * matters: the show screen's "Back to home" is one arm of a ternary and is REPLACED by the
 * primary action as soon as an episode resolves, and the movie screen never had one at all.
 * So on the normal path — a title with something to play — the only way out was the remote's
 * Back key, whose identity on this television is still unverified (see `useBackKey`), and
 * the Magic Remote is a pointer. Reported from the living room as "show/movie pages have no
 * way to return to the main menu".
 *
 * Rendering it HERE rather than in the two screens is deliberate: a third detail screen
 * cannot be written that forgets it.
 *
 * WHO GETS IT: whoever passes `focusPropsFor`, and the rule is "a screen the viewer BROWSES
 * on". The two title screens do. The three status frames built from this one — `LoadStatus`,
 * `LockedRedirect` and the player's `Gone` — do not, and must not: each already renders its
 * own named ways out (`WAYS_OUT`, `GONE_WAYS_OUT`, the retry), each owns a row model that
 * starts its actions at row 0, and two of them are transient. They were never the dead end;
 * they are the screens that already had the thing the title screens were missing.
 *
 * ROW 0 IS THE BAR when there is one. `actions` is then row 1 and `below` is rows 2+, and
 * the screen reports those counts to its one `useFocusGrid` along with `HEADER_CELLS` for
 * the bar. Without it, `actions` is row 0 as before. Anything passed as `actions` must never
 * unmount while it holds focus; an unmounted focused control drops DOM focus to <body> with
 * nothing to bring it back on a remote.
 *
 * It takes `focusPropsFor` rather than owning a grid: the hook listens on `window` and only
 * one instance may be live per screen.
 *
 * The art is taken as given. The caller upgrades it to `w1920` (`atSize`) so this frame
 * stays free of image policy. It is an inline `background-image`, quoted with
 * JSON.stringify so a stray quote or paren cannot end the `url()`.
 */
export function TitleScreen({
  art,
  eyebrow,
  title,
  overview,
  actions,
  below,
  focusPropsFor,
}: {
  art: string | null;
  eyebrow?: string | null;
  title: string;
  overview: string | null;
  /** Row 1 with a bar above, row 0 without. */
  actions: ReactNode;
  /** The rows after `actions`: an episode list, or nothing on a movie. */
  below?: ReactNode;
  /** The screen's own grid, for the bar at row 0. Omitted by the status frames; see above. */
  focusPropsFor?: (row: number, col: number) => FocusProps;
}) {
  return (
    <div className="bs-shell">
      {/* No `pathname`: a title screen is in no section of the menu, and `Header` marks
          nothing when it is not told where it is. */}
      {focusPropsFor ? <Header row={0} focusPropsFor={focusPropsFor} /> : null}
      <div className="bs-shell__scroll">
        <section className="bs-title">
          {art && <div className="bs-title__art" style={{ backgroundImage: backgroundImageFor(art) }} aria-hidden="true" />}
          <div className="bs-title__scrim" aria-hidden="true" />
          <div className="bs-title__body">
            {eyebrow ? <p className="bs-title__eyebrow">{eyebrow}</p> : null}
            <h1 className="bs-title__name">{title}</h1>
            {overview ? <p className="bs-title__overview">{overview}</p> : null}
            <div className="bs-title__actions">{actions}</div>
          </div>
        </section>
        {below ? <div className="bs-title__below">{below}</div> : null}
      </div>
    </div>
  );
}
