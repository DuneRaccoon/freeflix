import apiClient from './api-client';
import { Movie, SearchParams, CatalogPage, MovieDetail, TorrentHit } from '@/types';

export const moviesService = {
  // --- New TMDB-shaped catalog API ---
  browse: async (params: { api?: string; sort?: string; genre?: number; year?: number; page?: number }): Promise<CatalogPage> => {
    const response = await apiClient.get('/movies', { params });
    return response.data;
  },

  search: async (q: string, page = 1): Promise<CatalogPage> => {
    const response = await apiClient.get('/movies/search', { params: { q, page } });
    return response.data;
  },

  getDetail: async (tmdbId: number): Promise<MovieDetail> => {
    const response = await apiClient.get(`/movies/${tmdbId}`);
    return response.data;
  },

  getTorrents: async (tmdbId: number): Promise<TorrentHit[]> => {
    const response = await apiClient.get(`/movies/${tmdbId}/torrents`);
    return response.data;
  },

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

  // Get detailed movie information from enhanced API
  getMovieDetails: async (movie_id: string): Promise<any> => {
    const response = await apiClient.get(`/movies/details`, { params: { movie_id } });
    return response.data;
  },

  getMovieDetailsByTitle: async (title: string): Promise<any> => {
    const response = await apiClient.get(`/movies/details`, { params: { title } });
    return response.data;
  },

  getFeaturedMovies: async (
    limit: number = 10, 
    quality?: string, 
    page: number = 1
  ): Promise<Movie[]> => {
    const params: Record<string, any> = { limit, page, order_by: 'featured' };
    if (quality) params.quality = quality;
    
    const response = await apiClient.post(`/movies/browse`, { params });
    return response.data.slice(0, limit);
  },

  // Get latest movies
  getLatestMovies: async (
    limit: number = 10, 
    quality?: string, 
    page: number = 1
  ): Promise<Movie[]> => {
    const params: Record<string, any> = { limit, page };
    if (quality) params.quality = quality;
    
    const response = await apiClient.get(`/movies/latest`, { params });
    return response.data;
  },

  // Get top rated movies
  getTopRatedMovies: async (
    limit: number = 10, 
    quality?: string, 
    genre?: string, 
    year?: number,
    page: number = 1
  ): Promise<Movie[]> => {
    const params: Record<string, any> = { limit, page };
    if (quality) params.quality = quality;
    if (genre) params.genre = genre;
    if (year) params.year = year;
    
    const response = await apiClient.get(`/movies/top`, { params });
    return response.data;
  }
};