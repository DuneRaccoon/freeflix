/**
 * content_id helpers
 *
 * The content_id string is the single watch-identity join key used by both
 * the backend (UserStreamingProgress.movie_id) and the frontend.
 *
 * Formats:
 *   movie:{tmdb_id}              → { kind: 'movie' }
 *   tv:{tmdb_id}:s{n}:e{m}       → { kind: 'tv', showId, season, episode }
 *
 * These helpers are extracted from ContinueWatchingSection.tsx so they can be
 * shared across the browse system without duplication.
 */

export interface ParsedContentId {
  kind: 'movie' | 'tv';
  showId?: number;
  season?: number;
  episode?: number;
}

/**
 * Parse a content_id string into its component parts.
 * `tv:{id}:s{n}:e{m}` → tv parts; anything else → movie.
 */
export function parseContentId(movieId: string): ParsedContentId {
  if (movieId.startsWith('tv:')) {
    // format: tv:{showId}:s{n}:e{m}
    const match = movieId.match(/^tv:(\d+):s(\d+):e(\d+)$/i);
    if (match) {
      return {
        kind: 'tv',
        showId: parseInt(match[1], 10),
        season: parseInt(match[2], 10),
        episode: parseInt(match[3], 10),
      };
    }
    // Fallback: still classify as tv even if detailed parse fails
    return { kind: 'tv' };
  }
  return { kind: 'movie' };
}

/**
 * Build the resume URL for a streaming progress entry.
 * Appends `?file={file_index}` when file_index is set (season packs).
 */
export function resumeUrlFor(p: { torrent_id: string; file_index?: number | null }): string {
  const base = `/streaming/${p.torrent_id}`;
  return p.file_index != null ? `${base}?file=${p.file_index}` : base;
}

/**
 * Derive a clean show name from an episode title like "The Boys S01E03".
 * Strips the ` S01E03…` suffix; falls back to `Show {id}` or `Unknown Show`.
 */
export function showNameFromTitle(
  title: string | null | undefined,
  showId?: number,
): string {
  if (title) {
    const stripped = title.replace(/\s+S\d+(E\d+)?.*$/i, '').trim();
    if (stripped) return stripped;
    return title;
  }
  if (showId !== undefined) return `Show ${showId}`;
  return 'Unknown Show';
}
