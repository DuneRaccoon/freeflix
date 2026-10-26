/**
 * The player chrome: when the controls fade, what brings them back, and the
 * controls that only misbehave on a phone (taps, the scrubber, fullscreen).
 *
 * Driven with fake timers and a jsdom <video> whose `paused` is controlled, so
 * the 'playing' / 'pause' events reach the component exactly as a browser's would.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import VideoPlayer from './VideoPlayer';

// jsdom 25 has no PointerEvent, so fireEvent.pointer* builds a bare Event and
// drops pointerType / clientX — which is exactly what these tests are about.
class TestPointerEvent extends MouseEvent {
  pointerType: string;
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? 'mouse';
    this.pointerId = init.pointerId ?? 1;
  }
}

beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    (window as unknown as { PointerEvent: typeof TestPointerEvent }).PointerEvent = TestPointerEvent;
  }
  window.HTMLMediaElement.prototype.load = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(window.HTMLMediaElement.prototype.pause).mockClear();
  vi.mocked(window.HTMLMediaElement.prototype.play).mockClear();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

function setup(props: Partial<React.ComponentProps<typeof VideoPlayer>> = {}) {
  const utils = render(<VideoPlayer src="/test.mp4" downloadProgress={100} {...props} />);
  const video = utils.container.querySelector('video')!;
  const player = screen.getByLabelText('Video player');
  let paused = true;
  let t = 0;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
  Object.defineProperty(video, 'duration', { configurable: true, get: () => 100 });
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => t,
    set: (v: number) => { t = v; },
  });
  const play = () => act(() => {
    paused = false;
    fireEvent.play(video);
    fireEvent.playing(video);
  });
  const pause = () => act(() => {
    paused = true;
    fireEvent.pause(video);
  });
  const bar = () => screen.getByTestId('player-controls');
  const visible = () => bar().className.includes('opacity-100');
  return { ...utils, video, player, play, pause, bar, visible, time: () => t };
}

describe('VideoPlayer chrome — fading', () => {
  it('fades the controls out a few seconds into playback, without fullscreen', () => {
    const p = setup();
    p.play();
    expect(p.visible()).toBe(true);
    tick(3500);
    expect(p.visible()).toBe(false);
  });

  it('moving the mouse brings them back and restarts the countdown', () => {
    const p = setup();
    p.play();
    tick(3500);
    act(() => { fireEvent.pointerMove(p.player, { pointerType: 'mouse' }); });
    expect(p.visible()).toBe(true);
    tick(2000);
    act(() => { fireEvent.pointerMove(p.player, { pointerType: 'mouse' }); });
    tick(2000);
    expect(p.visible()).toBe(true);
    tick(1500);
    expect(p.visible()).toBe(false);
  });

  it('keeps them up while paused', () => {
    const p = setup();
    p.play();
    p.pause();
    tick(10_000);
    expect(p.visible()).toBe(true);
  });

  it('keeps them up while the speed menu is open', () => {
    const p = setup();
    p.play();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Playback speed' })); });
    tick(10_000);
    expect(p.visible()).toBe(true);
    expect(screen.getByRole('button', { name: '2×' })).toBeInTheDocument();
  });

  it('hidden centre buttons do not swallow taps', () => {
    const p = setup();
    p.play();
    tick(3500);
    const centre = screen.getByRole('button', { name: 'Forward 10 seconds' });
    expect(centre.className).toContain('pointer-events-none');
  });
});

describe('VideoPlayer chrome — touch', () => {
  it('a tap on the picture while the controls are hidden reveals them and does not pause', () => {
    const p = setup();
    p.play();
    tick(3500);
    act(() => {
      fireEvent.pointerDown(p.video, { pointerType: 'touch' });
      fireEvent.click(p.video);
    });
    tick(400);
    expect(p.visible()).toBe(true);
    expect(window.HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it('a tap while they are showing hides them, still without pausing', () => {
    const p = setup();
    p.play();
    act(() => {
      fireEvent.pointerDown(p.video, { pointerType: 'touch' });
      fireEvent.click(p.video);
    });
    tick(400);
    expect(p.visible()).toBe(false);
    expect(window.HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it('a mouse click on the picture still toggles playback', () => {
    const p = setup();
    p.play();
    act(() => {
      fireEvent.pointerDown(p.video, { pointerType: 'mouse' });
      fireEvent.click(p.video);
    });
    tick(400);
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  });
});

describe('VideoPlayer chrome — scrubber', () => {
  it('dragging the scrubber seeks to where it is released', () => {
    const p = setup();
    const slider = screen.getByRole('slider', { name: 'Seek' });
    slider.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 18, right: 200, bottom: 18, x: 0, y: 0, toJSON() {} }) as DOMRect;
    act(() => {
      fireEvent.pointerDown(slider, { pointerId: 1, clientX: 20, pointerType: 'touch' });
      fireEvent.pointerMove(slider, { pointerId: 1, clientX: 100, pointerType: 'touch' });
      fireEvent.pointerMove(slider, { pointerId: 1, clientX: 150, pointerType: 'touch' });
      // A touch drag ends without a click, so the release itself must seek.
      fireEvent.pointerUp(slider, { pointerId: 1, clientX: 150, pointerType: 'touch' });
    });
    expect(p.time()).toBeCloseTo(75);
  });
});

describe('VideoPlayer chrome — menus and fullscreen', () => {
  it('opening the source menu closes the speed menu', () => {
    setup({
      sources: [{ source_id: 'a', quality: '1080p', seeds: 10, health: 'healthy' } as never],
      currentSourceId: 'a',
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Playback speed' })); });
    act(() => { fireEvent.click(screen.getByTestId('source-switcher-button')); });
    expect(screen.queryByRole('button', { name: '2×' })).toBeNull();
    expect(screen.getByTestId('source-switcher-menu')).toBeInTheDocument();
  });

  it('falls back to the video element\'s own fullscreen where the player cannot go fullscreen (iPhone)', () => {
    const p = setup();
    const enter = vi.fn();
    (p.video as HTMLVideoElement & { webkitEnterFullscreen: () => void }).webkitEnterFullscreen = enter;
    Object.defineProperty(p.player, 'requestFullscreen', { configurable: true, value: undefined });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' })); });
    expect(enter).toHaveBeenCalledTimes(1);
  });
});

describe('VideoPlayer chrome — a video that was ready before the listeners', () => {
  it('drops the loading overlay when canplay fired before React attached its listeners', () => {
    // A cached or fast file can reach HAVE_ENOUGH_DATA before the listener effect
    // runs; its one 'canplay' is then gone, and nothing else ever clears isLoading.
    const desc = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'readyState')!;
    Object.defineProperty(window.HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
    try {
      render(<VideoPlayer src="/test.mp4" downloadProgress={100} />);
      expect(screen.queryByTestId('buffering-overlay')).toBeNull();
      // The centre transport (with the big Play) only renders once loading is over.
      expect(screen.getByRole('button', { name: 'Forward 10 seconds' })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window.HTMLMediaElement.prototype, 'readyState', desc);
    }
  });
});
