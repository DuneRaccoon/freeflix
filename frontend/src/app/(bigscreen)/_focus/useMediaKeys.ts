'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * The transport keys on a webOS remote — Play, Pause, Stop, Rewind, Fast-Forward — by every
 * spelling they might arrive under.
 *
 * WHAT IS KNOWN HERE AND WHAT IS GUESSED. Read this before narrowing either list.
 *
 * - NOTHING BELOW WAS READ OFF THIS DEVICE. This repo records exactly one key number from
 *   the television — `461` for Back — and `useBackKey.ts:7-11` records even that as an
 *   unverified assumption, because the on-TV key log at `/bigscreen/diag` was run and what
 *   it showed was never written down. No media button has ever been logged on this set.
 * - `415` Play, `19` Pause, `413` Stop, `412` Rewind, `417` Fast-Forward are RECALLED
 *   PLATFORM DOCUMENTATION, not a measurement. (`19` is also `VK_PAUSE` on a PC keyboard,
 *   which is consistent, and is the only one of the five with an everyday meaning.)
 * - That the engine populates `e.key` for a media button AT ALL is a GUESS. The set reported
 *   Chromium 120 / webOS 25 from `navigator.userAgent` in Oct 2026, which is a modern engine,
 *   but a television may route its transport buttons to `navigator.mediaSession`, deliver
 *   them only on `keyup`, or consume them in the platform's own player and send nothing.
 *
 * This project spent weeks believing the panel was Chromium 87 before anyone read the user
 * agent, so the provenance is written down rather than implied by a confident-looking table.
 * Stage 10's instrument takes the readings; until they are transcribed, narrow nothing.
 *
 * WHY THE TWO LISTS ARE NOT SYMMETRICAL. A `key` name this device never sends is inert — it
 * matches nothing. A `keyCode` that is wrong is worse than inert: the numbers are a flat
 * namespace shared with ordinary keys, so inventing one risks claiming a press that means
 * something else here. So the names are generous (standard `Media*`, the bare webOS-style
 * spellings, and the X11 `XF86Audio*` forms, the same reason `useBackKey` carries `XF86Back`)
 * and the numbers are exactly the five recalled ones. The numeric list grows from a reading,
 * never from a guess.
 *
 * AND NONE OF IT IS LOAD-BEARING. Every action reported here has a focusable on-screen twin
 * in the transport row, so an unrecognised media key is a missing shortcut and never a
 * missing feature. A wrong list is a one-line edit to two arrays.
 */
export type MediaKeyAction = 'play' | 'pause' | 'playPause' | 'stop' | 'rewind' | 'fastForward';

/**
 * `rewind`/`fastForward` are ±60s JUMPS, not a continuous scan: the platform does not
 * support scan, and the consumer owns the arithmetic (spec §7.4).
 */
export const MEDIA_KEYS: ReadonlyArray<readonly [string, MediaKeyAction]> = [
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
];

export const MEDIA_KEY_CODES: ReadonlyArray<readonly [number, MediaKeyAction]> = [
  [415, 'play'],
  [19, 'pause'],
  [413, 'stop'],
  [412, 'rewind'],
  [417, 'fastForward'],
];

/** `Map`, not an object literal: `KEYS['constructor']` on a literal is truthy. */
const KEYS: ReadonlyMap<string, MediaKeyAction> = new Map(MEDIA_KEYS);
const KEY_CODES: ReadonlyMap<number, MediaKeyAction> = new Map(MEDIA_KEY_CODES);

function actionOf(e: KeyboardEvent): MediaKeyAction | undefined {
  // Browser shortcuts are not remote presses.
  if (e.altKey || e.ctrlKey || e.metaKey) return undefined;
  return KEYS.get(e.key) ?? KEY_CODES.get(e.keyCode);
}

/**
 * Calls `onMediaKey` with the action a transport press means. Installs one `window` listener
 * and removes it on unmount.
 *
 * It claims the media keys and nothing else: `preventDefault()` on a key this does not act on
 * is how Back stops working on a device nobody can attach a debugger to (`useBackKey.ts:35`).
 * `useFocusGrid` has the same rule for the arrows and `useBackKey` for Back, so between the
 * three the surface never swallows a key it does not act on. A press something closer already
 * claimed (`defaultPrevented`) is left alone — a nested transport cell wins.
 *
 * A held key is claimed but acts once. A repeating Fast-Forward is ±60s per repeat, many times
 * a second: a storm of Range requests each re-anchoring the backend's deadline window. The
 * on-screen twin is how a viewer repeats a jump.
 *
 * `onMediaKey` may change on every render; the listener always calls the latest one.
 *
 * OWNERSHIP: like the focus grid and the Back key, the listener checks no scope, so one screen
 * means one live `useMediaKeys`. Of two, whichever registered first claims the press and the
 * other never hears it.
 */
export function useMediaKeys(onMediaKey: (action: MediaKeyAction) => void): void {
  const latest = useRef(onMediaKey);
  // Layout effect so a key press can never see the previous render's handler.
  useLayoutEffect(() => {
    latest.current = onMediaKey;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = actionOf(e);
      if (!action) return; // not ours: leave the event alone for the arrows and Back
      e.preventDefault();
      if (e.repeat) return;
      latest.current(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
