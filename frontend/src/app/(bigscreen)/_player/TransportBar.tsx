'use client';
import type { SubtitleCellState } from '../_data/subtitles';
import type { FocusProps } from '../_focus/useFocusGrid';
import type { MediaKeyAction } from '../_focus/useMediaKeys';

/**
 * The transport row: one focus row, one `<button>` per cell, and nothing else.
 *
 * IT OWNS NO FOCUS GRID, AND THAT IS THE WHOLE DESIGN (the `Keyboard.tsx` contract). It
 * takes `focusProps` and the grid row it occupies, and the screen concatenates
 * `transportCellCount` into its own `rowCounts`. A `useFocusGrid` in here would be a
 * defect, not a convenience: the hook's listener is on `window` and checks no scope, and
 * effects register CHILD BEFORE PARENT, so a grid inside this component would claim the
 * arrows and leave the screen's own grid inert.
 *
 * EVERY CELL IS A REAL `<button>`. Neither `useFocusGrid` nor `useMediaKeys` claims Enter
 * (`useFocusGrid.test.tsx:128` pins it), so activation is the browser turning OK into a
 * native click. The web player's `div role="slider"` would be a dead cell on a remote.
 *
 * PLAY/PAUSE IS RELABELLED, NEVER SWAPPED. Two elements swapped by a condition unmount the
 * control the ring is on, which drops DOM focus to `<body>` — and with the row's count
 * unchanged the grid's reconcile effect never re-runs, so nothing brings the ring back.
 *
 * THE ±60s CELLS ARE NOT DECORATION. They are the on-screen twins of the remote's Rewind
 * and Fast-Forward, and `MEDIA_TWINS` is what makes that structural: nothing about this
 * television's key codes has ever been read (`useMediaKeys`' header says so at length), so
 * an unrecognised media button has to degrade into a missing SHORTCUT rather than a missing
 * feature. `MEDIA_TWINS` is a `Record` over the hook's action union, so a seventh action
 * fails `tsc` here until it is given a cell.
 *
 * THE RETRY CELL IS APPENDED LAST, never inserted. The grid calls `go` only when the
 * clamped target CHANGES, so growth at the end never refocuses; a cell inserted at or
 * before the focused column would leave DOM focus on the element that just became column 1
 * while the model still points at column 0, and the next press would appear to do nothing.
 *
 * THE SUBTITLES CELL IS UNCONDITIONAL, and that is the same rule read from the other end.
 * The sidecar list resolves asynchronously, over a band that may already be on screen and
 * may already carry Retry — so a cell that appeared when the list answered would be an
 * insertion at column 4 of a row whose focus may be at column 4 or 5, which is the defect
 * described just above. It is therefore always rendered, in the middle of the row, and only
 * what it SAYS depends on the list. Its state rides in an `aria-hidden` sub-line, because the
 * cell's accessible name has to stay exactly `Subtitles` for the queries in this directory's
 * tests (and for anything that ever reads this surface aloud); the words themselves belong to
 * `_data/subtitles.cellLabel`, which this component does not call and must not second-guess.
 * It has no `MEDIA_TWINS` entry on purpose: no subtitle key code has ever been read off this
 * television (device reading 34), and `MEDIA_TWINS` is keyed on the hook's action union, so
 * the absence costs nothing and claims nothing.
 *
 * Stop is the row's non-Back exit as well as the Stop key's twin: the only key number this
 * project has ever read off the set is 461 for Back, and `useBackKey.ts` records even that
 * as unverified. It reports an action rather than navigating itself, because the position
 * has to be flushed before anything leaves the player (`api-client`'s 401 redirect is the
 * other way the player can be taken out from under itself) and that is the route's job.
 */

/** The cells this row can contain. One id per control, and the ids are the labels' keys. */
export type TransportCellId =
  | 'playPause'
  | 'back10'
  | 'back60'
  | 'forward60'
  | 'subtitles'
  | 'stop'
  | 'retry';

/**
 * What a press MEANS — the cell ids, plus the two DISCRETE transport intents a remote has
 * and a screen does not.
 *
 * A remote has separate ▶ and ⏸ keys; a screen has one control that toggles. Collapsing the
 * three onto the toggle (which is what shipped, and what the branch review measured) means a
 * viewer pressing ▶ on a playing title STOPS it, and ⏸ on a paused one resumes it — a
 * recognised key mapped to the wrong semantic, which `useMediaKeys`' "an unrecognised key is
 * a missing shortcut, never a missing feature" defence does not cover. `play` and `pause` are
 * therefore their own actions, handled idempotently by the consumer, and `TWIN_CELL` below is
 * what keeps the on-screen-twin contract intact: all three still live on the one control.
 */
export type TransportAction = TransportCellId | 'play' | 'pause';

export interface TransportCell {
  id: TransportCellId;
  /** The resting label. Play/Pause's is replaced at render; see `labelFor`. */
  label: string;
  /** Which existing `.bs-btn` dress it wears. No new modifier is added to `.bs-btn`. */
  variant: 'primary' | 'ghost';
}

/**
 * An ARRAY, so the row's count is `cells.length` rather than a number kept beside a layout.
 * The house rule is "declared count equals cells rendered" (`search/page.tsx:56` is a
 * literal `ACTION_CELLS = 2`); this row varies — Retry comes and goes — so it is derived.
 *
 * Play/Pause is first because the scrub row is declared ahead of this one but renders
 * nothing until `loadedmetadata`, so this cell is where the ring lands on arrival.
 */
