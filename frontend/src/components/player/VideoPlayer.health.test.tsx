/**
 * The health chip, which is the ONLY reader of `streamAdvice` on this surface.
 *
 * Why this suite exists: task 4 moved the stall thresholds, the backoff ladder and the
 * health-advice predicate into `@/lib/player/streamRecovery`, and the first two are
 * pinned across the seam by suites that already existed — shorten a rung and
 * `VideoPlayer.recovery.test.tsx` goes red; raise STALL_SPINNER_MS and
 * `VideoPlayer.stall.test.tsx` goes red. The third had NOTHING: stubbing `streamAdvice`
 * to `return 'none'` left the entire frontend suite green (122 files / 1894 tests),
 * because nothing anywhere asserted this copy. So the one definition this surface
 * shares with the television rested on tsc and on reading the diff.
 *
 * The rows below are the web's behaviour TODAY, bugs included, and two of them are
 * there to make a specific future edit fail:
 *
 *  - `VideoPlayer` passes `busy: true` to `streamAdvice` UNCONDITIONALLY, so the
 *    no-peers copy appears on a finished 0-peer title that is playing perfectly from
 *    disk. That is a real defect, PARKED (see the plan's deferral table) — and pinned
 *    here, because it is also the evidence this surface still passes `true`. The TV
 *    passes the real value and does not inherit it.
 *  - because `busy` gates both of `streamAdvice`'s branches, the `isBuffering ||
 *    isStalled` term has to stay at the CALL SITE, on the slow branch only. Hand it to
 *    the reducer instead and the chip starts saying "Buffering — slow connection" over
 *    healthy playback. The "says nothing over a connected swarm" row is what fails.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { StreamHealthState } from '@/types';
import VideoPlayer from './VideoPlayer';

beforeAll(() => {
  window.HTMLMediaElement.prototype.load = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => { vi.runOnlyPendingTimers(); });
  vi.useRealTimers();
});

const health = (over: Partial<StreamHealthState> = {}): StreamHealthState => ({
  stream_phase: 'ready',
  num_seeds: 4,
  num_peers: 4,
  download_rate: 500,
  health: 'healthy',
  ...over,
});

/**
 * Mount with a health reading. The buffering overlay that HOSTS the chip is already up
 * on the first paint (`isLoading` starts true), so "no chip" rows below are genuinely
 * "the chip was not rendered", not "its container was missing".
 */
function mount(streamHealth?: StreamHealthState) {
  const r = render(
    <VideoPlayer
      src="/test.mp4"
      downloadProgress={50}
      autoPlay={false}
      streamHealth={streamHealth}
    />
  );
  expect(r.queryByTestId('buffering-overlay')).not.toBeNull();
  return { ...r, video: r.container.querySelector('video')! };
}

/** The native underrun the browser reports: this is what makes the player busy. */
const startBuffering = (video: HTMLVideoElement) =>
  act(() => { fireEvent.waiting(video); });

const chip = (q: ReturnType<typeof mount>) => q.queryByTestId('player-health-message');

describe('VideoPlayer health chip', () => {
  it('says nothing without a health reading', () => {
    const q = mount(undefined);
    startBuffering(q.video);
    expect(chip(q)).toBeNull();
  });

  it('reports a dead swarm while buffering', () => {
    const q = mount(health({ health: 'dead', num_peers: 0, num_seeds: 0 }));
    startBuffering(q.video);
    expect(chip(q)!.textContent).toBe('Waiting for peers (0 connected)');
  });

  it('reports zero peers even when the health tier disagrees', () => {
    const q = mount(health({ health: 'low', num_peers: 0 }));
    startBuffering(q.video);
    expect(chip(q)!.textContent).toBe('Waiting for peers (0 connected)');
  });

  it('reports a connected but struggling swarm, with the peer count', () => {
    const q = mount(health({ health: 'low', num_peers: 3 }));
    startBuffering(q.video);
    expect(chip(q)!.textContent).toBe('Buffering — slow connection (3 peers)');
  });

  it('says "1 peer", not "1 peers"', () => {
    const q = mount(health({ health: 'low', num_peers: 1 }));
    startBuffering(q.video);
    expect(chip(q)!.textContent).toBe('Buffering — slow connection (1 peer)');
  });

  it('says nothing over a connected swarm we are NOT waiting on', () => {
    // THE conjunct row. The overlay is up (first paint), the swarm is alive, and the
    // player is not buffering or stalled — so there is nothing to say. Hand the real
    // `busy` to `streamAdvice` and drop the `isBuffering || isStalled` term from the
    // call site and this is the row that fails: the chip appears over healthy playback.
    const q = mount(health({ health: 'low', num_peers: 3 }));
    expect(chip(q)).toBeNull();
  });

  it('still blames the swarm at 0 peers when we are NOT waiting on it (PARKED defect)', () => {
    // NOT a fix: this is the web's behaviour today and the evidence it still passes
    // `busy: true`. A finished 0-peer title playing fine from disk reads as broken. If
    // this row ever goes red because the chip went quiet, the change is deliberate —
    // delete the row and the parked finding together.
    const q = mount(health({ health: 'dead', num_peers: 0, num_seeds: 0 }));
    expect(chip(q)!.textContent).toBe('Waiting for peers (0 connected)');
  });
});
