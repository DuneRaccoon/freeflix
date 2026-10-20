'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { FocusProps } from '../_focus/useFocusGrid';

/**
 * The surface's top bar: where you are, and everywhere else you can go.
 *
 * IT SITS IN `.bs-shell__head`, WHICH IS OUTSIDE THE SCROLLER, so it does not move while the
 * rails do — a header that scrolled away would be a row the viewer has to hunt for. That is
 * also why it is not `position: fixed`: `.bs-shell` is already a column of head + scroller,
 * so the head simply stays where it is and costs the scroller its height, with no layer and
 * nothing composited per frame.
 *
 * IT REPLACED A NAV ROW UNDER THE HERO. Home used to carry `NavRow` as its third focus row,
 * below the artwork: everything on this surface except Home was two Downs and a Right away,
 * and no other screen had it at all. A menu belongs at the top, on every browsing screen,
 * which is what this is.
 *
 * ROW 0, AND THE SCREEN LANDS ON ROW 1. Every screen that mounts this declares
 * `HEADER_CELLS` as its first row and passes `initialRow` to `useFocusGrid` so the ring
 * starts on the content. The menu is one Up press from the top of the content, which is
 * where a viewer reaches for it. Without that, every arrival would park the ring on "Home"
 * — and on the home screen that is a control whose own press does nothing.
 *
 * IT OWNS NO FOCUS GRID (the `Keyboard.tsx` contract). `useFocusGrid`'s listener is on
 * `window` and checks no scope, and effects register CHILD BEFORE PARENT, so a grid in here
 * would claim the arrows and leave the screen's own grid inert.
 *
 * THE CURRENT SECTION IS AN ATTRIBUTE, NOT A CLASS. `aria-current="page"` is what a screen
 * reader reads and what the stylesheet colours, so the two cannot disagree — the same device
 * `.bs-show__season[aria-pressed]` uses. The cell is still a real link and still a focus
 * stop: a menu item that refused to be focused because you are already there is a hole in
 * the row that Left and Right fall into.
 */

export interface HeaderTarget {
  href: string;
  label: string;
}

/**
 * The menu, in press order. HOME IS FIRST and is a target like any other: this bar appears
 * on screens that are not home, and "how do I get back" is the question a top bar exists to
 * answer.
 *
 * DIAGNOSTICS IS LAST AND IT STAYS. Nothing else on this surface links to it — the probe
 * page is how the engine, the key codes and the codec support were read off the television
 * in the first place — and a remote cannot type a URL. Last, so it is the furthest thing
 * from an accident.
 */
export const HEADER_TARGETS: readonly HeaderTarget[] = [
  { href: '/bigscreen', label: 'Home' },
  { href: '/bigscreen/search', label: 'Search' },
  { href: '/bigscreen/list', label: 'My List' },
  { href: '/bigscreen/profiles', label: 'Switch profile' },
  { href: '/bigscreen/diag', label: 'Diagnostics' },
];

/** What the screen must put in `rowCounts` for the header's row. */
export const HEADER_CELLS = HEADER_TARGETS.length;

/**
 * Which target a path is on, or -1.
 *
 * EXACT, NOT A PREFIX. `/bigscreen` is a prefix of every other route here, so
 * `startsWith` would mark Home current on the search screen as well — and a bar claiming
 * you are in two places is worse than one claiming nothing. A trailing slash is the one
 * spelling difference worth absorbing, because `next/link` and a hand-typed URL differ by
 * exactly that.
 */
export function currentTarget(pathname: string | null | undefined): number {
  if (!pathname) return -1;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return HEADER_TARGETS.findIndex((t) => t.href === path);
}

export function Header({
  row,
  focusPropsFor,
  pathname,
  children,
}: {
  /** The grid row this bar occupies; every cell is a column of it. */
  row: number;
  focusPropsFor: (row: number, col: number) => FocusProps;
  /** Where the viewer is, for the current-section mark. `usePathname()`, from the screen. */
  pathname?: string | null;
  /**
   * Whatever the screen wants beside the menu — the search query readout, home's exit note.
   * It holds NO focus stop: the row's count is `HEADER_CELLS` and nothing here may add to it.
   */
  children?: ReactNode;
}) {
  const current = currentTarget(pathname);
  return (
    <header className="bs-shell__head bs-head">
      {/* A <p>, not an <h1>: `h1` is a global element rule on this surface (56px display
          face), and the bar is a strip, not a title block. */}
      <p className="bs-head__brand">FREEFLIX</p>
      <nav className="bs-head__nav" aria-label="Freeflix">
        {HEADER_TARGETS.map((t, col) => (
          <Link
            key={t.href}
            href={t.href}
            className="bs-head__item"
            draggable={false}
            aria-current={col === current ? 'page' : undefined}
            {...focusPropsFor(row, col)}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </header>
  );
}
