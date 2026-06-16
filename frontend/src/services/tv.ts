import apiClient from './api-client';
import { CatalogPage, ShowDetail, SeasonDetail, TorrentHit } from '@/types';

export const tvService = {
  browse: async (params: { api?: string; sort?: string; genre?: number; year?: number; page?: number }): Promise<CatalogPage> => {
    const response = await apiClient.get('/tv', { params });
    return response.data;
  },

  search: async (q: string, page = 1): Promise<CatalogPage> => {
    const response = await apiClient.get('/tv/search', { params: { q, page } });
    return response.data;
  },

  getShow: async (tmdbId: number): Promise<ShowDetail> => {
    const response = await apiClient.get(`/tv/${tmdbId}`);
    return response.data;
  },

  getSeason: async (tmdbId: number, season: number): Promise<SeasonDetail> => {
    const response = await apiClient.get(`/tv/${tmdbId}/season/${season}`);
    return response.data;
  },

  getEpisodeTorrents: async (tmdbId: number, season: number, episode: number): Promise<TorrentHit[]> => {
    const response = await apiClient.get(`/tv/${tmdbId}/season/${season}/episode/${episode}/torrents`);
    return response.data;
  },
};
