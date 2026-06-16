'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CatalogItem, GENRE_OPTIONS, SORT_OPTIONS, YEAR_OPTIONS } from '@/types';
import { tvService } from '@/services/tv';
import ShowGrid from '@/components/tv/ShowGrid';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { motion } from 'framer-motion';
import SectionHeader from '@/components/ui/SectionHeader';
import { fadeIn, slideUp } from '@/components/ui/Motion';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import { FunnelIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

type TvApi = 'popular' | 'on_the_air' | 'airing_today';

const API_OPTIONS: { value: TvApi; label: string }[] = [
  { value: 'popular', label: 'Popular' },
  { value: 'on_the_air', label: 'On The Air' },
  { value: 'airing_today', label: 'Airing Today' },
];

export default function TvBrowseContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialApi = (searchParams.get('api') || 'popular') as TvApi;
  const initialGenre = Number(searchParams.get('genre') || '0');
  const initialYear = Number(searchParams.get('year') || '0');
  const initialSort = searchParams.get('sort') || '';

  const [showFilters, setShowFilters] = useState(false);
  const [shows, setShows] = useState<CatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [hasMorePages, setHasMorePages] = useState(false);

  const [api, setApi] = useState<TvApi>(initialApi);
  const [genre, setGenre] = useState<number>(initialGenre);
  const [year, setYear] = useState<number>(initialYear);
  const [sort, setSort] = useState<string>(initialSort);

  const genreSelectOptions = GENRE_OPTIONS.map(g => ({ value: String(g.value), label: g.label }));
  const sortSelectOptions = [
    { value: '', label: 'Default' },
    ...SORT_OPTIONS.map(s => ({ value: s.value, label: s.label })),
  ];
  const yearSelectOptions = YEAR_OPTIONS.map(y => ({
    value: String(y),
    label: y === 0 ? 'All Years' : String(y),
  }));

  const fetchShows = useCallback(async (
    apiMode: TvApi,
    genreId: number,
    yearVal: number,
    sortVal: string,
    page: number,
    resetList: boolean,
  ) => {
    try {
      setIsLoading(true);
      setError(null);

      const data = await tvService.browse({
        api: apiMode,
        sort: sortVal || undefined,
        genre: genreId || undefined,
        year: yearVal || undefined,
        page,
      });

      if (resetList) {
        const queryParams = new URLSearchParams();
        if (apiMode !== 'popular') queryParams.set('api', apiMode);
        if (genreId) queryParams.set('genre', String(genreId));
        if (yearVal) queryParams.set('year', String(yearVal));
        if (sortVal) queryParams.set('sort', sortVal);
        router.push(`/tv?${queryParams.toString()}`);
        setShows(data.results);
        setCurrentPage(1);
      } else {
        // Dedupe by tmdb_id: guards against React StrictMode double-mount and
        // against the TMDB popularity lists returning the same show across pages.
        setShows(prev => {
          const seen = new Set(prev.map(s => s.tmdb_id));
          return [...prev, ...data.results.filter(s => !seen.has(s.tmdb_id))];
        });
      }

      setHasMorePages(page < data.total_pages);
    } catch (err) {
      console.error('Error fetching TV shows:', err);
      setError('Failed to load TV shows. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  const handleResetFilters = () => {
    setGenre(0);
    setYear(0);
    setSort('');
    setApi('popular');
    fetchShows('popular', 0, 0, '', 1, true);
  };

  const handleLoadMore = useCallback(() => {
    if (isLoading || !hasMorePages) return;
    const nextPage = currentPage + 1;
    setCurrentPage(nextPage);
    fetchShows(api, genre, year, sort, nextPage, false);
  }, [currentPage, isLoading, hasMorePages, fetchShows, api, genre, year, sort]);

  const handleApplyFilters = () => {
    fetchShows(api, genre, year, sort, 1, true);
  };

  useEffect(() => {
    fetchShows(initialApi, initialGenre, initialYear, initialSort, 1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <motion.h1
            className="text-2xl md:text-3xl font-bold"
            variants={slideUp}
            initial="hidden"
            animate="visible"
          >
            Browse TV Shows
          </motion.h1>
          <motion.p
            className="text-gray-400 mt-1"
            variants={fadeIn}
            initial="hidden"
            animate="visible"
          >
            Explore popular series, shows airing now, and more.
          </motion.p>
        </div>
      </div>

      {/* Category + Filters */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Browse TV Shows</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Category toggle */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Category</label>
              <div className="flex flex-wrap gap-2">
                {API_OPTIONS.map(opt => (
                  <Button
                    key={opt.value}
                    type="button"
                    variant={api === opt.value ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setApi(opt.value);
                      fetchShows(opt.value, genre, year, sort, 1, true);
                    }}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Filter toggle */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={showFilters ? 'primary' : 'outline'}
                leftIcon={<FunnelIcon className="h-5 w-5" />}
                onClick={() => setShowFilters(prev => !prev)}
                className="whitespace-nowrap"
              >
                Filters
              </Button>
            </div>

            {showFilters && (
              <div className="bg-gray-800/50 p-4 rounded-md animate-fade-in space-y-4">
                <div className="flex justify-between items-center">
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

                <Select
                  label="Year"
                  options={yearSelectOptions}
                  value={String(year)}
                  onChange={(e) => setYear(Number(e.target.value))}
                />

                <Button
                  type="button"
                  variant="primary"
                  onClick={handleApplyFilters}
                  disabled={isLoading}
                >
                  Apply Filters
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <div className="space-y-4">
        <SectionHeader
          title="Results"
          subtitle={shows.length > 0 ? `(${shows.length} shows found)` : undefined}
          right={(
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<ArrowPathIcon className="h-4 w-4" />}
              onClick={handleApplyFilters}
              disabled={isLoading}
            >
              Refresh
            </Button>
          )}
        />

        {error ? (
          <div className="text-center py-8 bg-gray-800/50 rounded-lg">
            <p className="text-red-500 mb-4">{error}</p>
            <Button onClick={handleApplyFilters}>Try Again</Button>
          </div>
        ) : (
          <ShowGrid
            shows={shows}
            isLoading={isLoading}
            hasMorePages={hasMorePages}
            onLoadMore={handleLoadMore}
          />
        )}
      </div>
    </div>
  );
}
