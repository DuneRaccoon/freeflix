import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Movie } from '@/types';
import MovieCard from './MovieCard';

interface MovieGridProps {
  movies: Movie[];
  isLoading?: boolean;
  hasMorePages?: boolean;
  onDownload?: (movieId: string, quality: string) => void;
  onLoadMore?: () => void;
}

const MovieGrid: React.FC<MovieGridProps> = ({ 
  movies, 
  isLoading = false,
  hasMorePages = false,
  onDownload,
  onLoadMore
}) => {
  // Ref for the sentinel element that detects when we reach the bottom
  const observerRef = useRef<HTMLDivElement>(null);
  
  // Track if we're loading more content
  const [loadingMore, setLoadingMore] = useState(false);

  // Callback for when the sentinel element becomes visible
  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const [entry] = entries;
    if (entry.isIntersecting && hasMorePages && !isLoading && !loadingMore) {
      setLoadingMore(true);
      if (onLoadMore) {
        onLoadMore();
      }
    }
  }, [hasMorePages, isLoading, loadingMore, onLoadMore]);

  // Set up the intersection observer
  useEffect(() => {
    const options = {
      root: null, // viewport
      rootMargin: '0px',
      threshold: 0.5
    };
    
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

  // Reset loading more state when isLoading changes to false
  useEffect(() => {
    if (!isLoading) {
      setLoadingMore(false);
    }
  }, [isLoading]);

  // Loading skeleton for initial load
  if (isLoading && movies.length === 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index} className="">
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

  // No movies found
  if (movies.length === 0) {
    return (
      <div className="text-center py-12">
        <h3 className="text-xl font-semibold text-gray-300">No movies found</h3>
        <p className="text-gray-400 mt-2">Try adjusting your search criteria</p>
      </div>
    );
  }

  // Render movie grid with infinite scroll
  return (
    <div className="space-y-6">
      {/* Movie grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {movies.map((movie) => (
          <MovieCard 
            key={movie.link} 
            movie={movie} 
            onDownload={onDownload}
          />
        ))}
      </div>
      
      {/* Loading indicator for more content */}
      {(loadingMore || (isLoading && movies.length > 0)) && (
        <div className="py-6 flex justify-center">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500"></div>
            <span className="text-gray-400">Loading more movies...</span>
          </div>
        </div>
      )}
      
      {/* Sentinel element for intersection observer */}
      {hasMorePages && !isLoading && (
        <div ref={observerRef} className="h-4"></div>
      )}
    </div>
  );
};

export default MovieGrid;