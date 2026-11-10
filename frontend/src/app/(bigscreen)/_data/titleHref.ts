import type { ContentIdInput } from '@/lib/contentId';

/**
 * The television's title-screen URLs, and the one reader of the query they carry. A sibling
 * of `watchHref.ts`, and its own module for the same reason: the screen suites mock `title`,
 * and a URL builder living there would be mocked away with it.
 *
 * THE PRODUCER AND THE READER OF `?s=&e=` LIVE TOGETHER, because they are one fact spelled
 * twice. Continue Watching writes the asked episode into a card's href and the show screen
 * reads it back; a builder that wrote `?season=` beside a reader that read `s` would open
 * every resume card on the show's latest-watched season with nothing failing anywhere.
 * `titleHref.test.ts` round-trips the two.
 *
 * And deliberately NOT `@/lib/titlePageHref`, which answers `/movies/{id}` and
 * `/tv/{id}?season=&episode=`: (web) routes, which would navigate the television out of its
 * own root layout. Which title something belongs to is shared (`titleOfContentId` in
 * `@/lib/contentId`); the route that title lives at is per surface.
 */

/** The episode a show screen is asked to open on. Season 0 never is one (see `titleOfContentId`). */
export interface EpisodeAsk {
  season: number;
  episode: number;
}

/** The query keys. Private: `showHref` writes them and `showAskFrom` reads them, and nothing else may. */
const SEASON_KEY = 's';
const EPISODE_KEY = 'e';

export const movieHref = (tmdbId: number): string => `/bigscreen/movie/${tmdbId}`;

/** The show screen, asked to open on one episode when `at` names one; the bare screen otherwise. */
export const showHref = (showId: number, at?: EpisodeAsk | null): string =>
  at
    ? `/bigscreen/show/${showId}?${SEASON_KEY}=${at.season}&${EPISODE_KEY}=${at.episode}`
    : `/bigscreen/show/${showId}`;

/**
 * The screen a title opens on: a film's, or a show's — at its episode when the title names
 * one. `titleOfContentId` already dropped a half episode and season 0, so what is here is
 * exactly what to ask for.
 */
export function titleHref(t: ContentIdInput): string {
  if (t.kind === 'movie') return movieHref(t.tmdbId);
  return showHref(t.tmdbId, t.season != null && t.episode != null ? { season: t.season, episode: t.episode } : null);
}

/**
 * A query value as an ask: a positive safe integer, or null. `Number` alone is not enough —
 * it reads `''` and `' '` as 0, `'1e21'` as a number no season has, and `'1.5'` as a
 * fraction — so blank is null first, then the integer and range checks decide.
 */
function positive(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * The episode the show screen was asked to open on, read off its query. Each value is parsed
 * on its own and a bad one is null, never a throw: the screen treats null as "not asked" and
 * an ask it cannot honour (an unlisted season, a watched episode) as no ask either, so junk
 * in the URL falls back to the screen's own pick.
 */
export function showAskFrom(params: Pick<URLSearchParams, 'get'>): { season: number | null; episode: number | null } {
  return { season: positive(params.get(SEASON_KEY)), episode: positive(params.get(EPISODE_KEY)) };
}
