'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Movie, SearchParams, OrderByLiteral, GenreLiteral, QualityLiteral, YearLiteral, RatingLiteral } from '@/types';
import { moviesService } from '@/services/movies';
import MovieGrid from '@/components/movies/MovieGrid';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
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
  const initialQuality = (searchParams.get('quality') || 'all') as QualityLiteral;
  const initialGenre = (searchParams.get('genre') || 'all') as GenreLiteral;
  const initialRating = (searchParams.get('rating') || 'all') as RatingLiteral;
  const initialYear = searchParams.get('year') as YearLiteral || undefined;
  const initialOrderBy = (searchParams.get('order_by') || 'featured') as OrderByLiteral;
  
  const [searchTerm, setSearchTerm] = useState(initialKeyword);
  const [showFilters, setShowFilters] = useState(false);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMorePages, setHasMorePages] = useState(true);
  
  // Filter states
  const [quality, setQuality] = useState<QualityLiteral>(initialQuality);
  const [genre, setGenre] = useState<GenreLiteral>(initialGenre);
  const [minRating, setMinRating] = useState<RatingLiteral | string>(initialRating);
  const [year, setYear] = useState<YearLiteral | undefined>(initialYear);
  const [orderBy, setOrderBy] = useState<OrderByLiteral>(initialOrderBy);
  
  // Function to get current search parameters
  const getCurrentSearchParams = useCallback((): SearchParams => {
    return {
      keyword: searchTerm,
      quality,
      genre,
      rating: minRating,
      year,
      order_by: orderBy,
      page: currentPage
    };
  }, [searchTerm, quality, genre, minRating, year, orderBy, currentPage]);

  // Fetch movies based on search parameters
  const searchMovies = useCallback(async (params: SearchParams, resetList: boolean = true) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Update URL with search parameters (excluding page for cleaner URLs)
      const queryParams = new URLSearchParams();
      if (params.keyword) queryParams.set('keyword', params.keyword);
      if (params.quality !== 'all') queryParams.set('quality', params.quality!);
      if (params.genre !== 'all') queryParams.set('genre', params.genre!);
      if (params.rating !== 'all') queryParams.set('rating', params.rating!);
      if (params.year) queryParams.set('year', params.year);
      if (params.order_by !== 'featured') queryParams.set('order_by', params.order_by!);
      
      // Only update the URL on initial search or filter changes
      if (resetList) {
        router.push(`/search?${queryParams.toString()}`);
      }
      
      // Fetch movies
      const results = await moviesService.browseMovies(params);
      
      // Update movies list (either replace or append)
      if (resetList) {
        setMovies(results);
        setCurrentPage(1);
      } else {
        setMovies(prevMovies => [...prevMovies, ...results]);
      }
      
      // Check if there might be more pages
      setHasMorePages(results.length > 0);
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
    
    // Reset the movies list and start from page 1
    const params = getCurrentSearchParams();
    params.page = 1;
    searchMovies(params, true);
  };
  
  // Handle filter reset
  const handleResetFilters = () => {
    setQuality('all');
    setGenre('all');
    setMinRating('all');
    setYear(undefined);
    setOrderBy('featured');
    
    // Perform search with reset filters
    searchMovies({
      keyword: searchTerm,
      quality: 'all',
      genre: 'all',
      rating: 'all',
      year: undefined,
      order_by: 'featured',
      page: 1
    }, true);
  };
  
  // Handle loading more movies
  const handleLoadMore = useCallback(() => {
    if (isLoading || !hasMorePages) return;
    
    const nextPage = currentPage + 1;
    setCurrentPage(nextPage);
    
    const params = getCurrentSearchParams();
    params.page = nextPage;
    searchMovies(params, false);
  }, [currentPage, isLoading, hasMorePages, getCurrentSearchParams, searchMovies]);
  
  // Toggle filters visibility
  const toggleFilters = () => {
    setShowFilters(!showFilters);
  };
  
  // Initial search on mount
  useEffect(() => {
    const params: SearchParams = {
      keyword: initialKeyword,
      quality: initialQuality,
      genre: initialGenre,
      rating: initialRating,
      year: initialYear,
      order_by: initialOrderBy,
      page: 1
    };
    
    searchMovies(params, true);
  }, []);
  
  // Quality options
  const qualityOptions = [
    { value: 'all', label: 'All Qualities' },
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '2160p', label: '4K (2160p)' },
    { value: '3d', label: '3D' }
  ];
  
  // Genre options
  const genreOptions = [
    { value: 'all', label: 'All Genres' },
    { value: 'action', label: 'Action' },
    { value: 'adventure', label: 'Adventure' },
    { value: 'animation', label: 'Animation' },
    { value: 'biography', label: 'Biography' },
    { value: 'comedy', label: 'Comedy' },
    { value: 'crime', label: 'Crime' },
    { value: 'documentary', label: 'Documentary' },
    { value: 'drama', label: 'Drama' },
    { value: 'family', label: 'Family' },
    { value: 'fantasy', label: 'Fantasy' },
    { value: 'film-noir', label: 'Film-Noir' },
    { value: 'game-show', label: 'Game Show' },
    { value: 'history', label: 'History' },
    { value: 'horror', label: 'Horror' },
    { value: 'music', label: 'Music' },
    { value: 'musical', label: 'Musical' },
    { value: 'mystery', label: 'Mystery' },
    { value: 'news', label: 'News' },
    { value: 'reality-tv', label: 'Reality TV' },
    { value: 'romance', label: 'Romance' },
    { value: 'sci-fi', label: 'Sci-Fi' },
    { value: 'sport', label: 'Sport' },
    { value: 'talk-show', label: 'Talk Show' },
    { value: 'thriller', label: 'Thriller' },
    { value: 'war', label: 'War' },
    { value: 'western', label: 'Western' }
  ];
  
  // Rating options
  const ratingOptions = [
    { value: 'all', label: 'All Ratings' },
    { value: '9', label: '9+' },
    { value: '8', label: '8+' },
    { value: '7', label: '7+' },
    { value: '6', label: '6+' },
    { value: '5', label: '5+' },
    { value: '4', label: '4+' },
    { value: '3', label: '3+' },
    { value: '2', label: '2+' },
    { value: '1', label: '1+' }
  ];
  
  // Year options
  const yearOptions = [
    { value: 'all', label: 'All Years' },
    { value: '2024', label: '2024' },
    { value: '2023', label: '2023' },
    { value: '2022', label: '2022' },
    { value: '2021', label: '2021' },
    { value: '2020', label: '2020' },
    { value: '2019', label: '2019' },
    { value: '2018', label: '2018' },
    { value: '2017', label: '2017' },
    { value: '2016', label: '2016' },
    { value: '2015', label: '2015' },
    { value: '2014', label: '2014' },
    { value: '2013', label: '2013' },
    { value: '2012', label: '2012' },
    { value: '2011', label: '2011' },
    { value: '2010', label: '2010' },
    { value: '2000-2009', label: '2000-2009' },
    { value: '1990-1999', label: '1990-1999' },
    { value: '1980-1989', label: '1980-1989' },
    { value: '1970-1979', label: '1970-1979' },
    { value: '1950-1969', label: '1950-1969' },
    { value: '1900-1949', label: '1900-1949' }
  ];
  
  // Order by options
  const orderByOptions = [
    { value: 'featured', label: 'Featured' },
    { value: 'latest', label: 'Latest' },
    { value: 'oldest', label: 'Oldest' },
    { value: 'year', label: 'Year' },
    { value: 'rating', label: 'Rating' },
    { value: 'likes', label: 'Likes' },
    { value: 'alphabetical', label: 'Title (A-Z)' }
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Search Movies</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-grow">
                <Input
                  type="text"
                  placeholder="Search for movies..."
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
                  <h3 className="text-lg font-medium">Advanced Filters</h3>
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
                    label="Quality"
                    options={qualityOptions}
                    value={quality}
                    onChange={(e) => setQuality(e.target.value as QualityLiteral)}
                  />
                  
                  <Select
                    label="Genre"
                    options={genreOptions}
                    value={genre}
                    onChange={(e) => setGenre(e.target.value as GenreLiteral)}
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <Select
                    label="Minimum Rating"
                    options={ratingOptions}
                    value={minRating}
                    onChange={(e) => setMinRating(e.target.value)}
                  />
                  
                  <Select
                    label="Year"
                    options={yearOptions}
                    value={year || 'all'}
                    onChange={(e) => setYear(e.target.value as YearLiteral)}
                  />
                </div>
                
                <div className="mt-4">
                  <Select
                    label="Sort By"
                    options={orderByOptions}
                    value={orderBy}
                    onChange={(e) => setOrderBy(e.target.value as OrderByLiteral)}
                  />
                </div>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
      
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold">
            Results
            {movies.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400">
                ({movies.length} movies found)
              </span>
            )}
          </h2>
          
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<ArrowPathIcon className="h-4 w-4" />}
            onClick={() => handleSearch()}
            disabled={isLoading}
          >
            Refresh
          </Button>
        </div>
        
        {error ? (
          <div className="text-center py-8 bg-gray-800/50 rounded-lg">
            <p className="text-red-500 mb-4">{error}</p>
            <Button onClick={() => handleSearch()}>
              Try Again
            </Button>
          </div>
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