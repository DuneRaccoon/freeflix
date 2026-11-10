'use client';
import type { FocusProps } from '../_focus/useFocusGrid';

/**
 * The player's on-screen way back: one `<button>` at the top-left safe inset, named for the
 * title it returns to (`‹ The Boys`), or `Home` when the player knows no title.
 *
 * IT OWNS NO FOCUS GRID AND NO KEY HOOK, for the reason every component in this directory
 * gives: only one `useFocusGrid` may be live per screen, and effects register CHILD BEFORE
 * PARENT, so a grid or a `useBackKey` in here would claim the press before the route's own
 * ever saw it. It takes `focusProps` and the grid row it occupies — row 0, above the scrub row
 * — and the route puts `BACK_TO_TITLE_CELLS` first in its `rowCounts`.
 *
 * IT NAVIGATES NOTHING. A press is REPORTED (`onExit`), because the position has to be
 * flushed before anything leaves the player and that is the route's `leave`. The href and the
 * label come from one place in the route (`_data/titleHref.titleExitOf`) and are the same
 * exit the remote's last Back rung, Stop and its media key all use, so this control cannot
 * say one title and open another.
 *
 * IT FADES WITH THE BAND, ON THE BAND'S FLAG, AND THE FADE IS PAINT ONLY. The wrapper takes
 * `bs-player__back--hidden`, which the stylesheet makes `opacity: 0` and nothing else: this
 * control holds focus whenever the viewer has pressed Up to it, and `hidden`, `inert`,
 * `aria-hidden` and unmounting would all blur it — with the grid's counts unchanged nothing
 * brings the ring back on a surface with no Tab key. So the button keeps its `tabindex` and
 * its name while it is invisible, exactly as the band's controls do.
 *
 * THE RING MUST NEVER LAND HERE BY ITSELF, because an OK on it leaves the film. That is not
 * this component's to enforce — the route's `initialRow` keeps arrival and a recovery off it,
 * and its close move keeps the subtitle picker's exit off it — but it is why this is row 0
 * and not part of the transport row: it is reached only by an Up press, the one direction a
 * viewer pressing for the controls has no reason to make by accident.
 *
 * THE CHEVRON IS `aria-hidden`, so the control's accessible name is the title alone — the
 * name the route's suite finds it by, and what anything reading the screen aloud would say.
 * A long title is clipped to one line by `.bs-player__back-name` rather than wrapped down
 * over the picture.
 *
 * THE GAP BETWEEN THEM IS THE STYLESHEET'S. `.bs-btn` is `inline-flex`, so the two spans are
 * flex items, and a white-space text run between flex items is never drawn. A space typed
 * between them here would draw nothing; the name's own margin is the gap.
 */

/** The cells this control occupies in its grid row. One: there is one way back. */
export const BACK_TO_TITLE_CELLS = 1;

export function BackToTitle({
  row,
  focusProps,
  label,
  visible,
  onExit,
}: {
  /** The grid row this control occupies; it is column 0 of it. */
  row: number;
  focusProps: (row: number, col: number) => FocusProps;
  /** Where it goes, in words: the title's name, or `Home`. Rendered verbatim. */
  label: string;
  /** The band's own flag. False fades it; it is never unmounted for that. */
  visible: boolean;
  /** A press. The route flushes the position and leaves. */
  onExit: () => void;
}) {
  return (
    <div className={visible ? 'bs-player__back' : 'bs-player__back bs-player__back--hidden'}>
      <button type="button" className="bs-btn bs-btn--ghost" {...focusProps(row, 0)} onClick={onExit}>
        <span aria-hidden="true">‹</span>
        <span className="bs-player__back-name">{label}</span>
      </button>
    </div>
  );
}
