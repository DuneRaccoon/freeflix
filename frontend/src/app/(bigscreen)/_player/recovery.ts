/**
 * The TV player's recovery engine: reload the element, put the playhead back.
 *
 * WHAT IS SHARED AND WHAT IS NOT. The ladder and the attempt bound come from
 * `@/lib/player/streamRecovery` — one definition, imported, never re-declared here
 * (the drift pin in `engineContract.test.ts` fails both ways: a changed table, and a
 * local copy re-inlined). The ELEMENT DRIVING below is deliberately a second copy of
 * the web's sequence (`components/player/VideoPlayer.tsx` `attemptRecovery`), because
 * the two surfaces disagree about four things the plan names: `preload`, the
 * audio-intent machine, the exhaustion latch, and the stall predicate. See
 * `docs/superpowers/plans/2026-10-10-tv-stage7-player.md` -> "The sharing decision".
 *
 * AN ELEMENT GETTER, NOT AN ELEMENT. `getVideo()` is called at every step, so a
 * remount — a new `<video>` under the same page — cannot leave this engine driving a
 * detached node. An engine holding a dead element spends the whole ladder on nothing,
 * which from the sofa is indistinguishable from a title that simply will not play.
 *
 * FOUR THINGS THIS GETS RIGHT THAT ARE EASY TO GET WRONG:
 *
 * 1. `load()` IS THE RECOVERY. Once the element carries a `MediaError` its
 *    `networkState` is `NETWORK_NO_SOURCE` — exactly what the backend's 503 for an
 *    unavailable first chunk produces. Writing `currentTime` is then a no-op and
 *    `play()` does not re-run resource selection. Only `load()` resets
 *    `networkState` and re-issues the Range request.
 * 2. THE PLAYHEAD IS CAPTURED BEFORE `load()`, and restored on a ONE-SHOT
 *    `loadedmetadata`, guarded `if (t > 0)`. `load()` zeroes `currentTime` and drops
 *    `readyState` to `HAVE_NOTHING`, so a seek written any earlier is discarded, and
 *    a restore to 0 is a pointless extra seek before playback has even started.
 * 3. EXHAUSTION LATCHES. The web returns from its exhausted branch without setting a
 *    flag, so every further error re-fires the callback. There it opens a source
 *    switcher; here there is no switcher at the end of that loop, so an unlatched
 *    exhaustion is a message that repeats forever on a dead end. `noteHealthy()` and
 *    `noteSourceChange()` are the only things that re-arm it: real playback is new
 *    evidence, an error is not.
 * 4. THE SOURCE-CHANGE CLEANUP HAS TWO JOBS — clear the pending timeout AND invoke
 *    the detach handle. Drop either and a title change leaks a reload plus a stale
 *    one-shot that will seek the NEXT title to the previous one's playhead.
 *
 * Attempts are BOUNDED, not backed off forever, and that is a backend fact rather
 * than a preference: the catch-all 503 (`backend/app/api/streaming.py` `:337`) covers
 * permanent faults — a deleted file, an invalid handle — with the same status,
 * the same `Retry-After: 2` and the same empty body as the two transient ones.
 * `backend/tests/test_stream_status_matrix.py` pins that the three are otherwise
 * indistinguishable, so there is nothing to retry forever against.
 */
import { MAX_RECOVERY_ATTEMPTS, recoveryStep } from '@/lib/player/streamRecovery';

/** What the engine is doing, for a status line that never lies about it. */
export type RecoveryStatus =
  | { kind: 'idle' }
  | { kind: 'scheduled'; attempt: number; delayMs: number }
  | { kind: 'reloading'; attempt: number }
  | { kind: 'exhausted'; attempts: number };

export interface RecoveryOptions {
  /** Called at every step: a remount must never leave the engine on a dead node. */
  getVideo: () => HTMLVideoElement | null;
  onStatus?: (status: RecoveryStatus) => void;
  debug?: boolean;
}

export interface Recovery {
  /**
   * Walk one rung. `afterMs` (a parsed `Retry-After`) can only make the wait LONGER:
   * the ladder is how soon we are willing to ask again, the server's hint is the
   * earliest it expects to be able to answer, and the later of the two respects both.
   * A backend answering `Retry-After: 0` therefore cannot turn this into a spin loop.
   */
  attempt(afterMs?: number): void;
  /** Playback is running again: re-arm the ladder and the exhaustion latch. */
  noteHealthy(): void;
  /** A new src is being loaded: reset, and do the cleanup's two jobs. */
  noteSourceChange(): void;
  /** Permanent teardown. Does the two jobs and refuses to schedule anything after. */
  dispose(): void;
}

export function createRecovery({ getVideo, onStatus, debug }: RecoveryOptions): Recovery {
  let attempts = 0;
  let exhausted = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Removes the pending one-shot `loadedmetadata` restore, if one is attached. */
  let detach: (() => void) | null = null;

  const say = (status: RecoveryStatus) => {
    if (debug) console.log('[tv recovery]', status);
    onStatus?.(status);
  };

  /** The cleanup's two jobs, in one place so no caller can do half of it. */
  const cancelPending = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (detach) detach();
  };

  const reload = () => {
    timer = null;
    const video = getVideo();
    if (!video) return;
    say({ kind: 'reloading', attempt: attempts });
    try {
      // BEFORE load(): it resets currentTime to 0 and discards every buffered range.
      const at = Math.max(0, video.currentTime);

      video.load();

      // One one-shot at a time. Without this a second attempt stacks a second
      // restore, and the older one wins the race to write a staler position.
      if (detach) detach();
      const restore = () => {
        detach = null;
        try {
          if (at > 0) video.currentTime = at;
        } catch (err) {
          if (debug) console.error('[tv recovery] seek failed', err);
        }
        // `play()` is a promise in every engine that matters and `undefined` in some
        // test doubles; neither may throw out of an event listener.
        void video.play()?.catch?.((err: unknown) => {
          if (debug) console.error('[tv recovery] play failed', err);
        });
      };
      video.addEventListener('loadedmetadata', restore, { once: true });
      detach = () => {
        video.removeEventListener('loadedmetadata', restore);
        detach = null;
      };
    } catch (err) {
      if (debug) console.error('[tv recovery] reload failed', err);
    }
  };

  return {
    attempt(afterMs?: number) {
      if (disposed) return;

      const step = recoveryStep(attempts);
      if (step.exhausted) {
        if (exhausted) return; // THE LATCH: say it once, not once per further error.
        exhausted = true;
        say({ kind: 'exhausted', attempts: MAX_RECOVERY_ATTEMPTS });
        return;
      }

      const delayMs = Math.max(step.delayMs, afterMs ?? 0);
      attempts = step.next;

      cancelPending();
      say({ kind: 'scheduled', attempt: attempts, delayMs });
      timer = setTimeout(reload, delayMs);
    },

    noteHealthy() {
      if (disposed) return;
      attempts = 0;
      exhausted = false;
      // A reload scheduled against a stream that recovered by itself would interrupt
      // the playback it was meant to rescue. The web keeps that pending timeout; this
      // surface does not, because a stall-triggered attempt is the common case here.
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      say({ kind: 'idle' });
    },

    noteSourceChange() {
      if (disposed) return;
      attempts = 0;
      exhausted = false;
      cancelPending();
      say({ kind: 'idle' });
    },

    dispose() {
      disposed = true;
      cancelPending();
    },
  };
}
