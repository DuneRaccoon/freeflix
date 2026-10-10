/**
 * streamRecovery — the stall/recovery ARITHMETIC, shared by both players.
 *
 * Pure. No React, no DOM, one import (`@/types`, for `StreamHealthState`). That is
 * what makes it importable from `src/app/(bigscreen)`: the TV's import guard
 * (`legacy-target.test.ts`) blocks `@/components` one hop deep, and a module that
 * reaches only `@/types` passes it.
 *
 * WHY IT EXISTS. These five constants were component-body locals in
 * `components/player/VideoPlayer.tsx` — re-created on every render, therefore
 * unimportable and invisible to every test. The TV player needs the same ladder and
 * the same thresholds; a second copy of a backoff table is the drift class this repo
 * has already been bitten by. The ELEMENT DRIVING (load() / restore on
 * `loadedmetadata` / play()) is deliberately NOT here: each surface owns its own,
 * because the two disagree about `preload`, the audio-intent machine, the exhaustion
 * latch and the stall predicate. See
 * `docs/superpowers/plans/2026-10-10-tv-stage7-player.md` → "The sharing decision".
 *
 * THREE CONTRACTS THAT KEEP IT HONEST:
 *
 * 1. `expectingPlayback` is an INPUT, never a predicate this module computes. The web
 *    passes `isPlaying && !video.paused && !video.ended` — including the race where
 *    `load()` sets `paused` without firing `pause`, so the escalation can be released
 *    by the recovery that triggered it. The TV will pass a predicate that never reads
 *    `video.paused`. The divergence lives in the callers; this module cannot see it.
 *
 * 2. `streamAdvice` takes `busy`, and it gates BOTH branches. The web still shows
 *    "Waiting for peers (0 connected)" on a finished 0-peer title playing fine from
 *    disk — a real, PARKED bug (`VideoPlayer.tsx` healthMessage) — and the TV passes
 *    the real value so it does not inherit it.
 *    Do NOT read this as "the web passes `true` and consumes the verdict directly":
 *    that was this header's original claim and it is wrong. The web gated its SLOW
 *    branch on `isBuffering || isStalled` and its noPeers branch on nothing, so a bare
 *    `true` would show "slow connection" during healthy playback. `busy` gating both
 *    branches here is what lets `busy: false` + 0 peers answer 'none' (the row that
 *    stops the TV inheriting the lie), and the `isBuffering || isStalled` conjunct
 *    therefore STAYS at the web call site, on the slow branch only. Pinned by
 *    `VideoPlayer.health.test.tsx` — removing that conjunct reddens exactly one row.
 *
 * 3. The escalation latch is a FIELD ON THE SAMPLE (`escalated`), cleared only by an
 *    explicit `resetStallSample()`. `stallStep` never clears its own latch from a
 *    predicate — that is exactly how a reducer re-fires a recovery it already started.
 *
 * Non-vacuity, not argued: shorten a rung in `RECOVERY_BACKOFF_MS` and the EXISTING
 * web suite `components/player/VideoPlayer.recovery.test.tsx` goes red, because it
 * hard-codes `[1000, 2000, 4000, 8000]` and ticks `delay - 1` then `1`. That is the
 * only evidence the web reads this table rather than keeping a copy of it.
 */

import { StreamHealthState } from '@/types';

/**
 * Bounded exponential backoff (1·2·4·8s). Each rung's delay precedes the attempt it
 * indexes, so rung 0 is the first attempt's wait.
 */
export const RECOVERY_BACKOFF_MS = [1000, 2000, 4000, 8000] as const;

/** Derived, never a second literal: the ladder's length IS the attempt bound. */
export const MAX_RECOVERY_ATTEMPTS = RECOVERY_BACKOFF_MS.length;

/**
 * Stall-detector tuning. The playhead is sampled once per ~1s tick, so healthy
 * playback advances ~1s (>=0.5s even at 0.5x) between ticks — far above
 * STALL_EPSILON_S — while a genuinely frozen playhead advances ~0.
 */
export const STALL_EPSILON_S = 0.25;

/**
 * The sustained-freeze grace before WE surface a spinner. The browser's native
 * `waiting` event still shows one instantly on a real underrun; this only covers
 * wedges `waiting` never reported.
 */
export const STALL_SPINNER_MS = 2000;

/** How long a freeze must hold before we escalate to a recovery attempt. */
export const STALL_ESCALATE_MS = 10000;

export type RecoveryStep =
  | { exhausted: true }
  | { exhausted: false; delayMs: number; next: number };

