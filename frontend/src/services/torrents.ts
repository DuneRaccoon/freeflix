import apiClient from './api-client';
import { TorrentStatus, TorrentRequest, TorrentAction, TorrentBatchActionType, TorrentBatchResponse, CatalogTorrentRequest, TorrentCandidate } from '@/types';

export interface SourcesParams {
  tmdb_id: number;
  quality?: string;
  media_type?: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

export const torrentsService = {
  // Download a movie (legacy YTS-shaped request)
  downloadMovie: async (request: TorrentRequest): Promise<TorrentStatus> => {
    const response = await apiClient.post(`/torrents/download/movie`, request);
    return response.data;
  },

  // Download a movie using the new TMDB catalog API
  downloadCatalogMovie: async (request: CatalogTorrentRequest): Promise<TorrentStatus> => {
    const response = await apiClient.post(`/torrents/download`, request);
    return response.data;
  },

  // Ranked, health-classified torrent sources for a title (W1 GET /torrents/sources)
  getSources: async (params: SourcesParams): Promise<TorrentCandidate[]> => {
    const response = await apiClient.get(`/torrents/sources`, { params });
    return response.data;
  },

  // Get torrent status
  getTorrentStatus: async (torrentId?: string | null): Promise<TorrentStatus | null> => {
    if (!torrentId) return null;
    const response = await apiClient.get(`/torrents/status/${torrentId}`);
    return response.data;
  },

  // List all torrents with optional filter by state
  listTorrents: async (state?: string): Promise<TorrentStatus[]> => {
    const params = state ? { state } : {};
    const response = await apiClient.get(`/torrents/list`, { params });
    return response.data;
  },

  // Perform action on torrent (pause | resume)
  performTorrentAction: async (torrentId: string, action: TorrentAction): Promise<any> => {
    const response = await apiClient.post(`/torrents/action/${torrentId}`, { action });
    return response.data;
  },

  // Delete a torrent
  deleteTorrent: async (torrentId: string, deleteFiles: boolean = false): Promise<any> => {
    const response = await apiClient.delete(`/torrents/${torrentId}`, {
      params: { delete_files: deleteFiles }
    });
    return response.data;
  },

  // Batch action across torrents (pause/resume all, clear completed, retry errored)
  batchAction: async (
    action: TorrentBatchActionType,
    deleteFiles = false,
  ): Promise<TorrentBatchResponse> => {
    const response = await apiClient.post(`/torrents/batch`, { action, delete_files: deleteFiles });
    return response.data;
  },
  
  // Prioritize torrent for streaming (new function)
  prioritizeForStreaming: async (torrentId?: string | null): Promise<boolean> => {
    if (!torrentId) return false;
    try {
      const response = await apiClient.post(`/torrents/${torrentId}/prioritize`, {
        for_streaming: true
      });
      return response.data.success || false;
    } catch (error) {
      console.error('Error prioritizing torrent for streaming:', error);
      return false;
    }
  }
};