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

// Storage can throw on access (a TV in a restricted mode, a full quota), so every touch
// degrades to "nothing remembered" instead of taking the screen down.
function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* the choice holds for this session; it just will not survive a restart */
  }
}

/** Only what every TV screen needs. A full profile row carries settings and account ids. */
const toTvProfile = (p: TvProfile): TvProfile => ({
  id: p.id,
  display_name: p.display_name,
  avatar: p.avatar,
});

export function useTvProfile(): TvProfileState {
  const [profile, setProfile] = useState<TvProfile | null>(null);
  // True on the first render whatever is stored: storage is unreadable on the server, so
  // "not yet known" is the one answer the server render and the client's first agree on.
  const [loading, setLoading] = useState(true);
  // Set once someone has chosen. A restore that lands afterwards must neither replace
  // that choice nor erase it from storage as "no longer in the list".
  const decided = useRef(false);

  useEffect(() => {
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
  }, []);

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
