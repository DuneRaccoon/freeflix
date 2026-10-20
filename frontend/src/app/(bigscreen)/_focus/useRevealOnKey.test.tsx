import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { BACK_KEYS, BACK_KEY_CODES } from './useBackKey';
import { REVEAL_HIDE_MS, useRevealOnKey } from './useRevealOnKey';

interface HarnessProps {
  visible: boolean;
  onReveal: () => void;
  onHide: () => void;
  hideAfterMs?: number;
  onRender?: () => void;
  /** A nested React onKeyDown, the shape the scrub cell will have in task 8. */
  onNested?: (key: string) => void;
}

function Harness({ onRender, onNested, ...opts }: HarnessProps) {
  onRender?.();
  useRevealOnKey(opts);
  return (
    <div onKeyDown={(e) => onNested?.(e.key)}>
      <button type="button">cell</button>
    </div>
  );
}

/** Dispatch on window: this repo's test shape, and `window` is then the event target. */
function fire(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { window.dispatchEvent(e); });
  return e;
}

/** Dispatch at the focused element: the device's shape, and the only one React hears. */
function fireAtFocus(init: KeyboardEventInit): KeyboardEvent {
  const target = document.activeElement ?? document.body;
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(e); });
  return e;
}

/** An arrow as the real remote may send it: no usable `key`, only the legacy code. */
const RIGHT = { key: 'Unidentified', keyCode: 39 } as const;

