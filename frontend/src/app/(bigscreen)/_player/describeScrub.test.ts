import { describe, it, expect } from 'vitest';
import { describeScrub, SCRUB_STEP_S } from './describeScrub';
import { clampSeek, type ContiguousRun, type SeekReason, type SeekVerdict } from './seekBoundary';

const DURATION = 1000;
/** A measured run, with the fields `/info` actually sends (the `seekBoundary` fixture). */
const run = (run_end: number, file_size = 1000, run_start = 0): ContiguousRun => ({
  file_index: 0,
  file_size,
  piece_length: 100,
  run_start,
  run_end,
  complete: run_end >= file_size,
  measured_against: 'metadata',
});

/**
 * One fixture per `SeekReason`, each built by asking the REAL `clampSeek` — so the table
 * proves the reason is reachable as well as phrased. A `Record` keyed by the union, so a
 * seventh member of `SeekReason` fails `tsc` here as well as in `describeScrub`.
 */
const FIXTURES: Record<
  SeekReason,
  { position: number; target: number; duration?: number; contiguous?: ContiguousRun | null }
> = {
  // Backwards from 100 to 50: never refused.
  rewind: { position: 100, target: 50, contiguous: null },
  // Measured run reaching halfway, a short forward press well inside it.
  within: { position: 10, target: 20, contiguous: run(500) },
  // Nothing measured, so nothing is checked.
  unmeasured: { position: 10, target: 900, contiguous: null },
  // Same measured run, a press past the frontier: reduced to 485 (500/1000 of 1000s, -15).
  clamped: { position: 10, target: 900, contiguous: run(500) },
  // The run ends 20 bytes in and the playhead is at 100s: the ceiling is behind the viewer.
  atFrontier: { position: 100, target: 110, contiguous: run(20) },
  // `run_end === file_size`: every byte is here, so the only ceiling left is the title's end.
  end: { position: 900, target: 1100, contiguous: run(1000) },
};

const verdictFor = (reason: SeekReason): SeekVerdict => {
  const f = FIXTURES[reason];
  const v = clampSeek({
    target: f.target,
    currentTime: f.position,
    duration: f.duration ?? DURATION,
    contiguous: f.contiguous,
  });
  expect(v.reason, `fixture for '${reason}' must actually produce it`).toBe(reason);
  return v;
};

const viewFor = (reason: SeekReason) => {
  const f = FIXTURES[reason];
  return describeScrub({
    position: f.position,
    duration: f.duration ?? DURATION,
    contiguous: f.contiguous,
    pending: verdictFor(reason),
  });
};

const REASONS = Object.keys(FIXTURES) as SeekReason[];

