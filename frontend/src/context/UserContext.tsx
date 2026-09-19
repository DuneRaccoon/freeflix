'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User, UserSettings, UserSettingsUpdate, usersService } from '@/services/users';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { useSession } from '@/context/SessionContext';
import { preloadAvatars } from '@/utils/avatarHelper';

/** What `selectUser` resolves to. `locked` means the profile exists and belongs to
 *  this account, but the server wants its passcode before handing anything over. */
export type SelectUserResult = 'ok' | 'locked' | 'throttled' | 'error';

type UserContextType = {
  currentUser: User | null;
  userSettings: UserSettings | null;
  users: User[];
  isLoading: boolean;
  /** A profile is being opened right now. Distinct from `isLoading`, which is the
   *  one-time boot; surfaces a busy state without unmounting the caller. */
  isSelecting: boolean;
  error: string | null;
  loadUsers: () => Promise<void>;
  selectUser: (userId: string, passcode?: string) => Promise<SelectUserResult>;
  logout: () => void;
  isPasscodeRequired: (contentRating?: string | null) => boolean;
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

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Per-selection busy flag, kept separate from the boot flag above so that opening a
  // profile never tears down the screen the user is opening it from.
  const [isSelecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

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

  const selectUser = useCallback(
    async (userId: string, passcode?: string): Promise<SelectUserResult> => {
      // Deliberately does NOT flip `isLoading`. AuthenticatedLayout renders a spinner
      // instead of its children while that flag is set, so ProfileGate would UNMOUNT
      // mid-selection and take its PasscodePrompt state with it — a locked profile could
      // never show its keypad. `isLoading` means "still booting", nothing else.
      setSelecting(true);
      setError(null);
      try {
        if (passcode !== undefined) {
          // Verified server-side and recorded on the session row, so the lock the UI
          // advertises survives a page reload and cannot be skipped by calling the
          // profile-scoped endpoints directly.
          try {
            await usersService.unlockProfile(userId, passcode);
          } catch (err) {
            const status = statusOf(err) ?? 0;
            if (status === UNLOCK_THROTTLED) return 'throttled';
            if (UNLOCK_REJECTED.includes(status)) return 'locked';
            throw err;
          }
        }

        const [user, settings] = await Promise.all([
          usersService.getUser(userId),
          usersService.getUserSettings(userId),
        ]);

        setCurrentUser(user);
        setUserSettings(settings);
        writeStoredProfileId(user.id);
        return 'ok';
      } catch (err) {
        if (statusOf(err) === 423) return 'locked';
        console.error('Error selecting profile:', err);
        setError('Failed to open that profile. Please try again.');
        // The stored id outlives the profile it points at — a leftover from before
        // this account owned the browser, or a profile another member removed. Drop
        // it, or every reload replays the same failure.
        if (readStoredProfileId() === userId) writeStoredProfileId(null);
        return 'error';
      } finally {
        setSelecting(false);
      }
    },
    [],
  );

  useEffect(() => {
    preloadAvatars();
  }, []);

  useEffect(() => {
    if (sessionLoading) return;

    if (!accountId) {
      bootedFor.current = null;
      setUsers([]);
      setCurrentUser(null);
      setUserSettings(null);
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
      if (storedUserId) await selectUser(storedUserId);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, sessionLoading, loadUsers, selectUser]);

  /**
   * "Switch profile" — clears the active profile only. The session cookie is
   * untouched; real sign-out lives on SessionContext.
   */
  const logout = () => {
    setCurrentUser(null);
    setUserSettings(null);
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

  // Check if passcode is required
  const isPasscodeRequired = (contentRating?: string | null): boolean => {
    // If no settings or passcode not required, no passcode needed
    if (!userSettings || !userSettings.require_passcode) {
      return false;
    }

    // If no content rating, don't require passcode
    if (!contentRating) {
      return false;
    }

    // Get numerical values for comparison
    const contentLevel = maturityLevels.indexOf(contentRating.toLowerCase());
    const settingsLevel = maturityLevels.indexOf(userSettings.maturity_restriction);

    // Unknown rating doesn't require passcode
    if (contentLevel === -1) {
      return false;
    }

    // Require passcode if content rating is greater than settings restriction
    return contentLevel > settingsLevel;
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
    loadUsers,
    selectUser,
    logout,
    isPasscodeRequired,
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
