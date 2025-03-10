// frontend/src/services/streaming.ts
import apiClient from './api-client';
import { StreamingInfo } from '@/types';

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
  }
};