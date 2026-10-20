'use client';
import { useEffect, useState } from 'react';
import { PICKER_ROW_SIZE, pickerRowCounts, type SubtitlePickerRow } from '../_data/subtitles';
import type { FocusTarget } from '../_focus/model';
import type { FocusProps } from '../_focus/useFocusGrid';

/**
 * The subtitle picker: `Off` plus one cell per listed sidecar, inside the screen's ONE
 * focus grid.
 *
 * IT OWNS NO FOCUS GRID AND NO BACK HANDLER, and that is not a style choice (D13). Only one
 * `useFocusGrid` may be live per screen — the listener is on `window` and checks no scope,
 * and effects register CHILD BEFORE PARENT, so a grid in here would claim the arrows and
 * leave the route's own grid inert, and a `useBackKey` in here would claim the press before
 * the route's ladder ever saw it. So this component takes `focusProps` and the grid row it
 * starts at; the route puts `pickerRowCounts(rows.length)` into `rowCounts` INSTEAD of the
 * scrub and transport rows while the picker is open.
 *
 * IT REPLACES THE BAND'S ROWS; IT DOES NOT OVERLAY THEM. An overlay would need a second
 * grid (above) or a `rowCounts` that declared the transport row AND the picker, which is
 * four more reachable (row, col) pairs on a surface where the ring landing on a cell no
 * element claims is indistinguishable from nothing being focused.
 *
 * `Off` IS ALWAYS THE FIRST CELL, AND THAT IS WHAT MAKES THE SCREEN SAFE. Every reachable
 * state of this picker — an empty list, a list that shrank under a re-read, a release that
 * ships only an `.ass` — still renders one focusable cell, so no press can leave the viewer
 * with no ring on a surface that has no Tab key and no pointer to recover with.
 *
 * ROWS OF THREE, FROM ONE CALL. The cells are laid out from `pickerRowCounts` — the same
 * function the route declares its grid with — so the declared count and the cells rendered
 * cannot drift. A declared count one too high parks the ring on nothing; one too low makes
 * a rendered cell unreachable. Chunking here with a local `PICKER_ROW_SIZE` loop would be a
 * second statement of one rule, and deleting either copy would be green.
 *
 * WHAT IT REFUSES TO KNOW. `pair_source` is an opaque string and nothing here reads it: the
 * backend's `naming.track_label` has already folded the provenance into `label`, which is
 * rendered verbatim. The taxonomy grows — a sixth source landed while this was being
 * written — so a list of its values written on this side would be wrong within the hour,
 * and "is this paired at all" is `video_index === null`, a structural fact. The whole
 * provenance contract on this surface is therefore "render `label`", and
 * `page.subtitles.test.tsx` pins both halves: the suffixed labels arrive intact, and no
 * source file here contains the words `pair_source`.
 *
 * NO `aria-disabled` ANYWHERE, INCLUDING ON THE ROWS THIS BOX CANNOT SERVE. A `.ass` row is
 * focusable, announced normally, and answered by a sentence when it is pressed. The web
 * player's CC button is the anti-pattern (`VideoPlayer.tsx:1816-1831`: permanently
 * `aria-disabled` with `tabIndex={-1}`), and it is worse on a remote — the ring stops here
 * whatever the attribute says, so the attribute only removes the viewer's explanation.
 *
 * NO NEW CSS CLASS. `.bs-player__row`, `.bs-btn`, `.bs-btn--ghost`, `.bs-player__hint` and
 * `.bs-player__commit` already have rules; `bigscreen.css` is hand-authored, outside
 * PostCSS, and is not this task's file.
 */

/**
 * The grid row the picker's first row occupies. The picker is the whole grid while it is
 * open, so this is 0 — named rather than written as a literal in three places.
 */
const PICKER_FIRST_ROW = 0;

/** The always-present first cell's label. */
const PICKER_OFF_LABEL = 'Off';

