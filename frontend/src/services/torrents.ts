import apiClient from './api-client';
import { TorrentStatus, TorrentRequest, TorrentAction } from '@/types';

export const torrentsService = {
  // Download a movie
  downloadMovie: async (request: TorrentRequest): Promise<TorrentStatus> => {
    const response = await apiClient.post(`/torrents/download/movie`, request);
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

  // Perform action on torrent (pause, resume, stop, remove)
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
  }
};