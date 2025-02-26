import apiClient from './api-client';
import { Movie, SearchParams } from '@/types';

export const moviesService = {
  // Search movies by title
  searchMovies: async (title: string): Promise<Movie[]> => {
    const response = await apiClient.get(`/movies/search`, {
      params: { title }
    });
    return response.data;
  },

  // Browse movies with filters
  browseMovies: async (params: SearchParams): Promise<Movie[]> => {
    const response = await apiClient.post(`/movies/browse`, params);
    return response.data;
  },

  // Get movie details by URL
  getMovie: async (url: string): Promise<Movie> => {
    const response = await apiClient.get(`/movies/movie`, {
      params: { url }
    });
    return response.data;
  },

  // Get latest movies
  getLatestMovies: async (limit: number = 10, quality?: string): Promise<Movie[]> => {
    const params: Record<string, any> = { limit };
    if (quality) params.quality = quality;
    
    const response = await apiClient.get(`/movies/latest`, { params });
    return response.data;
  },

  // Get top rated movies
  getTopRatedMovies: async (
    limit: number = 10, 
    quality?: string, 
    genre?: string, 
    year?: number
  ): Promise<Movie[]> => {
    const params: Record<string, any> = { limit };
    if (quality) params.quality = quality;
    if (genre) params.genre = genre;
    if (year) params.year = year;
    
    const response = await apiClient.get(`/movies/top`, { params });
    return response.data;
  }
};