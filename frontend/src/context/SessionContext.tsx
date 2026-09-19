'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { authService, type Account, type InstanceStatus } from '@/services/auth';

type SessionContextType = {
  account: Account | null;
  instance: InstanceStatus | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [account, setAccount] = useState<Account | null>(null);
  const [instance, setInstance] = useState<InstanceStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const booted = useRef(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Status first: an unclaimed instance has no accounts to ask about, and /auth/me
      // would only produce a 401 that the boot state machine has to ignore anyway.
      const status = await authService.instanceStatus();
      setInstance(status);
      if (!status.claimed) {
        setAccount(null);
        return;
      }
      try {
        const payload = await authService.me();
        setAccount(payload.account);
      } catch {
        // A 401 here is the ordinary signed-out state, not a failure. authService.me()
        // opts out of the global redirect so AuthenticatedLayout owns that decision.
        setAccount(null);
      }
    } catch {
      setInstance(null);
      setAccount(null);
      setError('Could not reach this instance.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // React 18 StrictMode double-invokes effects in dev; a second bootstrap would
    // flip isLoading back to true and re-run the gate.
    if (booted.current) return;
    booted.current = true;
    void load();
  }, [load]);

  const signOut = useCallback(async () => {
    try {
      await authService.signOut();
    } catch {
      // The cookie is cleared by the response either way; a network failure here must
      // not strand someone on a signed-in shell.
    }
    try {
      localStorage.removeItem('currentUserId');
    } catch {
      // Private-mode storage. The hard navigation below discards the state regardless.
    }
    setAccount(null);
    // A full navigation rather than router.replace: it tears down every provider's
    // cached profile, progress and watchlist state in one step.
    window.location.replace('/signin');
  }, []);

  const value = { account, instance, isLoading, error, refresh: load, signOut };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};
