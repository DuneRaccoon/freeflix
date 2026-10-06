/**
 * Regression: recovery must actually re-fetch.
 *
 * The backend now answers an unavailable first chunk with 503 + Retry-After
 * instead of holding the socket open. Nothing in the frontend keys on 503, so the
 * only thing that can save that request is the generic error-state recovery — and
 * it was a no-op. `attemptRecovery` nudged `currentTime` and called `play()`, but
 * once the element carries a MediaError its `networkState` is NETWORK_NO_SOURCE:
 * writing `currentTime` does nothing and `play()` does not re-run resource
 * selection. Only `load()` resets `networkState` and re-fetches. So all four
 * attempts did nothing and the user was pushed to "switch source".
 *
 * These tests drive the real component with a controlled <video> element and fake
 * timers, and pin both halves: load() is called, and the playhead load() reset to
 * zero is restored afterwards.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import VideoPlayer from './VideoPlayer';

const loadSpy = vi.fn();
const playSpy = vi.fn().mockResolvedValue(undefined);

beforeAll(() => {
  window.HTMLMediaElement.prototype.load = loadSpy;
  window.HTMLMediaElement.prototype.play = playSpy;
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

beforeEach(() => {
  loadSpy.mockClear();
  playSpy.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

/** Make currentTime controllable on a jsdom <video>, and give it a MediaError. */
function wireErroredVideo(video: HTMLVideoElement, code = 2) {
  let t = 0;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => t,
    set: (v: number) => { t = v; },
  });
  Object.defineProperty(video, 'error', {
    configurable: true,
    get: () => ({ code, message: 'simulated network error' }),
  });
  return { seek: (v: number) => { t = v; }, at: () => t };
}

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('VideoPlayer error recovery', () => {
  it('calls load() on the video element, not just a currentTime nudge', () => {
    const { container } = render(
      <VideoPlayer src="/test.mp4" downloadProgress={50} autoPlay={false} />
    );
    const video = container.querySelector('video')!;
    wireErroredVideo(video);

    act(() => { fireEvent.error(video); });
    // Scheduled, not immediate: the backoff ladder is unchanged.
    expect(loadSpy).not.toHaveBeenCalled();

    tick(1000);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('restores the playhead that load() reset to zero', () => {
    const { container } = render(
      <VideoPlayer src="/test.mp4" downloadProgress={50} autoPlay={false} />
    );
    const video = container.querySelector('video')!;
    const ctl = wireErroredVideo(video);

    ctl.seek(137.5);
    act(() => { fireEvent.error(video); });
    tick(1000);
    expect(loadSpy).toHaveBeenCalledTimes(1);

    // A real load() zeroes currentTime and drops readyState to HAVE_NOTHING, so
    // the restoring seek has to wait for metadata.
    ctl.seek(0);
    act(() => { fireEvent.loadedMetadata(video); });

    expect(ctl.at()).toBe(137.5);
    expect(playSpy).toHaveBeenCalled();
  });

  it('does not seek back to a position of zero', () => {
    // A failure on the very first request has nothing to restore; writing
    // currentTime = 0 would be a pointless extra seek before playback starts.
    const { container } = render(
      <VideoPlayer src="/test.mp4" downloadProgress={50} autoPlay={false} />
    );
    const video = container.querySelector('video')!;
    wireErroredVideo(video);
    const seen: number[] = [];
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => 0,
      set: (v: number) => { seen.push(v); },
    });

    act(() => { fireEvent.error(video); });
    tick(1000);
    act(() => { fireEvent.loadedMetadata(video); });

    expect(seen).toEqual([]);
    expect(playSpy).toHaveBeenCalled();
  });

  it('keeps the 1/2/4/8s ladder and gives up after four attempts', () => {
    const onRecoveryExhausted = vi.fn();
    const { container } = render(
      <VideoPlayer
        src="/test.mp4"
        downloadProgress={50}
        autoPlay={false}
        onRecoveryExhausted={onRecoveryExhausted}
      />
    );
    const video = container.querySelector('video')!;
    wireErroredVideo(video);

    const ladder = [1000, 2000, 4000, 8000];
    ladder.forEach((delay, i) => {
      act(() => { fireEvent.error(video); });
      tick(delay - 1);
      expect(loadSpy).toHaveBeenCalledTimes(i);
      tick(1);
      expect(loadSpy).toHaveBeenCalledTimes(i + 1);
    });

    // Fifth failure: exhausted, no further reload.
    act(() => { fireEvent.error(video); });
    tick(10000);
    expect(loadSpy).toHaveBeenCalledTimes(ladder.length);
    expect(onRecoveryExhausted).toHaveBeenCalledTimes(1);
  });

  it('resets the ladder once playback is healthy again', () => {
    const { container } = render(
      <VideoPlayer src="/test.mp4" downloadProgress={50} autoPlay={false} />
    );
    const video = container.querySelector('video')!;
    wireErroredVideo(video);

    act(() => { fireEvent.error(video); });
    tick(1000);
    expect(loadSpy).toHaveBeenCalledTimes(1);

    act(() => { fireEvent.playing(video); });

    // Back to the first rung: a 1s delay, not the 2s the second attempt would use.
    act(() => { fireEvent.error(video); });
    tick(999);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    tick(1);
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });
});
