'use client';
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
 * Stop is the row's non-Back exit as well as the Stop key's twin: the only key number this
 * project has ever read off the set is 461 for Back, and `useBackKey.ts` records even that
 * as unverified. It reports an action rather than navigating itself, because the position
 * has to be flushed before anything leaves the player (`api-client`'s 401 redirect is the
 * other way the player can be taken out from under itself) and that is the route's job.
 */

export type TransportAction = 'playPause' | 'back10' | 'back60' | 'forward60' | 'stop' | 'retry';

export interface TransportCell {
  id: TransportAction;
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
  { id: 'stop', label: 'Stop', variant: 'ghost' },
];

/** Offered only when the stream has failed in a way a press can retry. Always LAST. */
export const RETRY_CELL: TransportCell = { id: 'retry', label: 'Try again', variant: 'primary' };

/** Which cell does what a media key asks. Every action has one; that is the point. */
export const MEDIA_TWINS: Record<MediaKeyAction, TransportAction> = {
  play: 'playPause',
  pause: 'playPause',
  playPause: 'playPause',
  stop: 'stop',
  rewind: 'back60',
  fastForward: 'forward60',
};

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
  onAction,
}: {
  /** The grid row this row occupies; every cell is a column of it. */
  row: number;
  focusProps: (row: number, col: number) => FocusProps;
  /** Drives Play/Pause's label only. */
  playing: boolean;
  /** Append the Retry cell. */
  retry?: boolean;
  onAction: (action: TransportAction) => void;
}) {
  return (
    <div className="bs-player__row" role="group" aria-label="Playback controls">
      {transportCells({ retry }).map((cell, col) => (
        <button
          key={cell.id}
          type="button"
          className={cell.variant === 'ghost' ? 'bs-btn bs-btn--ghost' : 'bs-btn'}
          {...focusProps(row, col)}
          onClick={() => onAction(cell.id)}
        >
          {labelFor(cell, { playing })}
        </button>
      ))}
    </div>
  );
}
