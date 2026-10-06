/**
 * Regression: the audio state machine must honour the user's intent across a
 * programmatic reload.
 *
 * `attemptRecovery` now calls `video.load()` (it has to — once a MediaError is set
 * and networkState is NETWORK_NO_SOURCE, a currentTime nudge and play() are both
 * no-ops). `load()` re-runs resource selection, which fires `loadstart` mid-session
 * — and that exposed a pre-existing defect:
 *
 *   loadstart -> video.muted = true          (unconditional, unguarded)
 *             -> volumechange
 *             -> setPlayerState({ isMuted: true })   the user's intent, overwritten
 *             -> setShowUnmuteButton(true)
 *             -> canplay restores video.muted = playerState.isMuted, but ONLY
 *                inside `if (autoPlay)`
 *
 * With autoPlay={false} — exactly the state while PatchedVideoPlayer's resume
 * prompt is open (PatchedVideoPlayer.tsx:373 passes autoPlay={!showResumePrompt})
 * — nothing restores at all and the player is permanently silent.
 *
 * These tests drive the real component with a controlled <video> element whose
 * `muted`/`volume` setters queue a `volumechange` the way the HTML spec says they
 * must (asynchronously), and with a `load()` that fires `loadstart` the way a real
 * one does.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import VideoPlayer from './VideoPlayer';

type VideoPlayerMethods = { seekTo: (time: number) => void; playWithSound: () => void };

const playSpy = vi.fn();
/** A real load() re-runs resource selection, which fires 'loadstart'. */
const loadSpy = vi.fn(function (this: HTMLMediaElement) {
  this.dispatchEvent(new Event('loadstart'));
});

beforeAll(() => {
  window.HTMLMediaElement.prototype.load = loadSpy;
  window.HTMLMediaElement.prototype.play = playSpy as unknown as () => Promise<void>;
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

beforeEach(() => {
  loadSpy.mockClear();
  playSpy.mockReset();
  playSpy.mockResolvedValue(undefined);
  vi.useFakeTimers();
});
afterEach(() => {
  // The guard-release timeouts land here; flushing them inside act() keeps the
  // teardown from emitting an unwrapped-update warning.
  act(() => { vi.runOnlyPendingTimers(); });
  vi.useRealTimers();
});

/**
 * Give a jsdom <video> a real-ish audio surface: `muted` and `volume` that queue a
 * `volumechange` task on change (HTML spec: the event is fired from a queued task,
 * i.e. NOT synchronously with the assignment — which is why a guard cleared
 * synchronously after the write cannot work). Also makes currentTime writable.
 *
 * `initialMuted` defaults to true: that is the state the element is already in
 * after mount, because the source-change effect mutes it for autoplay policy.
 */
function wireVideo(video: HTMLVideoElement, initialMuted = true) {
  let muted = initialMuted;
  let volume = 1;
  let t = 0;
  const queueVolumeChange = () => {
    setTimeout(() => video.dispatchEvent(new Event('volumechange')), 0);
  };
  Object.defineProperty(video, 'muted', {
    configurable: true,
    get: () => muted,
    set: (v: boolean) => {
      const next = !!v;
      if (next !== muted) { muted = next; queueVolumeChange(); }
    },
  });
  Object.defineProperty(video, 'volume', {
    configurable: true,
    get: () => volume,
    set: (v: number) => {
      if (v !== volume) { volume = v; queueVolumeChange(); }
    },
  });
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => t,
    set: (v: number) => { t = v; },
  });
  Object.defineProperty(video, 'error', {
    configurable: true,
    get: () => ({ code: 2, message: 'simulated network error' }),
  });
  return { seek: (v: number) => { t = v; } };
}

const tick = (ms = 300) => act(() => { vi.advanceTimersByTime(ms); });

/** Let queued volumechange tasks, the guard timeouts and play() promises settle. */
async function settle(ms = 300) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Read the component's own debug overlay — the only window onto its audio state. */
function audioState(container: HTMLElement) {
  const text = container.querySelector('.font-mono')?.textContent ?? '';
  return {
    isMuted: /Muted:\s*(true|false)/.exec(text)?.[1],
    showUnmuteButton: /Unmute:\s*(true|false)/.exec(text)?.[1],
  };
}

function renderPlayer(props: { autoPlay: boolean }) {
  let methods: VideoPlayerMethods | undefined;
  const { container } = render(
    <VideoPlayer
      src="/test.mp4"
      downloadProgress={50}
      debug
      autoPlay={props.autoPlay}
      registerMethods={(m) => { methods = m; }}
    />
  );
  const video = container.querySelector('video')!;
  return { container, video, getMethods: () => methods! };
}