describe('useRevealOnKey', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reveals on the first press while hidden, and swallows that press', () => {
    const onReveal = vi.fn();
    render(<Harness visible={false} onReveal={onReveal} onHide={() => {}} />);
    const e = fire(RIGHT);
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('beats a listener registered before it, in both dispatch shapes', () => {
    // REMOVE `{ capture: true }` AND THIS FAILS. A bubble listener registered first would
    // otherwise run first and act on the press that only meant "wake up" — and declaration
    // order is an accident of mount order, not a design. The capture pass runs the whole
    // path, including the target, before any bubble listener on any node.
    const seen: string[] = [];
    const earlier = (e: Event) => seen.push(`window:${(e as KeyboardEvent).keyCode}`);
    window.addEventListener('keydown', earlier);
    const onNested = vi.fn();
    try {
      const { container } = render(
        <Harness visible={false} onReveal={() => {}} onHide={() => {}} onNested={onNested} />,
      );
      fire(RIGHT);
      const button = container.querySelector('button');
      act(() => { (button as HTMLElement).focus(); });
      fireAtFocus(RIGHT);
      // Neither shape reached the earlier window listener, and neither reached React's
      // synthetic path, which is where task 8's scrub cell will live.
      expect(seen).toEqual([]);
      expect(onNested).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', earlier);
    }
  });

  describe.each([...BACK_KEYS.map((key) => [key, 0] as const), ...BACK_KEY_CODES.map((c) => ['Unidentified', c] as const)])(
    'Back while hidden: %s (%i)',
    (key, keyCode) => {
      it('is left alone, so the escalation is reachable', () => {
        // REMOVE THE BACK EXEMPTION AND THIS FAILS: Back would reveal the controls and the
        // page's own useBackKey would then collapse them again, in one press. The viewer
        // could never reach the second rung, which is the one that leaves the player.
        const seen: string[] = [];
        const onBack = (e: Event) => seen.push((e as KeyboardEvent).key);
        window.addEventListener('keydown', onBack);
        const onReveal = vi.fn();
        try {
          render(<Harness visible={false} onReveal={onReveal} onHide={() => {}} />);
          const e = fire({ key, keyCode });
          expect(onReveal).not.toHaveBeenCalled();
          expect(e.defaultPrevented).toBe(false);
          expect(seen).toEqual([key]);
        } finally {
          window.removeEventListener('keydown', onBack);
        }
      });
    },
  );

  it('claims nothing while visible', () => {
    const seen: string[] = [];
    const later = (e: Event) => seen.push((e as KeyboardEvent).key);
    window.addEventListener('keydown', later);
    const onReveal = vi.fn();
    try {
      render(<Harness visible onReveal={onReveal} onHide={() => {}} />);
      const e = fire({ key: 'ArrowRight', keyCode: 39 });
      expect(e.defaultPrevented).toBe(false);
      expect(onReveal).not.toHaveBeenCalled();
      expect(seen).toEqual(['ArrowRight']);
    } finally {
      window.removeEventListener('keydown', later);
    }
  });

  it('treats an arrow the focus grid already claimed as activity', () => {
    // ADD A `defaultPrevented` CHECK AND THIS FAILS. The grid claims every arrow it acts on,
    // so on this surface a claimed arrow is the *normal* shape of "the viewer is driving".
    // A reveal hook that skipped claimed keys would hide the band under a moving ring.
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', claim, { capture: true });
    const onHide = vi.fn();
    try {
      render(<Harness visible onReveal={() => {}} onHide={onHide} />);
      act(() => { vi.advanceTimersByTime(REVEAL_HIDE_MS - 1); });
      const e = fire(RIGHT);
      expect(e.defaultPrevented).toBe(true);
      // Re-armed by a press it could not have claimed itself.
      act(() => { vi.advanceTimersByTime(REVEAL_HIDE_MS - 1); });
      expect(onHide).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1); });
      expect(onHide).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', claim, { capture: true });
    }
  });

  it('still reveals on an already-claimed arrow while hidden', () => {
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', claim, { capture: true });
    const onReveal = vi.fn();
    try {
      render(<Harness visible={false} onReveal={onReveal} onHide={() => {}} />);
      fire(RIGHT);
      expect(onReveal).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', claim, { capture: true });
    }
  });

  it('hides after the quiet period, and only once per quiet period', () => {
    const onHide = vi.fn();
    render(<Harness visible onReveal={() => {}} onHide={onHide} />);
    fire(RIGHT);
    act(() => { vi.advanceTimersByTime(REVEAL_HIDE_MS - 1); });
    expect(onHide).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onHide).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(REVEAL_HIDE_MS * 3); });
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('hides without being pressed at all', () => {
    // THE DEFECT THIS ROW IS BUILT FROM, reported from the living room: "the video player
    // retains a dark overlay when playing". The quiet period used to be armed from
    // `onKeyDown` and nowhere else, so a viewer who started a title and then pressed
    // NOTHING — which is what watching something IS — never got a first period, and the
    // control band plus the 480px scrim behind it sat over the picture for the whole film.
    //
    // Every other quiet-period row in this file fires a key before advancing the clock, so
    // not one of them could have seen it. That is the gap, not an oversight in the
    // assertions: the armed path was tested thoroughly and the unarmed path was the one a
    // viewer actually takes.
    const onHide = vi.fn();
    render(<Harness visible onReveal={() => {}} onHide={onHide} />);
    act(() => { vi.advanceTimersByTime(REVEAL_HIDE_MS - 1); });
    expect(onHide).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('keeps serving the period while the caller refuses, with no press to re-arm it', () => {
    // The refusal contract, on the mount-armed period: the player refuses while a message
    // is on screen (the resume note, the arrival disclosure), and that is exactly the state
    // a title ARRIVES in. If a refusal spent the only period there is, the band would be
    // stuck for the rest of the film again — by a different route.
    let refuse = true;
    const onHide = vi.fn(() => (refuse ? false : undefined));
    render(<Harness visible onReveal={() => {}} onHide={onHide} />);
    act(() => { vi.advanceTimersByTime(REVEAL_HIDE_MS * 3); });
    expect(onHide).toHaveBeenCalledTimes(3);
    refuse = false;
    act(() => { vi.advanceTimersByTime(REVEAL_HIDE_MS); });
    expect(onHide).toHaveBeenCalledTimes(4);
    // ...and once it is accepted, nothing re-arms behind it.
    act(() => { vi.advanceTimersByTime(REVEAL_HIDE_MS * 3); });
    expect(onHide).toHaveBeenCalledTimes(4);
  });

  it('arms the quiet period from the reveal press too', () => {
    const onHide = vi.fn();
    render(<Harness visible={false} onReveal={() => {}} onHide={onHide} />);
    fire(RIGHT);
    act(() => { vi.advanceTimersByTime(REVEAL_HIDE_MS); });
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit hideAfterMs', () => {
    const onHide = vi.fn();
    render(<Harness visible onReveal={() => {}} onHide={onHide} hideAfterMs={120} />);
    fire(RIGHT);
    act(() => { vi.advanceTimersByTime(119); });
    expect(onHide).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('costs no render for a key repeat', () => {
    // MOVE THE TIMER INTO STATE AND THIS FAILS. A held arrow repeats many times a second,
    // and the grid has no `e.repeat` guard; a setState per repeat would re-render the whole
    // player band — over a decoding 1080p surface — once per repeat, for nothing visible.
    const onRender = vi.fn();
    render(<Harness visible onReveal={() => {}} onHide={() => {}} onRender={onRender} />);
    const before = onRender.mock.calls.length;
    for (let i = 0; i < 20; i++) fire({ ...RIGHT, repeat: i > 0 });
    expect(onRender.mock.calls.length).toBe(before);
  });

  it('registers one capture-phase keydown listener on window and removes it on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const keydowns = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'keydown');

    const { rerender, unmount } = render(<Harness visible onReveal={() => {}} onHide={() => {}} />);
    expect(keydowns(add)).toHaveLength(1);
    expect(keydowns(add)[0][2]).toEqual({ capture: true });
    // Fresh callbacks and a flipped `visible` must not re-register.
    rerender(<Harness visible={false} onReveal={() => {}} onHide={() => {}} />);
    rerender(<Harness visible onReveal={() => {}} onHide={() => {}} />);
    expect(keydowns(add)).toHaveLength(1);
    expect(keydowns(remove)).toHaveLength(0);

    unmount();
    expect(keydowns(remove)).toHaveLength(1);
    expect(keydowns(remove)[0][1]).toBe(keydowns(add)[0][1]);
    expect(keydowns(remove)[0][2]).toEqual({ capture: true });
  });

  it('does not hide, or claim, after unmount', () => {
    const onHide = vi.fn();
    const onReveal = vi.fn();
    const { unmount } = render(<Harness visible onReveal={onReveal} onHide={onHide} />);
    fire(RIGHT);
    unmount();
    act(() => { vi.advanceTimersByTime(REVEAL_HIDE_MS * 2); });
    expect(onHide).not.toHaveBeenCalled();
    const e = fire(RIGHT);
    expect(e.defaultPrevented).toBe(false);
    expect(onReveal).not.toHaveBeenCalled();
  });

  it('calls the latest callbacks and reads the latest visibility', () => {
    const firstReveal = vi.fn();
    const secondReveal = vi.fn();
    const { rerender } = render(<Harness visible onReveal={firstReveal} onHide={() => {}} />);
    // Visible: nothing to reveal, even though the callback changed.
    rerender(<Harness visible onReveal={secondReveal} onHide={() => {}} />);
    fire(RIGHT);
    expect(secondReveal).not.toHaveBeenCalled();
    rerender(<Harness visible={false} onReveal={secondReveal} onHide={() => {}} />);
    fire(RIGHT);
    expect(firstReveal).not.toHaveBeenCalled();
    expect(secondReveal).toHaveBeenCalledTimes(1);
  });

  it('ignores a modifier chord: not a remote press, so it neither reveals nor re-arms', () => {
    const onReveal = vi.fn();
    const onHide = vi.fn();
    const { rerender } = render(<Harness visible={false} onReveal={onReveal} onHide={onHide} />);
    for (const mod of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      const e = fire({ ...RIGHT, ...mod });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(onReveal).not.toHaveBeenCalled();

    rerender(<Harness visible onReveal={onReveal} onHide={onHide} />);
    fire(RIGHT);
    act(() => { vi.advanceTimersByTime(REVEAL_HIDE_MS - 1); });
    fire({ ...RIGHT, ctrlKey: true });
    act(() => { vi.advanceTimersByTime(1); });
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
