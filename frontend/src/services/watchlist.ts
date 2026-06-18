// frontend/src/services/watchlist.ts
import apiClient from './api-client';

export interface WatchlistItemCreate {
  content_id: string;
  tmdb_id: string;
  media_type: 'movie' | 'tv';
  title?: string;
}

export interface WatchlistItem {
  id: string;
  user_id: string;
  content_id: string;
  tmdb_id: string;
  media_type: string;
  title?: string | null;
  added_at: string;
  created_at: string;
}

export const watchlistService = {
  /**
   * Add a content item to the user's watchlist.
   * Returns 201 on success; the caller should handle 409 (already saved).
   */
  add: async (userId: string, item: WatchlistItemCreate): Promise<WatchlistItem> => {
    const response = await apiClient.post(`/watchlist/${userId}/add`, item);
    return response.data;
  },

  /**
   * Remove a content item from the user's watchlist.
   * content_id is URL-encoded automatically by axios.
   */
  remove: async (userId: string, contentId: string): Promise<void> => {
    await apiClient.delete(`/watchlist/${userId}/${encodeURIComponent(contentId)}`);
  },

  /**
   * Return all watchlist entries for the user, newest first.
   */
  list: async (userId: string): Promise<WatchlistItem[]> => {
    const response = await apiClient.get(`/watchlist/${userId}`);
    return response.data;
  },
};
