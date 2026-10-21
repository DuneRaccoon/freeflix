import type { BrowseParams, CatalogItem, CatalogPage } from '@/types';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import type { CardItem } from '../_components/Card';
import type { RailModel } from '../_components/Rail';

export interface TvRailSpec {
  key: string;
  title: string;
  eyebrow?: string;
  shape: 'poster' | 'wide';
  /** Browse params for the movie half. Omit to skip movies. */
  movieParams?: BrowseParams;
  /** Browse params for the tv half. Omit to skip shows. */
  tvParams?: BrowseParams;
}

/**
 * The television's rail lineup, in render order.
 *
 * A COPY of the web's `MIXED_RAILS` (`@/lib/buildMixedRailsScreen`), not an import of
 * it. That module imports `RowConfig` from the web's BrowseScreen component, which
 * drags `PosterCard` and `tailwind-merge` into the TV bundle while leaving the import
 * guard green. The web's `feed` field is dropped on purpose too: it drives per-rail
 * backdrop theming built from SVG filters and blend modes that spec §9 bans here.
 *
 * TMDB numbers movie and tv genres SEPARATELY, so each half carries its own id:
 * Action is movie 28 / tv 10759 and Sci-Fi is movie 878 / tv 10765. Drama and Comedy
 * are the two that coincide. Reusing one id for both halves returns the wrong genre
 * for one of them, with no error anywhere.
 *
 * `api` is validated by a different regex per endpoint (`now_playing`/`upcoming` are
 * movies-only, `on_the_air`/`airing_today` tv-only), so a mixed rail may only use a
 * value legal for BOTH: `popular` and `top_rated`. Anything else is a request error.
 */
