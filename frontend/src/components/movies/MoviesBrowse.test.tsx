import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MoviesBrowse from './MoviesBrowse';

vi.mock('@/context/UserContext', () => ({ useUser: () => ({ currentUser: { id: 'u1' } }) }));
vi.mock('@/services/rails', () => ({ railsService: { getRails: vi.fn() } }));
vi.mock('@/services/movies', () => ({ moviesService: { browse: vi.fn() } }));
vi.mock('@/services/tv', () => ({ tvService: { browse: vi.fn() } }));
vi.mock('@/components/browse/BrowseScreen', () => ({
  default: ({ hero, rows }: { hero?: { title: string }; rows: Array<{ title: string }> }) => (
    <div data-testid="mock-browse-screen">
      {hero && <h1 data-testid="mock-hero-title">{hero.title}</h1>}
      {rows.map((r) => (<h2 key={r.title} data-testid="mock-row-title">{r.title}</h2>))}
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
  (railsService.getRails as ReturnType<typeof vi.fn>).mockResolvedValue([
    { key: 'trending', title: 'Trending Movies', params: { api: 'popular' }, see_all_href: '/movies' },
    { key: 'genre-28', title: 'Action', eyebrow: 'Genre', params: { genres: '28' } },
  ]);
  (moviesService.browse as ReturnType<typeof vi.fn>).mockImplementation((p: { api?: string; genres?: string }) => {
    if (p.genres === '28') return Promise.resolve(page([item(301, 'Action Flick')]));
    return Promise.resolve(page([item(1, 'Popular Hero Movie'), item(2, 'Feat A')]));
  });
});

describe('MoviesBrowse', () => {
  it('renders the BrowseScreen once data loads', async () => {
    render(<MoviesBrowse />);
    await screen.findByTestId('mock-browse-screen');
  });

  it('asks the planner for movie rails with the active profile + surface', async () => {
    render(<MoviesBrowse />);
    await screen.findByTestId('mock-browse-screen');
    expect(railsService.getRails).toHaveBeenCalledWith('movie', 'u1', 'movies');
  });

  it('passes the first popular item as the hero', async () => {
    render(<MoviesBrowse />);
    const hero = await screen.findByTestId('mock-hero-title');
    expect(hero).toHaveTextContent('Popular Hero Movie');
  });

  it('renders planner-driven row titles', async () => {
    render(<MoviesBrowse />);
    const titles = (await screen.findAllByTestId('mock-row-title')).map((e) => e.textContent);
    expect(titles).toContain('Trending Movies');
    expect(titles).toContain('Action');
  });

  it('falls back to default rails when the planner fails', async () => {
    (railsService.getRails as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    render(<MoviesBrowse />);
    const titles = (await screen.findAllByTestId('mock-row-title')).map((e) => e.textContent);
    expect(titles).toContain('Trending Movies');
  });

  it('shows the movies skeleton during loading', async () => {
    let resolveAll!: () => void;
    const gate = new Promise<void>((res) => { resolveAll = res; });
    (moviesService.browse as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await gate;
      return page([item(1, 'Popular Hero Movie')]);
    });
    render(<MoviesBrowse />);
    expect(screen.getByTestId('movies-skeleton')).toBeInTheDocument();
    resolveAll();
    await screen.findByTestId('mock-browse-screen');
  });
});
