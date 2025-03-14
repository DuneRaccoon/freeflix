'use client';

import React, { Suspense } from 'react';
import LoadingScreen from '@/components/ui/LoadingScreen';

// Create a separate client component for the actual content
const MyMoviesPageContent = React.lazy(() => import('@/components/my-movies/MyMoviesPageContent'));

// Loading fallback component
const MyMoviesPageSkeleton = () => (
  <div className="space-y-8">
    <div className="flex justify-between items-center">
      <div className="h-8 bg-gray-700 rounded w-40"></div>
      <div className="h-8 bg-gray-700 rounded w-40"></div>
    </div>
    
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="animate-pulse">
          <div className="bg-gray-700 rounded-lg h-64"></div>
          <div className="h-12 bg-gray-800 rounded-b-lg flex items-center justify-between px-3">
            <div className="h-8 w-20 bg-gray-700 rounded"></div>
            <div className="h-8 w-20 bg-gray-700 rounded"></div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default function MyMoviesPage() {
  return (
    <Suspense fallback={<MyMoviesPageSkeleton />}>
      <MyMoviesPageContent />
    </Suspense>
  );
}