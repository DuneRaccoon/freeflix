/**
 * Regression: the "buffering" overlay must NOT appear during healthy playback.
 *
 * Root cause (fixed): handleTimeUpdate used to overwrite the stall detector's
 * position ref on every 'timeupdate' (~4-60x/sec), collapsing checkForStall's
 * intended ~1s comparison window down to the few-ms gap since the last timeupdate.
 * A normally-advancing playhead was then read as "not moved" -> the overlay
 * flashed on during perfectly healthy playback. These tests drive the real
 * component with a controlled <video> element and fake timers.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
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
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

/** Make currentTime / paused / ended controllable on a jsdom <video>. */
function controlVideo(video: HTMLVideoElement) {
  let t = 0;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => t,
    set: (v: number) => { t = v; },
  });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
  Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
  return { seek: (v: number) => { t = v; } };
}

const tick = (ms = 1000) => act(() => { vi.advanceTimersByTime(ms); });

describe('VideoPlayer stall detection', () => {
  it('does NOT show the buffering overlay while the playhead is advancing', () => {
    const { container, queryByTestId } = render(
      <VideoPlayer src="/test.mp4" downloadProgress={100} autoPlay={false} />
    );
    const video = container.querySelector('video')!;
    const ctl = controlVideo(video);

    // Enter a normal playing state (clears the initial isLoading overlay).
    ctl.seek(10);
    act(() => { fireEvent.playing(video); });
    // A 'timeupdate' lands right before the stall check — the pathological timing
    // that used to overwrite the stall ref to the live position.
    act(() => { fireEvent.timeUpdate(video); });

    // One stall-check tick with the playhead where the timeupdate left it. The
    // playhead has advanced 0 -> 10 across the window: healthy, no overlay.
    tick(1000);
    expect(queryByTestId('buffering-overlay')).toBeNull();

    // Keep advancing normally over several seconds; overlay must stay hidden.
    for (let s = 11; s <= 15; s++) {
      ctl.seek(s);
      act(() => { fireEvent.timeUpdate(video); });
      tick(1000);
      expect(queryByTestId('buffering-overlay')).toBeNull();
    }
  });

  it('DOES show the buffering overlay when the playhead is genuinely frozen', () => {
    const { container, queryByTestId } = render(
      <VideoPlayer src="/test.mp4" downloadProgress={100} autoPlay={false} />
    );
    const video = container.querySelector('video')!;
    const ctl = controlVideo(video);

    ctl.seek(10);
    act(() => { fireEvent.playing(video); });

    // Prime the detector at t=10 (first tick reads advance 0->10, syncs sample).
    tick(1000);
    expect(queryByTestId('buffering-overlay')).toBeNull();

    // Freeze the playhead and let the stall accumulate past the spinner threshold.
    tick(6000);
    expect(queryByTestId('buffering-overlay')).not.toBeNull();
  });
});
