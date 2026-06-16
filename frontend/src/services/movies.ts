import apiClient from './api-client';
import { CatalogPage, MovieDetail, TorrentHit } from '@/types';

export const moviesService = {
  // Browse movies (api = popular | top_rated)
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
};