/**
 * The ladder, as arithmetic: given the number of attempts already spent, how long to
 * wait and what the count becomes. `exhausted` is terminal — an exhausted attempt
 * count stays exhausted, however far past the bound it is pushed.
 */
export function recoveryStep(attempt: number): RecoveryStep {
  if (attempt >= MAX_RECOVERY_ATTEMPTS) return { exhausted: true };
  return { exhausted: false, delayMs: RECOVERY_BACKOFF_MS[attempt], next: attempt + 1 };
}

/**
 * The stall detector's whole memory between ticks.
 *
 * `position` is the playhead sampled on the PREVIOUS tick — a true ~1s window. A
 * caller that refreshes it from a high-frequency handler (`timeupdate`) collapses the
 * window to a few ms, so an advancing playhead reads as frozen and the overlay flashes
 * during healthy playback. That was a live bug; `VideoPlayer.stall.test.tsx` is its
 * regression test and the value-level pin lives in this module's own suite.
 *
 * `escalated` is the latch: set when a recovery is handed out, and cleared ONLY by
 * `resetStallSample`.
 */
export type StallSample = {
  position: number;
  frozenSinceMs: number | null;
  escalated: boolean;
};

/**
 * - `ok`        — advancing, or not expecting playback. Any freeze bookkeeping is gone.
 * - `frozen`    — frozen, but not long enough to say anything to the viewer yet.
 * - `buffering` — frozen past STALL_SPINNER_MS: surface the spinner.
 * - `escalate`  — frozen past STALL_ESCALATE_MS with the latch open. SUBSUMES
 *                 `buffering`: a caller that surfaces a spinner on `buffering` must
 *                 surface it on `escalate` too (STALL_ESCALATE_MS > STALL_SPINNER_MS,
 *                 so the web's two independent `if`s both fired on the same tick).
 */
export type StallPhase = 'ok' | 'frozen' | 'buffering' | 'escalate';

/** A fresh sample. The ONLY thing that clears the escalation latch. */
export function resetStallSample(position = 0): StallSample {
  return { position, frozenSinceMs: null, escalated: false };
}

/**
 * One tick of the stall detector. Pure: the caller owns the clock, the playhead and
 * the question of whether playback is expected at all.
 */
export function stallStep(
  prev: StallSample,
  input: { position: number; expectingPlayback: boolean; nowMs: number },
): { next: StallSample; phase: StallPhase } {
  const { position, expectingPlayback, nowMs } = input;

  // Strictly greater than: a delta of exactly the epsilon is NOT movement.
  const advanced = Math.abs(position - prev.position) > STALL_EPSILON_S;

  if (advanced || !expectingPlayback) {
    // Healthy, or intentionally paused/ended — tear down the freeze bookkeeping. The
    // latch is NOT cleared here; only resetStallSample does that.
    return {
      next: { position, frozenSinceMs: null, escalated: prev.escalated },
      phase: 'ok',
    };
  }

  if (prev.frozenSinceMs === null) {
    // First tick across which the playhead did not move: start the clock, say nothing.
    return {
      next: { position, frozenSinceMs: nowMs, escalated: prev.escalated },
      phase: 'frozen',
    };
  }

  const frozenMs = nowMs - prev.frozenSinceMs;
  const held: StallSample = {
    position,
    frozenSinceMs: prev.frozenSinceMs,
    escalated: prev.escalated,
  };

  if (frozenMs > STALL_ESCALATE_MS && !prev.escalated) {
    return { next: { ...held, escalated: true }, phase: 'escalate' };
  }
  if (frozenMs > STALL_SPINNER_MS) {
    return { next: held, phase: 'buffering' };
  }
  return { next: held, phase: 'frozen' };
}

/**
 * What a stream's health is worth SAYING, separated from the copy that says it.
 *
 * `busy` is the caller's "we are actually waiting on this stream right now". Without
 * it, a finished 0-peer torrent playing perfectly from disk reads as a dead swarm —
 * which is what the web does today, because it passes `true`. Returning `'none'` for
 * `busy: false` is the whole reason this argument exists.
 */
export type StreamAdvice = 'none' | 'noPeers' | 'slow';

export function streamAdvice(
  health: StreamHealthState | null | undefined,
  busy: boolean,
): StreamAdvice {
  if (!health) return 'none';
  if (!busy) return 'none';
  if (health.health === 'dead' || health.num_peers === 0) return 'noPeers';
  return 'slow';
}
