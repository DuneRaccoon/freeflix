/**
 * The seek boundary: three distinct answers, and conflating any two of them is a defect.
 *
 * Task 3's handover, which these rows exist to hold apart:
 *
 *   1. `contiguous: null` means UNKNOWN, and unknown means seeking is UNBOUNDED. Three
 *      backend paths answer null — the torrent is absent from `active_torrents`, it has no
 *      metadata, or a libtorrent call raised — and the first of those is the FINISHED,
 *      EVICTED download, which still plays every byte off disk and is the television's main
 *      content. A ceiling of 0 here refuses every seek on a complete film.
 *   2. A MEASURED zero-length run (`run_start == run_end`) is a real answer, not unknown:
 *      refuse forward seeks, keep playing.
 *   3. `run_start` legitimately sits BEHIND the playhead on a pack episode, so the ceiling
 *      is lifted to the playhead. Without the lift the clamp yanks the viewer backwards.
 *
 * Bounds are FILE-relative and `run_end` is EXCLUSIVE.
 */
import { describe, it, expect } from 'vitest';
import {
  SEEK_MARGIN_S,
  clampSeek,
  seekLimitSeconds,
  type ContiguousRun,
} from './seekBoundary';

/** A measured run, with the fields `/info` actually sends. */
const run = (over: Partial<ContiguousRun> = {}): ContiguousRun => ({
  file_index: 0,
  file_size: 1000,
  piece_length: 100,
  run_start: 0,
  run_end: 500,
  complete: false,
  measured_against: 'metadata',
  ...over,
});

/** 2 hours, so a byte fraction converts to a round number of seconds. */
const D = 7200;

describe('SEEK_MARGIN_S', () => {
  it('is a real margin, in seconds', () => {
    // Pinned absolutely: a derived assertion would move with the constant and catch
    // nothing. The margin is why a seek lands behind the frontier rather than on it.
    expect(SEEK_MARGIN_S).toBe(15);
    expect(SEEK_MARGIN_S).toBeGreaterThan(0);
  });
});