/**
 * What a refused row says when it is pressed, per the backend's `reason` code.
 *
 * NOT EXHAUSTIVE BY DESIGN, and the fallback is why: `reason` is a backend taxonomy that
 * can grow (it already carries a value, `unreadable`, that the format gate makes
 * unreachable on this path), and a `Record` over a closed union here would either need
 * editing every time the backend adds a code or silently render `undefined`. The format
 * is always named, because it is the part the viewer can act on — a release with an
 * `.srt` of the same language is a different download.
 */
const REFUSAL_WORDS: Readonly<Record<string, string>> = {
  'unsupported-format': 'the box cannot convert it, so there is nothing to show',
  unreadable: 'the box could not read the file',
};

/** The sentence a press on an unservable row is answered with. */
function refusalSentence(row: SubtitlePickerRow): string {
  const words = REFUSAL_WORDS[row.entry.reason ?? ''] ?? 'the box cannot show it';
  return `This is a .${row.entry.format} subtitle — ${words}.`;
}

/**
 * Which picker cell the current choice sits on. `0` is `Off`.
 *
 * A choice that is no longer in the list reads as `Off` rather than as a cell index: the
 * list is re-read per (title, file), and an index carried across an episode change names
 * another episode's file entirely.
 *
 * THE NULL EARLY RETURN IS THE SAME RULE STATED TWICE, and that is named rather than
 * claimed: `index` is a `number` on every row, so `findIndex` against `null` answers -1 and
 * the line below already returns 0. Deleting it is green on every row — the shape this
 * branch keeps finding. It is kept as documentation of the intent, not as a guard.
 */
function pickerCellIndex(
  rows: readonly SubtitlePickerRow[],
  chosenIndex: number | null,
): number {
  if (chosenIndex === null) return 0;
  const at = rows.findIndex((r) => r.index === chosenIndex);
  return at === -1 ? 0 : at + 1;
}

/**
 * The grid target for the current choice — the focus move the route makes when the picker
 * OPENS.
 *
 * It has to be explicit. `clampTarget` (`_focus/model.ts:65-69`) would otherwise answer
 * `clamp(col, 0, n-1)` of the row the ring was already on, which is the TRANSPORT row's
 * column 4 — a number that means the Subtitles cell and, in the picker's coordinates,
 * means some unrelated language.
 */
export function pickerTarget(
  rows: readonly SubtitlePickerRow[],
  chosenIndex: number | null,
): FocusTarget {
  const cell = pickerCellIndex(rows, chosenIndex);
  return {
    row: PICKER_FIRST_ROW + Math.floor(cell / PICKER_ROW_SIZE),
    col: cell % PICKER_ROW_SIZE,
  };
}

