'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  PasscodeChangeRequest,
  User,
  UserSettings,
  UserSettingsUpdate,
  usersService,
} from '@/services/users';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { useSession } from '@/context/SessionContext';
import { onProfileLocked } from '@/services/api-client';

/** What `selectUser` resolves to. `locked` means the profile exists and belongs to
 *  this account, but the server wants its passcode before handing anything over. */
export type SelectUserResult = 'ok' | 'locked' | 'throttled' | 'error';

/** What `changePasscode` resolves to. `wrong` is a 403: the current code did not match. */
export type PasscodeChangeResult = 'ok' | 'wrong' | 'throttled' | 'error';

type UserContextType = {
  currentUser: User | null;
  userSettings: UserSettings | null;
  users: User[];
  isLoading: boolean;
  /** A profile is being opened right now. Distinct from `isLoading`, which is the
   *  one-time boot; surfaces a busy state without unmounting the caller. */
  isSelecting: boolean;
  error: string | null;
  /** The stored profile that boot restore found locked (423): the picker should ask
   *  for its code. `null` otherwise, and cleared by any successful pick. */
  lockedProfileId: string | null;
  loadUsers: () => Promise<void>;
  selectUser: (userId: string, passcode?: string) => Promise<SelectUserResult>;
  logout: () => void;
  changePasscode: (userId: string, body: PasscodeChangeRequest) => Promise<PasscodeChangeResult>;
  isContentAllowed: (contentRating?: string | null) => boolean;
  updateUser: (userId: string, data: { display_name?: string; avatar?: string }) => Promise<void>;
  updateUserSettings: (userId: string, settings: UserSettingsUpdate) => Promise<void>;
};

const UserContext = createContext<UserContextType | undefined>(undefined);

const ACTIVE_PROFILE_KEY = 'currentUserId';

// A rejected unlock keeps the keypad open rather than tearing the selection down; only
// an unexpected failure is an 'error'. 429 is reported separately because rendering it
// as "Incorrect passcode" tells someone their correct code is wrong — after five
// fat-fingered tries the sixth is refused before the hash is even checked, and every
// attempt for the next five minutes shows the same lie.
const UNLOCK_REJECTED = [403, 423];
const UNLOCK_THROTTLED = 429;

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

function readStoredProfileId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_KEY);
  } catch {
    return null;
  }
}

function writeStoredProfileId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    else localStorage.removeItem(ACTIVE_PROFILE_KEY);
  } catch {
    // Private-mode storage. The profile stays active for this tab, it just will not
    // be remembered — not worth failing the selection over.
  }
}

/**
 * The profile a request URL names, or null when it names none. Every backend route
 * that can answer 423 takes its profile in one of these places: `/users/{id}/…`,
 * `/watchlist/{id}/…`, `/streaming/progress/{id}/…`, or `?user_id=` (rails).
 */