export const TV_RAILS: readonly TvRailSpec[] = [
  {
    key: 'trending',
    title: 'Trending This Week',
    shape: 'poster',
    movieParams: { api: 'popular' },
    tvParams: { api: 'popular' },
  },
  {
    key: 'top-rated',
    title: 'Top Rated',
    eyebrow: 'Critically acclaimed',
    shape: 'poster',
    movieParams: { api: 'top_rated' },
    tvParams: { api: 'top_rated' },
  },
  {
    key: 'new',
    title: 'New Releases',
    shape: 'poster',
    movieParams: { api: 'popular', sort: 'primary_release_date.desc' },
    tvParams: { api: 'popular', sort: 'primary_release_date.desc' },
  },
  {
    key: 'genre-action',
    title: 'Action & Adventure',
    eyebrow: 'Genre',
    shape: 'poster',
    movieParams: { genres: '28' },
    tvParams: { genres: '10759' },
  },
  {
    key: 'genre-drama',
    title: 'Drama',
    eyebrow: 'Genre',
    shape: 'poster',
    movieParams: { genres: '18' },
    tvParams: { genres: '18' },
  },
  {
    key: 'genre-comedy',
    title: 'Comedy',
    eyebrow: 'Genre',
    shape: 'poster',
    movieParams: { genres: '35' },
    tvParams: { genres: '35' },
  },
  {
    key: 'genre-scifi',
    title: 'Sci-Fi & Fantasy',
    eyebrow: 'Genre',
    shape: 'poster',
    movieParams: { genres: '878' },
    tvParams: { genres: '10765' },
  },
  {
    key: 'genre-crime',
    title: 'Crime',
    eyebrow: 'Genre',
    shape: 'poster',
    movieParams: { genres: '80' },
    tvParams: { genres: '80' },
  },

  // ----------------------------------------------------------------------------------
  // Below here the pool is the TELEVISION'S OWN, and the web has none of it. A rail is
  // two HTTP requests, so the lineup on screen is a random SUBSET of this pool
  // (`RAILS_ON_SCREEN`) rather than all of it: the variety is in which rails are drawn
  // tonight, not in drawing thirty of them at once.
  //
  // THE ONE TRAP IN WRITING NEW SPECS, read off `providers/catalog.py:96-126`: any of
  // `genres`/`year`/`origin`/`lang`/`provider` switches the upstream request to
  // `api=discover`, and `api` is then NOT SENT AT ALL. So on a filtered rail `api` is
  // decoration and `sort` is the only thing that orders it — which is why these carry a
  // sort and the unfiltered ones carry an api.
  //
  // AND SORT IS NOT TRANSLATED PER MODE (nothing in `providers/` touches it; it goes
  // straight upstream). `primary_release_date` is a movie field and `first_air_date` a tv
  // one, so a date sort belongs in ONE half's params, never in both. (The 'new' rail
  // above sends the movie spelling to both halves — inherited from the web table, which
  // `railsDrift.test.ts` pins, so it is left exactly as it is rather than quietly fixed
  // on one surface.)
  { key: 'genre-animation', title: 'Animation', eyebrow: 'Genre', shape: 'poster',
    movieParams: { genres: '16' }, tvParams: { genres: '16' } },
  { key: 'genre-documentary', title: 'Documentary', eyebrow: 'Genre', shape: 'poster',
    movieParams: { genres: '99' }, tvParams: { genres: '99' } },
  { key: 'genre-family', title: 'Family', eyebrow: 'Genre', shape: 'poster',
    movieParams: { genres: '10751' }, tvParams: { genres: '10751' } },
  { key: 'genre-mystery', title: 'Mystery', eyebrow: 'Genre', shape: 'poster',
    movieParams: { genres: '9648' }, tvParams: { genres: '9648' } },
  { key: 'genre-western', title: 'Westerns', eyebrow: 'Genre', shape: 'poster',
    movieParams: { genres: '37' }, tvParams: { genres: '37' } },
  // TMDB has no television equivalent for these four, so they are MOVIE-ONLY rails: the
  // `tvParams`-less shape `fetchRail` already supports ("Omit to skip shows"). Pairing
  // them with a near-enough tv genre would put thrillers under Crime and label it Horror.
  { key: 'genre-horror', title: 'Horror', eyebrow: 'Films', shape: 'poster',
    movieParams: { genres: '27' } },
  { key: 'genre-thriller', title: 'Thrillers', eyebrow: 'Films', shape: 'poster',
    movieParams: { genres: '53' } },
  { key: 'genre-romance', title: 'Romance', eyebrow: 'Films', shape: 'poster',
    movieParams: { genres: '10749' } },
  { key: 'genre-history', title: 'History', eyebrow: 'Films', shape: 'poster',
    movieParams: { genres: '36' } },
  // Movie 10752 is 'War'; tv 10768 is 'War & Politics'. Different ids, same shelf.
  { key: 'genre-war', title: 'War & Politics', eyebrow: 'Genre', shape: 'poster',
    movieParams: { genres: '10752' }, tvParams: { genres: '10768' } },
  // ...and these two exist only on television.
  { key: 'genre-reality', title: 'Reality TV', eyebrow: 'Series', shape: 'poster',
    tvParams: { genres: '10764' } },
  { key: 'genre-kids', title: 'For Younger Viewers', eyebrow: 'Series', shape: 'poster',
    tvParams: { genres: '10762' } },

  // `origin: 'anime'` is NOT a country: `catalog.py:104` reads it as genre 16 + Japanese,
  // which is the one shelf that needs two filters and gets them from one word.
  { key: 'anime', title: 'Anime', eyebrow: 'From Japan', shape: 'poster',
    movieParams: { origin: 'anime' }, tvParams: { origin: 'anime' } },
  { key: 'origin-kr', title: 'From Korea', eyebrow: 'World cinema', shape: 'poster',
    movieParams: { origin: 'KR' }, tvParams: { origin: 'KR' } },
  { key: 'origin-jp', title: 'From Japan', eyebrow: 'World cinema', shape: 'poster',
    movieParams: { origin: 'JP' }, tvParams: { origin: 'JP' } },
  { key: 'origin-gb', title: 'From Britain', eyebrow: 'World cinema', shape: 'poster',
    movieParams: { origin: 'GB' }, tvParams: { origin: 'GB' } },
  { key: 'origin-fr', title: 'From France', eyebrow: 'World cinema', shape: 'poster',
    movieParams: { origin: 'FR' }, tvParams: { origin: 'FR' } },
  { key: 'origin-in', title: 'From India', eyebrow: 'World cinema', shape: 'poster',
    movieParams: { origin: 'IN' }, tvParams: { origin: 'IN' } },
  { key: 'lang-es', title: 'In Spanish', eyebrow: 'World cinema', shape: 'poster',
    movieParams: { lang: 'es' }, tvParams: { lang: 'es' } },
  { key: 'origin-se', title: 'From Scandinavia', eyebrow: 'World cinema', shape: 'poster',
    movieParams: { origin: 'SE' }, tvParams: { origin: 'SE' } },

  // One half only, because the sort field names a column the other mode does not have.
  { key: 'newest-films', title: 'Just Added to Cinemas', eyebrow: 'Films', shape: 'poster',
    movieParams: { sort: 'primary_release_date.desc' } },
  { key: 'newest-series', title: 'New Seasons', eyebrow: 'Series', shape: 'poster',
    tvParams: { sort: 'first_air_date.desc' } },
  { key: 'grossing', title: 'Biggest at the Box Office', eyebrow: 'Films', shape: 'poster',
    movieParams: { sort: 'revenue.desc' } },
];

