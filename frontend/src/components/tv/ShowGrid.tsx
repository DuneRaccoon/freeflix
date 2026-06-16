'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CatalogItem } from '@/types';
import ShowCard from './ShowCard';

interface ShowGridProps {
  shows: CatalogItem[];
  isLoading?: boolean;
  hasMorePages?: boolean;
  onLoadMore?: () => void;
}

const ShowGrid: React.FC<ShowGridProps> = ({
  shows,
  isLoading = false,
  hasMorePages = false,
  onLoadMore,
}) => {
  const observerRef = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const [entry] = entries;
    if (entry.isIntersecting && hasMorePages && !isLoading && !loadingMore) {
      setLoadingMore(true);
      if (onLoadMore) {
        onLoadMore();
      }
    }
  }, [hasMorePages, isLoading, loadingMore, onLoadMore]);

  useEffect(() => {
    const options = { root: null, rootMargin: '0px', threshold: 0.5 };
    const observer = new IntersectionObserver(handleObserver, options);
    if (observerRef.current) {
      observer.observe(observerRef.current);
    }
    return () => {
      if (observerRef.current) {
        observer.unobserve(observerRef.current);
      }
    };
  }, [handleObserver]);

  useEffect(() => {
    if (!isLoading) {
      setLoadingMore(false);
    }
  }, [isLoading]);

  // Loading skeleton for initial load
  if (isLoading && shows.length === 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index}>
            <div className="relative rounded-lg h-64 overflow-hidden bg-card">
              <div className="absolute inset-0 shimmer" />
            </div>
            <div className="mt-2 h-6 rounded bg-card overflow-hidden relative">
              <div className="absolute inset-0 shimmer" />
            </div>
            <div className="mt-1 h-4 rounded bg-card overflow-hidden relative w-1/2">
              <div className="absolute inset-0 shimmer" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // No shows found
  if (shows.length === 0) {
    return (
      <div className="text-center py-12">
        <h3 className="text-xl font-semibold text-gray-300">No shows found</h3>
        <p className="text-gray-400 mt-2">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {shows.map((show) => (
          <ShowCard
            key={show.tmdb_id.toString()}
            show={show}
          />
        ))}
      </div>

      {(loadingMore || (isLoading && shows.length > 0)) && (
        <div className="py-6 flex justify-center">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500"></div>
            <span className="text-gray-400">Loading more shows...</span>
          </div>
        </div>
      )}

      {hasMorePages && !isLoading && (
        <div ref={observerRef} className="h-4"></div>
      )}
    </div>
  );
};

export default ShowGrid;
