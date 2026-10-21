'use client';
import type { NextCellStateId } from '../_data/nextEpisode';
import type { SubtitleCellState } from '../_data/subtitles';
import type { FocusProps } from '../_focus/useFocusGrid';
import type { MediaKeyAction } from '../_focus/useMediaKeys';
import { glyphFor } from './glyphs';

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
 * EVERY CELL IS AN ICON IN A CIRCLE, AND ITS NAME IS STILL IN THE DOM. Seven rectangles of
 * prose is what a desktop player looks like; a television's transport is glyphs, which is also
 * what the remote's own keys are. So each cell draws an inline SVG (`glyphs.tsx` — no text
 * inside it, ever, and no filter) and the WORD it carries is revealed by `:focus` in the
 * stylesheet. Revealed by OPACITY, never by mounting it: the label is this control's
 * accessible name, so `display: none` would take `getByRole('button', { name: 'Pause' })` away
 * from every test in this directory and the name away from anything that reads the screen
 * aloud. The one thing that is `aria-hidden` is the state sub-line, for the reason it always
 * was — it would rename the control.
 *
 * THE NEXT-EPISODE CELL IS THE ONE INSERTION THIS ROW ALLOWS, and `NEXT_CELL` is where the
 * reason is written: whether the title is an episode is settled before the band exists and
 * cannot change while it does, which is exactly what is NOT true of Retry.
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
  | 'nextEpisode'
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
 * therefore their own actions, handled idempotently by the consumer. All three still live on
 * the one control because `TRANSPORT_CELLS` holds a single `playPause` cell and nothing adds a
 * second; `TWIN_CELL` below RECORDS that mapping for a test to walk and `tsc` to check, and no
 * production path reads it (measured — `noDeadExports.test.ts` declares it test-only).
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
 * Offered only while the title on screen IS an episode with something after it to go to.
 *
 * INSERTED, NOT APPENDED — which is the one growth this row's focus model does not tolerate,
 * and it is safe here for a reason the `retry` flag cannot borrow: `next` is CONSTANT for the
 * life of the band. Whether a title is an episode is settled before the player mounts (it is
 * read off the watch-identity key, which the route resolves from the torrent row and the file
 * list on arrival), and a new arrival takes the whole player down and rebuilds it. The route
 * freezes it on mount as well, so a prop that changed underneath could not reshape the row
 * even if something started changing it — see `Playing`'s own note.
 *
 * `retry`, by contrast, flips mid-film whenever the stream fails, which is why THAT cell is
 * appended and why nothing else in this row may be.
 *
 * AFTER `forward60`, by id rather than by index. A reorder of `TRANSPORT_CELLS` then carries
 * this cell with its anchor instead of silently moving it to the middle of the seek cluster,
 * and an anchor that stopped existing is a `tsc` error on `TransportCellId`, not a cell that
 * quietly lands at the front of the row.
 */
export const NEXT_CELL: TransportCell = { id: 'nextEpisode', label: 'Next episode', variant: 'ghost' };

/** Where `NEXT_CELL` goes: straight after the forward jump, which is the end of the seek cluster. */
export const NEXT_CELL_AFTER: TransportCellId = 'forward60';

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
 *
 * WHAT IT IS NOT: the thing that makes the contract true. The watch route's `act` switch
 * handles each action directly and never consults this table, so an entry changed here moves
 * no pixel — it reddens a test. That makes this a second, hand-written statement of a rule
 * production states elsewhere, which is the shape that lets the two drift apart silently.
 */
export const TWIN_CELL: Record<TransportAction, TransportCellId> = {
  playPause: 'playPause',
  play: 'playPause',
  pause: 'playPause',
  back10: 'back10',
  back60: 'back60',
  forward60: 'forward60',
  nextEpisode: 'nextEpisode',
  subtitles: 'subtitles',
  stop: 'stop',
  retry: 'retry',
};

/**
 * What the Subtitles cell SAYS — decided by the screen, rendered verbatim here.
 *
 * TWO FIELDS AND NO LOGIC, deliberately. `note` arrives already rendered (the screen asks
 * `_data/subtitles.cellLabel`), so there is one place the nine phrasings live and this
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

/**
 * What the Next-episode cell says under its icon — the same two fields as the Subtitles
 * cell's view, and deliberately a SECOND interface rather than one generic shape.
 *
 * The two fields exist for the reasons `SubtitleCellView` sets out (words rendered verbatim
 * so there is one place the phrasings live; a machine-readable twin so a test can read which
 * state the screen believes it is in without matching prose), and `stateId` is typed to the
 * union of THIS cell's states, which is what a shared `{ stateId: string }` would throw away.
 * The duplication is two field names; what it buys is that neither cell can be handed the
 * other's state.
 */
export interface NextCellView {
  /** The next-episode verdict, `checking` while the lookup is out, `starting` after a press. */
  stateId: NextCellStateId;
  note: string;
}

