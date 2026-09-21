// frontend/src/services/avatars.ts
import apiClient from './api-client';

export interface LibraryStill {
  /** Accessible name for the tile, e.g. the character or actor name. */
  label: string;
  /** Raw TMDB path fragment, sent to the backend to mint a `cached:` id. */
  profilePath: string;
  /** Already-built w185 URL from `CastMember.image`, used only for the thumbnail. */
  previewUrl: string;
}

export const avatarsService = {
  /**
   * Hand the backend a TMDB path fragment; it downloads, caches and returns the
   * `cached:` id. The path is never a URL — the backend picks the host.
   */
  async cacheTmdbStill(path: string): Promise<string> {
    const { data } = await apiClient.post<{ id: string }>('/avatars/from-tmdb', { path });
    return data.id;
  },
};
