'use client';
import type { AutoNextState } from '../_data/autoNext';
import type { FocusProps } from '../_focus/useFocusGrid';

/**
 * The show screen's switch for "get the next episode ready".
 *
 * ONE CELL, ALWAYS RENDERED, and both of those are about the focus model rather than about
 * tidiness. The show screen's row 0 declares a constant count (`ACTION_CELLS`), so this must
 * not come and go with the state of the read behind it — a cell that appeared when the
 * settings call answered would be an insertion into the row the ring is most likely sitting
 * in. So it renders from the first commit, showing the default, and only what it SAYS depends
 * on the answer. (The Subtitles cell in the player is the same decision for the same reason;
 * its own header has the long version.)
 *
 * IT IS THE `.bs-title__toggle` SHAPE, NOT A NEW CONTROL. `aria-pressed` on a `.bs-btn
 * .bs-btn--ghost`, which the stylesheet already colours — the movie screen's 4K opt-in is the
 * other one, and the pressed declarations are shared between them rather than copied. The
 * border is carried in BOTH states by that rule, so turning the switch on changes colour and
 * nothing else: a border appearing on press would widen the control by 2px and nudge whatever
 * is beside it, which under a 4px focus ring reads as the screen moving.
 *
 * A PRESS IS NEVER SILENTLY REFUSED. The label flips at once — `useAutoNext` writes
 * optimistically — and a refusal flips it back and prints why beside it, because there is no
 * toaster on this surface and a control that lied about its own state is worse than one that
 * admits it could not save.
 *
 * WHAT IT DOES NOT DO: claim the setting is this profile's when the read failed. `readFailed`
 * says so in words, and the player's own gate is stricter still — it will not start a
 * background download on a setting nobody managed to read.
 */

/** What the switch says it is. The word order puts the STATE last, where a viewer's eye lands. */
export function autoNextLabel(on: boolean): string {
  return `Auto-download next: ${on ? 'On' : 'Off'}`;
}

export function AutoNextToggle({
  state,
  focusProps,
}: {
  state: AutoNextState;
  focusProps: FocusProps;
}) {
  const { on, readFailed, writeFailed, toggle } = state;
  return (
    <div className="bs-title__action bs-show__autonext">
      <button
        type="button"
        className="bs-btn bs-btn--ghost bs-title__toggle"
        aria-pressed={on}
        {...focusProps}
        onClick={toggle}
      >
        {autoNextLabel(on)}
      </button>
      {/* The note is PERMANENT, not a disclosure that comes and goes: it is the only place the
          switch's effect is stated, and a line that appeared on press would nudge the control
          the ring is on. It is prose beside a control, so `.bs-title__note`, which is what the
          4K cell's own disclosure wears. */}
      <p className="bs-title__note">Starts the next episode downloading before this one ends.</p>
      {/* A FAILED READ IS A NOTE, NOT AN ALERT, and the distinction is the viewer's: nobody
          pressed anything, nothing is wrong with what they are doing, and the switch is
          showing the default rather than a mistake. `role="alert"` is for the press that
          could not be saved — an answer to something the viewer just did, and the one thing
          here a television should interrupt itself to say. */}
      {readFailed && (
        <p className="bs-title__note">Couldn’t read this profile’s setting, so this is the default.</p>
      )}
      {writeFailed && (
        <p role="alert" className="bs-title__alert">
          Couldn’t save that. The box still has it the other way round.
        </p>
      )}
    </div>
  );
}
