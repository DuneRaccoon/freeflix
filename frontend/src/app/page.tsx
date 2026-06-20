'use client';

import React, { Suspense } from 'react';
import { useUser } from '@/context/UserContext';
import LoadingScreen from '@/components/ui/LoadingScreen';
import HomeBrowse from '@/components/home/HomeBrowse';

// Inline skeleton that matches the FRÈ browse aesthetic while HomeBrowse lazy-loads.
function HomeBrowseSkeleton() {
  return (
    <div
      data-testid="home-browse-skeleton"
      className="relative bg-ink text-text animate-pulse"
    >
      {/* Hero placeholder */}
      <div
        className="w-full bg-surface"
        style={{ height: 'clamp(620px,85vh,1040px)' }}
      />
      {/* Content area placeholder */}
      <div className="px-6 space-y-10 py-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="h-7 bg-surface-2 rounded w-48" />
            <div className="flex gap-4">
              {Array.from({ length: 5 }).map((_, j) => (
                <div
                  key={j}
                  className="flex-none bg-surface-2 rounded-card"
                  style={{ width: 'clamp(184px,15.5vw,272px)', aspectRatio: '2/3' }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  const { isLoading } = useUser();

  if (isLoading) {
    return <LoadingScreen message="Loading..." />;
  }

  return (
    <Suspense fallback={<HomeBrowseSkeleton />}>
      <HomeBrowse />
    </Suspense>
  );
}
