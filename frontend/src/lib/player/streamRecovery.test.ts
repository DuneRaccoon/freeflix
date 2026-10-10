/**
 * The shared stall/recovery arithmetic, as tables.
 *
 * No DOM, no React, no timers: everything here is a value in and a value out, which
 * is the point of extracting it. The ELEMENT-level behaviour stays pinned where it
 * already was — `components/player/VideoPlayer.recovery.test.tsx` and
 * `.stall.test.tsx` for the web, `(bigscreen)/_player/` for the TV — and those two
 * suites are also the non-vacuity proof for this file: shorten a rung below, or raise
 * STALL_SPINNER_MS, and the existing web suites go red because the web now reads
 * these constants instead of its own copies.
 */
import { describe, it, expect } from 'vitest';
import { StreamHealthState } from '@/types';
import {
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_BACKOFF_MS,
  STALL_EPSILON_S,
  STALL_ESCALATE_MS,
  STALL_SPINNER_MS,
  StallSample,
  recoveryStep,
  resetStallSample,
  stallStep,
  streamAdvice,
} from './streamRecovery';

// ---------------------------------------------------------------------------
// The tuning values themselves
// ---------------------------------------------------------------------------
describe('tuning constants', () => {
  it('is the 1/2/4/8s ladder, and the bound is its length', () => {
    // Pinned by value because BOTH surfaces read these, and the web's existing
    // recovery suite hard-codes the same four numbers.
    expect([...RECOVERY_BACKOFF_MS]).toEqual([1000, 2000, 4000, 8000]);
    expect(MAX_RECOVERY_ATTEMPTS).toBe(4);
    expect(MAX_RECOVERY_ATTEMPTS).toBe(RECOVERY_BACKOFF_MS.length);
  });

  it('keeps the thresholds ordered: epsilon, then spinner, then escalation', () => {
    // `escalate` subsumes `buffering` only while this ordering holds.
    expect(STALL_EPSILON_S).toBe(0.25);
    expect(STALL_SPINNER_MS).toBe(2000);
    expect(STALL_ESCALATE_MS).toBe(10000);
    expect(STALL_SPINNER_MS).toBeLessThan(STALL_ESCALATE_MS);
  });
});

