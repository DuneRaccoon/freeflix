'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { BACK_KEYS, BACK_KEY_CODES } from './useBackKey';

/**
 * How long the controls stay up after the last press. A guess, not a measurement — no
 * reading from the set informs it — so it is a named constant the caller may override.
 */
export const REVEAL_HIDE_MS = 5000;

/** Imported, never re-listed: a second copy of the Back spellings would drift. */
const BACK_NAMES: ReadonlySet<string> = new Set(BACK_KEYS);
const BACK_CODES: ReadonlySet<number> = new Set(BACK_KEY_CODES);

const isBack = (e: KeyboardEvent) => BACK_NAMES.has(e.key) || BACK_CODES.has(e.keyCode);

export interface RevealOnKeyOptions {
  /** Whether the controls are on screen right now. Read live; it never re-registers. */
  visible: boolean;
  /** Show the controls. Called only while hidden, and must be idempotent. */
  onReveal: () => void;
  /**
   * Hide them again after the quiet period. Must be idempotent — see below.
   *
   * RETURN `false` TO SAY "REFUSED", and the quiet period is served again. Returning
   * nothing means "treat it as done", so every existing caller is unaffected.
   */
  onHide: () => void | boolean;
  /** The quiet period. Defaults to `REVEAL_HIDE_MS`. */
  hideAfterMs?: number;
}

/**
 * The reveal-and-auto-hide half of the player's key handling: any remote press wakes the
 * control band, and a quiet period puts it away again.
 *
 * `{ capture: true }`, AND THAT IS THE DESIGN. While hidden, the first press must mean only
 * "wake up" — it must not also move the ring, seek, or play. The capture pass at `window`
 * runs before every other phase on every node in the path, including bubble listeners on the
 * target itself, so `stopPropagation()` here keeps the press away from `useFocusGrid`,
 * `useBackKey`, `useMediaKeys` and React's synthetic handlers alike. A bubble listener here
 * would instead be ordered against them by declaration order, which on this surface means
 * mount order — an accident, not a decision, and effects register child before parent.
 *
 * IT DOES NOT CHECK `defaultPrevented`, deliberately. The focus grid claims every arrow it
 * acts on, so on this surface a claimed arrow is the ordinary shape of "the viewer is
 * driving". Skipping claimed keys would auto-hide the band under a moving ring.
 *
 * BACK IS EXEMPT, under every spelling, imported from `useBackKey`'s own lists. Back is the
 * escalation (cancel an edit, then hide, then leave). If a Back press while hidden revealed
 * the controls, the page's `useBackKey` would collapse them again in the same press and the
 * rung that leaves the player would be unreachable.
 *
 * Every other key is swallowed while hidden, media keys included: the first press always
 * means "wake up", and the viewer presses again. Exempting more keys is a one-line change,
 * but a key that acts invisibly is worse than one that acts on the second press.
 *
 * A modifier chord is not a remote press (there is no Ctrl on a remote), so it is ignored
 * outright: not swallowed, and not counted as activity.
 *
 * THE TIMER LIVES IN A REF. A held arrow repeats many times a second and the grid has no
 * `e.repeat` guard, so a `setState` per press would re-render the control band — over a
 * decoding 1080p surface — once per repeat, for nothing visible. Nothing here renders.
 *
 * `onHide` must be idempotent: a pending quiet period is not cancelled when the controls are
 * hidden some other way (a Back press), so it can fire against already-hidden controls.
 *
 * THE QUIET PERIOD STARTS ON MOUNT. Anything else means the controls' first appearance —
 * the one nobody asked for, when the title starts — is the one that never goes away by
 * itself, because the viewer has not pressed anything yet. See the effect below.
 *
 * A REFUSED HIDE IS RETRIED, NOT SPENT, and that is a contract change made to fix a live
 * defect rather than to enable a new feature. The caller may legitimately refuse — the
 * player refuses while the title is paused, while a seek edit is open, and WHILE A MESSAGE
 * IS ON SCREEN. The quiet period used to be armed only by a key press, so a refusal
 * consumed it and nothing re-armed: a message that outlives the quiet period (the player's
 * notes run 8s against a 5s period) permanently spent the press that would have put the
 * band away, and the control band then sat over the picture for the rest of the film. That
 * was already reachable on the reduced-resume path before anything in stage 8 existed.
 * Serving the period again costs one `setTimeout` per period while a refusal persists,
 * renders nothing, and stops with the hook; being stuck visible costs the film.
 *
 * OWNERSHIP: one live instance per screen, like the other three key hooks. Two would each
 * swallow the other's first press.
 */
export function useRevealOnKey(opts: RevealOnKeyOptions): void {
  const latest = useRef(opts);
  // Layout effect so a key press can never see the previous render's visibility or callbacks.
  useLayoutEffect(() => {
    latest.current = opts;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const rearm = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // `=== false` is the refusal, so `undefined` (a void-returning caller) still
        // counts as done and nothing re-arms behind it.
        if (latest.current.onHide() === false) rearm();
      }, latest.current.hideAfterMs ?? REVEAL_HIDE_MS);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (isBack(e)) return;
      if (!latest.current.visible) {
        // The press that only meant "wake up": claimed, and kept from everything downstream.
        e.preventDefault();
        e.stopPropagation();
        latest.current.onReveal();
      }
      rearm();
    };

    // ARMED ON MOUNT, NOT ONLY BY A PRESS, and this is the fix for a defect that was on
    // screen for the whole of every film: the quiet period was armed from `onKeyDown` and
    // from nowhere else, so a viewer who started a title and then pressed NOTHING — which
    // is what watching something is — never got a first period at all. The band and the
    // 480px scrim behind it sat over the picture until some key happened to be pressed.
    //
    // Every row in this hook's own suite fired a key before advancing the clock, so none of
    // them could see it; `hides without being pressed at all` is the one that can.
    //
    // It composes with the refusal contract rather than bypassing it: on arrival the player
    // usually HAS a message up (the resume note, the arrival disclosure), `mayHide` refuses,
    // and the period is served again until the message goes — which is exactly what a press
    // would have got.
    rearm();
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
}
