'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CatalogItem, GENRE_OPTIONS, SORT_OPTIONS, YEAR_OPTIONS } from '@/types';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import MovieGrid from '@/components/movies/MovieGrid';
import ShowCard from '@/components/tv/ShowCard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { motion } from 'framer-motion';
import SectionHeader from '@/components/ui/SectionHeader';
import { fadeIn, slideUp, staggerContainer } from '@/components/ui/Motion';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import {
  MagnifyingGlassIcon,
  XMarkIcon,
  FunnelIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';

export default function SearchPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Get initial search parameters from URL
  const initialKeyword = searchParams.get('keyword') || '';
  const initialGenre = Number(searchParams.get('genre') || '0');
  const initialYear = Number(searchParams.get('year') || '0');
  const initialSort = searchParams.get('sort') || '';
  const initialApi = (searchParams.get('api') || 'popular') as 'popular' | 'top_rated';

  const [searchTerm, setSearchTerm] = useState(initialKeyword);
  const [showFilters, setShowFilters] = useState(false);
  const [movies, setMovies] = useState<CatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'movie' | 'tv'>('movie');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMorePages, setHasMorePages] = useState(false);

  // Filter states
  const [api, setApi] = useState<'popular' | 'top_rated'>(initialApi);
  const [genre, setGenre] = useState<number>(initialGenre);
  const [year, setYear] = useState<number>(initialYear);
  const [sort, setSort] = useState<string>(initialSort);

  // Genre options formatted for Select component (string values)
  const genreSelectOptions = GENRE_OPTIONS.map(g => ({ value: String(g.value), label: g.label }));

  // Sort options formatted for Select component
  const sortSelectOptions = [
    { value: '', label: 'Default' },
    ...SORT_OPTIONS.map(s => ({ value: s.value, label: s.label }))
  ];

  // Year options formatted for Select component
  const yearSelectOptions = YEAR_OPTIONS.map(y => ({
    value: String(y),
    label: y === 0 ? 'All Years' : String(y)
  }));

  // Api toggle options
  const apiOptions = [
    { value: 'popular', label: 'Popular' },
    { value: 'top_rated', label: 'Top Rated' },
  ];

  // Core fetch function
  const fetchMovies = useCallback(async (
    keyword: string,
    apiMode: 'popular' | 'top_rated',
    genreId: number,
    yearVal: number,
    sortVal: string,
    page: number,
    resetList: boolean,
    mediaMode: 'movie' | 'tv' = 'movie'
  ) => {
    try {
      setIsLoading(true);
      setError(null);

      let results: CatalogItem[] = [];
      let totalPages = 1;

      if (keyword.trim()) {
        // Search mode
        if (mediaMode === 'tv') {
          const data = await tvService.search(keyword.trim(), page);
          results = data.results;
          totalPages = data.total_pages;
        } else {
          const data = await moviesService.search(keyword.trim(), page);
          results = data.results;
          totalPages = data.total_pages;
        }
      } else {
        // Browse mode (movies only; TV browse uses tvService.browse but filters still apply)
        if (mediaMode === 'tv') {
          const data = await tvService.browse({
            sort: sortVal || undefined,
            genre: genreId || undefined,
            year: yearVal || undefined,
            page,
          });
          results = data.results;
          totalPages = data.total_pages;
        } else {
          const data = await moviesService.browse({
            api: apiMode,
            sort: sortVal || undefined,
            genre: genreId || undefined,
            year: yearVal || undefined,
            page,
          });
          results = data.results;
          totalPages = data.total_pages;
        }
      }

      // Update URL
      if (resetList) {
        const queryParams = new URLSearchParams();
        if (keyword) queryParams.set('keyword', keyword);
        if (genreId) queryParams.set('genre', String(genreId));
        if (yearVal) queryParams.set('year', String(yearVal));
        if (sortVal) queryParams.set('sort', sortVal);
        if (apiMode !== 'popular') queryParams.set('api', apiMode);
        router.push(`/search?${queryParams.toString()}`);
      }

      if (resetList) {
        setMovies(results);
        setCurrentPage(1);
      } else {
        setMovies(prev => [...prev, ...results]);
      }

      setHasMorePages(page < totalPages);
    } catch (err) {
      console.error('Error searching movies:', err);
      setError('Failed to search movies. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  // Handle search form submission
  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    fetchMovies(searchTerm, api, genre, year, sort, 1, true, mode);
  };

  // Handle filter reset
  const handleResetFilters = () => {
    setGenre(0);
    setYear(0);
    setSort('');
    setApi('popular');
    fetchMovies(searchTerm, 'popular', 0, 0, '', 1, true, mode);
  };

  // Handle mode toggle — reset results and re-run current query
  const handleModeChange = (newMode: 'movie' | 'tv') => {
    setMode(newMode);
    setMovies([]);
    setCurrentPage(1);
    fetchMovies(searchTerm, api, genre, year, sort, 1, true, newMode);
  };

  // Handle loading more movies
  const handleLoadMore = useCallback(() => {
    if (isLoading || !hasMorePages) return;
    const nextPage = currentPage + 1;
    setCurrentPage(nextPage);
    fetchMovies(searchTerm, api, genre, year, sort, nextPage, false, mode);
  }, [currentPage, isLoading, hasMorePages, fetchMovies, searchTerm, api, genre, year, sort, mode]);

  // Toggle filters visibility
  const toggleFilters = () => {
    setShowFilters(!showFilters);
  };

  // Initial search on mount
  useEffect(() => {
    fetchMovies(initialKeyword, initialApi, initialGenre, initialYear, initialSort, 1, false, 'movie');
  }, []);

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="relative overflow-hidden rounded-xl theater-shadow bg-card">
        <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="absolute -top-20 -left-20 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -right-10 w-96 h-96 bg-secondary/10 rounded-full blur-3xl" />
        </motion.div>
        <div className="relative p-6 md:p-8">
          <motion.h1 className="text-2xl md:text-3xl font-bold" variants={slideUp} initial="hidden" animate="visible">Find your next favorite</motion.h1>
          <motion.p className="text-gray-400 mt-1" variants={fadeIn} initial="hidden" animate="visible">Filter by genre, year, and sort order with live results.</motion.p>
        </div>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>{mode === 'tv' ? 'Search TV Shows' : 'Search Movies'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="space-y-4">
            {/* Movies / TV toggle */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === 'movie' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => handleModeChange('movie')}
              >
                Movies
              </Button>
              <Button
                type="button"
                variant={mode === 'tv' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => handleModeChange('tv')}
              >
                TV Shows
              </Button>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-grow">
                <Input
                  type="text"
                  placeholder={mode === 'tv' ? 'Search for TV shows...' : 'Search for movies...'}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={showFilters ? 'primary' : 'outline'}
                  leftIcon={<FunnelIcon className="h-5 w-5" />}
                  onClick={toggleFilters}
                  className="whitespace-nowrap"
                >
                  Filters
                </Button>

                <Button
                  type="submit"
                  variant="primary"
                  isLoading={isLoading && currentPage === 1}
                >
                  Search
                </Button>
              </div>
            </div>

            {showFilters && (
              <div className="bg-gray-800/50 p-4 rounded-md animate-fade-in">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium">Filters</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleResetFilters}
                  >
                    Reset Filters
                  </Button>
                </div>

                {/* API toggle (Popular / Top Rated) */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-1">Browse Mode</label>
                  <div className="flex gap-2">
                    {apiOptions.map(opt => (
                      <Button
                        key={opt.value}
                        type="button"
                        variant={api === opt.value ? 'primary' : 'outline'}
                        size="sm"
                        onClick={() => setApi(opt.value as 'popular' | 'top_rated')}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select
                    label="Genre"
                    options={genreSelectOptions}
                    value={String(genre)}
                    onChange={(e) => setGenre(Number(e.target.value))}
                  />

                  <Select
                    label="Sort By"
                    options={sortSelectOptions}
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  />
                </div>

                <div className="mt-4">
                  <Select
                    label="Year"
                    options={yearSelectOptions}
                    value={String(year)}
                    onChange={(e) => setYear(Number(e.target.value))}
                  />
                </div>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <SectionHeader
          title="Results"
          subtitle={movies.length > 0 ? `(${movies.length} ${mode === 'tv' ? 'shows' : 'movies'} found)` : undefined}
          right={(
            <Button size="sm" variant="ghost" leftIcon={<ArrowPathIcon className="h-4 w-4" />} onClick={() => handleSearch()} disabled={isLoading}>
              Refresh
            </Button>
          )}
        />

        {error ? (
          <div className="text-center py-8 bg-gray-800/50 rounded-lg">
            <p className="text-red-500 mb-4">{error}</p>
            <Button onClick={() => handleSearch()}>
              Try Again
            </Button>
          </div>
        ) : mode === 'tv' ? (
          <>
            {isLoading && movies.length === 0 ? (
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
            ) : movies.length === 0 ? (
              <div className="text-center py-12">
                <h3 className="text-xl font-semibold text-gray-300">No TV shows found</h3>
                <p className="text-gray-400 mt-2">Try adjusting your search criteria</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                  {movies.map((show) => (
                    <ShowCard key={show.tmdb_id.toString()} show={show} />
                  ))}
                </div>
                {(isLoading && movies.length > 0) && (
                  <div className="py-6 flex justify-center">
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500"></div>
                      <span className="text-gray-400">Loading more shows...</span>
                    </div>
                  </div>
                )}
                {hasMorePages && !isLoading && (
                  <div className="flex justify-center">
                    <Button variant="outline" onClick={handleLoadMore}>
                      Load More
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <MovieGrid
            movies={movies}
            isLoading={isLoading}
            hasMorePages={hasMorePages}
            onLoadMore={handleLoadMore}
          />
        )}
      </div>
    </div>
  );
}
