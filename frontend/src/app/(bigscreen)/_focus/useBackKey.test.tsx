import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { BACK_KEYS, BACK_KEY_CODES, useBackKey } from './useBackKey';

function Harness({ onBack }: { onBack: () => void }) {
  useBackKey(onBack);
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

describe('useBackKey', () => {
  it('recognises exactly the documented keys and codes', () => {
    // Pinned as literals: the tests below iterate the same lists, so loosening or emptying
    // an export would otherwise leave them green.
    expect([...BACK_KEYS]).toEqual(['Backspace', 'Escape', 'XF86Back', 'BrowserBack', 'GoBack', 'Back']);
    expect([...BACK_KEY_CODES]).toEqual([461, 8, 27, 166]);
  });

  describe.each(['Backspace', 'Escape', 'XF86Back', 'BrowserBack', 'GoBack', 'Back'])('by key: %s', (key) => {
    it('calls onBack and claims the press', () => {
      const onBack = vi.fn();
      render(<Harness onBack={onBack} />);
      const e = fire({ key });
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(e.defaultPrevented).toBe(true);
    });
  });

  describe.each([461, 8, 27, 166])('by keyCode: %i', (keyCode) => {
    it('calls onBack and claims the press, when the key has no usable name', () => {
      // webOS can send a remote key with `key` empty or "Unidentified".
      const onBack = vi.fn();
      render(<Harness onBack={onBack} />);
      const e = fire({ key: 'Unidentified', keyCode });
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(e.defaultPrevented).toBe(true);
    });

    it('calls onBack when there is no key at all', () => {
      const onBack = vi.fn();
      render(<Harness onBack={onBack} />);
      fire({ keyCode });
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe.each([
    ['ArrowLeft', 37],
    ['ArrowDown', 40],
    ['Enter', 13],
    ['a', 65],
    ['Unidentified', 0],
    ['Tab', 9],
    ['constructor', 0],
  ])('a key that is not Back: %s (%i)', (key, keyCode) => {
    it('is neither acted on nor claimed', () => {
      const onBack = vi.fn();
      render(<Harness onBack={onBack} />);
      const e = fire({ key, keyCode });
      expect(onBack).not.toHaveBeenCalled();
      // The rule that matters: a key this hook does not act on is left for everyone else.
      expect(e.defaultPrevented).toBe(false);
    });
  });

  it('ignores a Back key chorded with a browser shortcut modifier', () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    for (const mod of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      const e = fire({ key: 'Backspace', keyCode: 8, ...mod });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(onBack).not.toHaveBeenCalled();
  });

  it('leaves a press that something closer already claimed', () => {
    // A nested handler (a transport bar, an overlay) that took the key must win.
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    const claim = (e: Event) => e.preventDefault();
    document.addEventListener('keydown', claim);
    const target = document.createElement('div');
    document.body.appendChild(target);
    try {
      act(() => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      });
    } finally {
      document.removeEventListener('keydown', claim);
      target.remove();
    }
    expect(onBack).not.toHaveBeenCalled();
  });

  it('claims a held key but acts only on the first press', () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    fire({ key: 'Escape' });
    const repeat = fire({ key: 'Escape', repeat: true });
    fire({ key: 'Escape', repeat: true });
    expect(onBack).toHaveBeenCalledTimes(1);
    // Still claimed, or the browser would act on the repeats itself.
    expect(repeat.defaultPrevented).toBe(true);
  });

  it('installs exactly one keydown listener on window, and removes it on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const keydowns = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'keydown');

    const { rerender, unmount } = render(<Harness onBack={() => {}} />);
    expect(keydowns(add)).toHaveLength(1);
    // A new handler every render must not re-register.
    rerender(<Harness onBack={() => {}} />);
    rerender(<Harness onBack={() => {}} />);
    expect(keydowns(add)).toHaveLength(1);
    expect(keydowns(remove)).toHaveLength(0);

    unmount();
    expect(keydowns(remove)).toHaveLength(1);
    // The same function that was added is the one removed.
    expect(keydowns(remove)[0][1]).toBe(keydowns(add)[0][1]);
  });

  it('stops calling onBack after unmount', () => {
    const onBack = vi.fn();
    const { unmount } = render(<Harness onBack={onBack} />);
    fire({ key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
    unmount();
    const e = fire({ key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
    // And an unmounted screen no longer claims the key either.
    expect(e.defaultPrevented).toBe(false);
  });

  it('always calls the latest onBack', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onBack={first} />);
    rerender(<Harness onBack={second} />);
    fire({ key: 'Backspace' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