/** Which cells the row holds. Both flags default to false: a cell has to be asked for. */
export interface TransportCellOptions {
  /** Append the Retry cell. Changes mid-film; see `RETRY_CELL`. */
  retry?: boolean;
  /** Include the Next-episode cell. Constant for the band's life; see `NEXT_CELL`. */
  next?: boolean;
}

/** `NEXT_CELL` spliced in after its anchor, or the table unchanged. */
function withNextCell(cells: readonly TransportCell[]): readonly TransportCell[] {
  const at = cells.findIndex((c) => c.id === NEXT_CELL_AFTER);
  // An anchor that is not in the table would otherwise splice at 0, putting the cell first
  // and moving every column. Appending is the one growth this row tolerates, so that is what
  // an impossible table degrades to rather than a silent reshuffle.
  if (at < 0) return [...cells, NEXT_CELL];
  return [...cells.slice(0, at + 1), NEXT_CELL, ...cells.slice(at + 1)];
}

export function transportCells(opts: TransportCellOptions): readonly TransportCell[] {
  const base = opts.next ? withNextCell(TRANSPORT_CELLS) : TRANSPORT_CELLS;
  return opts.retry ? [...base, RETRY_CELL] : base;
}

/** What the screen must put in `rowCounts` for this row. */
export function transportCellCount(opts: TransportCellOptions): number {
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
  next,
  onAction,
}: {
  /** The grid row this row occupies; every cell is a column of it. */
  row: number;
  focusProps: (row: number, col: number) => FocusProps;
  /** Drives Play/Pause's label and its glyph. */
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
  /**
   * What the Next-episode cell says — AND whether the cell exists at all. One prop for both,
   * because the two can never disagree: the cell is for episodes, and the lookup only runs
   * for an episode, so a view with no cell would be a state nothing shows and a cell with no
   * view would be a control with nothing to say. (The Subtitles cell is the other way round
   * on purpose: its list resolves while the row is already on screen, so the cell must exist
   * before the view does.)
   */
  next?: NextCellView;
  onAction: (action: TransportAction) => void;
}) {
  const cells = transportCells({ retry, next: next !== undefined });
  return (
    <div className="bs-player__row" role="group" aria-label="Playback controls">
      {cells.map((cell, col) => {
        const label = labelFor(cell, { playing });
        const note = cellNote(cell.id, subtitles, next);
        return (
          <button
            key={cell.id}
            type="button"
            className={cell.variant === 'primary' ? 'bs-tp bs-tp--primary' : 'bs-tp'}
            {...focusProps(row, col)}
            onClick={() => onAction(cell.id)}
            // Absent on every other cell, and absent on these two until the screen has an
            // answer: `undefined` writes no attribute at all, so "no state yet" and a state
            // are different things in the DOM as well as in the model.
            data-subtitles={cell.id === 'subtitles' ? subtitles?.stateId : undefined}
            data-next={cell.id === 'nextEpisode' ? next?.stateId : undefined}
          >
            {/* THE ICON CARRIES NO TEXT, and `glyphs.tsx` says why at length: SVG text would
                land in this button's `textContent`, which this directory's tests assert is
                exactly the cell's label. `aria-hidden` is on the `<svg>` itself, so the
                wrapper is free to be the circle the stylesheet draws. */}
            <span className="bs-tp__glyph">{glyphFor(cell.id, { playing })}</span>
            {/* THE CELL'S NAME, AND IT IS NEVER `aria-hidden`. The icons are what the viewer
                reads at three metres, so the stylesheet reveals this only while the cell has
                focus — by OPACITY, never `display: none`, which would take the name out of
                the accessibility tree and with it every `getByRole('button', { name })` query
                on this surface and the television's own screen reader. */}
            <span className="bs-tp__label">{label}</span>
            {/* `aria-hidden` IS LOAD-BEARING, not tidiness: the cell's accessible name is
                computed from its contents, so an announced sub-line would rename the control
                from `Subtitles` to `Subtitles off` — and every exact-name query for it, here
                and in the route's suite, would stop finding it. `.bs-player__commit` is the
                ScrubBar's own sub-line class, reused rather than reinvented, so this adds no
                rule to a stylesheet that is outside PostCSS; the transport row re-places it
                under the circle with one descendant rule. */}
            {note !== undefined && (
              <span className="bs-player__commit" aria-hidden="true">
                {note}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The sub-line a cell shows, or `undefined` for a cell that has none.
 *
 * ONE FUNCTION FOR BOTH VIEWS, so "which cells may carry a sub-line" is stated once. The
 * mutation it closes is the one `TransportBar.test.tsx` already names — render the sub-line
 * for every cell, and with `aria-hidden` kept every accessible name still reads correctly
 * while six cells wear a stranger's state.
 */
function cellNote(
  id: TransportCellId,
  subtitles: SubtitleCellView | undefined,
  next: NextCellView | undefined,
): string | undefined {
  if (id === 'subtitles') return subtitles?.note;
  if (id === 'nextEpisode') return next?.note;
  return undefined;
}