/**
 * The user's gesture that grants sound. PatchedVideoPlayer calls playWithSound()
 * straight out of the Resume / Start click (PatchedVideoPlayer.tsx:311).
 */
async function userAsksForSound(m: VideoPlayerMethods) {
  await act(async () => { m.playWithSound(); });
  await settle();
}

describe('VideoPlayer audio state across a programmatic reload', () => {
  it('autoPlay={false}: a mid-session loadstart must not leave the element muted', async () => {
    const { container, video, getMethods } = renderPlayer({ autoPlay: false });
    const ctl = wireVideo(video);
    ctl.seek(0);

    await userAsksForSound(getMethods());
    expect(video.muted).toBe(false);

    // A recovery reload: loadstart, then the element becomes playable again.
    act(() => { fireEvent.loadStart(video); });
    act(() => { fireEvent.canPlay(video); });
    await settle();

    // THE DEFECT: loadstart muted unconditionally and nothing outside the
    // `if (autoPlay)` branch ever restores it -> permanent silence.
    expect(video.muted).toBe(false);
    expect(audioState(container).isMuted).toBe('false');
  });

  it('keeps sound through a full error-driven recovery (autoPlay={false})', async () => {
    const { container, video, getMethods } = renderPlayer({ autoPlay: false });
    const ctl = wireVideo(video);

    await userAsksForSound(getMethods());
    expect(video.muted).toBe(false);

    ctl.seek(137.5);
    act(() => { fireEvent.error(video); });
    tick(1000);                                   // backoff rung 1 -> load()
    expect(loadSpy).toHaveBeenCalledTimes(1);     // which fired 'loadstart'

    ctl.seek(0);
    act(() => { fireEvent.loadedMetadata(video); });
    act(() => { fireEvent.canPlay(video); });
    await settle();

    expect(video.muted).toBe(false);
    expect(video.volume).toBe(1);
    expect(audioState(container).isMuted).toBe('false');
    // The recovery's own position restore is untouched by this fix.
    expect(video.currentTime).toBe(137.5);
  });

  it('keeps an explicit user mute through a recovery', async () => {
    const { container, video, getMethods } = renderPlayer({ autoPlay: false });
    wireVideo(video);

    await userAsksForSound(getMethods());
    expect(video.muted).toBe(false);

    // The user mutes, deliberately.
    const muteBtn = container.querySelector('[aria-label="Mute"]')!;
    await act(async () => { fireEvent.click(muteBtn); });
    await settle();
    expect(video.muted).toBe(true);
    expect(audioState(container).isMuted).toBe('true');

    act(() => { fireEvent.error(video); });
    tick(1000);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.loadedMetadata(video); });
    act(() => { fireEvent.canPlay(video); });
    await settle();

    // Intent is honoured in BOTH directions: the fix must not force sound on.
    expect(video.muted).toBe(true);
    expect(audioState(container).isMuted).toBe('true');
  });

  it('does not raise the unmute affordance merely because a reload happened', async () => {
    const { container, video, getMethods } = renderPlayer({ autoPlay: false });
    wireVideo(video);

    await userAsksForSound(getMethods());
    expect(audioState(container).showUnmuteButton).toBe('false');

    act(() => { fireEvent.loadStart(video); });
    await settle();
    act(() => { fireEvent.canPlay(video); });
    await settle();

    // THE DEFECT: the unguarded programmatic mute reached handleVolumeChange,
    // which called setShowUnmuteButton(video.muted) -> a spurious affordance
    // (and, with autoPlay flapping, the reported flicker).
    expect(audioState(container).showUnmuteButton).toBe('false');
  });
});

describe('VideoPlayer autoplay path (must not regress)', () => {
  it('autoPlay={true}: attempts sound-on autoplay and keeps sound when allowed', async () => {
    const { container, video } = renderPlayer({ autoPlay: true });
    wireVideo(video);

    act(() => { fireEvent.canPlay(video); });
    await settle();

    expect(playSpy).toHaveBeenCalled();
    expect(video.muted).toBe(false);
    expect(audioState(container).isMuted).toBe('false');
    expect(audioState(container).showUnmuteButton).toBe('false');
  });

  it('autoPlay={true}: falls back to muted + unmute affordance when blocked', async () => {
    playSpy.mockReset();
    playSpy
      .mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'))
      .mockResolvedValue(undefined);

    const { container, video } = renderPlayer({ autoPlay: true });
    wireVideo(video);

    act(() => { fireEvent.canPlay(video); });
    await settle();

    // Sound-on first, then the muted retry.
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(video.muted).toBe(true);
    expect(audioState(container).isMuted).toBe('true');
    expect(audioState(container).showUnmuteButton).toBe('true');
  });
});
