'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usersService } from '@/services/users';

/**
 * Which profile is watching, for the television surface.
 *
 * The web keeps this in `UserContext`, mounted in `(web)/layout.tsx`. This surface cannot
 * import that (nothing under `(bigscreen)` may reach into the web's component and
 * provider trees), so it has its own, deliberately smaller: a hook that only REMEMBERS the
 * choice. Home needs it because Continue Watching and My List call `{user_id}`-scoped
 * endpoints, which answer 403/404/423 until a profile exists.
 *
 * It does NOT verify a passcode. Unlocking is recorded server-side against the session
 * row, so the only honest check is whether a profile-scoped call succeeds. The profiles
 * screen performs the unlock and then calls `select`; a restored profile is trusted the
 * same way, and a screen whose first scoped call comes back 423 should `clear()` and send
 * the viewer back to /bigscreen/profiles.
 */

export interface TvProfile {
  id: string;
  display_name: string;
  avatar: string | null;
}

export interface TvProfileState {
  /** null until a profile is chosen and unlocked. */
  profile: TvProfile | null;
  loading: boolean;
  select: (p: TvProfile) => void;
  clear: () => void;
}

/**
 * localStorage, not sessionStorage: a television app restarts whenever the viewer leaves
 * and comes back, and re-asking "who's watching?" every time is the wrong default for a
 * device in a living room. (Not the web's `currentUserId` either; the two surfaces make
 * their own choice.)
 */
const STORAGE_KEY = 'bs-profile';

/**
 * The choice as THIS page load last made it, for when storage cannot hold it.
 *
 * Not per hook instance, and that is the point. The picker calls `select()` and navigates;
 * home mounts its OWN `useTvProfile()` and reads storage. If the write failed (a TV in a
 * restricted mode, a full quota) that read finds nothing, home sees `profile: null` and
 * sends the viewer straight back to "Who's watching?", forever, with no way out on a
 * remote. A module-level value survives the client-side navigation between the two.
 *
 * It wins over storage when set: it is the newer of the two, and a write that failed
 * leaves storage holding a stale earlier choice. `clear()` sets it back to null, which
 * defers to storage again.
 */
let memoryId: string | null = null;

// Storage can throw on access (a TV in a restricted mode, a full quota), so every touch
// degrades to "nothing remembered" instead of taking the screen down.
function readStoredId(): string | null {
  if (memoryId) return memoryId;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null): void {
  memoryId = id;
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* held in memoryId for the rest of this page load; it just will not survive a restart */
  }
}

/** Only what every TV screen needs. A full profile row carries settings and account ids. */
const toTvProfile = (p: TvProfile): TvProfile => ({
  id: p.id,
  display_name: p.display_name,
  avatar: p.avatar,
});

export interface TvProfileOptions {
  /**
   * Resolve the remembered profile on mount (default). The picker passes `false`: it only
   * wants `select`, and the restore would fetch the same profile list the picker fetches
   * for itself.
   */
  restore?: boolean;
}

export function useTvProfile({ restore = true }: TvProfileOptions = {}): TvProfileState {
  const [profile, setProfile] = useState<TvProfile | null>(null);
  // True on the first render whatever is stored: storage is unreadable on the server, so
  // "not yet known" is the one answer the server render and the client's first agree on.
  // (With nothing to restore there is nothing to wait for, and the option is constant.)
  const [loading, setLoading] = useState(restore);
  // Set once someone has chosen. A restore that lands afterwards must neither replace
  // that choice nor erase it from storage as "no longer in the list".
  const decided = useRef(false);

  useEffect(() => {
    if (!restore) return;
    const storedId = readStoredId();
    if (!storedId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    usersService
      .getUsers()
      .then((users) => {
        if (cancelled || decided.current) return;
        const match = users.find((u) => u.id === storedId);
        if (match) setProfile(toTvProfile(match));
        // Deleted on another device. Forget it, or every launch repeats this lookup.
        else writeStoredId(null);
      })
      // Unreachable is not "gone": keep the stored id and leave profile null for now.
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restore]);

  const select = useCallback((p: TvProfile) => {
    decided.current = true;
    writeStoredId(p.id);
    setProfile(toTvProfile(p));
    setLoading(false);
  }, []);

  const clear = useCallback(() => {
    decided.current = true;
    writeStoredId(null);
    setProfile(null);
    setLoading(false);
  }, []);

  return { profile, loading, select, clear };
}
