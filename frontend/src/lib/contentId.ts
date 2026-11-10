/**
 * content_id helpers
 *
 * The content_id string is the single watch-identity join key used by both
 * the backend (UserStreamingProgress.movie_id) and the frontend.
 *
 * Formats:
 *   movie:{tmdb_id}              → { kind: 'movie' }
 *   tv:{tmdb_id}                 → { kind: 'tv' } (show level)
 *   tv:{tmdb_id}:s{n}:e{m}       → { kind: 'tv', showId, season, episode }
 *
 * These helpers were first extracted from the old ContinueWatchingSection.tsx;
 * both surfaces' Continue Watching rails and title pages now share them.
 *
 * IMPORT-FREE ON PURPOSE. Both surfaces import this module — the television included — and
 * the TV's import guard (`legacy-target.test.ts`) follows a `@/lib` import one hop, so the
 * first import added here becomes a TV dependency too. `titleOfContentId` and
 * `titleOfStream` say WHICH TITLE something belongs to and stop there: the route that title
 * lives at is per surface (`@/lib/titlePageHref` for the web,
 * `(bigscreen)/_data/titleHref.ts` for the TV), so neither builds a URL.
 */

export interface ParsedContentId {
  kind: 'movie' | 'tv';
  showId?: number;
  season?: number;
  episode?: number;
}

export interface ContentIdInput {
  kind: 'movie' | 'tv';
  tmdbId: number;
  season?: number;
  episode?: number;
}

/**
 * Build a content_id string from its component parts.
 *
 * movie → `movie:{tmdbId}`
 * tv (show level, no season/episode) → `tv:{tmdbId}`
 * tv episode → `tv:{tmdbId}:s{season}:e{episode}`
 */
export function buildContentId({ kind, tmdbId, season, episode }: ContentIdInput): string {
  if (kind === 'movie') return `movie:${tmdbId}`;
  if (season != null && episode != null) return `tv:${tmdbId}:s${season}:e${episode}`;
  return `tv:${tmdbId}`;
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
 * Extract the TMDB id from a content_id, for either kind:
 *   `movie:{id}`            → id
 *   `tv:{id}` / `tv:{id}:…` → id (the show id)
 * Returns undefined for legacy title-based ids or a non-numeric id segment.
 * (Kept separate from parseContentId, whose exact return shape is pinned by tests.)
 */
export function tmdbIdFromContentId(movieId: string): number | undefined {
  const match = movieId.match(/^(?:movie|tv):(\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
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

/** A TMDB id a title page can be built on: a positive safe integer, so 0, NaN and 1e20 are not. */
function isTmdbId(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
}

/**
 * A season or episode number a title may name: an integer ≥ 1. SEASON 0 NEVER QUALIFIES.
 * It is TMDB's Specials, and it is also the backend's last resort (`resolve_content_id` in
 * `services/content_id.py` mints `tv:{tmdb}:s0:e{file_index}` for a file it could not
 * identify) — the two cannot be told apart, and a page asked for the second would open on a
 * Specials episode that was never playing.
 */
function isEpisodeNumber(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;
}

/**
 * The title, with its episode only when BOTH coordinates qualify. A film never carries one,
 * and a show with half an episode is the show: a lone season is not kept, so both helpers
 * answer only the shapes `buildContentId` can key a progress row under. Keys are omitted,
 * never set to undefined.
 */
function titleOf(
  kind: ContentIdInput['kind'],
  tmdbId: number,
  season: number | null | undefined,
  episode: number | null | undefined,
): ContentIdInput {
  if (kind === 'tv' && isEpisodeNumber(season) && isEpisodeNumber(episode)) {
    return { kind, tmdbId, season, episode };
  }
  return { kind, tmdbId };
}

/**
 * Which title a progress row's content id belongs to: the film, the show, or the show at
 * one episode.
 *
 * NULL MEANS "CANNOT BE IDENTIFIED", and the caller must keep doing what it did before there
 * was a title page to send anyone to (Continue Watching keeps opening the player). That is a
 * legacy title-string id (`Interstellar`, from before content ids), a non-numeric id segment,
 * and a tmdb id that is not a positive safe integer.
 *
 * The tmdb id comes from `tmdbIdFromContentId` and the kind and S/E from `parseContentId`, so
 * a show-level `tv:{id}` — which `parseContentId` classifies without an id — still names its
 * show. `tv:{id}:s0:e{n}` names the show alone; see `isEpisodeNumber`.
 */
export function titleOfContentId(contentId: string | null | undefined): ContentIdInput | null {
  if (!contentId) return null;
  const tmdbId = tmdbIdFromContentId(contentId);
  if (!isTmdbId(tmdbId)) return null;
  const { kind, season, episode } = parseContentId(contentId);
  return titleOf(kind, tmdbId, season, episode);
}

/**
 * Which title the web player's download belongs to, from its torrent row and — for a season
 * pack — a hint naming the file being played (the `/info` answer or the `/files` entry).
 *
 * - `media_type` decides the kind, not the season fields. Anything but `'tv'` is a film,
 *   because `manager.py` stores a TV torrent as "movie" when the caller omits the type.
 * - A row that names its own episode is a single-episode download, and both numbers are the
 *   row's. A season pack carries `episode: null` ("this season is covered"), and then BOTH
 *   numbers are the hint's, never one from each. A pack row's season is only the season that
 *   was asked for — a multi-season "Complete" pack is stored under one of them — while
 *   `/info` answers a pack file's season and episode from the same precomputed map the web's
 *   progress key is built from (`api/streaming.py`). So the episode this names is the one the
 *   web wrote its row under, and a hint with no season is the show, not the row's season.
 *
 * NOT `watchIdentity`'s PRECEDENCE, and the TV player does not call this. The TV keys its
 * progress itself in `(bigscreen)/_data/useWatchProgress.watchIdentity`, the row's season
 * first and the file's after it, and leaves by that key (`(bigscreen)/_data/titleHref.ts`),
 * so each surface's way back names the episode that surface wrote. The two part only over a
 * pack: the TV can pair the row's season with the file's episode, and the web never does.
 *
 * NEVER `/info`'s `content_id`. Its last resort is the `s0` fallback (see `isEpisodeNumber`),
 * which parses cleanly and names an episode nobody chose; the hint's bare season and episode
 * are read instead, and season 0 among them is dropped. Null, as for `titleOfContentId`,
 * when the download carries no usable tmdb id.
 */
export function titleOfStream(
  status:
    | {
        tmdb_id?: number | null;
        media_type?: string | null;
        season?: number | null;
        episode?: number | null;
      }
    | null
    | undefined,
  hint?: { season?: number | null; episode?: number | null } | null,
): ContentIdInput | null {
  const tmdbId = status?.tmdb_id;
  if (!status || !isTmdbId(tmdbId)) return null;
  if (status.media_type !== 'tv') return { kind: 'movie', tmdbId };
  if (status.episode != null) return titleOf('tv', tmdbId, status.season, status.episode);
  return titleOf('tv', tmdbId, hint?.season, hint?.episode);
}