/**
 * A catalog rail as the screen receives it: the `RailModel` it draws, plus the catalog row
 * behind its first card.
 *
 * `RailModel` is a view model and carries only what a card draws. The home hero needs more
 * of the same title (its backdrop and its overview), which a `CardItem` does not hold. `lead`
 * hands that source row through, so the screen does not have to look the title up again: a
 * title-detail call is a TMDB request and then a torrent search (see continueWatching.ts).
 */
export interface CatalogRail extends RailModel {
  /** The row `items[0]` was built from; null for an empty rail. */
  lead: CatalogItem | null;
}

/**
 * A longer rail is just more D-pad presses to cross. Shared with My List, which would
 * otherwise be 150 anchors for a 150-title watchlist.
 */
export const RAIL_CAP = 20;

export function catalogItemToCard(item: CatalogItem, shape: 'poster' | 'wide'): CardItem {
  return {
    // media_type is in the id because a movie and a show can share a tmdb id.
    id: `${item.media_type}:${item.tmdb_id}`,
    // These routes arrive in stage 6; a card that navigates to a not-yet-existing
    // route is correct now and complete then.
    href:
      item.media_type === 'tv'
        ? `/bigscreen/show/${item.tmdb_id}`
        : `/bigscreen/movie/${item.tmdb_id}`,
    // CatalogItem always has `title`, even for shows (it is ShowDetail that uses `name`).
    title: item.title,
    subtitle: item.year ? String(item.year) : null,
    // Absolute URLs already, or null.
    artUrl: shape === 'wide' ? item.backdrop_url : item.poster_url,
  };
}

/**
 * THE ONE STATEMENT of "this row can become a card that goes somewhere", in terms of the two
 * fields `catalogItemToCard` builds an href out of. Everything on this surface that turns a
 * row into a card goes through it: the rails here, the search results, and the watchlist
 * (which reaches it with a `Number()`-converted string id, so it takes the values rather than
 * the row). The rule was stated three times at three different strictnesses before this, and
 * the weakest statement was the one a "dedupe these" refactor would have reached for.
 *
 * - **`tmdb_id` must be a positive whole number.** The arrays come off the wire, so a null
 *   element or an id that is not a number is possible at runtime whatever the types say, and
 *   `catalogItemToCard` would interpolate it into `/bigscreen/movie/NaN`. `0` and negatives
 *   are not TMDB ids either, and `/bigscreen/movie/0` 404s just as surely.
 *
 * - **`media_type` must be exactly `movie` or `tv`, because that is what picks the ROUTE.**
 *   `catalogItemToCard` sends anything that is not exactly `'tv'` to
 *   `/bigscreen/movie/{tmdb_id}`, so a row of some other kind becomes a card the viewer
 *   presses that dead-ends on a 404 — the stage-4 Critical's exact shape.
 *
 * WHY THAT SECOND CLAUSE IS LATENT ON THE RAILS PATH, stated correctly because the comment it
 * replaces was wrong in the dangerous direction. The old argument was that "a rail fetches
 * the movie endpoint and the tv endpoint separately, so each half's `media_type` is implied
 * by which call returned it". `toRail` does not work that way: `catalogItemToCard` reads
 * `item.media_type` off the **row**, not off which of the two array arguments it arrived in,
 * so a wrong-kind row in the `shows` half is routed by the field and nothing here would
 * object. The real safety is on the **backend**: `backend/app/providers/catalog.py`'s
 * `normalize_item` sets `media_type="tv" if media_type == "tv" else "movie"` from the
 * endpoint's own hardcoded `mode`, so a catalog row is always one of the two. That is also
 * the proof that strengthening this guard drops nothing legitimate — pinned by a test — and
 * it is why the clause is cheap to keep here even though only search, where the two halves
 * merge into one list, can see it fire.
 *
 * Note what it still cannot catch: a row whose kind is the *other* valid one (a `'movie'` row
 * in the shows half) is usable, and routes by its field. Only the backend's normalisation
 * prevents that, and `journeys.test.tsx` pins the mechanism.
 */
