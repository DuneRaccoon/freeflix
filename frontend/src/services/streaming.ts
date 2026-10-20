// frontend/src/services/streaming.ts
import apiClient from './api-client';
import {
  StreamingInfo,
  StreamingProgress,
  SubtitleAdmission,
  SubtitleList,
  VideoFile,
} from '@/types';

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

  // The sidecar subtitle list for one torrent, as an ENVELOPE (`SubtitleList`) and never a
  // bare array: `coverage` is the only thing that separates "this release ships no .srt"
  // from "this download has no live handle, so the box cannot see its files at all", and
  // an empty array cannot say which.
  //
  // `fileIndex` is the VIDEO file index being watched, so a season pack answers only the
  // episode on screen. Built key-by-key rather than as a literal, the same way
  // `getStreamingInfo` is and for the same measured reason: an absent value must be an
  // ABSENT PARAM. The backend VALIDATES `file_index` against the torrent's video files and
  // 404s one that is not among them, so `?file_index=undefined` would turn a list the
  // television can read into "The box doesn't recognise this title."
  //
  // `allow401` opts out of the client's global 401 redirect — see `saveProgress` below for
  // the mechanism. A subtitle list is never worth evicting a viewer from a film, and the
  // interceptor's hard navigation happens inside its own rejection handler behind a
  // module-scoped flag that is never reset, so one unguarded 401 here would also silence
  // every later one in the same page load.
  getSubtitles: async (
    torrentId: string,
    fileIndex?: number,
    opts?: { allow401?: boolean },
  ): Promise<SubtitleList> => {
    const params: Record<string, number> = {};
    if (fileIndex !== undefined) params.file_index = fileIndex;
    const response = await apiClient.get(`/streaming/${torrentId}/subtitles`, {
      ...(Object.keys(params).length > 0 ? { params } : {}),
      // `ready` flips underneath this URL while a download runs, so a cached answer is
      // the one thing the television must never believe. The authoritative half is the
      // backend's own `Cache-Control: no-store` on the response; this is the request
      // half. NOT `cache: 'no-store'` — that is a `fetch` option, and axios 1.12.2
      // resolves its adapter in the order `['xhr', 'http', 'fetch']`, so in a browser the
      // XHR adapter runs and reads no `cache` key at all. A `cache` field here would be a
      // guard that cannot be observed to work or to be missing, which is worse than none.
      headers: { 'Cache-Control': 'no-store' },
      ...(opts?.allow401 ? { __allow401: true } : {}),
    });
    return response.data;
  },

  // Ask the box to admit one sidecar's pieces. THE ONLY MUTATING SUBTITLE CALL, and it
  // answers 202 BEFORE the bytes arrive — the outcome is learned by polling the list (see
  // `(bigscreen)/_data/subtitles.ts`), never from this response. `admitted: 0` is a
  // success. A refused gate is a 409 and arrives as a rejection whose
  // `response.data.reason` names the gate.
  //
  // `index` is the torrent's own libtorrent file index, the same number the list's `index`
  // carries — never a row's position in the list.
  fetchSubtitle: async (
    torrentId: string,
    index: number,
    opts?: { allow401?: boolean },
  ): Promise<SubtitleAdmission> => {
    const response = await apiClient.post(
      `/streaming/${torrentId}/subtitles/${index}/fetch`,
      undefined,
      opts?.allow401 ? { __allow401: true } : undefined,
    );
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