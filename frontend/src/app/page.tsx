'use client';

import React, { Suspense } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

// Create a separate client component for the actual content
const HomePageContent = React.lazy(() => import('@/components/home/HomePageContent'));

// Loading fallback component
const HomePageSkeleton = () => (
  <div className="space-y-8">
    {/* Hero Section Skeleton */}
    <div className="bg-gradient-to-r from-primary-900 to-secondary-900 rounded-xl p-6 md:p-10 shadow-lg">
      <div className="max-w-3xl">
        <div className="h-10 bg-gray-300/20 rounded w-3/4 mb-4"></div>
        <div className="h-6 bg-gray-300/20 rounded w-full mb-2"></div>
        <div className="h-6 bg-gray-300/20 rounded w-2/3 mb-6"></div>
        <div className="flex flex-wrap gap-4">
          <div className="h-12 bg-gray-300/20 rounded w-32"></div>
          <div className="h-12 bg-gray-300/20 rounded w-40"></div>
        </div>
      </div>
    </div>

    {/* Quick Stats Section Skeleton */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="p-4 flex items-center">
            <div className="bg-gray-700 p-3 rounded-full mr-4 h-12 w-12"></div>
            <div>
              <div className="h-6 bg-gray-700 rounded w-24 mb-2"></div>
              <div className="h-4 bg-gray-700 rounded w-32"></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>

    {/* Movies Sections Skeleton */}
    {[1, 2].map((section) => (
      <Card key={section}>
        <CardHeader>
          <div className="h-6 bg-gray-700 rounded w-40"></div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="animate-pulse">
                <div className="bg-gray-700 rounded-lg h-64"></div>
                <div className="mt-2 bg-gray-700 h-6 rounded w-3/4"></div>
                <div className="mt-1 bg-gray-700 h-4 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
);

export default function HomePage() {
  return (
    <Suspense fallback={<HomePageSkeleton />}>
      <HomePageContent />
    </Suspense>
  );
}