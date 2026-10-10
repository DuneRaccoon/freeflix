'use client';
import { useEffect, useState } from 'react';
import type { FocusProps } from '../_focus/useFocusGrid';
import { describeScrub, SCRUB_STEP_S } from './describeScrub';
import { formatTime } from './formatTime';
import { clampSeek, type ContiguousRun, type SeekVerdict } from './seekBoundary';

/**
 * The scrub cell: ONE focus cell, alone in its own row, which claims Left and Right while
 * it holds focus and nothing else ever.
 *
 * IT OWNS NO FOCUS GRID (the `Keyboard.tsx` contract). It takes `focusProps` and the row it
 * occupies, and the screen puts `scrubRowCount(duration)` into its own `rowCounts`. A grid
 * in here would claim the arrows for a child instance — the hook's listener is on `window`
 * and checks no scope, and effects register CHILD BEFORE PARENT — leaving the screen's own
 * grid inert.
 *
 * ALONE IN ITS ROW, AND DECLARED FIRST. Alone, because this handler eats the horizontal
 * arrows while the cell has focus, so a sibling in this row would be unreachable. First,
 * because the row does not exist until `<video>` reports a finite duration — never yet
 * observed for an in-progress stream on this set — and the grid starts on the first
 * POPULATED row, which is then the transport row's Play/Pause.
 *
 * THE CLAIM IS UNCONDITIONAL: `preventDefault()` happens before anything is decided, every
 * time this cell sees Left or Right. The trap is already in this repo — `bigscreen/diag`'s
 * tile row claims the arrow only `if (target)`, so at either end nothing is claimed. Copied
 * into a live grid, the press AT THE SEEKABLE BOUNDARY is the one that falls through, which
 * is §7.4's refusal handed to the navigation model instead of to the viewer: the cell
 * decides nothing and says nothing at the exact moment the viewer is pressing against the
 * download edge. (It does not make the ring jump off a one-cell row — `move` never wraps
 * left/right between rows, `model.ts:95-97` — but it does hand a future sibling in this row
 * a second action on one press, which is the web player's live ±20s double-seek.)
 *
 * The numeric `keyCode` is matched beside the name, for the reason `useFocusGrid` and
 * `useMediaKeys` both carry numeric maps: the only key number this project has ever read off
 * the television arrived with no usable `e.key`. BUT IT IS NOT THE PATH THIS HANDLER
 * ACTUALLY TAKES, and the test says so: React's `getEventKey` rewrites a SYNTHETIC event's
 * `key` from `keyCode` before any handler runs ('Unidentified' and '' both become
 * 'ArrowRight' for 39, and the legacy 'Right' spelling is normalised too), so deleting the
 * numeric half here changes no behaviour and no test. It stays as defence in depth for the
 * day this moves to a native listener, where the two hooks' maps are genuinely load-bearing.
 *
 * SCRUBBING IS PENDING-POSITION ARITHMETIC. No network, and no `currentTime` write per
 * press. `useFocusGrid` has no `e.repeat` guard, so a held arrow repeats many times a
 * second, and a seek per press would be a storm of Range requests each re-anchoring
 * libtorrent's deadline window at a fresh offset — which starves the frontier the viewer is
 * waiting for. OK commits the pending position; leaving the row cancels it, and
 * `describeScrub` says so while an edit is open because Up and Down are the grid's, not
 * this cell's.
 *
 * EVERY REFUSAL IS A SENTENCE, NOT A SILENCE. `clampSeek` always answers a reason and
 * `describeScrub` phrases all six, so the ceiling is something the viewer reads rather than
 * a press that appears to do nothing.
 */

/** The condition the row's existence, its count and this component's render all share. */
export function hasFiniteDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

/** What the screen must put in `rowCounts` for this row. */
export function scrubRowCount(duration: number): number {
  return hasFiniteDuration(duration) ? 1 : 0;
}

/** A width or offset for a track layer, as a percentage that cannot leave the track. */
function pct(fraction: number): string {
  const n = Number.isFinite(fraction) ? fraction * 100 : 0;
  return `${Math.round(Math.max(0, Math.min(100, n)) * 100) / 100}%`;
}

