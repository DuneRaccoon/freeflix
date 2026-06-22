import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SeriesBrowse from './SeriesBrowse';

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
import { tvService } from '@/services/tv';

function item(id: number, title: string) {
  return { tmdb_id: id, media_type: 'tv' as const, title, year: 2024, overview: '',
    poster_url: null, backdrop_url: null, genre_ids: [], genres: [], vote_average: 0,
    vote_count: 0, popularity: 0, original_language: 'en' };
}
const page = (items: ReturnType<typeof item>[]) => ({ page: 1, results: items, total_pages: 1, total_results: items.length });

beforeEach(() => {
  vi.clearAllMocks();
  (railsService.getRails as ReturnType<typeof vi.fn>).mockResolvedValue([
    { key: 'trending', title: 'Trending Series', params: { api: 'popular' }, see_all_href: '/tv' },
    { key: 'top-rated', title: 'Top Rated Series', eyebrow: 'Critically acclaimed', variant: 'ranked', params: { api: 'top_rated' } },
  ]);
  (tvService.browse as ReturnType<typeof vi.fn>).mockImplementation((p: { api?: string; genres?: string }) => {
    if (p.api === 'top_rated') return Promise.resolve(page([item(201, 'Top Rated Show')]));
    return Promise.resolve(page([item(1, 'Popular Hero Show'), item(2, 'Feat Show A')]));
  });
});

describe('SeriesBrowse', () => {
  it('renders the BrowseScreen once data loads', async () => {
    render(<SeriesBrowse />);
    await screen.findByTestId('mock-browse-screen');
  });

  it('asks the planner for tv rails with the active profile + surface tv', async () => {
    render(<SeriesBrowse />);
    await screen.findByTestId('mock-browse-screen');
    expect(railsService.getRails).toHaveBeenCalledWith('tv', 'u1', 'tv');
  });

  it('passes the first popular item as the hero', async () => {
    render(<SeriesBrowse />);
    const hero = await screen.findByTestId('mock-hero-title');
    expect(hero).toHaveTextContent('Popular Hero Show');
  });

  it('renders planner-driven row titles ending in Series', async () => {
    render(<SeriesBrowse />);
    const titles = (await screen.findAllByTestId('mock-row-title')).map((e) => e.textContent);
    expect(titles).toContain('Trending Series');
    expect(titles).toContain('Top Rated Series');
  });

  it('falls back to default rails when the planner fails', async () => {
    (railsService.getRails as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    render(<SeriesBrowse />);
    const titles = (await screen.findAllByTestId('mock-row-title')).map((e) => e.textContent);
    expect(titles).toContain('Trending Series');
  });

  it('shows the series skeleton during loading', async () => {
    let resolveAll!: () => void;
    const gate = new Promise<void>((res) => { resolveAll = res; });
    (tvService.browse as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await gate;
      return page([item(1, 'Popular Hero Show')]);
    });
    render(<SeriesBrowse />);
    expect(screen.getByTestId('series-skeleton')).toBeInTheDocument();
    resolveAll();
    await screen.findByTestId('mock-browse-screen');
  });
});
