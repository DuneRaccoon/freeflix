// frontend/src/services/streaming.ts
import apiClient from './api-client';
import { StreamingInfo, StreamingProgress, VideoFile } from '@/types';

export const streamingService = {
  // Get streaming information for a torrent.
  //
  // `at` is the BYTE OFFSET the seek boundary (`video_file.contiguous`) is measured around,
  // and omitting it means 0 — the run at the head of the file. A player that resumes at
  // 50:20 and asks with no `at` is handed the run around byte 0, which is a measurement of
  // the wrong part of the file: the resume seek is then clamped to a ceiling that has
  // nothing to do with where the viewer is going. Built key-by-key rather than as a literal
  // so an absent value is an ABSENT PARAM and never `?at=undefined`/`?file_index=null`
  // (axios drops a null param silently, and `/info` then resolves the largest file and
  // answers THAT file's content_id — see `(bigscreen)/_player/fileIndex.ts`).
  getStreamingInfo: async (
    torrentId?: string | null,
    fileIndex?: number,
    at?: number,
  ): Promise<StreamingInfo | null> => {
    if (!torrentId) return null;
    const params: Record<string, number> = {};
    if (fileIndex !== undefined) params.file_index = fileIndex;
    if (at !== undefined) params.at = at;
    const response = await apiClient.get(
      `/streaming/${torrentId}/info`,
      Object.keys(params).length > 0 ? { params } : undefined,
    );
    return response.data;
  },

  // Get the streaming URL for a torrent
  getStreamingUrl: (torrentId?: string | null, quality?: string, fileIndex?: number): string | null => {
    if (!torrentId) return null;
    const baseUrl = `/api/v1/streaming/${torrentId}/video`;
    const params = new URLSearchParams();
    if (quality) params.set('quality', quality);
    if (fileIndex !== undefined) params.set('file_index', String(fileIndex));
    const qs = params.toString();
    return qs ? `${baseUrl}?${qs}` : baseUrl;
  },

  // Get the list of video files in a torrent
  getFiles: async (torrentId: string): Promise<VideoFile[]> => {
    const response = await apiClient.get(`/streaming/${torrentId}/files`);
    return response.data;
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

  // `allow401` opts this one call out of the client's global 401 redirect. The interceptor
  // hard-navigates from inside its own rejection handler, BEFORE any caller sees the error
  // (`api-client.ts` `handleUnauthorized`), so a player flushing its position on the way out
  // would be destroyed mid-flush by its own failing write and the position lost. The TV
  // player passes it; the web keeps the redirect.
  saveProgress: async (
    userId: string,
    progress: Omit<StreamingProgress, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'last_watched_at'>,
    opts?: { allow401?: boolean },
  ): Promise<StreamingProgress> => {
    const response = await apiClient.post(
      `/streaming/progress/${userId}`,
      progress,
      opts?.allow401 ? { __allow401: true } : undefined,
    );
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