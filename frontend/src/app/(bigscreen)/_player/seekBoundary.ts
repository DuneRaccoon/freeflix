/**
 * The seek boundary: how far forward a press may land, and why it could not land further.
 *
 * `/info`'s `video_file.contiguous` is the only data source
 * (`manager.py:contiguous_available`). Its `downloaded`/`progress` siblings are
 * `file_progress()` TOTALS counting scattered pieces, and every Range request re-anchors
 * libtorrent's deadline window at a fresh mid-file offset, so holes behind the frontier are
 * the normal state — a bar drawn from `progress` permits exactly the seek this exists to
 * refuse.
 *
 * THREE DISTINCT ANSWERS, AND CONFLATING ANY TWO IS A DEFECT:
 *
 *   1. `contiguous: null` means UNKNOWN, and unknown means seeking is UNBOUNDED. Three
 *      backend paths answer null — absent from `active_torrents`, no metadata yet, or a
 *      libtorrent call raised — and the first is the FINISHED, EVICTED download, which
 *      still plays every byte straight off disk and is this television's main content. A
 *      ceiling of 0 there refuses every seek on a complete film.
 *   2. A MEASURED zero-length run (`run_start === run_end`) is a real answer, not unknown:
 *      the piece under the playhead is not on disk. Refuse forward seeks; keep playing.
 *   3. `run_start` legitimately sits BEHIND the playhead on a pack episode, and the run can
 *      end only just past it: `prioritize_video_files` marks EVERY video file priority 7
 *      while `set_sequential_download` is per-TORRENT, so libtorrent fills the lowest-index
 *      episode of a pack first and episode 5 plays off the deadline window around its own
 *      playhead. Hence the lift: the playhead is always a legal destination. Without it the
 *      clamp answers a second BEHIND the viewer and a fast-forward press rewinds them.
 *
 * Bounds are FILE-relative and `run_end` is EXCLUSIVE (the first byte not in the run).
 *
 * THE MARGIN IS NOT COSMETIC. A seek landing just INSIDE the frontier passes
 * `wait_for_first_chunk` — which only answers for the first 1 MiB — the 206 is sent, and
 * the next chunk sits in `stream_file_range`'s mid-stream poll, where `cap = 300.0` and
 * `waited = 0.0` are both re-initialised INSIDE the `while remaining > 0` loop. So the hold
 * is 300s per chunk and unbounded in total, with the status code already spent and no way
 * left to signal. The margin is what keeps the landing point far enough behind the frontier
 * that the re-anchored sequential download gets ahead of the playhead again.
 *
 * It is not a guarantee and is not sold as one: on a swarm slower than playback no margin
 * saves the stream, and that case belongs to the recovery ladder and the 503 handling
 * (`recovery.ts`, `classify.ts`), not here.
 *
 * REFUSE FORWARD SEEKS ONLY, AND NEVER REWRITE `currentTime`. `clampSeek` always answers a
 * finite second at or ahead of the playhead for a forward press, so assigning it can never
 * move the viewer backwards; when it equals the playhead the press was refused and the
 * caller simply does not assign (`if (v.seconds !== video.currentTime) …`). And it always
 * answers a `reason`: a press is never silently refused on this surface, so there is always
 * something for the readout to say.
 */
import type { VideoFileInfo } from '@/types';

/** The measured run, exactly as `/info` sends it. */
export type ContiguousRun = NonNullable<VideoFileInfo['contiguous']>;

/**
 * How far behind the download frontier a seek must land, in seconds of video.
 *
 * Sized against what the backend does after the response starts rather than against a feel:
 * the generator reads in 1 MiB chunks and waits for each chunk's pieces, so the landing
 * point needs at least the next chunk plus its piece rounding (a multi-gigabyte torrent's
 * piece length is 1-16 MiB) already on disk. At a 1080p bitrate of 5-12 Mbit/s, 15 seconds
 * is roughly 9-22 MiB of lead — more than one chunk plus one piece at the low end, and
 * several at the high end.
 */
export const SEEK_MARGIN_S = 15;

/** Why a press landed where it did. The words for these live in task 8's `describeScrub`. */
export type SeekReason =
  /** Backward (or in place). Never refused: those bytes have already been played. */
  | 'rewind'
  /** Forward, inside the measured run. */
  | 'within'
  /** Forward, allowed because nothing was measured — an unknown run, or no duration yet. */
  | 'unmeasured'
  /** Forward, reduced to the download frontier. */
  | 'clamped'
  /** Forward, refused: the frontier is already at the playhead. Playback continues. */
  | 'atFrontier'
  /** Forward, reduced to the end of the title. NOT a download refusal. */
  | 'end';

