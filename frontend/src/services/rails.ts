import apiClient from './api-client';
import { BrowseParams } from '@/types';

export interface RailSpec {
  key: string;
  title: string;
  eyebrow?: string;
  variant?: 'poster' | 'ranked';
  params: BrowseParams;
  see_all_href?: string;
}

export const railsService = {
  getRails: async (
    mode: 'movie' | 'tv',
    userId?: string,
    surface?: string,
    limit = 10,
  ): Promise<RailSpec[]> => {
    const response = await apiClient.get('/rails', {
      params: { mode, user_id: userId, surface, limit },
    });
    return response.data.rails ?? [];
  },
};
