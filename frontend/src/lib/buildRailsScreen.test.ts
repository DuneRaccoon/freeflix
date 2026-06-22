import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/rails', () => ({ railsService: { getRails: vi.fn() } }));
vi.mock('@/services/movies', () => ({ moviesService: { browse: vi.fn() } }));
vi.mock('@/services/tv', () => ({ tvService: { browse: vi.fn() } }));

import { railsService } from '@/services/rails';
import { moviesService } from '@/services/movies';
import { buildRailsScreen } from './buildRailsScreen';

function item(id: number, title: string) {
  return { tmdb_id: id, media_type: 'movie' as const, title, year: 2024, overview: '',
    poster_url: null, backdrop_url: null, genre_ids: [], genres: [], vote_average: 0,
    vote_count: 0, popularity: 0, original_language: 'en' };
}
const page = (items: ReturnType<typeof item>[]) => ({ page: 1, results: items, total_pages: 1, total_results: items.length });

beforeEach(() => {
  vi.clearAllMocks();
  (railsService.getRails as ReturnType<typeof vi.fn>).mockResolvedValue([
    { key: 'trending', title: 'Trending Movies', params: { api: 'popular' }, see_all_href: '/movies' },
    { key: 'genre-28', title: 'Action', eyebrow: 'Genre', params: { genres: '28' } },
  ]);
  (moviesService.browse as ReturnType<typeof vi.fn>).mockImplementation((p: { api?: string; genres?: string }) => {
    if (p.genres === '28') return Promise.resolve(page([item(301, 'Action Flick')]));
    return Promise.resolve(page([item(1, 'Hero'), item(2, 'Feat A')]));
  });
});

describe('buildRailsScreen', () => {
  it('maps planner rails to rows and derives hero/featured from the popular rail', async () => {
    const screen = await buildRailsScreen('movie', 'u1', 'movies');
    expect(railsService.getRails).toHaveBeenCalledWith('movie', 'u1', 'movies');
    expect(screen.hero?.title).toBe('Hero');
    expect(screen.featured.map((i) => i.title)).toEqual(['Feat A']);
    expect(screen.rows.map((r) => r.title)).toEqual(['Trending Movies', 'Action']);
    expect(screen.rows[1].items[0].title).toBe('Action Flick');
  });

  it('falls back to default rails when the planner fails', async () => {
    (railsService.getRails as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    const screen = await buildRailsScreen('movie');
    expect(screen.rows.length).toBeGreaterThan(0);
    expect(screen.rows[0].title).toBe('Trending Movies');
  });
});
