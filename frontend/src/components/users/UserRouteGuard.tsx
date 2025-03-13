'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@/context/UserContext';
import UserSelectScreen from '@/components/users/UserSelectScreen';

interface UserRouteGuardProps {
  children: (isAuthenticated: boolean) => React.ReactNode;
}

const UserRouteGuard: React.FC<UserRouteGuardProps> = ({ children }) => {
  const { currentUser, isLoading } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Once user state is loaded, we can mark as initialized
    if (!isLoading) {
      setIsInitialized(true);
    }
  }, [isLoading]);

  // Don't render anything while checking the initial user state
  if (!isInitialized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent"></div>
        <p className="mt-4 text-lg">Loading...</p>
      </div>
    );
  }

  // If no user is selected, show the user select screen
  if (!currentUser) {
    return <UserSelectScreen />;
  }

  // If a user is selected, render the children with the authenticated flag
  return <>{children(true)}</>;
};

export default UserRouteGuard;