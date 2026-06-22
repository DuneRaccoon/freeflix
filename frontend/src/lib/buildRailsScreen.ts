import { CatalogItem, CatalogPage } from '@/types';
import { RowConfig } from '@/components/browse/BrowseScreen';
import { railsService, RailSpec } from '@/services/rails';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { feedIdentityFromParams, feedIdentityFromKey } from '@/lib/feedThemes';

const emptyPage: CatalogPage = { page: 1, results: [], total_pages: 0, total_results: 0 };

export interface RailsScreen {
  hero?: CatalogItem;
  featured: CatalogItem[];
  rows: RowConfig[];
}

function defaultRails(mode: 'movie' | 'tv'): RailSpec[] {
  const noun = mode === 'tv' ? 'Series' : 'Movies';
  const href = mode === 'tv' ? '/tv' : '/movies';
  return [
    { key: 'trending', title: `Trending ${noun}`, params: { api: 'popular' }, see_all_href: href },
    { key: 'top-rated', title: `Top Rated ${noun}`, eyebrow: 'Critically acclaimed', variant: 'ranked', params: { api: 'top_rated' } },
    { key: 'new', title: 'New Releases', params: { api: 'popular', sort: 'primary_release_date.desc' } },
    { key: 'genre-28', title: 'Action', eyebrow: 'Genre', params: { genres: '28' } },
    { key: 'genre-18', title: 'Drama', eyebrow: 'Genre', params: { genres: '18' } },
  ];
}

export async function buildRailsScreen(
  mode: 'movie' | 'tv',
  userId?: string,
  surface?: string,
): Promise<RailsScreen> {
  const browse = mode === 'tv' ? tvService.browse : moviesService.browse;

  let rails: RailSpec[];
  try {
    rails = await railsService.getRails(mode, userId, surface);
    if (rails.length === 0) rails = defaultRails(mode);
  } catch {
    rails = defaultRails(mode);
  }

  const pages = await Promise.all(rails.map((r) => browse(r.params).catch(() => emptyPage)));

  // Hero/featured come from the first popular-feed rail (fallback: first rail).
  const heroIdx = Math.max(0, rails.findIndex((r) => r.params.api === 'popular'));
  const heroPage = pages[heroIdx] ?? emptyPage;

  const rows: RowConfig[] = rails.map((r, i) => ({
    key: r.key,
    title: r.title,
    eyebrow: r.eyebrow,
    variant: r.variant,
    seeAllHref: r.see_all_href,
    items: pages[i].results,
    feed: feedIdentityFromParams(r.params) ?? feedIdentityFromKey(r.key),
  }));

  return {
    hero: heroPage.results[0],
    featured: heroPage.results.slice(1, 7),
    rows,
  };
}
