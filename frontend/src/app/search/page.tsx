'use client';

import React, { Suspense } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

// Create a separate client component for the actual search functionality
const SearchPageContent = React.lazy(() => import('@/components/search/SearchPageContent'));

// Loading fallback component
const SearchPageSkeleton = () => (
  <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>Search Movies</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="animate-pulse">
          <div className="h-10 bg-gray-700 rounded-md mb-4"></div>
          <div className="h-32 bg-gray-700/50 rounded-md"></div>
        </div>
      </CardContent>
    </Card>
    
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="h-6 bg-gray-700 rounded w-32"></div>
        <div className="h-8 bg-gray-700 rounded w-20"></div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index} className="animate-pulse">
            <div className="bg-gray-700 rounded-lg h-64"></div>
            <div className="mt-2 bg-gray-700 h-6 rounded w-3/4"></div>
            <div className="mt-1 bg-gray-700 h-4 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchPageSkeleton />}>
      <SearchPageContent />
    </Suspense>
  );
}