describe('describeScrub', () => {
  it('reads out the playhead, padded against the duration, when nothing is pending', () => {
    const view = describeScrub({ position: 252, duration: 5520, contiguous: null, pending: null });
    // 1:32:00 total, so the position is drawn h:mm:ss too — one field count per readout.
    expect(view.readout).toBe('0:04:12');
    expect(view.hint).toBe('');
    // Never empty: a cell whose OK does nothing must say what to press instead.
    expect(view.commit).toMatch(/left or right/i);
    expect(view.commit).toMatch(/OK/);
  });

  it('reads out the PENDING second, not the playhead, while an edit is open', () => {
    const view = viewFor('clamped');
    // Reduced to 485s = 8:05. The playhead (10s) must not be what the viewer reads.
    expect(view.readout).toBe('8:05');
    expect(view.commit).toContain('8:05');
  });

  it.each(REASONS)('phrases %s with a hint of its own', (reason) => {
    const view = viewFor(reason);
    expect(view.hint.length).toBeGreaterThan(0);
    expect(view.commit.length).toBeGreaterThan(0);
    expect(view.readout.length).toBeGreaterThan(0);
  });

  it('gives all six reasons distinct hints', () => {
    // Six members, one sentence each: a `switch` that fell two reasons through to one
    // phrasing would still be exhaustive and would still read as if it had answered.
    const hints = REASONS.map((r) => viewFor(r).hint);
    expect(new Set(hints).size).toBe(REASONS.length);
    expect(REASONS).toHaveLength(6);
  });

  it('never lets the download and the end of the title share a sentence', () => {
    // The whole reason `seekLimitSeconds` answers Infinity instead of the duration: "the
    // download stops you here" and "the title ends here" are different statements and a
    // viewer acts differently on each.
    const end = viewFor('end');
    expect.soft(end.hint).toMatch(/end of (the|this) title/i);
    expect.soft(end.hint).not.toMatch(/download/i);
    for (const reason of ['clamped', 'atFrontier'] as const) {
      const view = viewFor(reason);
      expect.soft(view.hint, reason).toMatch(/download/i);
      expect.soft(view.hint, reason).not.toMatch(/end of (the|this) title/i);
    }
  });

  it('says the ceiling in words when the download bounds the seek', () => {
    expect(viewFor('clamped').hint).toContain('8:05');
    expect(viewFor('within').hint).toContain('8:05');
  });

  it('draws no time at all for an UNBOUNDED ceiling, rather than formatTime(Infinity)', () => {
    // `seekLimitSeconds` answers Number.POSITIVE_INFINITY for every unbounded case and
    // `formatTime(Infinity)` is '0:00', which on a ten-foot readout reads as a measurement
    // ("downloaded as far as 0:00") rather than as an absence. Both unbounded reasons are
    // checked, and both positions are past 0:00 so the string cannot appear innocently.
    for (const reason of ['unmeasured', 'end'] as const) {
      const view = viewFor(reason);
      expect.soft(view.hint, `${reason} hint`).not.toMatch(/0:00|Infinity|NaN/);
      expect.soft(view.commit, `${reason} commit`).not.toMatch(/0:00|Infinity|NaN/);
    }
    // And the measured-but-complete run, which is the case a reader expects to be finite:
    // `run_end === file_size` is still an infinite ceiling.
    const whole = describeScrub({
      position: 10,
      duration: DURATION,
      contiguous: run(1000),
      pending: clampSeek({ target: 900, currentTime: 10, duration: DURATION, contiguous: run(1000) }),
    });
    expect.soft(whole.hint).not.toMatch(/0:00|Infinity|NaN/);
    expect.soft(whole.hint).toMatch(/whole|all/i);
  });

  it('says what cancels the edit, because Up and Down are not the cell’s to claim', () => {
    // The scrub cell claims Left/Right only — Down off the row must keep working or the
    // cell is a trap with no Tab key to escape. So the keys that LEAVE the bar are the keys
    // that discard the edit, and a viewer who is not told loses the edit without a word.
    for (const reason of REASONS) {
      expect.soft(viewFor(reason).hint, reason).toMatch(/up or down cancels/i);
    }
    // Nothing pending, nothing to cancel: the line does not warn about a cancel that is
    // not available.
    expect(describeScrub({ position: 5, duration: DURATION, contiguous: null, pending: null }).hint).toBe('');
  });

  it('promises a jump only when OK would actually move the playhead', () => {
    // `atFrontier` answers the playhead itself: the press was refused. "OK jumps to 1:40"
    // when 1:40 is where you already are is the lying-label defect, and the refusal is the
    // thing the viewer has to see.
    const refused = viewFor('atFrontier');
    expect.soft(refused.readout).toBe('1:40');
    expect.soft(refused.commit).not.toMatch(/jumps/i);
    expect.soft(refused.commit).toMatch(/here/i);
    const moves = viewFor('clamped');
    expect.soft(moves.commit).toMatch(/jumps to 8:05/i);
  });

  it('is pure: the same state always reads the same, and the state is not touched', () => {
    const state = {
      position: 10,
      duration: DURATION,
      contiguous: run(500),
      pending: verdictFor('clamped'),
    };
    const frozen = Object.freeze({ ...state, pending: Object.freeze({ ...state.pending }) });
    expect(describeScrub(frozen)).toEqual(describeScrub(frozen));
  });

  it('steps by the ±10s the spec gives Left and Right', () => {
    // §7.4: "Left/Right give ±10s"; the remote's Rewind/Fast-Forward are ±60s jumps, which
    // are the transport row's twins, not this.
    expect(SCRUB_STEP_S).toBe(10);
  });
});
