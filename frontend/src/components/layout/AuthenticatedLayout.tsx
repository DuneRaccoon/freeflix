'use client';
import React from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@/context/UserContext';
import TopNav from '@/components/shell/TopNav';
import BottomTabBar from '@/components/shell/BottomTabBar';
import ProfileGate from '@/components/shell/ProfileGate';
import CinematicAtmosphere from '@/components/fx/CinematicAtmosphere';

interface AuthenticatedLayoutProps { children: React.ReactNode; }

const AuthenticatedLayout: React.FC<AuthenticatedLayoutProps> = ({ children }) => {
  const { currentUser, isLoading } = useUser();
  const pathname = usePathname();
  const isStreaming = pathname?.startsWith('/streaming');

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-hairline border-t-gold" />
      </div>
    );
  }

  if (!currentUser) return <ProfileGate />;

  // Player route: full-bleed, no chrome.
  if (isStreaming) {
    return <main className="h-screen w-screen bg-ink">{children}</main>;
  }

  return (
    <>
      <CinematicAtmosphere />
      <TopNav />
      <main className="relative z-[2] min-h-screen pb-16 md:pb-0">{children}</main>
      <BottomTabBar />
    </>
  );
};

export default AuthenticatedLayout;
