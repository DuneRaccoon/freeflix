'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * The Back key on a webOS remote, by every spelling it might arrive under.
 *
 * ITS IDENTITY ON THIS DEVICE IS NOT KNOWN. The repo records only `461`, and records it as
 * an unverified assumption: the on-TV key log at `/bigscreen/diag` was run, but what it
 * showed was never written down. So this recognises every plausible spelling rather than
 * betting on one, and the keypad keeps an on-screen Back key that does not depend on any
 * of them. Once the log is transcribed, narrow these to what the set actually sends.
 *
 * - `461` is webOS's documented Back; `8` is Backspace, which many TV browsers send
 *   instead; `27` is Escape, which is what the diag page's own log would show; `166` is
 *   `VK_BROWSER_BACK`.
 * - `Unidentified` is deliberately absent. A TV that sends no usable `key` is matched by its
 *   `keyCode`, and claiming `Unidentified` would claim every key it fails to name.
 */
export const BACK_KEYS: readonly string[] = ['Backspace', 'Escape', 'XF86Back', 'BrowserBack', 'GoBack', 'Back'];
export const BACK_KEY_CODES: readonly number[] = [461, 8, 27, 166];

/** `Set`, not an object literal: `KEYS['constructor']` on a literal is truthy. */
const KEYS: ReadonlySet<string> = new Set(BACK_KEYS);
const KEY_CODES: ReadonlySet<number> = new Set(BACK_KEY_CODES);

function isBack(e: KeyboardEvent): boolean {
  // Browser shortcuts (Ctrl+Backspace deletes a word) are not remote presses.
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  return KEYS.has(e.key) || KEY_CODES.has(e.keyCode);
}

/**
 * Calls `onBack` for a Back press. Installs one `window` listener and removes it on unmount.
 *
 * It claims the Back keys and nothing else: `preventDefault()` on a key this does not act on
 * is how Back stops working on a device nobody can attach a debugger to. `useFocusGrid` has
 * the same rule for the arrows, so between them the surface never swallows a key it does
 * not act on. A press something closer already claimed (`defaultPrevented`) is left alone.
 *
 * A held key is claimed but acts once. Back is an escalation (collapse, then leave), and a
 * repeating key would walk the viewer through every step of it in one press.
 *
 * `onBack` may change on every render; the listener always calls the latest one.
 *
 * OWNERSHIP: like the focus grid, the listener checks no scope, so one screen means one
 * live `useBackKey`. Of two, whichever registered first claims the press and the other
 * never hears it.
 */
export function useBackKey(onBack: () => void): void {
  const latest = useRef(onBack);
  // Layout effect so a key press can never see the previous render's handler.
  useLayoutEffect(() => {
    latest.current = onBack;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!isBack(e)) return; // not ours: leave the event alone
      e.preventDefault();
      if (e.repeat) return;
      latest.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
