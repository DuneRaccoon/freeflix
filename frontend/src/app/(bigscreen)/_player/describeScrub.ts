import { formatTime } from './formatTime';
import { seekLimitSeconds, type ContiguousRun, type SeekReason, type SeekVerdict } from './seekBoundary';

/**
 * The words the scrub cell says: where the bar is pointing, why it could not point
 * further, and what OK will do about it.
 *
 * Pure, and an EXHAUSTIVE SWITCH WITH NO `default`, so a seventh `SeekReason` fails
 * `npx tsc --noEmit` here rather than falling through to a sentence that happens to be
 * grammatical. `SeekReason` has six members and all six are phrased separately:
 *
 * - `clamped` and `atFrontier` are the DOWNLOAD refusing, and `end` is the title ending.
 *   Those two must never share a sentence. "The download stops you here" is temporary and
 *   the viewer waits; "the title ends here" is not, and a viewer told the wrong one either
 *   waits for nothing or presses against a wall. Keeping them apart is the whole reason
 *   `seekLimitSeconds` answers `Number.POSITIVE_INFINITY` rather than the duration for an
 *   unbounded ceiling.
 * - `rewind` is never a refusal: those bytes have already been played.
 * - `within` and `unmeasured` both permit the press, and say so differently, because
 *   "it is inside what has downloaded" and "nobody measured" are different promises.
 *
 * `Number.isFinite` BEFORE ANY CEILING REACHES THE SCREEN. `seekLimitSeconds` answers
 * `Infinity` for every unbounded case (unknown run, a run covering the whole file, no
 * usable duration) and `formatTime(Infinity)` is `'0:00'` — which on a ten-foot readout
 * reads as a measurement ("downloaded as far as 0:00") rather than as an absence. The
 * unbounded cases therefore get a sentence with no time in it at all.
 *
 * WHAT CANCELS IS PART OF THE HINT. The cell claims Left/Right only: Up and Down belong to
 * the focus grid, which moves the ring off the row and so discards the pending edit. A
 * viewer who is not told that loses the edit without a word, so while an edit is open every
 * hint ends by saying what cancels it.
 *
 * It owns no state and reads no element: the pending edit arrives as the `SeekVerdict` the
 * cell already computed, so the sentence and the seek can never disagree about where OK
 * goes.
 */

/** How far one Left/Right press moves the pending position (spec §7.4: "Left/Right give ±10s"). */
export const SCRUB_STEP_S = 10;

export interface ScrubState {
  /** `video.currentTime`. */
  position: number;
  /** `video.duration`. Used as the padding total, so every time in the band has one shape. */
  duration: number;
  /** `/info`'s `video_file.contiguous`. `null`/`undefined` mean UNKNOWN, not zero. */
  contiguous?: ContiguousRun | null;
  /** The verdict for the edit the viewer has open, or `null` when there is no edit. */
  pending: SeekVerdict | null;
}

export interface ScrubView {
  /** The time the bar is pointing at: the pending edit if there is one, else the playhead. */
  readout: string;
  /** Why it is pointing there, and what cancels it. `''` when no edit is open. */
  hint: string;
  /** What OK does right now. Never empty — a control that does nothing must say so. */
  commit: string;
}

function assertNever(x: never): never {
  throw new Error(`Unhandled seek reason: ${JSON.stringify(x)}`);
}

/**
 * One sentence per reason. `limit` is the download ceiling and MAY BE `Infinity`; every
 * branch that would draw it checks first.
 */
function reasonHint(reason: SeekReason, limit: number, duration: number): string {
  const bounded = Number.isFinite(limit);
  const ceiling = formatTime(limit, duration);
  switch (reason) {
    case 'rewind':
      return 'Going back — those seconds are already here.';
    case 'within':
      return bounded
        ? `Downloaded as far as ${ceiling}.`
        : 'The whole title has downloaded.';
    case 'unmeasured':
      return 'The box hasn’t said how much has downloaded, so this isn’t checked.';
    case 'clamped':
      return bounded
        ? `Only downloaded as far as ${ceiling} — this stops there.`
        : 'This stops where the download does.';
    case 'atFrontier':
      return 'The download hasn’t reached past here yet. Playback carries on.';
    case 'end':
      // No mention of the download, deliberately: this is the end of the title.
      return 'This is the end of the title.';
    default:
      return assertNever(reason);
  }
}

export function describeScrub({ position, duration, contiguous, pending }: ScrubState): ScrubView {
  const total = duration;
  if (pending === null) {
    return {
      readout: formatTime(position, total),
      hint: '',
      commit: 'Left or Right chooses a time; OK jumps there.',
    };
  }
  const limit = seekLimitSeconds(contiguous, duration);
  const readout = formatTime(pending.seconds, total);
  return {
    readout,
    hint: `${reasonHint(pending.reason, limit, total)} Up or Down cancels.`,
    // A refused press answers the playhead itself, and "OK jumps to 1:40" when 1:40 is
    // where you already are is a label that lies about what a press does.
    commit:
      pending.seconds === position
        ? 'OK keeps playing from here.'
        : `OK jumps to ${readout}.`,
  };
}
