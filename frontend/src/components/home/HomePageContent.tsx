'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CatalogItem } from '@/types';
import { moviesService } from '@/services/movies';
import { Card, CardContent } from '@/components/ui/Card';
import SectionHeader from '@/components/ui/SectionHeader';
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

  const [featuredHighlights, setFeaturedHighlights] = useState<CatalogItem[]>([]);
  const [featuredMovies, setFeaturedMovies] = useState<CatalogItem[]>([]);
  const [latestMovies, setLatestMovies] = useState<CatalogItem[]>([]);
  const [topRatedMovies, setTopRatedMovies] = useState<CatalogItem[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial movies
  useEffect(() => {
    const fetchMovies = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch in parallel using the new catalog API
        const [featuredPage, latestPage, topRatedPage, highlightsPage] = await Promise.all([
          moviesService.browse({ api: 'popular' }),
          moviesService.browse({ api: 'popular', sort: 'primary_release_date.desc' }),
          moviesService.browse({ api: 'top_rated' }),
          moviesService.browse({ api: 'popular' }),
        ]);

        setFeaturedMovies(featuredPage.results);
        setLatestMovies(latestPage.results);
        setTopRatedMovies(topRatedPage.results);
        setFeaturedHighlights(highlightsPage.results.slice(0, 5));
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

    const fetchMovies = async () => {
      try {
        const [featuredPage, latestPage, topRatedPage] = await Promise.all([
          moviesService.browse({ api: 'popular' }),
          moviesService.browse({ api: 'popular', sort: 'primary_release_date.desc' }),
          moviesService.browse({ api: 'top_rated' }),
        ]);

        setFeaturedMovies(featuredPage.results);
        setLatestMovies(latestPage.results);
        setTopRatedMovies(topRatedPage.results);
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
      <div className="space-y-3">
        <SectionHeader title="Featured Movies" />
        <div className="h-px bg-gradient-to-r from-white/10 via-white/5 to-transparent" />
        <MovieCarousel
          title="Featured Movies"
          movies={featuredMovies}
          isLoading={isLoading}
          viewAllLink="/search"
          viewAllLabel="View All Featured Movies"
        />
      </div>

      {/* Latest Movies Section */}
      <div className="space-y-3">
        <SectionHeader title="Latest Movies" />
        <div className="h-px bg-gradient-to-r from-white/10 via-white/5 to-transparent" />
        <MovieCarousel
          title="Latest Movies"
          movies={latestMovies}
          isLoading={isLoading}
          viewAllLink="/search"
          viewAllLabel="View All Latest Movies"
        />
      </div>

      {/* Top Rated Movies Section */}
      <div className="space-y-3">
        <SectionHeader title="Top Rated Movies" />
        <div className="h-px bg-gradient-to-r from-white/10 via-white/5 to-transparent" />
        <MovieCarousel
          title="Top Rated Movies"
          movies={topRatedMovies}
          isLoading={isLoading}
          viewAllLink="/search"
          viewAllLabel="View All Top Rated Movies"
        />
      </div>

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