export const TRANSPORT_CELLS: readonly TransportCell[] = [
  { id: 'playPause', label: 'Pause', variant: 'primary' },
  { id: 'back10', label: 'Back 10s', variant: 'ghost' },
  { id: 'back60', label: 'Rewind 1 min', variant: 'ghost' },
  { id: 'forward60', label: 'Forward 1 min', variant: 'ghost' },
  // IN THE MIDDLE, AND ALWAYS HERE. Not appended, because `RETRY_CELL`'s append is the one
  // growth this row's focus model tolerates and a second appender would make "last" a race;
  // not conditional, because the list it describes resolves while the row is on screen. See
  // the header.
  { id: 'subtitles', label: 'Subtitles', variant: 'ghost' },
  { id: 'stop', label: 'Stop', variant: 'ghost' },
];

/** Offered only when the stream has failed in a way a press can retry. Always LAST. */
export const RETRY_CELL: TransportCell = { id: 'retry', label: 'Try again', variant: 'primary' };

/**
 * What a media key MEANS. A `Record` over the hook's action union, so a seventh media action
 * fails `tsc` here until it has been given one.
 *
 * NOT "which cell it lands on" — that is `TWIN_CELL`. The two were one table and the
 * conflation is what made ▶ pause a playing title.
 */
export const MEDIA_TWINS: Record<MediaKeyAction, TransportAction> = {
  play: 'play',
  pause: 'pause',
  playPause: 'playPause',
  stop: 'stop',
  rewind: 'back60',
  fastForward: 'forward60',
};

/**
 * Which CELL embodies an action — the focusable twin. Play, Pause and the toggle are all the
 * one control, which is why this mapping exists rather than three cells: a screen has no use
 * for two buttons that differ only in which of them is a no-op.
 *
 * A `Record` over the whole action union, so a seventh action fails `tsc` here until it has
 * been given a cell to live on, and `TransportBar.test.tsx` walks it to prove every media key
 * still reaches something a remote can focus.
 */
export const TWIN_CELL: Record<TransportAction, TransportCellId> = {
  playPause: 'playPause',
  play: 'playPause',
  pause: 'playPause',
  back10: 'back10',
  back60: 'back60',
  forward60: 'forward60',
  subtitles: 'subtitles',
  stop: 'stop',
  retry: 'retry',
};

/**
 * What the Subtitles cell SAYS — decided by the screen, rendered verbatim here.
 *
 * TWO FIELDS AND NO LOGIC, deliberately. `note` arrives already rendered (the screen asks
 * `_data/subtitles.cellLabel`), so there is one place the eight phrasings live and this
 * component cannot drift from it; `stateId` is the same answer in machine-readable form, put
 * on the cell as `data-subtitles` so a test can read which state the screen believes it is in
 * without matching prose. A single field would force one of the two to be derived from the
 * other, and a test that re-derived the words it is checking checks nothing.
 *
 * NO LANGUAGE AND NO COUNT. The row is `flex-wrap: nowrap`, so an overflowed cell is one the
 * D-pad can focus and the viewer cannot see; `cellLabel`'s signature (a state and nothing
 * else) is what forecloses interpolating a language into it, and the chosen language is
 * visible in the picker, where there is room for it.
 */
export interface SubtitleCellView {
  stateId: SubtitleCellState;
  note: string;
}

export function transportCells(opts: { retry: boolean }): readonly TransportCell[] {
  return opts.retry ? [...TRANSPORT_CELLS, RETRY_CELL] : TRANSPORT_CELLS;
}

/** What the screen must put in `rowCounts` for this row. */
export function transportCellCount(opts: { retry: boolean }): number {
  return transportCells(opts).length;
}

/** The label a cell wears right now. Only Play/Pause's depends on anything. */
export function labelFor(cell: TransportCell, state: { playing: boolean }): string {
  return cell.id === 'playPause' ? (state.playing ? 'Pause' : 'Play') : cell.label;
}

export function TransportBar({
  row,
  focusProps,
  playing,
  retry = false,
  subtitles,
  onAction,
}: {
  /** The grid row this row occupies; every cell is a column of it. */
  row: number;
  focusProps: (row: number, col: number) => FocusProps;
  /** Drives Play/Pause's label only. */
  playing: boolean;
  /** Append the Retry cell. */
  retry?: boolean;
  /**
   * What the Subtitles cell says. OPTIONAL, and its absence changes nothing about the row:
   * the cell is there either way and simply says nothing, which is what a surface that has
   * not asked for a list yet should show. Optional also because six existing renders in this
   * directory's tests predate it, and a required field would have turned a cell's sub-line
   * into a compile error in files that are not about subtitles at all.
   */
  subtitles?: SubtitleCellView;
  onAction: (action: TransportAction) => void;
}) {
  return (
    <div className="bs-player__row" role="group" aria-label="Playback controls">
      {transportCells({ retry }).map((cell, col) => {
        const view = cell.id === 'subtitles' ? subtitles : undefined;
        return (
          <button
            key={cell.id}
            type="button"
            className={cell.variant === 'ghost' ? 'bs-btn bs-btn--ghost' : 'bs-btn'}
            {...focusProps(row, col)}
            onClick={() => onAction(cell.id)}
            // Absent on every other cell, and absent on this one until the screen has an
            // answer: `undefined` writes no attribute at all, so "no state yet" and "state
            // `loading`" are different things in the DOM as well as in the model.
            data-subtitles={view?.stateId}
          >
            {labelFor(cell, { playing })}
            {/* `aria-hidden` IS LOAD-BEARING, not tidiness: the cell's accessible name is
                computed from its contents, so an announced sub-line would rename the control
                from `Subtitles` to `Subtitles off` — and every exact-name query for it, here
                and in the route's suite, would stop finding it. `.bs-player__commit` is the
                ScrubBar's own sub-line class, reused rather than reinvented, so this adds no
                rule to a stylesheet that is outside PostCSS. */}
            {view !== undefined && (
              <span className="bs-player__commit" aria-hidden="true">
                {view.note}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
