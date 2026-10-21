'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usersService, type UserSettings } from '@/services/users';

/**
 * The per-profile "get the next episode ready" switch, as the television reads and writes it.
 *
 * WHY THE DEFAULT LIVES IN A FUNCTION. The column behind this is `user_settings
 * .auto_next_episode`, nullable with no default, because this project has no migration
 * framework: `sync_columns()` can only emit a bare `ADD COLUMN`, so on every household's
 * existing database the column arrives NULL on every row. The server turns that into `true`
 * (`api/users.py`: `row.auto_next_episode is not False`) and the response field is a plain
 * `bool`, never optional — but the CLIENT type is optional, because a required field would be
 * a type error in every settings-shaped object literal under `src/components/`, which the TV
 * work does not touch. So `undefined` reaches here, and `autoNextFrom` is the one place that
 * says what it means. Two readers (the show screen's toggle and the player's prefetch) must
 * not each decide for themselves.
 *
 * WHY A FAILED READ IS NOT "ON". `settled` is true only when the read ANSWERED. The prefetch
 * gates on `settled && on`, so an unreachable settings endpoint means no background download
 * — never a multi-gigabyte download on a Raspberry Pi for a profile that may have opted out.
 * The toggle gates on nothing, because a control has to render something: it shows `on`,
 * which is the default, and says the read failed beside it. The two gates differ because the
 * costs differ, which is the whole reason `settled` is reported separately from `on`.
 *
 * THE WRITE IS OPTIMISTIC AND REVERTS. There is no toaster on this surface, so a failed PUT
 * has to be visible on the control itself: the switch flips at once (a press is never
 * silently ignored), and on a refusal it flips back and `writeFailed` turns on, which is what
 * the toggle prints beside itself.
 */

/**
 * On unless something says otherwise. `=== false`, not `!settings?.auto_next_episode`: the
 * second reads a missing settings row, a missing field and an explicit `false` as the same
 * thing, and only the last of those is a viewer's decision.
 */
export function autoNextFrom(settings: Pick<UserSettings, 'auto_next_episode'> | null | undefined): boolean {
  return settings?.auto_next_episode !== false;
}

export interface AutoNextState {
  /** Whether to get the next episode ready. The default (on) until the read says otherwise. */
  on: boolean;
  /** The read ANSWERED. False while it is in flight and false if it failed. */
  settled: boolean;
  /** The read failed: `on` is the default rather than this profile's answer. */
  readFailed: boolean;
  /** The last press could not be saved, and `on` has been put back to what the box holds. */
  writeFailed: boolean;
  /** Flip it. Resolves when the box has answered (or refused). */
  toggle: () => void;
}

export function useAutoNext(userId: string | null): AutoNextState {
  const [on, setOn] = useState(true);
  const [settled, setSettled] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  // A second press while the first is in flight would race two PUTs whose order the box
  // decides; the control's state is already the answer to the first.
  const writing = useRef(false);
  // Set in the effect rather than at declaration, so StrictMode's second mount revives it —
  // the shape `PrimaryAction` and the subtitle picker both use.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setSettled(false);
    setReadFailed(false);
    setWriteFailed(false);
    if (!userId) {
      // No profile: nothing to read and nothing to wait for. NOT `settled`, because the
      // prefetch must not run for nobody — it would be a download keyed to no history.
      setOn(true);
      return;
    }
    let cancelled = false;
    usersService
      .getUserSettings(userId)
      .then((settings) => {
        if (cancelled) return;
        setOn(autoNextFrom(settings));
        setSettled(true);
      })
      .catch(() => {
        if (cancelled) return;
        // The default, so the toggle has something true-by-default to show — and NOT
        // `settled`, so nothing acts on it.
        setOn(true);
        setReadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // The current value, for `toggle`. A REF rather than reading it through `setOn(was => …)`:
  // an updater must be pure, and StrictMode invokes one twice — so a PUT fired from inside an
  // updater is two PUTs racing each other, which is precisely the state this hook is for.
  const onRef = useRef(on);
  useLayoutEffect(() => {
    onRef.current = on;
  });

  const toggle = useCallback(() => {
    if (!userId || writing.current) return;
    const was = onRef.current;
    const next = !was;
    writing.current = true;
    setWriteFailed(false);
    setOn(next);
    void usersService
      .updateUserSettings(userId, { auto_next_episode: next })
      .then((settings) => {
        if (!alive.current) return;
        // The BOX's answer, not the press's: a settings row that came back with something
        // else (another device wrote it, the field ignored by an older backend) is what the
        // next episode will actually be decided by.
        setOn(autoNextFrom(settings));
        setSettled(true);
        setReadFailed(false);
      })
      .catch(() => {
        if (!alive.current) return;
        setOn(was);
        setWriteFailed(true);
      })
      .finally(() => {
        writing.current = false;
      });
  }, [userId]);

  return { on, settled, readFailed, writeFailed, toggle };
}