export function SubtitlePicker({
  rows,
  chosenIndex,
  emptyHint,
  focusProps,
  onChoose,
}: {
  /** Every listed entry, offers first. From `_data/subtitles.pickerRows`. */
  rows: readonly SubtitlePickerRow[];
  /** The torrent file index showing now, or null for `Off`. */
  chosenIndex: number | null;
  /**
   * Why there is nothing to choose, for a list with no entries at all. The route owns the
   * sentence because the route owns the read's three states; this component would have to
   * restate them to derive it.
   */
  emptyHint: string;
  focusProps: (row: number, col: number) => FocusProps;
  /** `null` is `Off`. The route owns the choice and closes the picker. */
  onChoose: (index: number | null) => void;
}) {
  /**
   * The row whose press was refused, so the refusal is a SENTENCE rather than a silence.
   *
   * Local, and cleared when the list changes: the hint names a format, and a format that
   * belongs to an entry the list no longer carries is a sentence about nothing. The route
   * never sees this — it is not a message (`mayHide` reads `message === ''`, so a sentence
   * in the band's one line would pin the 480px band over the picture for the rest of the
   * film) and it is not state anything outside this component can act on.
   */
  const [refused, setRefused] = useState<SubtitlePickerRow | null>(null);
  // KEYED ON THE INDICES, NOT ON THE ARRAY, and the reason is the measured one rather than
  // the obvious one. `[rows]` does NOT clear the refusal in the commit the press caused —
  // the press re-renders only this component, so the route's array keeps its identity, and
  // a first draft of this comment claimed otherwise with "measured" beside it. What `[rows]`
  // actually does is clear the sentence on the next ROUTE re-render for any reason at all:
  // the `/info` re-measure every 10s, the playhead's whole-second writes, a reveal. The
  // viewer's answer would evaporate a few seconds after they read it, with nothing anywhere
  // to notice. `page.subtitles.test.tsx` advances past the `/info` cadence with the refusal
  // up, which is the only row that can see the difference.
  const rowsKey = rows.map((r) => r.index).join(',');
  useEffect(() => {
    setRefused(null);
  }, [rowsKey]);

  const counts = pickerRowCounts(rows.length);
  // Offsets from the counts themselves, never `row * PICKER_ROW_SIZE`: that arithmetic is
  // only right while the chunk size here and the chunk size in `pickerRowCounts` agree,
  // which is the drift this component exists not to have.
  let next = 0;
  const laidOut = counts.map((n) => {
    const start = next;
    next += n;
    return { start, n };
  });
  const currentCell = pickerCellIndex(rows, chosenIndex);

  // THERE IS NO PRECEDENCE HERE TO GET WRONG, and that is said plainly because it LOOKS
  // like there is. The two sources are mutually exclusive by construction: a refusal exists
  // only once a ROW has been pressed, and the route's `emptyHint` is non-empty only for the
  // four read states that carry no rows at all. MEASURED, in the shape of task 4's X2:
  // swapping these two arms is GREEN on every row in this file, and no realistic fixture can
  // redden it, so the order is named as undiscriminable rather than defended with a comment
  // claiming it matters. The `rows.length === 0` conjunct is kept so that this component's
  // behaviour depends on its own props and not on an invariant held in another file.
  const hint = refused !== null ? refusalSentence(refused) : rows.length === 0 ? emptyHint : '';

  const press = (cell: number) => {
    if (cell === 0) {
      onChoose(null);
      return;
    }
    const row = rows[cell - 1];
    if (row === undefined) return;
    if (!row.selectable) {
      // ANSWERED, NOT IGNORED. The row is in the release and the viewer can see it there,
      // so the press gets the format and what the box will do about it. `.ass`/`.ssa` are
      // listed and never converted (D17), which is the stage-8 shape: a visible row with
      // effect NONE, carrying its own reason.
      setRefused(row);
      return;
    }
    onChoose(row.index);
  };

  return (
    <>
      {/* NO `role="status"`, and that is deliberate on both counts. It is not a live
          region — it appears with the rows it describes, under a ring the viewer has just
          moved — and the band's ONE `role="status"` line is the route's `message`, which
          `mayHide` reads: keeping them distinguishable is what lets the auto-hide row
          assert `message === ''` while the picker is on screen. `.bs-player__hint` holds
          one line open (`min-height`), so a sentence arriving does not nudge the control
          the ring is sitting on. */}
      <p className="bs-player__hint">{hint}</p>
      {laidOut.map(({ start, n }, r) => (
        <div className="bs-player__row" key={`picker-row-${r}`}>
          {Array.from({ length: n }, (_, c) => {
            const cell = start + c;
            const row = cell === 0 ? null : rows[cell - 1];
            const label = row === null ? PICKER_OFF_LABEL : row.label;
            const current = cell === currentCell;
            return (
              <button
                key={row === null ? 'off' : `entry-${row.index}`}
                type="button"
                // The current choice wears the primary dress and everything else the ghost
                // one, exactly as the transport row does for Play/Pause. No modifier is
                // added to `.bs-btn`, and the RING is still the only navigation signal:
                // this says which track is showing, not which cell is focused.
                className={current ? 'bs-btn' : 'bs-btn bs-btn--ghost'}
                {...focusProps(PICKER_FIRST_ROW + r, c)}
                onClick={() => press(cell)}
              >
                {label}
                {/* ANNOUNCED, not `aria-hidden`. The transport cell hides its sub-line
                    because its accessible name is pinned to the exact string `Subtitles`
                    by queries in two suites; no such contract exists on a picker row, and
                    the format is the most useful thing about a row the box cannot serve.
                    `.bs-player__commit` is the ScrubBar's own sub-line class, reused. */}
                {row !== null && !row.selectable && (
                  <span className="bs-player__commit">.{row.entry.format}</span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