export function ScrubBar({
  row,
  focusProps,
  position,
  duration,
  contiguous,
  step = SCRUB_STEP_S,
  onSeek,
  onEditOpen,
}: {
  /** The grid row this cell occupies; it is the only cell in it. */
  row: number;
  focusProps: (row: number, col: number) => FocusProps;
  /** `video.currentTime`. */
  position: number;
  /** `video.duration`. The row does not exist until this is finite and positive. */
  duration: number;
  /** `/info`'s `video_file.contiguous`. `null`/`undefined` mean UNKNOWN, not zero. */
  contiguous?: ContiguousRun | null;
  /** How far one press moves. ±10s by default (spec §7.4). */
  step?: number;
  /** OK pressed with an edit open: seek here. The only thing this component asks for. */
  onSeek: (seconds: number) => void;
  /**
   * Whether an edit is open, for the ROUTE's benefit. Back is an escalation whose level is
   * DERIVED from state rather than counted — cancel the edit, then put the controls away,
   * then leave — and a counter would walk the viewer two rungs after a reveal. The cancel
   * itself stays here (`onBlur`, below): the route only has to know one is open.
   */
  onEditOpen?: (open: boolean) => void;
}) {
  // Hooks before the conditional return: the row appears when `loadedmetadata` lands, and a
  // hook count that changed with it would be a React error rather than a missing row.
  const [pending, setPending] = useState<SeekVerdict | null>(null);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const back = e.key === 'ArrowLeft' || e.keyCode === 37;
    const forward = e.key === 'ArrowRight' || e.keyCode === 39;
    if (!back && !forward) return; // not ours: Back, OK and the vertical arrows are untouched
    // UNCONDITIONAL, and before any decision. See the header.
    e.preventDefault();
    const from = pending?.seconds ?? position;
    setPending(
      clampSeek({
        target: from + (back ? -step : step),
        // Always the real playhead: the ceiling is measured against where playback is, not
        // against where the viewer has walked the pending marker to.
        currentTime: position,
        duration,
        contiguous,
      }),
    );
  };

  // Reported in an effect, never during render: the route turns it into state of its own.
  const editOpen = pending !== null;
  useEffect(() => {
    onEditOpen?.(editOpen);
  }, [editOpen, onEditOpen]);

  const commit = () => {
    if (!pending) return; // the label already says what Left and Right are for
    const seconds = pending.seconds;
    setPending(null);
    onSeek(seconds);
  };

  // The recovery ladder calls `v.load()`, which resets `duration` to NaN until
  // `loadedmetadata` lands again: the row disappears mid-edit and comes back. The edit must
  // not come back with it — OK would commit a position nobody chose during the stall. A
  // render-phase reset (React's documented "adjusting state when a prop changes") rather
  // than an effect, because every hook here has to run before the row's conditional return.
  if (!hasFiniteDuration(duration)) {
    if (pending !== null) setPending(null);
    return null;
  }

  const view = describeScrub({ position, duration, contiguous, pending });
  const at = pending?.seconds ?? position;
  const size = contiguous && contiguous.file_size > 0 ? contiguous.file_size : 0;

  return (
    <>
      {/* First in the band, which is bottom-anchored: a hint that wraps to a second line
          grows the band UPWARDS, so the control the ring is sitting on never moves. */}
      <p className="bs-player__hint" role="status">
        {view.hint}
      </p>
      <div className="bs-player__row">
        <button
          type="button"
          className="bs-player__scrub"
          {...focusProps(row, 0)}
          onKeyDown={onKeyDown}
          onClick={commit}
          onBlur={() => setPending(null)}
        >
          <span className="bs-player__times">
            {view.readout} <span className="bs-player__total">of {formatTime(duration, duration)}</span>
          </span>
          <span className="bs-player__commit">{view.commit}</span>
          <span className="bs-player__track">
            {/* The measured run, drawn FROM `run_start`: on a pack episode the contiguous
                region legitimately begins well into the file, because
                `prioritize_video_files` marks every episode priority 7 while sequential
                download is per-torrent. Zero-width when nothing was measured — unknown is
                not zero, but it is not a length this may draw either, and the hint says so
                in words. */}
            <span
              className="bs-player__ready"
              style={{
                left: pct(size ? contiguous!.run_start / size : 0),
                width: pct(size ? (contiguous!.run_end - contiguous!.run_start) / size : 0),
              }}
            />
            <span className="bs-player__played" style={{ width: pct(at / duration) }} />
          </span>
        </button>
      </div>
    </>
  );
}
