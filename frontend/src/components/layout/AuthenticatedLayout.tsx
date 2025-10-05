'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@/context/UserContext';
import UserSelectScreen from '@/components/users/UserSelectScreen';
import Navigation from '@/components/ui/Navigation';

interface AuthenticatedLayoutProps {
  children: React.ReactNode;
}

const AuthenticatedLayout: React.FC<AuthenticatedLayoutProps> = ({ children }) => {
  const { currentUser, isLoading } = useUser();
  const pathname = usePathname();
  const isStreamingRoute = pathname?.startsWith('/streaming');
  
  // If loading, show loading indicator
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent"></div>
        <p className="mt-4 text-lg">Loading...</p>
      </div>
    );
  }
  
  // If no user is selected, show the user selection screen
  if (!currentUser) {
    return <UserSelectScreen />;
  }
  
  // User is authenticated, show the regular layout with navigation
  if (isStreamingRoute) {
    return (
      <main className="w-screen h-screen bg-black">
        {children}
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background bg-app-gradient">
      <Navigation />
      <main className="container mx-auto py-6 px-4 relative">
        {/* Subtle film grain overlay */}
        <div className="film-grain" />
        {children}
      </main>
    </div>
  );
};

export default AuthenticatedLayout;