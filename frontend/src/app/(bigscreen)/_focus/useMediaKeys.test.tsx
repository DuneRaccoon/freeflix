import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MEDIA_KEYS, MEDIA_KEY_CODES, type MediaKeyAction, useMediaKeys } from './useMediaKeys';

function Harness({ onMediaKey }: { onMediaKey: (action: MediaKeyAction) => void }) {
  useMediaKeys(onMediaKey);
  return null;
}

/** Dispatch on window, the way the remote's presses arrive. Returns the event. */
function fire(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { window.dispatchEvent(e); });
  return e;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMediaKeys', () => {
  it('recognises exactly the documented keys and codes', () => {
    // Pinned as literals: the tests below iterate the same lists, so loosening or emptying
    // an export would otherwise leave them green. The same pin as useBackKey's.
    expect([...MEDIA_KEYS]).toEqual([
      ['MediaPlay', 'play'],
      ['MediaPause', 'pause'],
      ['MediaPlayPause', 'playPause'],
      ['MediaStop', 'stop'],
      ['MediaRewind', 'rewind'],
      ['MediaFastForward', 'fastForward'],
      ['Play', 'play'],
      ['Pause', 'pause'],
      ['Stop', 'stop'],
      ['Rewind', 'rewind'],
      ['FastForward', 'fastForward'],
      ['XF86AudioPlay', 'play'],
      ['XF86AudioPause', 'pause'],
      ['XF86AudioStop', 'stop'],
      ['XF86AudioRewind', 'rewind'],
      ['XF86AudioForward', 'fastForward'],
    ]);
    expect([...MEDIA_KEY_CODES]).toEqual([
      [415, 'play'],
      [19, 'pause'],
      [413, 'stop'],
      [412, 'rewind'],
      [417, 'fastForward'],
    ]);
  });

  describe.each([...MEDIA_KEYS])('by key: %s', (key, action) => {
    it('reports the action and claims the press', () => {
      const onMediaKey = vi.fn();
      render(<Harness onMediaKey={onMediaKey} />);
      const e = fire({ key });
      expect(onMediaKey.mock.calls).toEqual([[action]]);
      expect(e.defaultPrevented).toBe(true);
    });
  });

  describe.each([...MEDIA_KEY_CODES])('by keyCode: %i', (keyCode, action) => {
    it('reports the action and claims the press, when the key has no usable name', () => {
      // webOS can send a remote key with `key` empty or "Unidentified". This is the half of
      // the recognition most likely to be the live path on this set.
      const onMediaKey = vi.fn();
      render(<Harness onMediaKey={onMediaKey} />);
      const e = fire({ key: 'Unidentified', keyCode });
      expect(onMediaKey.mock.calls).toEqual([[action]]);
      expect(e.defaultPrevented).toBe(true);
    });

    it('reports the action when there is no key at all', () => {
      const onMediaKey = vi.fn();
      render(<Harness onMediaKey={onMediaKey} />);
      fire({ keyCode });
      expect(onMediaKey.mock.calls).toEqual([[action]]);
    });
  });

  describe.each([
    ['ArrowLeft', 37],
    ['ArrowRight', 39],
    ['ArrowUp', 38],
    ['ArrowDown', 40],
    ['Enter', 13],
    ['Backspace', 8],
    ['Escape', 27],
    ['GoBack', 461],
    ['BrowserBack', 166],
    ['a', 65],
    ['Tab', 9],
    ['constructor', 0],
    ['Unidentified', 0],
    // Not "anything spelled Media…": the forward/back track buttons are not transport jumps.
    ['MediaTrackNext', 0],
    // 179 is desktop Chromium's code for the combined play/pause button. It is NOT in the
    // recalled webOS table, so it is deliberately unrecognised; see the module header on why
    // the numeric list grows only from a reading. Delete this row if a reading adds it.
    ['Unidentified', 179],
  ])('a key that is not a media key: %s (%i)', (key, keyCode) => {
    it('is neither acted on nor claimed', () => {
      // The rule that matters (useBackKey.ts:35): a key this hook does not act on is left
      // for everyone else. Enter is the OK button, Back is the escalation, and the arrows
      // are the focus grid's — all three must leave defaultPrevented false.
      const onMediaKey = vi.fn();
      render(<Harness onMediaKey={onMediaKey} />);
      const e = fire({ key, keyCode });
      expect(onMediaKey).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    });
  });

  it('ignores a media key chorded with a browser shortcut modifier', () => {
    const onMediaKey = vi.fn();
    render(<Harness onMediaKey={onMediaKey} />);
    for (const mod of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      const e = fire({ key: 'MediaPlay', keyCode: 415, ...mod });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(onMediaKey).not.toHaveBeenCalled();
  });

  it('leaves a press that something closer already claimed', () => {
    // A nested handler (the scrub cell, an overlay) that took the key must win.
    const onMediaKey = vi.fn();
    render(<Harness onMediaKey={onMediaKey} />);
    const claim = (e: Event) => e.preventDefault();
    document.addEventListener('keydown', claim);
    const target = document.createElement('div');
    document.body.appendChild(target);
    try {
      act(() => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'MediaPlay', bubbles: true, cancelable: true }));
      });
    } finally {
      document.removeEventListener('keydown', claim);
      target.remove();
    }
    expect(onMediaKey).not.toHaveBeenCalled();
  });

  it('claims a held key but acts only on the first press', () => {
    // A held Fast-Forward is ±60s per repeat, many times a second: a Range storm that
    // re-anchors the deadline window at every press. The on-screen twin is how you repeat.
    const onMediaKey = vi.fn();
    render(<Harness onMediaKey={onMediaKey} />);
    fire({ key: 'MediaFastForward' });
    const repeat = fire({ key: 'MediaFastForward', repeat: true });
    fire({ key: 'MediaFastForward', repeat: true });
    expect(onMediaKey).toHaveBeenCalledTimes(1);
    // Still claimed, or the browser would act on the repeats itself.
    expect(repeat.defaultPrevented).toBe(true);
  });

  it('installs exactly one keydown listener on window, and removes it on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const keydowns = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'keydown');

    const { rerender, unmount } = render(<Harness onMediaKey={() => {}} />);
    expect(keydowns(add)).toHaveLength(1);
    // A new handler every render must not re-register.
    rerender(<Harness onMediaKey={() => {}} />);
    rerender(<Harness onMediaKey={() => {}} />);
    expect(keydowns(add)).toHaveLength(1);
    expect(keydowns(remove)).toHaveLength(0);

    unmount();
    expect(keydowns(remove)).toHaveLength(1);
    expect(keydowns(remove)[0][1]).toBe(keydowns(add)[0][1]);
  });

  it('stops reporting after unmount, and no longer claims the key', () => {
    const onMediaKey = vi.fn();
    const { unmount } = render(<Harness onMediaKey={onMediaKey} />);
    fire({ key: 'MediaPlay' });
    expect(onMediaKey).toHaveBeenCalledTimes(1);
    unmount();
    const e = fire({ key: 'MediaPlay' });
    expect(onMediaKey).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(false);
  });

  it('always calls the latest callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onMediaKey={first} />);
    rerender(<Harness onMediaKey={second} />);
    fire({ key: 'MediaPause' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('claims no key it has no action for, so Back and the D-pad still work beside it', () => {
    // The whole-surface invariant, asserted in one place: between useFocusGrid (arrows),
    // useBackKey (Back) and this hook, nothing swallows a key it does not act on.
    const onMediaKey = vi.fn();
    render(<Harness onMediaKey={onMediaKey} />);
    const claimed: string[] = [];
    for (const [key] of MEDIA_KEYS) if (fire({ key }).defaultPrevented) claimed.push(key);
    expect(claimed).toEqual(MEDIA_KEYS.map(([key]) => key));
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'GoBack']) {
      expect(fire({ key }).defaultPrevented).toBe(false);
    }
  });
});
