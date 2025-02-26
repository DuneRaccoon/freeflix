import React from 'react';
import { Movie } from '@/types';
import MovieCard from './MovieCard';

interface MovieGridProps {
  movies: Movie[];
  isLoading?: boolean;
  onDownload?: (movieId: string, quality: string) => void;
}

const MovieGrid: React.FC<MovieGridProps> = ({ 
  movies, 
  isLoading = false,
  onDownload 
}) => {
  // Loading skeleton
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index} className="animate-pulse">
            <div className="bg-gray-700 rounded-lg h-64"></div>
            <div className="mt-2 bg-gray-700 h-6 rounded w-3/4"></div>
            <div className="mt-1 bg-gray-700 h-4 rounded w-1/2"></div>
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

  // Render movie grid
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
      {movies.map((movie) => (
        <MovieCard 
          key={movie.link} 
          movie={movie} 
          onDownload={onDownload}
        />
      ))}
    </div>
  );
};

export default MovieGrid;