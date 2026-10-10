/**
 * The TV stall detector.
 *
 * THE TEST NO EXISTING SUITE CAN HAVE is `escalates while the page re-renders
 * faster than the poll period`. The web's equivalent interval is re-created on every
 * change of an unmemoized prop (`VideoPlayer.tsx:603 -> :658 -> :661`) and survives
 * only because its own poll periods are 5000/1500ms — comfortably above a render
 * clock. A TV page re-renders on a controls-auto-hide timer, a progress poll and a
 * scrub readout, so the same shape would leave the television with NO stall
 * detection at all. Hazard 12.
 *
 * The other half is the predicate: `expectingPlayback` must not read `video.paused`,
 * because `load()` — the first thing a recovery does — sets `paused` with no `pause`
 * event. A detector that reads it disarms itself at the exact moment it should be
 * watching the recovery it just asked for.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { STALL_ESCALATE_MS, STALL_SPINNER_MS } from '@/lib/player/streamRecovery';
import { STALL_POLL_MS, useStallWatch, type StallStatus } from './useStallWatch';

beforeAll(() => {
  window.HTMLMediaElement.prototype.load = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.restoreAllMocks();
  // In act(): this hook runs BEFORE testing-library's cleanup (vitest unwinds
  // afterEach in reverse registration order), so the host is still mounted and the
  // interval's setState would otherwise land outside act.
  act(() => { vi.runOnlyPendingTimers(); });
  vi.useRealTimers();
});

const MEDIA_EVENTS = ['play', 'playing', 'pause', 'ended'];

/** The host: a real <video>, the hook over a getter, and a status readout. */
function Host({
  onEscalate,
  onStatus,
  rerenderEveryMs,
  onRender,
}: {
  onEscalate: () => void;
  onStatus?: (s: StallStatus) => void;
  /** Re-render on this clock, handing the hook a FRESH callback closure each time. */
  rerenderEveryMs?: number;
  /** Receives each render's callback identity, so freshness is measured, not assumed. */
  onRender?: (cb: () => void) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!rerenderEveryMs) return;
    const id = setInterval(() => bump((n) => n + 1), rerenderEveryMs);
    return () => clearInterval(id);
  }, [rerenderEveryMs]);
  // A new arrow every render: the thing a dep array would latch onto.
  const cb = () => onEscalate();
  onRender?.(cb);
  const status = useStallWatch({ getVideo: () => ref.current, onEscalate: cb });
  onStatus?.(status);
  return <video ref={ref} preload="metadata" data-status={status} />;
}

/** currentTime under test control; `paused`/`ended` default to a playing element. */
function controlVideo(video: HTMLVideoElement) {
  let t = 10;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => t,
    set: (v: number) => { t = v; },
  });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
  Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
  return {
    seek: (v: number) => { t = v; },
    /** What `load()` does: paused goes true and NO pause event is fired. */
    silentlyPause: () => {
      Object.defineProperty(video, 'paused', { configurable: true, get: () => true });
    },
    end: () => {
      Object.defineProperty(video, 'ended', { configurable: true, get: () => true });
    },
  };
}

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

function mount(opts: Partial<Parameters<typeof Host>[0]> = {}) {
  const onEscalate = opts.onEscalate ?? vi.fn();
  const seen: StallStatus[] = [];
  const callbacks = new Set<() => void>();
  const view = render(
    <Host
      onEscalate={onEscalate}
      onStatus={(s) => seen.push(s)}
      rerenderEveryMs={opts.rerenderEveryMs}
      onRender={(cb) => callbacks.add(cb)}
    />,
  );
  const video = view.container.querySelector('video')!;
  return { ...view, video, onEscalate: onEscalate as ReturnType<typeof vi.fn>, seen, callbacks };
}

