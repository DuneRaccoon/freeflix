/**
 * The TV recovery engine, driven through a real <video> element.
 *
 * WHY A REAL ELEMENT. The five assertions ported from the web's
 * `components/player/VideoPlayer.recovery.test.tsx` all reach for
 * `container.querySelector('video')` and then write `currentTime`, fire `error`
 * and fire `loadedmetadata` on it. A stub object cannot host an `addEventListener`
 * contract or a `{ once: true }` registration, which is half of what this engine
 * gets wrong when it gets anything wrong. jsdom implements none of the media
 * methods, so `load`/`play`/`pause` are prototype-stubbed exactly as that suite
 * does it.
 *
 * WHAT IS NEW HERE, beyond the port:
 *  - the exhaustion LATCH (the web's `VideoPlayer.tsx:542` returns without setting
 *    a flag, so a sixth error re-fires the exhausted callback; on the TV there is
 *    no source switcher at the end of that loop, so a repeating nag is a dead end);
 *  - the `afterMs` override, which is how a `Retry-After` reaches the ladder;
 *  - the source-change cleanup's TWO jobs, asserted as a listener count and a
 *    timer count rather than argued;
 *  - the element GETTER: a remount must not leave the engine driving a dead node.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { MAX_RECOVERY_ATTEMPTS, RECOVERY_BACKOFF_MS } from '@/lib/player/streamRecovery';
import { createRecovery, type Recovery, type RecoveryStatus } from './recovery';

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

/** The ~15-line host: one real <video>, one engine over a getter, nothing else. */
function Host({
  onReady,
  onStatus,
  nodeKey = 'a',
}: {
  onReady: (r: Recovery) => void;
  onStatus?: (s: RecoveryStatus) => void;
  nodeKey?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [engine] = useState(() => createRecovery({ getVideo: () => ref.current, onStatus }));
  useEffect(() => {
    onReady(engine);
  }, [engine, onReady]);
  return <video key={nodeKey} ref={ref} preload="metadata" />;
}

/** Make currentTime controllable, and give the element a MediaError like the web suite. */
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

/**
 * Count the listeners actually attached to an element, `{ once: true }` included.
 *
 * A naive add/remove counter over-counts a one-shot that has already fired, which
 * is the exact case the source-change assertions care about. So a `once`
 * registration is wrapped and drops itself from the tally when it runs, and
 * `removeEventListener` is mapped back to the wrapper so the engine's own detach
 * still works.
 */
function trackListeners(el: HTMLElement) {
  const live = new Map<EventListener, { type: string; wrapped: EventListener }>();
  const rawAdd = el.addEventListener.bind(el);
  const rawRemove = el.removeEventListener.bind(el);
  el.addEventListener = ((type: string, fn: EventListener, opts?: AddEventListenerOptions | boolean) => {
    const once = typeof opts === 'object' && opts !== null && opts.once === true;
    const wrapped: EventListener = once ? (ev) => { live.delete(fn); fn(ev); } : fn;
    live.set(fn, { type, wrapped });
    rawAdd(type, wrapped, opts);
  }) as typeof el.addEventListener;
  el.removeEventListener = ((type: string, fn: EventListener, opts?: EventListenerOptions | boolean) => {
    const entry = live.get(fn);
    live.delete(fn);
    rawRemove(type, entry?.wrapped ?? fn, opts);
  }) as typeof el.removeEventListener;
  return { count: (type: string) => [...live.values()].filter((e) => e.type === type).length };
}

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

/** Render the host and hand back both the element and the engine. */
function mount(onStatus?: (s: RecoveryStatus) => void, nodeKey?: string) {
  let engine!: Recovery;
  const onReady = (r: Recovery) => { engine = r; };
  const view = render(<Host onReady={onReady} onStatus={onStatus} nodeKey={nodeKey} />);
  const video = view.container.querySelector('video')!;
  return { ...view, video, engine, onReady };
}

describe('createRecovery — the five web assertions, ported', () => {
  it('calls load() on the video element, not just a currentTime nudge', () => {
    const { video, engine } = mount();
    wireErroredVideo(video);

    act(() => { engine.attempt(); });
    // Scheduled, not immediate: the backoff ladder is the shared one.
    expect(loadSpy).not.toHaveBeenCalled();

    tick(RECOVERY_BACKOFF_MS[0]);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('restores the playhead that load() reset to zero', () => {
    const { video, engine } = mount();
    const ctl = wireErroredVideo(video);

    ctl.seek(137.5);
    act(() => { engine.attempt(); });
    tick(RECOVERY_BACKOFF_MS[0]);
    expect(loadSpy).toHaveBeenCalledTimes(1);

    // A real load() zeroes currentTime and drops readyState to HAVE_NOTHING, so the
    // restoring seek has to wait for metadata.
    ctl.seek(0);
    act(() => { fireEvent.loadedMetadata(video); });

    expect(ctl.at()).toBe(137.5);
    expect(playSpy).toHaveBeenCalled();
  });

  it('does not seek back to a position of zero', () => {
    const { video, engine } = mount();
    wireErroredVideo(video);
    const seen: number[] = [];
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => 0,
      set: (v: number) => { seen.push(v); },
    });

    act(() => { engine.attempt(); });
    tick(RECOVERY_BACKOFF_MS[0]);
    act(() => { fireEvent.loadedMetadata(video); });

    expect(seen).toEqual([]);
    expect(playSpy).toHaveBeenCalled();
  });

  it('keeps the shared ladder and gives up after MAX_RECOVERY_ATTEMPTS', () => {
    const onStatus = vi.fn();
    const { video, engine } = mount(onStatus);
    wireErroredVideo(video);

    RECOVERY_BACKOFF_MS.forEach((delay, i) => {
      act(() => { engine.attempt(); });
      tick(delay - 1);
      expect(loadSpy).toHaveBeenCalledTimes(i);
      tick(1);
      expect(loadSpy).toHaveBeenCalledTimes(i + 1);
    });

    // One past the bound: exhausted, no further reload.
    act(() => { engine.attempt(); });
    tick(10000);
    expect(loadSpy).toHaveBeenCalledTimes(MAX_RECOVERY_ATTEMPTS);
    expect(onStatus.mock.calls.map(([s]) => s).filter((s) => s.kind === 'exhausted')).toEqual([
      { kind: 'exhausted', attempts: MAX_RECOVERY_ATTEMPTS },
    ]);
  });

  it('resets the ladder once playback is healthy again', () => {
    const { video, engine } = mount();
    wireErroredVideo(video);

    act(() => { engine.attempt(); });
    tick(RECOVERY_BACKOFF_MS[0]);
    expect(loadSpy).toHaveBeenCalledTimes(1);

    act(() => { engine.noteHealthy(); });

    // Back to the first rung, not the second.
    act(() => { engine.attempt(); });
    tick(RECOVERY_BACKOFF_MS[0] - 1);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    tick(1);
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });
});

describe('createRecovery — what the TV adds', () => {
  it('latches exhaustion: a sixth and seventh error say it once', () => {
    // THE WEB RE-FIRES HERE (`VideoPlayer.tsx:542` returns without setting a flag).
    // On the web the exhausted callback opens a source switcher; the TV has none, so
    // an unlatched exhaustion is a message that repeats forever on a dead end.
    const onStatus = vi.fn();
    const { video, engine } = mount(onStatus);
    wireErroredVideo(video);

    for (const delay of RECOVERY_BACKOFF_MS) {
      act(() => { engine.attempt(); });
      tick(delay);
    }
    act(() => { engine.attempt(); });
    act(() => { engine.attempt(); });
    act(() => { engine.attempt(); });
    tick(10000);

    expect(onStatus.mock.calls.filter(([s]) => s.kind === 'exhausted')).toHaveLength(1);
    expect(loadSpy).toHaveBeenCalledTimes(MAX_RECOVERY_ATTEMPTS);
  });

  it('honours an afterMs longer than the rung, and never shortens the rung', () => {
    // This is how `Retry-After` reaches the ladder. The server's hint says the
    // earliest useful retry; the ladder says the soonest WE will ask again. Taking
    // the later of the two means a wedged backend answering `Retry-After: 0`
    // cannot turn the ladder into a spin loop.
    const { video, engine } = mount();
    wireErroredVideo(video);

    act(() => { engine.attempt(5000); });
    tick(4999);
    expect(loadSpy).not.toHaveBeenCalled();
    tick(1);
    expect(loadSpy).toHaveBeenCalledTimes(1);

    act(() => { engine.noteHealthy(); });
    act(() => { engine.attempt(0) });
    tick(RECOVERY_BACKOFF_MS[0] - 1);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    tick(1);
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  it('a source change clears the pending timer and detaches the one-shot', () => {
    const { video, engine } = mount();
    wireErroredVideo(video);
    const listeners = trackListeners(video);

    act(() => { engine.attempt(); });
    expect(vi.getTimerCount()).toBe(1);
    act(() => { engine.noteSourceChange(); });
    expect(vi.getTimerCount()).toBe(0);
    tick(10000);
    expect(loadSpy).not.toHaveBeenCalled();

    // Exactly one one-shot after two attempts: the second detaches the first's.
    act(() => { engine.attempt(); });
    tick(RECOVERY_BACKOFF_MS[0]);
    expect(listeners.count('loadedmetadata')).toBe(1);
    act(() => { engine.attempt(); });
    tick(RECOVERY_BACKOFF_MS[1]);
    expect(listeners.count('loadedmetadata')).toBe(1);

    // ...and the source change takes it away again, so a reload plus a stale
    // listener cannot leak across a title change.
    act(() => { engine.noteSourceChange(); });
    expect(listeners.count('loadedmetadata')).toBe(0);
  });

  it('dispose() leaves no timer and no listener, and never schedules again', () => {
    const { video, engine } = mount();
    wireErroredVideo(video);
    const listeners = trackListeners(video);

    act(() => { engine.attempt(); });
    tick(RECOVERY_BACKOFF_MS[0]);
    expect(listeners.count('loadedmetadata')).toBe(1);

    act(() => { engine.dispose(); });
    expect(listeners.count('loadedmetadata')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    loadSpy.mockClear();
    act(() => { engine.attempt(); });
    tick(10000);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drives the element the getter names NOW, not the one it was built with', () => {
    // The reason the factory takes a getter. A remount replaces the node; an engine
    // holding the old one calls load() on a detached element and the ladder is spent
    // on nothing, which on this surface looks exactly like a title that will not play.
    let engine!: Recovery;
    const onReady = (r: Recovery) => { engine = r; };
    const view = render(<Host onReady={onReady} nodeKey="a" />);
    const first = view.container.querySelector('video')!;
    wireErroredVideo(first);

    // Spend one rung on the FIRST element, so an engine that caches has something
    // stale to hold. Without this step the mutation is invisible: the first call to a
    // `cached ??= getVideo()` would simply pick up the new node. Measured, not argued.
    act(() => { engine.attempt(); });
    tick(RECOVERY_BACKOFF_MS[0]);
    expect(loadSpy).toHaveBeenCalledTimes(1);

    act(() => { engine.noteSourceChange(); });
    view.rerender(<Host onReady={onReady} nodeKey="b" />);
    const second = view.container.querySelector('video')!;
    expect(second).not.toBe(first);
    const ctl = wireErroredVideo(second);
    ctl.seek(42);

    act(() => { engine.attempt(); });
    tick(RECOVERY_BACKOFF_MS[0]);
    // The restore reaches the live node: the one-shot is on `second`, and the dead
    // node can no longer drive anything.
    ctl.seek(0);
    act(() => { fireEvent.loadedMetadata(first); });
    expect(ctl.at()).toBe(0);
    act(() => { fireEvent.loadedMetadata(second); });
    expect(ctl.at()).toBe(42);
  });

  it('reports what it is doing, in order', () => {
    const onStatus = vi.fn();
    const { video, engine } = mount(onStatus);
    wireErroredVideo(video);

    act(() => { engine.attempt(); });
    tick(RECOVERY_BACKOFF_MS[0]);
    act(() => { engine.noteHealthy(); });

    expect(onStatus.mock.calls.map(([s]) => s)).toEqual([
      { kind: 'scheduled', attempt: 1, delayMs: RECOVERY_BACKOFF_MS[0] },
      { kind: 'reloading', attempt: 1 },
      { kind: 'idle' },
    ]);
  });
});