export function usableCardIdentity(tmdbId: unknown, mediaType: unknown): boolean {
  if (!Number.isInteger(tmdbId) || (tmdbId as number) <= 0) return false;
  return mediaType === 'movie' || mediaType === 'tv';
}

/** `usableCardIdentity` for a catalog row. A bad row costs itself, not the rail. */
export function usableCatalogRow(item: CatalogItem | null | undefined): item is CatalogItem {
  return !!item && usableCardIdentity(item.tmdb_id, item.media_type);
}

/**
 * Interleave the two halves (movie, show, movie, show, ...) and cap the rail. When one
 * half is shorter, the other carries on alone rather than being cut to match.
 *
 * `loading` is an explicit `false`, not an omitted key: a screen that merges a result
 * over a loading placeholder with `{ ...placeholder, ...result }` would otherwise keep
 * `loading: true`, and `railCellCount` would report 0 focusable cells for a full rail.
 */
export function toRail(spec: TvRailSpec, movies: CatalogItem[], shows: CatalogItem[]): CatalogRail {
  // Unusable rows go BEFORE the interleave, so a bad row does not shift the alternation.
  const [m, t] = [movies.filter(usableCatalogRow), shows.filter(usableCatalogRow)];
  const mixed: CatalogItem[] = [];
  const longest = Math.max(m.length, t.length);
  for (let i = 0; i < longest; i++) {
    if (i < m.length) mixed.push(m[i]);
    if (i < t.length) mixed.push(t[i]);
  }
  const shown = mixed.slice(0, RAIL_CAP);
  return {
    key: spec.key,
    title: spec.title,
    eyebrow: spec.eyebrow,
    shape: spec.shape,
    items: shown.map((item) => catalogItemToCard(item, spec.shape)),
    loading: false,
    lead: shown[0] ?? null,
  };
}

/**
 * One half of a rail, already failure-tolerant: a rejection, a synchronous throw, or a
 * 200 with no `results` array is an empty half, never an error, so the other half still
 * renders. The call is made synchronously, so both halves are in flight together.
 */
async function half(call: (() => Promise<CatalogPage>) | null): Promise<CatalogItem[]> {
  if (!call) return [];
  try {
    const page = await call();
    return Array.isArray(page?.results) ? page.results : [];
  } catch {
    return [];
  }
}

/**
 * One rail's two calls, concurrent. Never rejects: if BOTH halves fail, or anything
 * after them throws, the rail comes back empty, and `Rail` removes an empty rail rather
 * than drawing a hole.
 */
export async function fetchRail(spec: TvRailSpec): Promise<CatalogRail> {
  try {
    const { movieParams, tvParams } = spec;
    const [movies, shows] = await Promise.all([
      half(movieParams ? () => moviesService.browse(movieParams) : null),
      half(tvParams ? () => tvService.browse(tvParams) : null),
    ]);
    return toRail(spec, movies, shows);
  } catch {
    return toRail(spec, [], []);
  }
}
