import type { ContentIdInput } from './contentId';

/**
 * THE WEB'S ROUTE TO A TITLE PAGE, and the reader of the query it writes.
 *
 * WEB ONLY, as `resumeUrlFor` is: `/movies/{id}` and `/tv/{id}` are `(web)` routes, and a
 * television sent to one leaves its own root layout. The TV builds its own title routes in
 * `(bigscreen)/_data/titleHref.ts`, with its own query spelling (`s`/`e`), and never imports
 * this module.
 *
 * THE PRODUCER AND THE READER LIVE TOGETHER so the spelling cannot drift between them:
 * `titlePageHref` writes `?season=&episode=` and `episodeAskFrom` reads it back, and a
 * round-trip test pins the pair. Both apply one rule — a season is asked for only when it is
 * an integer ≥ 1, and an episode only alongside such a season — so the builder never writes
 * an ask the reader would throw away.
 *
 * SEASON 0 IS NEVER AN ASK. It is Specials, and also the backend's `s0` fallback for a file
 * it could not identify; `@/lib/contentId`'s `titleOfContentId` and `titleOfStream` already
 * drop it, and both functions here drop it again for any other caller.
 */

/** A positive safe integer: the only season or episode number either function will carry. */
const isAskNumber = (n: number | undefined): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;

/**
 * The web page for a title: `/movies/{id}` for a film, `/tv/{id}` for a show, and the show
 * page asked for an episode — `/tv/{id}?season={S}&episode={E}` — when the title names one.
 * A season with no episode asks for the season alone; an episode with no season is dropped.
 */
export function titlePageHref(t: ContentIdInput): string {
  if (t.kind === 'movie') return `/movies/${t.tmdbId}`;
  const base = `/tv/${t.tmdbId}`;
  if (!isAskNumber(t.season)) return base;
  return isAskNumber(t.episode)
    ? `${base}?season=${t.season}&episode=${t.episode}`
    : `${base}?season=${t.season}`;
}

/**
 * One query value as an ask number, or undefined. A repeated parameter (`?season=1&season=2`,
 * which Next hands over as an array) is read by its FIRST value. Digits only (`/^\d+$/`), so
 * `-1`, `1.5`, `1e3`, a blank and `abc` are refused before `Number` can read any of them as a
 * number; `Number.isSafeInteger` then refuses a string of digits too long to be exact.
 */
function askNumber(raw: string | string[] | undefined): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return isAskNumber(n) ? n : undefined;
}

/**
 * The episode a show page was asked to open on, read from its `searchParams`.
 *
 * NOTHING HERE THROWS AND NOTHING IS REJECTED LOUDLY. A malformed, zero or absent value is
 * simply not an ask, and the page behaves exactly as it does without a query — no 404 for a
 * hand-edited URL. `episode` is kept only when `season` is: an episode number means nothing
 * without the season it belongs to. Keys are omitted, never set to undefined.
 */
export function episodeAskFrom(
  sp: Record<string, string | string[] | undefined>,
): { season?: number; episode?: number } {
  const season = askNumber(sp.season);
  if (season === undefined) return {};
  const episode = askNumber(sp.episode);
  return episode === undefined ? { season } : { season, episode };
}
