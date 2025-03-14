'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Movie } from '@/types';
import { moviesService } from '@/services/movies';
import MovieGrid from '@/components/movies/MovieGrid';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import RecentlyWatchedMovies from '@/components/home/RecentlyWatchedMovies';
import { useUser } from '@/context/UserContext';
import { useProgress } from '@/context/ProgressContext';
import ContinueWatchingSection from '@/components/home/ContinueWatchingSection';


export default function HomePageContent() {
  const { currentUser } = useUser();
  const { progressData } = useProgress();
  const [featuredMovies, setFeaturedMovies] = useState<Movie[]>([]);
  const [latestMovies, setLatestMovies] = useState<Movie[]>([]);
  const [topRatedMovies, setTopRatedMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination states for featured movies
  const [featuredMoviesPage, setFeaturedMoviesPage] = useState(1);
  const [hasMoreFeaturedMovies, setHasMoreFeaturedMovies] = useState(true);
  const [loadingMoreFeatured, setLoadingMoreFeatured] = useState(false);
  
  // Pagination states for latest movies
  const [latestMoviesPage, setLatestMoviesPage] = useState(1);
  const [hasMoreLatestMovies, setHasMoreLatestMovies] = useState(true);
  const [loadingMoreLatest, setLoadingMoreLatest] = useState(false);
  
  // Pagination states for top rated movies
  const [topRatedMoviesPage, setTopRatedMoviesPage] = useState(1);
  const [hasMoreTopRatedMovies, setHasMoreTopRatedMovies] = useState(true);
  const [loadingMoreTopRated, setLoadingMoreTopRated] = useState(false);

  // Fetch initial movies
  useEffect(() => {
    const fetchMovies = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Fetch latest and top-rated movies in parallel
        const [featured, latest, topRated] = await Promise.all([
          moviesService.getFeaturedMovies(10),
          moviesService.getLatestMovies(10),
          moviesService.getTopRatedMovies(10)
        ]);
        
        setFeaturedMovies(featured);
        setLatestMovies(latest);
        setTopRatedMovies(topRated);
        
        // Check if there might be more movies
        setHasMoreFeaturedMovies(featured.length === 10);
        setHasMoreLatestMovies(latest.length === 10);
        setHasMoreTopRatedMovies(topRated.length === 10);
      } catch (err) {
        console.error('Error fetching movies:', err);
        setError('Failed to fetch movies. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchMovies();
  }, []);

  // Load more latest movies
  const loadMoreLatestMovies = useCallback(async () => {
    if (loadingMoreLatest || !hasMoreLatestMovies) return;
    
    try {
      setLoadingMoreLatest(true);
      
      // Increment the page
      const nextPage = latestMoviesPage + 1;
      setLatestMoviesPage(nextPage);
      
      // Fetch more movies
      const moreMovies = await moviesService.getLatestMovies(10, undefined, nextPage);
      
      // Append new movies
      setLatestMovies(prev => [...prev, ...moreMovies]);
      
      // Check if there are more movies to load
      setHasMoreLatestMovies(moreMovies.length === 10);
    } catch (err) {
      console.error('Error loading more latest movies:', err);
    } finally {
      setLoadingMoreLatest(false);
    }
  }, [latestMoviesPage, loadingMoreLatest, hasMoreLatestMovies]);

  // Load more top rated movies
  const loadMoreTopRatedMovies = useCallback(async () => {
    if (loadingMoreTopRated || !hasMoreTopRatedMovies) return;
    
    try {
      setLoadingMoreTopRated(true);
      
      // Increment the page
      const nextPage = topRatedMoviesPage + 1;
      setTopRatedMoviesPage(nextPage);
      
      // Fetch more movies
      const moreMovies = await moviesService.getTopRatedMovies(10, undefined, undefined, undefined, nextPage);
      
      // Append new movies
      setTopRatedMovies(prev => [...prev, ...moreMovies]);
      
      // Check if there are more movies to load
      setHasMoreTopRatedMovies(moreMovies.length === 10);
    } catch (err) {
      console.error('Error loading more top rated movies:', err);
    } finally {
      setLoadingMoreTopRated(false);
    }
  }, [topRatedMoviesPage, loadingMoreTopRated, hasMoreTopRatedMovies]);

  const handleRefresh = () => {
    setIsLoading(true);
    setFeaturedMovies([]);
    setLatestMovies([]);
    setTopRatedMovies([]);
    setFeaturedMoviesPage(1);
    setLatestMoviesPage(1);
    setTopRatedMoviesPage(1);
    
    const fetchMovies = async () => {
      try {
        const [featured, latest, topRated] = await Promise.all([
          moviesService.getFeaturedMovies(10),
          moviesService.getLatestMovies(10),
          moviesService.getTopRatedMovies(10)
        ]);
        
        setFeaturedMovies(featured);
        setLatestMovies(latest);
        setTopRatedMovies(topRated);
        setHasMoreFeaturedMovies(featured.length === 10);
        setHasMoreLatestMovies(latest.length === 10);
        setHasMoreTopRatedMovies(topRated.length === 10);
        setError(null);
      } catch (err) {
        console.error('Error refreshing movies:', err);
        setError('Failed to refresh movies. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchMovies();
  };

  console.log(progressData);

  const hasInProgressMovies = currentUser && Object.values(progressData).some(
    item => !item.completed && item.percentage > 0
  );

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-primary-900 to-secondary-900 rounded-xl p-6 md:p-10 shadow-lg">
        <div className="max-w-3xl">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Download YIFY Movies with Ease
          </h1>
          <p className="text-gray-100 text-lg mb-6">
            Browse, search, and download movies from YTS in a simple and intuitive interface.
            Schedule automatic downloads of your favorite genres.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/search">
              <Button 
                size="lg" 
                leftIcon={<MagnifyingGlassIcon className="w-5 h-5" />}
              >
                Search Movies
              </Button>
            </Link>
            <Link href="/schedules">
              <Button 
                size="lg" 
                variant="outline" 
                leftIcon={<ClockIcon className="w-5 h-5" />}
              >
                Schedule Downloads
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Quick Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center">
            <div className="bg-primary-900 p-3 rounded-full mr-4">
              <MagnifyingGlassIcon className="w-6 h-6 text-primary-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Explore</h3>
              <p className="text-muted-foreground">Browse thousands of movies</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4 flex items-center">
            <div className="bg-secondary-900 p-3 rounded-full mr-4">
              <ArrowDownTrayIcon className="w-6 h-6 text-secondary-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Download</h3>
              <p className="text-muted-foreground">High-quality torrents</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4 flex items-center">
            <div className="bg-muted p-3 rounded-full mr-4">
              <ClockIcon className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Automate</h3>
              <p className="text-muted-foreground">Schedule regular downloads</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Continue Watching Section - Only show if user is logged in */}
      {hasInProgressMovies && <ContinueWatchingSection />}

      {/* Recently Watched Section - Only show if user is logged in */}
      {currentUser && <RecentlyWatchedMovies />}

      {/* Featured Movies Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Featured Movies</CardTitle>
          <Button 
            size="sm" 
            variant="ghost" 
            leftIcon={<ArrowPathIcon className="w-4 h-4" />}
            onClick={handleRefresh}
            isLoading={isLoading}
          >
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-center py-8">
              <p className="text-red-500 mb-4">{error}</p>
              <Button onClick={handleRefresh}>Try Again</Button>
            </div>
          ) : (
            <MovieGrid 
              movies={featuredMovies} 
              isLoading={isLoading || loadingMoreFeatured}
              // hasMorePages={hasMoreLatestMovies}
              // onLoadMore={loadMoreLatestMovies}
            />
          )}
          <div className="mt-6 text-center">
            <Link href="/search?order_by=featured">
              <Button variant="outline">View All Featured Movies</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Latest Movies Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Latest Movies</CardTitle>
          <Button 
            size="sm" 
            variant="ghost" 
            leftIcon={<ArrowPathIcon className="w-4 h-4" />}
            onClick={handleRefresh}
            isLoading={isLoading}
          >
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-center py-8">
              <p className="text-red-500 mb-4">{error}</p>
              <Button onClick={handleRefresh}>Try Again</Button>
            </div>
          ) : (
            <MovieGrid 
              movies={latestMovies} 
              isLoading={isLoading || loadingMoreLatest}
              // hasMorePages={hasMoreLatestMovies}
              // onLoadMore={loadMoreLatestMovies}
            />
          )}
          <div className="mt-6 text-center">
            <Link href="/search">
              <Button variant="outline">View All Latest Movies</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Top Rated Movies Section */}
      <Card>
        <CardHeader>
          <CardTitle>Top Rated Movies</CardTitle>
        </CardHeader>
        <CardContent>
          <MovieGrid 
            movies={topRatedMovies} 
            isLoading={isLoading || loadingMoreTopRated}
            // hasMorePages={hasMoreTopRatedMovies}
            // onLoadMore={loadMoreTopRatedMovies}
          />
          <div className="mt-6 text-center">
            <Link href="/search?order_by=rating">
              <Button variant="outline">View All Top Rated Movies</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}