describe('seekLimitSeconds', () => {
  it('is UNBOUNDED when nothing was measured — never zero', () => {
    // The finished-and-evicted torrent. `contiguous_available` answers None with no live
    // handle, and every byte of that file is on disk. This function answers the ceiling
    // the DOWNLOAD imposes, so "no ceiling" is Infinity; `clampSeek` is what then bounds a
    // press by the duration, with a different reason.
    expect(seekLimitSeconds(null, D)).toBe(Number.POSITIVE_INFINITY);
    expect(seekLimitSeconds(undefined, D)).toBe(Number.POSITIVE_INFINITY);
    expect(seekLimitSeconds(null, D)).not.toBe(0);
  });

  it('is unbounded with no duration to convert bytes against', () => {
    // There is no scale, so there is no number to answer but an unbounded one. A 0 here
    // would refuse the resume seek on arrival, which is the lying-label defect
    // `_data/title.ts:33` says this surface refuses.
    expect(seekLimitSeconds(null, Number.NaN)).toBe(Number.POSITIVE_INFINITY);
    expect(seekLimitSeconds(run(), Number.NaN)).toBe(Number.POSITIVE_INFINITY);
    expect(seekLimitSeconds(run(), 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('draws the ceiling a margin behind the frontier', () => {
    // Half the bytes of a 2-hour film: the frontier is 1:00:00 and the ceiling is 15s
    // behind it. WITHOUT THE MARGIN a seek to exactly the frontier passes
    // `wait_for_first_chunk` (which only checks the first 1 MiB), the 206 is sent, and
    // the NEXT chunk sits in `stream_file_range`'s mid-stream poll — where `cap` and
    // `waited` are both re-initialised inside the `while remaining > 0` loop, so the hold
    // is 300s per chunk and unbounded in total, with the status code already spent.
    expect(seekLimitSeconds(run({ run_end: 500 }), D)).toBe(3600 - SEEK_MARGIN_S);
  });

  it('floors the bytes-to-seconds fraction', () => {
    // 7200 * 501 / 1000 = 3607.2. Flooring errs low; the conversion is CBR arithmetic
    // over a VBR file, so the true second at that byte can sit either side of it and only
    // one direction is safe.
    expect(seekLimitSeconds(run({ run_end: 501 }), D)).toBe(3607 - SEEK_MARGIN_S);
  });

  it('treats a run that reaches the end of the file as unbounded', () => {
    // `run_end` is EXCLUSIVE, so run_end === file_size is "every byte is here". There is
    // no frontier ahead to stay behind, and subtracting the margin anyway would refuse a
    // seek into the last 15 seconds of a fully downloaded film.
    expect(seekLimitSeconds(run({ run_end: 1000, complete: true }), D)).toBe(Number.POSITIVE_INFINITY);
    expect(seekLimitSeconds(run({ run_start: 400, run_end: 1000 }), D)).toBe(Number.POSITIVE_INFINITY);
    // One byte short is NOT the end of the file: exclusivity, pinned from the other side.
    expect(seekLimitSeconds(run({ run_end: 999 }), D)).toBe(7192 - SEEK_MARGIN_S);
  });

  it('answers 0 for a measured zero-length run, which is a real answer', () => {
    // Distinct from null. The piece under the playhead is not on disk; forward seeking is
    // refused and playback carries on.
    expect(seekLimitSeconds(run({ run_start: 0, run_end: 0 }), D)).toBe(0);
  });

  it('is unbounded when there is nothing to measure against', () => {
    expect(seekLimitSeconds(run({ file_size: 0, run_end: 0 }), D)).toBe(Number.POSITIVE_INFINITY);
    expect(seekLimitSeconds(run({ file_size: -1 }), D)).toBe(Number.POSITIVE_INFINITY);
  });

  it('never answers a negative number', () => {
    for (const run_end of [0, 1, 2]) {
      expect(seekLimitSeconds(run({ run_start: 0, run_end }), D)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('clampSeek', () => {
  it('allows the press when nothing was measured', () => {
    // THE ROW THE EVICTED FINISHED TORRENT RIDES ON. A ceiling of 0 here refuses every
    // seek on a complete film.
    const v = clampSeek({ target: 6000, currentTime: 10, duration: D, contiguous: null });
    expect(v.seconds).toBe(6000);
    expect(v.reason).toBe('unmeasured');
  });

  it('reduces a forward press to the ceiling', () => {
    const v = clampSeek({ target: 3600, currentTime: 100, duration: D, contiguous: run() });
    expect(v.seconds).toBe(3600 - SEEK_MARGIN_S);
    expect(v.reason).toBe('clamped');
  });

  it('allows a forward press that lands inside the run', () => {
    const v = clampSeek({ target: 1800, currentTime: 100, duration: D, contiguous: run() });
    expect(v.seconds).toBe(1800);
    expect(v.reason).toBe('within');
  });

  it('refuses a forward press on a measured zero-length run, and keeps the playhead', () => {
    const v = clampSeek({
      target: 60,
      currentTime: 0,
      duration: D,
      contiguous: run({ run_start: 0, run_end: 0 }),
    });
    expect(v.seconds).toBe(0);
    expect(v.reason).toBe('atFrontier');
  });

  it('allows a seek into the last seconds of a fully downloaded file', () => {
    // The consequence of subtracting the margin from a run that reaches EOF: the final
    // SEEK_MARGIN_S seconds of a film whose every byte is on disk become unreachable.
    // There is no frontier there to stay behind.
    const v = clampSeek({
      target: 7195,
      currentTime: 7100,
      duration: D,
      contiguous: run({ run_end: 1000, complete: true }),
    });
    expect(v.seconds).toBe(7195);
    expect(v.reason).toBe('within');
  });

  it('holds the three answers apart at one playhead', () => {
    // THE DEFECT THIS WHOLE MODULE EXISTS TO PREVENT is answering any two of these the
    // same way. Same press, same playhead, three different measurements.
    const press = { target: 1800, currentTime: 60, duration: D };
    const unknown = clampSeek({ ...press, contiguous: null });
    const zero = clampSeek({ ...press, contiguous: run({ run_start: 0, run_end: 0 }) });
    const partial = clampSeek({ ...press, contiguous: run({ run_end: 500 }) });

    expect(unknown.seconds).toBe(1800); // unbounded
    expect(zero.seconds).toBe(60); // refused, at the playhead
    expect(partial.seconds).toBe(1800); // inside the run
    expect(new Set([unknown.reason, zero.reason, partial.reason]).size).toBe(3);
  });

  it('lifts the ceiling to the playhead on a pack episode', () => {
    // The run containing the playhead can end only just past it: libtorrent fills the
    // LOWEST-index episode of a pack first (`prioritize_video_files` marks every video
    // file priority 7 while `set_sequential_download` is per-torrent), so episode 5 plays
    // off the deadline window around its own playhead. Byte 420/1000 is second 3024, so
    // the raw ceiling is 3009 — BEHIND a playhead at 3020.
    const pack = run({ run_start: 400, run_end: 420 });
    expect(seekLimitSeconds(pack, D)).toBe(3024 - SEEK_MARGIN_S);
    const v = clampSeek({ target: 3100, currentTime: 3020, duration: D, contiguous: pack });
    // WITHOUT THE LIFT this answers 3009 and yanks the viewer back 11 seconds for
    // pressing fast-forward.
    expect(v.seconds).toBe(3020);
    expect(v.seconds).toBeGreaterThanOrEqual(3020);
    expect(v.reason).toBe('atFrontier');
  });

  it('never moves the playhead backwards on a forward press', () => {
    // Stated as an invariant over every shape, because "yanked backwards" is the failure
    // and one row only covers one way of reaching it.
    const shapes: Array<ContiguousRun | null> = [
      null,
      run(),
      run({ run_start: 0, run_end: 0 }),
      run({ run_start: 400, run_end: 420 }),
      run({ run_end: 1000, complete: true }),
      run({ file_size: 0, run_end: 0 }),
    ];
    for (const contiguous of shapes) {
      for (const currentTime of [0, 60, 3020, 7190]) {
        const v = clampSeek({ target: currentTime + 60, currentTime, duration: D, contiguous });
        expect(v.seconds, `${JSON.stringify(contiguous)} at ${currentTime}`)
          .toBeGreaterThanOrEqual(currentTime);
      }
    }
  });

  it('does not call the end of the film a download refusal', () => {
    // A ±60s jump near the end of a complete title lands past the duration. The press is
    // still reduced, but for a different reason, and `describeScrub` must not be handed
    // "still downloading" to say about a film that is entirely on disk.
    const v = clampSeek({ target: 7250, currentTime: 7190, duration: D, contiguous: null });
    expect(v.seconds).toBe(D);
    expect(v.reason).toBe('end');
    // ...while the same overshoot on a half-downloaded title IS a download refusal.
    const w = clampSeek({ target: 7250, currentTime: 100, duration: D, contiguous: run() });
    expect(w.seconds).toBe(3600 - SEEK_MARGIN_S);
    expect(w.reason).toBe('clamped');
  });

  it('never refuses a backward press', () => {
    // Forward seeks only. Rewinding is always into bytes that have already been played.
    for (const contiguous of [null, run(), run({ run_start: 0, run_end: 0 })]) {
      const v = clampSeek({ target: 10, currentTime: 3020, duration: D, contiguous });
      expect(v.seconds).toBe(10);
      expect(v.reason).toBe('rewind');
    }
  });

  it('floors a backward press at zero', () => {
    const v = clampSeek({ target: -30, currentTime: 10, duration: D, contiguous: run() });
    expect(v.seconds).toBe(0);
    expect(v.reason).toBe('rewind');
  });

  it('always answers a finite number and a reason', () => {
    // A press is never silently refused on this surface: there is always something for
    // `describeScrub` to say, and the number is always safe to assign to `currentTime`.
    const REASONS = ['rewind', 'within', 'unmeasured', 'clamped', 'atFrontier', 'end'];
    const seen = new Set<string>();
    const shapes: Array<ContiguousRun | null | undefined> = [
      null,
      undefined,
      run(),
      run({ run_start: 0, run_end: 0 }),
      run({ run_start: 400, run_end: 420 }),
      run({ run_end: 1000, complete: true }),
    ];
    for (const contiguous of shapes) {
      for (const duration of [D, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
        for (const currentTime of [0, 60, 3020, Number.NaN]) {
          for (const target of [-10, 0, 60, 3100, 1e9, Number.NaN]) {
            const v = clampSeek({ target, currentTime, duration, contiguous });
            const where = `${JSON.stringify(contiguous)} d=${duration} t=${currentTime} -> ${target}`;
            expect(Number.isFinite(v.seconds), where).toBe(true);
            expect(v.seconds, where).toBeGreaterThanOrEqual(0);
            expect(REASONS, where).toContain(v.reason);
            seen.add(v.reason);
          }
        }
      }
    }
    // Non-vacuity: the sweep above really did reach every answer, so "always has a
    // reason" is not holding because one branch answers for everything.
    expect([...seen].sort()).toEqual([...REASONS].sort());
  });
});
