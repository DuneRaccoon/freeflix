// frontend/src/services/activity.ts
import apiClient from './api-client';

export interface ActivityCount {
  active_downloads: number;
  aggregate_progress: number; // 0.0–100.0, mean progress across active torrents
  max_active_downloads: number; // configured concurrent-download ceiling
}

export const activityService = {
  /**
   * Fetch the current count of active downloads and their mean progress.
   * Maps to GET /api/v1/activity/count.
   */
  getCount: async (): Promise<ActivityCount> => {
    const response = await apiClient.get<ActivityCount>('/activity/count');
    return response.data;
  },
};
