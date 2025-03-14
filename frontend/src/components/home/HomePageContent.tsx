'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Movie } from '@/types';
import { moviesService } from '@/services/movies';
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
import MovieCarousel from '@/components/movies/MovieCarousel';
import FeatureCarousel from '@/components/movies/FeatureCarousel';

// Import the custom Swiper styles
import '@/styles/swiper-custom.css';

export default function HomePageContent() {
  const { currentUser } = useUser();
  const { progressData } = useProgress();

  const [featuredHighlights, setFeaturedHighlights] = useState<Movie[]>([]);
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
        const [featured, latest, topRated, highlights] = await Promise.all([
          moviesService.getFeaturedMovies(15),
          moviesService.getLatestMovies(15),
          moviesService.getTopRatedMovies(15),
          moviesService.browseMovies({
            rating: '7',
            limit: 5,
            quality: '1080p',
            year: (new Date().getFullYear() - 1).toString(),
            order_by: 'featured'
          })
          // moviesService.getTopRatedMovies(5, '1080p', undefined, undefined, 1)
        ]);
        
        setFeaturedMovies(featured);
        setLatestMovies(latest);
        setTopRatedMovies(topRated);
        setFeaturedHighlights(highlights);
        
        // Check if there might be more movies
        setHasMoreFeaturedMovies(featured.length === 15);
        setHasMoreLatestMovies(latest.length === 15);
        setHasMoreTopRatedMovies(topRated.length === 15);
      } catch (err) {
        console.error('Error fetching movies:', err);
        setError('Failed to fetch movies. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchMovies();
  }, []);

  // Handle refreshing all content
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
          moviesService.getFeaturedMovies(15),
          moviesService.getLatestMovies(15),
          moviesService.getTopRatedMovies(15)
        ]);
        
        setFeaturedMovies(featured);
        setLatestMovies(latest);
        setTopRatedMovies(topRated);
        setHasMoreFeaturedMovies(featured.length === 15);
        setHasMoreLatestMovies(latest.length === 15);
        setHasMoreTopRatedMovies(topRated.length === 15);
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

  const hasInProgressMovies = currentUser && Object.values(progressData).some(
    item => !item.completed && item.percentage > 0
  );

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <FeatureCarousel 
        movies={featuredHighlights} 
        isLoading={isLoading}
      />

      {/* <div className="bg-gradient-to-r from-primary-900 to-secondary-900 rounded-xl p-6 md:p-10 shadow-lg">
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
      </div> */}

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

      {/* Error Message */}
      {error && (
        <div className="text-center py-8 bg-gray-800/50 rounded-lg">
          <p className="text-red-500 mb-4">{error}</p>
          <Button onClick={handleRefresh}>Try Again</Button>
        </div>
      )}

      {/* Featured Movies Section */}
      <Card>
        <CardContent className="p-4 pb-8">
          <MovieCarousel
            title="Featured Movies"
            movies={featuredMovies}
            isLoading={isLoading}
            viewAllLink="/search?order_by=featured"
            viewAllLabel="View All Featured Movies"
          />
        </CardContent>
      </Card>

      {/* Latest Movies Section */}
      <Card>
        <CardContent className="p-4 pb-8">
          <MovieCarousel
            title="Latest Movies"
            movies={latestMovies}
            isLoading={isLoading}
            viewAllLink="/search?order_by=latest"
            viewAllLabel="View All Latest Movies"
          />
        </CardContent>
      </Card>

      {/* Top Rated Movies Section */}
      <Card>
        <CardContent className="p-4 pb-8">
          <MovieCarousel
            title="Top Rated Movies"
            movies={topRatedMovies}
            isLoading={isLoading}
            viewAllLink="/search?order_by=rating"
            viewAllLabel="View All Top Rated Movies"
          />
        </CardContent>
      </Card>

      {/* Refresh Button for all content */}
      <div className="flex justify-center">
        <Button
          variant="outline"
          leftIcon={<ArrowPathIcon className="w-5 h-5" />}
          onClick={handleRefresh}
          isLoading={isLoading}
          className="mb-6"
        >
          Refresh All Content
        </Button>
      </div>
    </div>
  );
}