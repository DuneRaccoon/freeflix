'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  resetStallSample,
  stallStep,
  type StallSample,
} from '@/lib/player/streamRecovery';

/**
 * Detect a wedged playhead the browser never surfaced, and say so ONCE.
 *
 * The arithmetic is the shared reducer's (`@/lib/player/streamRecovery`): the
 * epsilon, the spinner grace, the escalation threshold and the latch all live there,
 * in one definition, and this hook is the element driving and the clock around it.
 * It returns a STATUS VALUE rather than driving three `setState`s, because a readout
 * that disagrees with itself is the thing a ten-foot screen shows worst.
 *
 * TWO SHAPES HERE ARE LOAD-BEARING, NOT STYLISTIC.
 *
 * 1. THE INTERVAL LIVES IN AN EFFECT WITH `[]` DEPS, AND THE CALLBACK IS HELD IN A
 *    REF. The web's equivalent interval re-subscribes on every change of an
 *    unmemoized prop (`components/player/VideoPlayer.tsx:603 -> :658 -> :661`) and
 *    gets away with it only because its poll periods — 5000ms and 1500ms — are far
 *    above any render clock. This page re-renders on a controls-auto-hide timer, a
 *    progress poll and a scrub readout; a 1s interval rebuilt on each of those never
 *    fires, and the television would have no stall detection at all. Hazard 12.
 *
 * 2. `expectingPlayback` NEVER READS `video.paused`. `load()` — the first thing a
 *    recovery does — sets `paused` with no `pause` event, so a predicate that reads
 *    it goes quiet exactly while the reload it asked for is in flight: the web's
 *    escalation can be released by its own recovery. Intent is tracked from the
 *    EVENTS instead (`play`/`playing` arm it, `pause`/`ended` disarm it), which a
 *    silent state change cannot forge.
 *
 * SUSPENDED, NOT RE-ARMED. The escalation latch is a field on the shared sample and
 * is cleared only by `resetStallSample`, which this hook calls on `playing` and on
 * nothing else. So a freeze that is already being recovered keeps reporting
 * `buffering` and never hands out a second recovery; only playback actually
 * resuming counts as evidence that the next freeze is a new one.
 *
 * ONE ELEMENT, ONE REGISTRATION. The listeners are attached once, to whatever
 * `getVideo()` names when the effect runs, and removed on unmount. The caller owns
 * both the element and this hook in the same component, so the node is stable for
 * the hook's lifetime; a surface that remounts its `<video>` under a live watcher
 * would need a keyed remount of the watcher too, and should say so there.
 */

/**
 * The sampling cadence. NOT a shared constant, deliberately: the shared module owns
 * the thresholds, and this is the clock the caller runs them on. It must stay ~1s,
 * because `STALL_EPSILON_S` (0.25s) is tuned for a one-second window — healthy
 * playback advances ~1s per tick, and a much shorter window reads an advancing
 * playhead as frozen. That collapse was a live bug on the web
 * (`VideoPlayer.stall.test.tsx` is its regression test).
 */
export const STALL_POLL_MS = 1000;

/** What the viewer is being told. `escalate` is folded into `buffering`: the recovery is ours to run, the spinner is theirs to see. */
export type StallStatus = 'ok' | 'frozen' | 'buffering';

export interface StallWatchOptions {
  getVideo: () => HTMLVideoElement | null;
  /** Called once per freeze that crosses the escalation threshold. */
  onEscalate: () => void;
}

export function useStallWatch({ getVideo, onEscalate }: StallWatchOptions): StallStatus {
  const [status, setStatus] = useState<StallStatus>('ok');
  const sample = useRef<StallSample>(resetStallSample());
  /** Playback INTENT, from events only. Never `video.paused`. */
  const intended = useRef(false);
  const latest = useRef(onEscalate);
  const getVideoRef = useRef(getVideo);

  // Layout effect so a tick can never call the previous render's callback.
  useLayoutEffect(() => {
    latest.current = onEscalate;
    getVideoRef.current = getVideo;
  });

  useEffect(() => {
    const video = getVideoRef.current();
    if (!video) return;

    const arm = () => { intended.current = true; };
    const armAndReset = () => {
      intended.current = true;
      // The ONLY thing that clears the escalation latch.
      sample.current = resetStallSample(video.currentTime);
      setStatus('ok');
    };
    const disarm = () => { intended.current = false; };

    video.addEventListener('play', arm);
    video.addEventListener('playing', armAndReset);
    video.addEventListener('pause', disarm);
    video.addEventListener('ended', disarm);
    return () => {
      video.removeEventListener('play', arm);
      video.removeEventListener('playing', armAndReset);
      video.removeEventListener('pause', disarm);
      video.removeEventListener('ended', disarm);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const video = getVideoRef.current();
      if (!video) return;

      const { next, phase } = stallStep(sample.current, {
        position: video.currentTime,
        expectingPlayback: intended.current && !video.ended,
        nowMs: Date.now(),
      });
      sample.current = next;

      if (phase === 'escalate') latest.current();
      setStatus(phase === 'escalate' ? 'buffering' : phase);
    }, STALL_POLL_MS);
    return () => clearInterval(id);
  }, []);

  return status;
}