describe('useStallWatch', () => {
  it('says nothing while the playhead advances', () => {
    const { video, onEscalate } = mount();
    const ctl = controlVideo(video);
    act(() => { fireEvent.playing(video); });

    for (let i = 1; i <= 20; i++) {
      // From 10: `playing` sampled the playhead where it stood, so i must start at 1
      // or the first tick is a genuine freeze. (It did; this is measured.)
      ctl.seek(10 + i);
      tick(STALL_POLL_MS);
      expect(video.dataset.status).toBe('ok');
    }
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('walks frozen -> buffering -> escalate on the shared thresholds', () => {
    const { video, onEscalate } = mount();
    controlVideo(video);
    act(() => { fireEvent.playing(video); });

    tick(STALL_POLL_MS);
    expect(video.dataset.status).toBe('frozen');

    // Still inside the spinner grace: a single slow tick must not flash an overlay.
    tick(STALL_SPINNER_MS);
    expect(video.dataset.status).toBe('frozen');
    expect(onEscalate).not.toHaveBeenCalled();

    tick(STALL_POLL_MS);
    expect(video.dataset.status).toBe('buffering');
    expect(onEscalate).not.toHaveBeenCalled();

    // Up to, but not past, the escalation threshold.
    tick(STALL_ESCALATE_MS - STALL_SPINNER_MS - STALL_POLL_MS);
    expect(onEscalate).not.toHaveBeenCalled();

    tick(STALL_POLL_MS);
    expect(onEscalate).toHaveBeenCalledTimes(1);
    // `escalate` subsumes `buffering`, so the viewer-visible state does not regress.
    expect(video.dataset.status).toBe('buffering');
  });

  it('escalates even while the page re-renders five times a second', () => {
    // THE TEST NO EXISTING SUITE CAN HAVE. Put the callback in the interval effect's
    // dep array and the interval is torn down and rebuilt every 200ms, so the 1s tick
    // never arrives and the television has no stall detection whatsoever.
    const { video, onEscalate, callbacks } = mount({ rerenderEveryMs: 200 });
    controlVideo(video);
    act(() => { fireEvent.playing(video); });

    // ONE act() PER SLICE, and that detail is the whole test. A single
    // `advanceTimersByTime(12000)` inside one act() runs every timer callback before
    // React commits ANY of the queued state updates, so the effect never re-runs and
    // the dep-array mutation stays green — measured, and it is how this test first
    // failed to fail. Slicing makes React commit between slices, which is what a
    // browser does.
    for (let i = 0; i < (STALL_ESCALATE_MS + STALL_POLL_MS * 2) / 200; i++) tick(200);

    // Non-vacuity: the page really did re-render faster than the poll period, and the
    // hook really was handed a different closure each time.
    expect(callbacks.size).toBeGreaterThan(50);
    expect(onEscalate).toHaveBeenCalledTimes(1);
  });

  it('stays armed across a load() that sets paused without firing pause', () => {
    // The web's predicate is `isPlaying && !video.paused && !video.ended`, and this is
    // the state a recovery's own `load()` leaves behind. Read `paused` here and the
    // detector goes quiet exactly while the reload it asked for is in flight.
    const { video, onEscalate } = mount();
    const ctl = controlVideo(video);
    act(() => { fireEvent.playing(video); });

    ctl.silentlyPause();
    tick(STALL_ESCALATE_MS + STALL_POLL_MS * 2);
    expect(onEscalate).toHaveBeenCalledTimes(1);
  });

  it('disarms on a real pause event, and re-arms on playing', () => {
    const { video, onEscalate } = mount();
    controlVideo(video);
    act(() => { fireEvent.playing(video); });
    act(() => { fireEvent.pause(video) });

    tick(STALL_ESCALATE_MS * 2);
    expect(onEscalate).not.toHaveBeenCalled();
    expect(video.dataset.status).toBe('ok');

    act(() => { fireEvent.playing(video); });
    tick(STALL_ESCALATE_MS + STALL_POLL_MS * 2);
    expect(onEscalate).toHaveBeenCalledTimes(1);
  });

  it('does not escalate a finished film', () => {
    const { video, onEscalate } = mount();
    const ctl = controlVideo(video);
    act(() => { fireEvent.playing(video); });
    ctl.end();

    tick(STALL_ESCALATE_MS * 2);
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('suspends after escalating: it is re-armed by playback, never by another tick', () => {
    // While a recovery is in flight the detector must not hand out a second one. The
    // latch lives on the shared sample and only a `playing` event clears it, so the
    // ladder is walked by errors and real freezes rather than by the clock.
    const { video, onEscalate } = mount();
    controlVideo(video);
    act(() => { fireEvent.playing(video); });

    tick(STALL_ESCALATE_MS + STALL_POLL_MS * 2);
    expect(onEscalate).toHaveBeenCalledTimes(1);

    tick(STALL_ESCALATE_MS * 3);
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(video.dataset.status).toBe('buffering');

    act(() => { fireEvent.playing(video); });
    expect(video.dataset.status).toBe('ok');
    tick(STALL_ESCALATE_MS + STALL_POLL_MS * 2);
    expect(onEscalate).toHaveBeenCalledTimes(2);
  });

  it('registers its element listeners once, however often the page renders', () => {
    const addSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    const removeSpy = vi.spyOn(HTMLElement.prototype, 'removeEventListener');
    const view = mount({ rerenderEveryMs: 200 });
    controlVideo(view.video);

    // React attaches its own listeners for every media event to every <video> it
    // creates, whatever the props, so the absolute count is not the hook's alone (it
    // was 12 at mount for four event names). What IS the hook's alone: the count must
    // not GROW as the page re-renders, and the unmount must take exactly the hook's
    // four away. React removes none of its own on unmount — also measured.
    const added = () => addSpy.mock.calls.filter(([t]) => MEDIA_EVENTS.includes(t as string)).length;
    const afterMount = added();
    expect(afterMount).toBeGreaterThan(0);

    tick(5000); // ~25 re-renders
    expect(added()).toBe(afterMount);

    view.unmount();
    const removed = removeSpy.mock.calls.filter(([t]) => MEDIA_EVENTS.includes(t as string)).length;
    expect(removed).toBe(MEDIA_EVENTS.length);
    expect(vi.getTimerCount()).toBe(0);
  });
});