function profileNamedBy(url: string): string | null {
  const [path, query = ''] = url.split('?');
  const inPath = path.match(/\/(?:users|watchlist|streaming\/progress)\/([^/]+)/);
  if (inPath) return decodeURIComponent(inPath[1]);
  return new URLSearchParams(query).get('user_id') || null;
}

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Per-selection busy flag, kept separate from the boot flag above so that opening a
  // profile never tears down the screen the user is opening it from.
  const [isSelecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedProfileId, setLockedProfileId] = useState<string | null>(null);
  const router = useRouter();
  // The 423 listener subscribes once, so it reads the profile through a ref.
  const currentUserRef = useRef<User | null>(null);
  currentUserRef.current = currentUser;

  // The profile list is account-scoped server-side, so there is nothing to fetch
  // until the session resolves — and a fetch before it would only collect a 401.
  const { account, isLoading: sessionLoading } = useSession();
  const accountId = account?.id ?? null;
  const bootedFor = useRef<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      setError(null);
      const userData = await usersService.getUsers();
      setUsers(userData);
    } catch (err) {
      console.error('Error loading users:', err);
      setError('Failed to load profiles. Please try again.');
    }
  }, []);

  /** The one failure path for opening a profile, whichever request failed. */
  const openFailed = useCallback((userId: string, err: unknown): 'error' => {
    console.error('Error selecting profile:', err);
    setError('Failed to open that profile. Please try again.');
    // The stored id outlives the profile it points at — a leftover from before
    // this account owned the browser, or a profile another member removed. Drop
    // it, or every reload replays the same failure.
    if (readStoredProfileId() === userId) writeStoredProfileId(null);
    return 'error';
  }, []);

  /**
   * Fetches a profile the session may already read and makes it this tab's. No select:
   * boot restore calls this alone, so a refresh never asks for the code again.
   */
  const openProfile = useCallback(async (userId: string): Promise<'ok' | 'locked' | 'error'> => {
    try {
      const [user, settings] = await Promise.all([
        usersService.getUser(userId),
        usersService.getUserSettings(userId),
      ]);

      setCurrentUser(user);
      setUserSettings(settings);
      setLockedProfileId(null);
      writeStoredProfileId(user.id);
      return 'ok';
    } catch (err) {
      if (statusOf(err) === 423) return 'locked';
      return openFailed(userId, err);
    }
  }, [openFailed]);

  const selectUser = useCallback(
    async (userId: string, passcode?: string): Promise<SelectUserResult> => {
      // Deliberately does NOT flip `isLoading`. AuthenticatedLayout renders a spinner
      // instead of its children while that flag is set, so ProfileGate would UNMOUNT
      // mid-selection and take its PasscodePrompt state with it — a locked profile could
      // never show its keypad. `isLoading` means "still booting", nothing else.
      setSelecting(true);
      setError(null);
      try {
        // Select runs on EVERY pick, code or not, and before anything is fetched: the
        // server keeps only the session's active profile unlocked, so this pick is what
        // relocks the last one. An open profile is picked without a code.
        try {
          await usersService.selectProfile(userId, passcode);
        } catch (err) {
          const status = statusOf(err) ?? 0;
          if (status === UNLOCK_THROTTLED) return 'throttled';
          if (UNLOCK_REJECTED.includes(status)) return 'locked';
          return openFailed(userId, err);
        }
        return await openProfile(userId);
      } finally {
        setSelecting(false);
      }
    },
    [openProfile, openFailed],
  );

  useEffect(() => {
    if (sessionLoading) return;

    if (!accountId) {
      bootedFor.current = null;
      setUsers([]);
      setCurrentUser(null);
      setUserSettings(null);
      setLockedProfileId(null);
      setIsLoading(false);
      return;
    }

    // Re-running on every render of the provider would refetch the whole profile list
    // and reset the active profile; key the bootstrap on the account instead.
    if (bootedFor.current === accountId) return;
    bootedFor.current = accountId;

    let cancelled = false;
    void (async () => {
      await loadUsers();
      if (cancelled) return;
      const storedUserId = readStoredProfileId();
      // Restore, never select: the session still holds this profile unlocked from the
      // pick that stored it. A 423 means it was relocked since (another tab picked a
      // different profile); keep the stored id and let the picker ask for its code.
      if (storedUserId && (await openProfile(storedUserId)) === 'locked') {
        setLockedProfileId(storedUserId);
      }
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, sessionLoading, loadUsers, openProfile]);

  // Another tab picked a different profile, which relocked this tab's. Back to the
  // picker with the numpad open for it. Not logout(): the stored id stays and no
  // deselect is sent, which would relock the profile the other tab just opened.
  useEffect(
    () =>
      onProfileLocked((url) => {
        // select/unlock are the lock prompt's own requests; their 423 is a refusal, not a relock.
        if (/\/(select|unlock)$/.test(url.split('?')[0])) return;
        const current = currentUserRef.current;
        if (!current) return;
        // A stale request for the previous profile, landing after a switch, is about
        // that profile: only a 423 naming this one (or naming none) drops it.
        const named = profileNamedBy(url);
        if (named !== null && named !== current.id) return;
        setLockedProfileId(current.id);
        setCurrentUser(null);
        setUserSettings(null);
      }),
    [],
  );

  /**
   * "Switch profile" — relocks the profile on the server and clears it here. The
   * session cookie is untouched; real sign-out lives on SessionContext.
   */
  const logout = () => {
    // Not awaited: apiClient sets no timeout, so a hung request would otherwise trap
    // the user on this profile. A failed relock leaves it open until the next pick.
    usersService.deselectProfile().catch((e) => console.error('Error relocking profile:', e));
    setCurrentUser(null);
    setUserSettings(null);
    setLockedProfileId(null);
    writeStoredProfileId(null);
    router.push('/');
  };

  // Maturity levels from least to most restrictive
  const maturityLevels = ['none', 'pg', 'pg13', 'r'];

  // Check if content is allowed based on maturity rating
  const isContentAllowed = (contentRating?: string | null): boolean => {
    // If no settings or no restrictions, allow all
    if (!userSettings || userSettings.maturity_restriction === 'none') {
      return true;
    }

    // If no content rating, allow
    if (!contentRating) {
      return true;
    }

    // Get numerical values for comparison
    const contentLevel = maturityLevels.indexOf(contentRating.toLowerCase());
    const settingsLevel = maturityLevels.indexOf(userSettings.maturity_restriction);

    // If content rating is unknown, allow
    if (contentLevel === -1) {
      return true;
    }

    // Allow if content rating is less than or equal to settings restriction
    return contentLevel <= settingsLevel;
  };

  // Update user info
  const updateUser = async (userId: string, data: { display_name?: string; avatar?: string }) => {
    try {
      setIsLoading(true);
      const updatedUser = await usersService.updateUser(userId, data);

      // Update current user if this is the logged in user
      if (currentUser && currentUser.id === userId) {
        setCurrentUser(updatedUser);
      }

      // Refresh the users list
      await loadUsers();

      toast.success('Profile updated successfully');
    } catch (err) {
      console.error('Error updating profile:', err);
      toast.error('Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Sets, changes or removes a profile's code. Never flips `isLoading` and shows no
   * toast: AuthenticatedLayout swaps the page for a spinner while `isLoading` is set,
   * which would unmount the caller's form mid-flow. The caller renders the result.
   */
  const changePasscode = async (
    userId: string,
    body: PasscodeChangeRequest,
  ): Promise<PasscodeChangeResult> => {
    try {
      const updatedSettings = await usersService.changePasscode(userId, body);
      if (userId === currentUser?.id) setUserSettings(updatedSettings);
      // The picker's lock badges read the list.
      void loadUsers();
      return 'ok';
    } catch (err) {
      const status = statusOf(err);
      if (status === 403) return 'wrong';
      if (status === UNLOCK_THROTTLED) return 'throttled';
      console.error('Error changing passcode:', err);
      return 'error';
    }
  };

  // Update user settings
  const updateUserSettings = async (userId: string, settings: UserSettingsUpdate) => {
    try {
      setIsLoading(true);
      const updatedSettings = await usersService.updateUserSettings(userId, settings);

      // Update current user settings if this is the logged in user
      if (currentUser && currentUser.id === userId) {
        setUserSettings(updatedSettings);
      }

      toast.success('Settings updated successfully');
    } catch (err) {
      console.error('Error updating settings:', err);
      toast.error('Failed to update settings');
    } finally {
      setIsLoading(false);
    }
  };

  const value = {
    currentUser,
    userSettings,
    users,
    isLoading: isLoading || sessionLoading,
    isSelecting,
    error,
    lockedProfileId,
    loadUsers,
    selectUser,
    logout,
    changePasscode,
    isContentAllowed,
    updateUser,
    updateUserSettings,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};
