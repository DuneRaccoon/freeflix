// frontend/src/services/avatars.ts
import apiClient from './api-client';
import { watchlistService } from './watchlist';
import { moviesService } from './movies';

export interface LibraryStill {
  /** Accessible name for the tile, e.g. the character or actor name. */
  label: string;
  /** Raw TMDB path fragment, sent to the backend to mint a `cached:` id. */
  profilePath: string;
  /** Already-built w185 URL from `CastMember.image`, used only for the thumbnail. */
  previewUrl: string;
}

/** Detail fetches are one request each, so cap how many titles we open. */
const MAX_TITLES = 6;
const MAX_STILLS = 30;

export const avatarsService = {
  /**
   * Hand the backend a TMDB path fragment; it downloads, caches and returns the
   * `cached:` id. The path is never a URL — the backend picks the host.
   */
  async cacheTmdbStill(path: string): Promise<string> {
    const { data } = await apiClient.post<{ id: string }>('/avatars/from-tmdb', { path });
    return data.id;
  },

  /**
   * Draw library-tab avatar stills from the user's watchlist.
   *
   * Movies only: `ShowDetail` has no `cast` field and the backend show endpoint
   * never fetches credits, so TV entries are skipped rather than half-supported.
   */
  async loadLibraryStills(userId: string): Promise<LibraryStill[]> {
    let items;
    try {
      items = await watchlistService.list(userId);
    } catch {
      // A picker that throws because the watchlist is unreachable is worse than
      // a picker with no library tab.
      return [];
    }

    const recent = items
      .filter((i) => i.media_type !== 'tv')
      .sort((a, b) => b.added_at.localeCompare(a.added_at))
      .slice(0, MAX_TITLES);

    const details = await Promise.allSettled(
      recent.map((i) => moviesService.getDetail(Number(i.tmdb_id))),
    );

    const stills: LibraryStill[] = [];
    for (const d of details) {
      if (d.status !== 'fulfilled') continue;
      for (const c of d.value.cast ?? []) {
        if (!c.profile_path || !c.image) continue;
        stills.push({
          label: c.character || c.name,
          profilePath: c.profile_path,
          previewUrl: c.image,
        });
      }
    }
    return stills.slice(0, MAX_STILLS);
  },
};