export interface SeekVerdict {
  /** Where the seek may land. Always finite, never negative, never behind the playhead. */
  seconds: number;
  reason: SeekReason;
}

export interface SeekRequest {
  /** The second the press asked for. */
  target: number;
  /** `video.currentTime`. */
  currentTime: number;
  /** `video.duration`; `NaN` before metadata. */
  duration: number;
  /** `/info`'s `video_file.contiguous`. `null`/`undefined` mean UNKNOWN, not zero. */
  contiguous?: ContiguousRun | null;
}

/**
 * The highest second a forward seek may land on, as bounded BY THE DOWNLOAD, or
 * `Number.POSITIVE_INFINITY` when the download bounds nothing.
 *
 * NEVER 0 FOR AN UNKNOWN RUN — see the header. Infinity rather than the duration, so that
 * "the download stops you here" and "the title ends here" stay two different statements;
 * `clampSeek` applies the second one, with its own reason. It is also the safe direction for
 * a caller that forgets the special case: `Math.min(target, Infinity)` is the target, while
 * `Math.min(target, null)` is 0, which is the catastrophic answer.
 *
 * A READOUT MUST CHECK `Number.isFinite` before showing this. `formatTime(Infinity)` is
 * '0:00', which on a television reads as a measurement rather than as an absence.
 *
 * Unknown `duration` is also unbounded: there is no scale to convert bytes with, and a 0
 * here would refuse the resume seek on arrival — a control labelled "Resume from 1:02:05"
 * that then starts at 0:00 is the lying-label defect `_data/title.ts:33` refuses. The TV
 * engine seeks on a one-shot `loadedmetadata`, where the duration is known, so this is the
 * out-of-contract path rather than the normal one.
 */
export function seekLimitSeconds(
  contiguous: ContiguousRun | null | undefined,
  duration: number,
): number {
  if (contiguous == null) return Number.POSITIVE_INFINITY; // unknown, NOT zero
  const { file_size, run_end } = contiguous;
  if (!(file_size > 0)) return Number.POSITIVE_INFINITY; // nothing to measure against
  // `run_end` is EXCLUSIVE, so run_end === file_size means every byte is in the run: there
  // is no frontier ahead to stay behind, and subtracting the margin anyway would refuse a
  // seek into the last SEEK_MARGIN_S seconds of a fully downloaded film.
  if (run_end >= file_size) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(duration) || duration <= 0) return Number.POSITIVE_INFINITY;
  // FLOOR, not round or ceil: this is CBR arithmetic over a VBR file, so the true second at
  // that byte sits either side of the quotient and only one direction is safe.
  const frontier = Math.floor((duration * Math.max(0, run_end)) / file_size);
  return Math.max(0, frontier - SEEK_MARGIN_S);
}

/**
 * Where a seek press may land, and why it could not land further.
 *
 * Forward presses only are reduced. The ceiling is the download frontier, bounded by the
 * title's end and then LIFTED TO THE PLAYHEAD, so the answer is never behind the viewer.
 */
export function clampSeek({ target, currentTime, duration, contiguous }: SeekRequest): SeekVerdict {
  const from = nonNegative(currentTime);
  const want = nonNegative(target);
  if (want <= from) return { seconds: want, reason: 'rewind' };

  const limit = seekLimitSeconds(contiguous, duration);
  const end = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  // THE LIFT. `Math.max(…, from)` last: on a pack episode the run containing the playhead
  // can end within the margin of it, so the raw ceiling sits behind the viewer.
  const cap = Math.max(Math.min(limit, end), from);

  if (want <= cap) {
    const measured =
      contiguous != null
      && contiguous.file_size > 0
      && Number.isFinite(duration)
      && duration > 0;
    return { seconds: want, reason: measured ? 'within' : 'unmeasured' };
  }
  // `cap` is finite here: an infinite cap accepts every finite target above.
  if (limit < end) return { seconds: cap, reason: cap <= from ? 'atFrontier' : 'clamped' };
  return { seconds: cap, reason: 'end' };
}

/** Whole-second-safe: NaN and Infinity become 0, negatives become 0. */
function nonNegative(value: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
