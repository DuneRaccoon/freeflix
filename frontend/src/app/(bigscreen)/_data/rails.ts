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
 * A row that can become a card that goes somewhere. The arrays come off the wire, so a
 * null element or an id that is not a number is possible at runtime whatever the types
 * say; such a row costs itself, not the rail.
 */
function isUsable(item: CatalogItem | null | undefined): item is CatalogItem {
  return !!item && Number.isInteger(item.tmdb_id);
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
  const [m, t] = [movies.filter(isUsable), shows.filter(isUsable)];
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
