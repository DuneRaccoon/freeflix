import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomeBrowse from './HomeBrowse';

const mockWatchlistItems: Array<{
  id: string; user_id: string; content_id: string; tmdb_id: string;
  media_type: 'movie' | 'tv'; title: string; added_at: string; created_at: string;
}> = [];
vi.mock('@/context/WatchlistContext', () => ({
  useWatchlist: () => ({ items: mockWatchlistItems }),
}));

vi.mock('@/context/UserContext', () => ({ useUser: () => ({ currentUser: { id: 'u1' } }) }));
vi.mock('@/services/rails', () => ({ railsService: { getRails: vi.fn() } }));
vi.mock('@/services/movies', () => ({ moviesService: { browse: vi.fn() } }));
vi.mock('@/services/tv', () => ({ tvService: { browse: vi.fn() } }));
vi.mock('@/components/browse/BrowseScreen', () => ({
  default: ({ hero, rows }: { hero?: { title: string }; rows: Array<{ title: string; items?: unknown[] }> }) => (
    <div data-testid="mock-browse-screen">
      {hero && <h1 data-testid="mock-hero-title">{hero.title}</h1>}
      {rows.map((r) => (
        <h2 key={r.title} data-testid="mock-row-title" data-count={(r.items ?? []).length}>{r.title}</h2>
      ))}
    </div>
  ),
}));

import { railsService } from '@/services/rails';
import { moviesService } from '@/services/movies';

function item(id: number, title: string) {
  return { tmdb_id: id, media_type: 'movie' as const, title, year: 2024, overview: '',
    poster_url: null, backdrop_url: null, genre_ids: [], genres: [], vote_average: 0,
    vote_count: 0, popularity: 0, original_language: 'en' };
}
const page = (items: ReturnType<typeof item>[]) => ({ page: 1, results: items, total_pages: 1, total_results: items.length });

beforeEach(() => {
  vi.clearAllMocks();
  mockWatchlistItems.length = 0;
  (railsService.getRails as ReturnType<typeof vi.fn>).mockResolvedValue([
    { key: 'trending', title: 'Trending Movies', params: { api: 'popular' }, see_all_href: '/movies' },
    { key: 'genre-28', title: 'Action', eyebrow: 'Genre', params: { genres: '28' } },
  ]);
  (moviesService.browse as ReturnType<typeof vi.fn>).mockImplementation((p: { api?: string; genres?: string }) => {
    if (p.genres === '28') return Promise.resolve(page([item(301, 'Action Flick')]));
    return Promise.resolve(page([item(1, 'Popular Hero Movie'), item(2, 'Feat A')]));
  });
});

describe('HomeBrowse', () => {
  it('renders the BrowseScreen once data loads', async () => {
    render(<HomeBrowse />);
    await screen.findByTestId('mock-browse-screen');
  });

  it('asks the planner for movie rails with the active profile + surface home', async () => {
    render(<HomeBrowse />);
    await screen.findByTestId('mock-browse-screen');
    expect(railsService.getRails).toHaveBeenCalledWith('movie', 'u1', 'home');
  });

  it('passes the first popular item as the hero', async () => {
    render(<HomeBrowse />);
    const hero = await screen.findByTestId('mock-hero-title');
    expect(hero).toHaveTextContent('Popular Hero Movie');
  });

  it('renders planner-driven row titles', async () => {
    render(<HomeBrowse />);
    const titles = (await screen.findAllByTestId('mock-row-title')).map((e) => e.textContent);
    expect(titles).toContain('Trending Movies');
    expect(titles).toContain('Action');
  });

  it('falls back to default rails when the planner fails', async () => {
    (railsService.getRails as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    render(<HomeBrowse />);
    const titles = (await screen.findAllByTestId('mock-row-title')).map((e) => e.textContent);
    expect(titles).toContain('Trending Movies');
  });

  it('shows the home skeleton during loading', async () => {
    let resolveAll!: () => void;
    const gate = new Promise<void>((res) => { resolveAll = res; });
    (moviesService.browse as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await gate;
      return page([item(1, 'Popular Hero Movie')]);
    });
    render(<HomeBrowse />);
    expect(screen.getByTestId('home-skeleton')).toBeInTheDocument();
    resolveAll();
    await screen.findByTestId('mock-browse-screen');
  });

  it('injects a "My List" row after the first rail when the watchlist has items', async () => {
    mockWatchlistItems.push(
      { id: 'w1', user_id: 'u1', content_id: 'movie:1', tmdb_id: '1', media_type: 'movie', title: 'Saved', added_at: '', created_at: '' },
    );
    render(<HomeBrowse />);
    const titles = (await screen.findAllByTestId('mock-row-title')).map((e) => e.textContent);
    expect(titles).toContain('My List');
    expect(titles[1]).toBe('My List');
  });

  it('includes both movies and tv in the Home My List row', async () => {
    mockWatchlistItems.push(
      { id: 'w1', user_id: 'u1', content_id: 'movie:1', tmdb_id: '1', media_type: 'movie', title: 'M', added_at: '', created_at: '' },
      { id: 'w2', user_id: 'u1', content_id: 'tv:2', tmdb_id: '2', media_type: 'tv', title: 'T', added_at: '', created_at: '' },
    );
    render(<HomeBrowse />);
    const myList = (await screen.findAllByTestId('mock-row-title')).find((e) => e.textContent === 'My List')!;
    expect(myList.getAttribute('data-count')).toBe('2');
  });
});
