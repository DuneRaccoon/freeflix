import type { BrowseParams, CatalogItem, CatalogPage } from '@/types';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
// Type-only, so erased at build. Spelled with the `@/app/...` alias rather than
// `../_components/...` because the guard in legacy-target.test.ts rejects any relative
// specifier containing both `..` and `components/`, and `_components/` is a substring
// match for it. This directory is the TV's own, not the web's component tree.
import type { CardItem } from '@/app/(bigscreen)/_components/Card';
import type { RailModel } from '@/app/(bigscreen)/_components/Rail';

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

/** A longer rail is just more D-pad presses to cross. */
const RAIL_CAP = 20;

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
 * Interleave the two halves (movie, show, movie, show, ...) and cap the rail. When one
 * half is shorter, the other carries on alone rather than being cut to match.
 */
export function toRail(spec: TvRailSpec, movies: CatalogItem[], shows: CatalogItem[]): RailModel {
  const mixed: CatalogItem[] = [];
  const longest = Math.max(movies.length, shows.length);
  for (let i = 0; i < longest; i++) {
    if (i < movies.length) mixed.push(movies[i]);
    if (i < shows.length) mixed.push(shows[i]);
  }
  return {
    key: spec.key,
    title: spec.title,
    eyebrow: spec.eyebrow,
    shape: spec.shape,
    items: mixed.slice(0, RAIL_CAP).map((item) => catalogItemToCard(item, spec.shape)),
  };
}

/**
 * One half of a rail, already failure-tolerant: a rejection (or a 200 with no `results`)
 * is an empty half, never an error, so the other half still renders.
 */
function half(call: Promise<CatalogPage> | null): Promise<CatalogItem[]> {
  if (!call) return Promise.resolve([]);
  return call.then(
    (page) => page?.results ?? [],
    () => [],
  );
}

/**
 * One rail's two calls, concurrent. Never rejects. If BOTH halves fail the rail comes
 * back empty, and `Rail` removes an empty rail rather than drawing a hole.
 */
export async function fetchRail(spec: TvRailSpec): Promise<RailModel> {
  const [movies, shows] = await Promise.all([
    half(spec.movieParams ? moviesService.browse(spec.movieParams) : null),
    half(spec.tvParams ? tvService.browse(spec.tvParams) : null),
  ]);
  return toRail(spec, movies, shows);
}
