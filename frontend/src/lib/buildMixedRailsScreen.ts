import { BrowseParams } from '@/types';

export interface MixedRailSpec {
  key: string;
  title: string;
  eyebrow?: string;
  variant?: 'poster' | 'ranked';
  movieParams: BrowseParams;
  tvParams: BrowseParams;
}

/**
 * Home-page rail set. Titles are noun-free ("Movies"/"Series" omitted) because
 * each rail blends both media types. TMDB genre IDs differ between movies and
 * TV, so every rail carries the correct id for each side (e.g. Action is movie
 * genre 28 but tv genre 10759). This table is the single source of truth.
 */
export const MIXED_RAILS: MixedRailSpec[] = [
  {
    key: 'trending',
    title: 'Trending This Week',
    movieParams: { api: 'popular' },
    tvParams: { api: 'popular' },
  },
  {
    key: 'top-rated',
    title: 'Top Rated',
    eyebrow: 'Critically acclaimed',
    variant: 'ranked',
    movieParams: { api: 'top_rated' },
    tvParams: { api: 'top_rated' },
  },
  {
    key: 'new',
    title: 'New Releases',
    movieParams: { api: 'popular', sort: 'primary_release_date.desc' },
    tvParams: { api: 'popular', sort: 'primary_release_date.desc' },
  },
  {
    key: 'genre-action',
    title: 'Action & Adventure',
    eyebrow: 'Genre',
    movieParams: { genres: '28' },
    tvParams: { genres: '10759' },
  },
  {
    key: 'genre-drama',
    title: 'Drama',
    eyebrow: 'Genre',
    movieParams: { genres: '18' },
    tvParams: { genres: '18' },
  },
  {
    key: 'genre-comedy',
    title: 'Comedy',
    eyebrow: 'Genre',
    movieParams: { genres: '35' },
    tvParams: { genres: '35' },
  },
  {
    key: 'genre-scifi',
    title: 'Sci-Fi & Fantasy',
    eyebrow: 'Genre',
    movieParams: { genres: '878' },
    tvParams: { genres: '10765' },
  },
  {
    key: 'genre-crime',
    title: 'Crime',
    eyebrow: 'Genre',
    movieParams: { genres: '80' },
    tvParams: { genres: '80' },
  },
];

/**
 * Interleave two lists, alternating a, b, a, b… starting with `a` (movies).
 * Stops at `cap` total items. When one list is shorter or empty, the remaining
 * items of the longer list follow in order — no gaps.
 */
export function interleave<T>(a: T[], b: T[], cap = 20): T[] {
  const out: T[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < cap; i++) {
    if (i < a.length && out.length < cap) out.push(a[i]);
    if (i < b.length && out.length < cap) out.push(b[i]);
  }
  return out;
}
