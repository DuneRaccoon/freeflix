'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Movie, SearchParams } from '@/types';
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

export default function SearchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  // Get initial search parameters from URL
  const initialKeyword = searchParams.get('keyword') || '';
  const initialQuality = searchParams.get('quality') || 'all';
  const initialGenre = searchParams.get('genre') || 'all';
  const initialRating = searchParams.get('rating') ? parseInt(searchParams.get('rating')!, 10) : 0;
  const initialYear = searchParams.get('year') ? parseInt(searchParams.get('year')!, 10) : undefined;
  const initialOrderBy = searchParams.get('order_by') || 'featured';
  
  const [searchTerm, setSearchTerm] = useState(initialKeyword);
  const [showFilters, setShowFilters] = useState(false);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Filter states
  const [quality, setQuality] = useState(initialQuality);
  const [genre, setGenre] = useState(initialGenre);
  const [minRating, setMinRating] = useState(initialRating);
  const [year, setYear] = useState<number | undefined>(initialYear);
  const [orderBy, setOrderBy] = useState(initialOrderBy);
  
  // Fetch movies based on search parameters
  const searchMovies = async (params: SearchParams) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Update URL with search parameters
      const queryParams = new URLSearchParams();
      if (params.keyword) queryParams.set('keyword', params.keyword);
      if (params.quality !== 'all') queryParams.set('quality', params.quality!);
      if (params.genre !== 'all') queryParams.set('genre', params.genre!);
      if (params.rating && params.rating > 0) queryParams.set('rating', params.rating.toString());
      if (params.year) queryParams.set('year', params.year.toString());
      if (params.order_by !== 'featured') queryParams.set('order_by', params.order_by!);
      
      router.push(`/search?${queryParams.toString()}`);
      
      // Fetch movies
      const results = await moviesService.browseMovies(params);
      setMovies(results);
    } catch (err) {
      console.error('Error searching movies:', err);
      setError('Failed to search movies. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Handle search form submission
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    searchMovies({
      keyword: searchTerm,
      quality,
      genre,
      rating: minRating,
      year,
      order_by: orderBy
    });
  };
  
  // Handle filter reset
  const handleResetFilters = () => {
    setQuality('all');
    setGenre('all');
    setMinRating(0);
    setYear(undefined);
    setOrderBy('featured');
    
    // Perform search with reset filters
    searchMovies({
      keyword: searchTerm,
      quality: 'all',
      genre: 'all',
      rating: 0,
      year: undefined,
      order_by: 'featured'
    });
  };
  
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
      order_by: initialOrderBy
    };
    
    searchMovies(params);
  }, []);
  
  // Quality options
  const qualityOptions = [
    { value: 'all', label: 'All Qualities' },
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '2160p', label: '4K (2160p)' }
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
    { value: 'history', label: 'History' },
    { value: 'horror', label: 'Horror' },
    { value: 'music', label: 'Music' },
    { value: 'musical', label: 'Musical' },
    { value: 'mystery', label: 'Mystery' },
    { value: 'romance', label: 'Romance' },
    { value: 'sci-fi', label: 'Sci-Fi' },
    { value: 'sport', label: 'Sport' },
    { value: 'thriller', label: 'Thriller' },
    { value: 'war', label: 'War' },
    { value: 'western', label: 'Western' }
  ];
  
  // Order by options
  const orderByOptions = [
    { value: 'featured', label: 'Featured' },
    { value: 'date', label: 'Date Added' },
    { value: 'rating', label: 'Rating' },
    { value: 'title', label: 'Title' },
    { value: 'year', label: 'Year' },
    { value: 'seeds', label: 'Seeds' }
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
                  isLoading={isLoading}
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
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Select
                    label="Quality"
                    options={qualityOptions}
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                  />
                  
                  <Select
                    label="Genre"
                    options={genreOptions}
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                  />
                  
                  <Select
                    label="Sort By"
                    options={orderByOptions}
                    value={orderBy}
                    onChange={(e) => setOrderBy(e.target.value)}
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <Input
                    type="number"
                    label="Minimum Rating"
                    min="0"
                    max="10"
                    value={minRating || ''}
                    onChange={(e) => setMinRating(parseInt(e.target.value || '0', 10))}
                  />
                  
                  <Input
                    type="number"
                    label="Year"
                    min="1900"
                    max={new Date().getFullYear()}
                    value={year || ''}
                    onChange={(e) => setYear(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                    placeholder="Any year"
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
            onClick={() => handleSearch({ preventDefault: () => {} } as any)}
            disabled={isLoading}
          >
            Refresh
          </Button>
        </div>
        
        {error ? (
          <div className="text-center py-8 bg-gray-800/50 rounded-lg">
            <p className="text-red-500 mb-4">{error}</p>
            <Button onClick={() => handleSearch({ preventDefault: () => {} } as any)}>
              Try Again
            </Button>
          </div>
        ) : (
          <MovieGrid 
            movies={movies} 
            isLoading={isLoading} 
          />
        )}
      </div>
    </div>
  );
}