// ---------------------------------------------------------------------------
// recoveryStep
// ---------------------------------------------------------------------------
describe('recoveryStep', () => {
  it('walks the four rungs, each delay with the count it produces', () => {
    expect(recoveryStep(0)).toEqual({ exhausted: false, delayMs: 1000, next: 1 });
    expect(recoveryStep(1)).toEqual({ exhausted: false, delayMs: 2000, next: 2 });
    expect(recoveryStep(2)).toEqual({ exhausted: false, delayMs: 4000, next: 3 });
    expect(recoveryStep(3)).toEqual({ exhausted: false, delayMs: 8000, next: 4 });
  });

  it('is exhausted once the ladder is spent', () => {
    expect(recoveryStep(MAX_RECOVERY_ATTEMPTS)).toEqual({ exhausted: true });
  });

  it('stays exhausted — there is no wrap and no fifth rung', () => {
    // The web's `onRecoveryExhausted` fires from this branch on every further error,
    // so it must be terminal rather than cyclic.
    expect(recoveryStep(5)).toEqual({ exhausted: true });
    expect(recoveryStep(99)).toEqual({ exhausted: true });
  });

  it('never hands out an undefined delay', () => {
    for (let a = 0; a <= MAX_RECOVERY_ATTEMPTS + 2; a++) {
      const step = recoveryStep(a);
      if (!step.exhausted) expect(Number.isFinite(step.delayMs)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// stallStep
// ---------------------------------------------------------------------------
const playing = (position: number, nowMs: number) => ({
  position,
  expectingPlayback: true,
  nowMs,
});

describe('stallStep', () => {
  it('reads an advancing playhead as healthy across the ~1s window', () => {
    // The `.stall` suite's scenario as a value: the previous SAMPLE is where the last
    // tick left it, not where a `timeupdate` just was.
    const { next, phase } = stallStep(resetStallSample(0), playing(10, 1_000));
    expect(phase).toBe('ok');
    expect(next).toEqual({ position: 10, frozenSinceMs: null, escalated: false });
  });

  it('reads a window collapsed onto the live position as frozen', () => {
    // The bug `.stall.test.tsx` exists for, stated as arithmetic: if a high-frequency
    // handler refreshes `position` to the live playhead, the delta is ~0 and healthy
    // playback reads as a freeze.
    const { phase } = stallStep(resetStallSample(10), playing(10, 1_000));
    expect(phase).toBe('frozen');
  });

  it('treats a delta of exactly the epsilon as NOT movement', () => {
    // `>` and not `>=`: the comparison is strict in both directions.
    expect(stallStep(resetStallSample(5), playing(5 + STALL_EPSILON_S, 1_000)).phase)
      .toBe('frozen');
    expect(stallStep(resetStallSample(5), playing(5 + STALL_EPSILON_S + 0.01, 1_000)).phase)
      .toBe('ok');
  });

  it('counts a backwards jump as movement too', () => {
    expect(stallStep(resetStallSample(90), playing(10, 1_000)).phase).toBe('ok');
  });

  it('starts the clock on the first frozen tick and says nothing yet', () => {
    const { next, phase } = stallStep(resetStallSample(10), playing(10, 5_000));
    expect(phase).toBe('frozen');
    expect(next.frozenSinceMs).toBe(5_000);
  });

  it('holds frozen below the spinner grace', () => {
    const frozen: StallSample = { position: 10, frozenSinceMs: 1_000, escalated: false };
    expect(stallStep(frozen, playing(10, 1_000 + STALL_SPINNER_MS)).phase).toBe('frozen');
  });

  it('surfaces buffering after a 6s freeze', () => {
    const frozen: StallSample = { position: 10, frozenSinceMs: 1_000, escalated: false };
    const { next, phase } = stallStep(frozen, playing(10, 7_000));
    expect(phase).toBe('buffering');
    // The clock is NOT restarted — the freeze is still the same freeze.
    expect(next.frozenSinceMs).toBe(1_000);
  });

  it('escalates after a 10s freeze, exactly once, and latches', () => {
    const frozen: StallSample = { position: 10, frozenSinceMs: 1_000, escalated: false };
    const first = stallStep(frozen, playing(10, 1_000 + STALL_ESCALATE_MS + 1));
    expect(first.phase).toBe('escalate');
    expect(first.next.escalated).toBe(true);

    // Every later tick of the SAME freeze must not hand out a second recovery.
    let sample = first.next;
    for (const t of [13_000, 20_000, 60_000]) {
      const step = stallStep(sample, playing(10, t));
      expect(step.phase).toBe('buffering');
      expect(step.next.escalated).toBe(true);
      sample = step.next;
    }
  });

  it('does not escalate at exactly the escalation threshold', () => {
    const frozen: StallSample = { position: 10, frozenSinceMs: 1_000, escalated: false };
    expect(stallStep(frozen, playing(10, 1_000 + STALL_ESCALATE_MS)).phase).toBe('buffering');
  });

  it('does not clear its own latch when the playhead recovers', () => {
    // The reducer never re-arms itself from a predicate: an `ok` tick drops the freeze
    // clock but leaves the latch exactly where it was. Only resetStallSample re-arms.
    const latched: StallSample = { position: 10, frozenSinceMs: 1_000, escalated: true };
    const { next, phase } = stallStep(latched, playing(30, 2_000));
    expect(phase).toBe('ok');
    expect(next.frozenSinceMs).toBeNull();
    expect(next.escalated).toBe(true);
  });

  it('re-arms on an explicit reset', () => {
    const latched: StallSample = { position: 10, frozenSinceMs: 1_000, escalated: true };
    const rearmed = resetStallSample(latched.position);
    expect(rearmed).toEqual({ position: 10, frozenSinceMs: null, escalated: false });

    // And a fresh freeze escalates again.
    const frozen = stallStep(rearmed, playing(10, 1_000));
    expect(frozen.phase).toBe('frozen');
    expect(stallStep(frozen.next, playing(10, 12_000)).phase).toBe('escalate');
  });

  it('clears a long freeze without escalating when playback is not expected', () => {
    // Paused or ended: the playhead is frozen BECAUSE the viewer asked for that.
    const frozen: StallSample = { position: 10, frozenSinceMs: 1_000, escalated: false };
    const { next, phase } = stallStep(frozen, {
      position: 10,
      expectingPlayback: false,
      nowMs: 60_000,
    });
    expect(phase).toBe('ok');
    expect(next.frozenSinceMs).toBeNull();
    expect(next.escalated).toBe(false);
  });

  it('keeps sampling the playhead even on an ok tick', () => {
    // The sample must advance whether or not playback is expected, or the first tick
    // after a pause compares against a stale position.
    const { next } = stallStep(resetStallSample(0), {
      position: 42,
      expectingPlayback: false,
      nowMs: 1_000,
    });
    expect(next.position).toBe(42);
  });

  it('does not mutate the sample it was given', () => {
    const prev: StallSample = { position: 10, frozenSinceMs: 1_000, escalated: false };
    stallStep(prev, playing(10, 30_000));
    expect(prev).toEqual({ position: 10, frozenSinceMs: 1_000, escalated: false });
  });
});

// ---------------------------------------------------------------------------
// streamAdvice
// ---------------------------------------------------------------------------
const health = (over: Partial<StreamHealthState> = {}): StreamHealthState => ({
  stream_phase: 'ready',
  num_seeds: 4,
  num_peers: 4,
  download_rate: 500,
  health: 'healthy',
  ...over,
});

describe('streamAdvice', () => {
  it('says nothing without a health reading', () => {
    expect(streamAdvice(undefined, true)).toBe('none');
    expect(streamAdvice(null, true)).toBe('none');
  });

  it('reports a dead swarm as noPeers', () => {
    expect(streamAdvice(health({ health: 'dead', num_peers: 0 }), true)).toBe('noPeers');
  });

  it('reports zero peers as noPeers even when the health tier disagrees', () => {
    expect(streamAdvice(health({ health: 'low', num_peers: 0 }), true)).toBe('noPeers');
  });

  it('reports a connected but struggling swarm as slow', () => {
    expect(streamAdvice(health({ health: 'low', num_peers: 2 }), true)).toBe('slow');
    expect(streamAdvice(health({ health: 'healthy', num_peers: 9 }), true)).toBe('slow');
  });

  it('says nothing at all when we are not waiting on the stream', () => {
    // THE reason `busy` exists: a finished 0-peer torrent playing perfectly from disk
    // is not a dead swarm, it is a title that no longer needs one. The web passes
    // `true` here and keeps its copy; the TV passes the real value.
    expect(streamAdvice(health({ health: 'dead', num_peers: 0 }), false)).toBe('none');
    expect(streamAdvice(health({ health: 'low', num_peers: 2 }), false)).toBe('none');
    expect(streamAdvice(health(), false)).toBe('none');
  });
});
