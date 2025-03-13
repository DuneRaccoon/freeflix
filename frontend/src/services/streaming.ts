// frontend/src/services/streaming.ts
import apiClient from './api-client';
import { StreamingInfo, StreamingProgress  } from '@/types';

export const streamingService = {
  // Get streaming information for a torrent
  getStreamingInfo: async (torrentId?: string | null): Promise<StreamingInfo | null> => {
    if (!torrentId) return null;
    const response = await apiClient.get(`/streaming/${torrentId}/info`);
    return response.data;
  },

  // Get the streaming URL for a torrent
  getStreamingUrl: (torrentId?: string | null, quality?: string): string | null => {
    if (!torrentId) return null;
    const baseUrl = `/api/v1/streaming/${torrentId}/video`;
    return quality ? `${baseUrl}?quality=${quality}` : baseUrl;
  },

  // Check if a torrent is ready for streaming
  checkStreamingReady: async (torrentId?: string | null): Promise<boolean> => {
    try {
      if (!torrentId) return false;
      const info = await streamingService.getStreamingInfo(torrentId);

      if (!info) return false;
      
      // A file is generally ready for streaming if it has at least 5% downloaded
      // or if the first few MB are available
      const minStreamableProgress = 5; // 5%
      const isProgressSufficient = info.video_file.progress >= minStreamableProgress;
      
      // Additional check: Is the state appropriate for streaming?
      const streamableStates = ['downloading', 'finished', 'seeding'];
      const isStateStreamable = streamableStates.includes(info.state);
      
      return isProgressSufficient && isStateStreamable;
    } catch (error) {
      console.error('Error checking if torrent is ready for streaming:', error);
      return false;
    }
  },

  saveProgress: async (userId: string, progress: Omit<StreamingProgress, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'last_watched_at'>): Promise<StreamingProgress> => {
    const response = await apiClient.post(`/streaming/progress/${userId}`, progress);
    return response.data;
  },

  // Update existing progress
  updateProgress: async (userId: string, progressId: string, progressUpdate: Pick<StreamingProgress, 'current_time' | 'duration' | 'percentage' | 'completed'>): Promise<StreamingProgress> => {
    const response = await apiClient.put(`/streaming/progress/${userId}/${progressId}`, progressUpdate);
    return response.data;
  },

  // Get progress for a specific torrent
  getProgressByTorrent: async (userId: string, torrentId: string): Promise<StreamingProgress | null> => {
    try {
      const response = await apiClient.get(`/streaming/progress/${userId}/${torrentId}`);
      return response.data;
    } catch (error) {
      if ((error as any)?.response?.status === 404) {
        return null;
      }
      throw error;
    }
  },

  // Get progress for a specific movie
  getProgressByMovie: async (userId: string, movieId: string): Promise<StreamingProgress | null> => {
    try {
      const response = await apiClient.get(`/streaming/progress/${userId}/movie/${movieId}`);
      return response.data;
    } catch (error) {
      if ((error as any)?.response?.status === 404) {
        return null;
      }
      throw error;
    }
  },

  // Get recent progress entries
  getRecentProgress: async (userId: string, limit: number = 10): Promise<StreamingProgress[]> => {
    const response = await apiClient.get(`/streaming/progress/${userId}`, {
      params: { limit }
    });
    return response.data;
  },

  // Delete progress
  deleteProgress: async (userId: string, progressId: string): Promise<void> => {
    await apiClient.delete(`/streaming/progress/${userId}/${progressId}`);
  }
};