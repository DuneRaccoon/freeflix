/**
 * SeriesBrowse — Vitest + RTL tests
 *
 * Spec (Task 11):
 *  - mocks tvService.browse to resolve catalog pages
 *  - asserts the hero + row titles render (use findBy* for async fetch)
 *  - asserts a PosterCard links to /tv/{id}
 *  - no act warnings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SeriesBrowse from './SeriesBrowse';

// ---------------------------------------------------------------------------
// Mock tvService so tests don't make real HTTP requests
// ---------------------------------------------------------------------------

vi.mock('@/services/tv', () => ({
  tvService: {
    browse: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock BrowseScreen to keep tests focused on SeriesBrowse fetch/compose logic.
// The mock renders the hero title, row titles, and a sample PosterCard link
// so we can assert the correct /tv/{id} href.
// ---------------------------------------------------------------------------

vi.mock('@/components/browse/BrowseScreen', () => ({
  default: ({
    hero,
    rows,
  }: {
    hero?: { title: string; tmdb_id: number; media_type: string };
    rows: Array<{ title: string; items: Array<{ tmdb_id: number; media_type: string; title: string }> }>;
  }) => (
    <div data-testid="mock-browse-screen">
      {hero && <h1 data-testid="mock-hero-title">{hero.title}</h1>}
      {rows.map((row) => (
        <div key={row.title}>
          <h2 data-testid="mock-row-title">{row.title}</h2>
          {row.items.slice(0, 1).map((item) => (
            <a
              key={item.tmdb_id}
              data-testid="mock-poster-card-link"
              href={`/${item.media_type === 'tv' ? 'tv' : 'movies'}/${item.tmdb_id}`}
            >
              {item.title}
            </a>
          ))}
        </div>
      ))}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { tvService } from '@/services/tv';

function makeCatalogItem(id: number, title: string) {
  return {
    tmdb_id: id,
    media_type: 'tv' as const,
    title,
    year: 2024,
    overview: `Overview for ${title}`,
    poster_url: `https://image.tmdb.org/t/p/w500/poster-${id}.jpg`,
    backdrop_url: `https://image.tmdb.org/t/p/w1280/backdrop-${id}.jpg`,
    genre_ids: [10759],
    genres: ['Action & Adventure'],
    vote_average: 8.0,
    vote_count: 500,
    popularity: 200,
    original_language: 'en',
  };
}

function makeCatalogPage(items: ReturnType<typeof makeCatalogItem>[]) {
  return {
    page: 1,
    results: items,
    total_pages: 1,
    total_results: items.length,
  };
}

// Popular page: first item becomes the hero; items [1..6] become the featured rail
const popularItems = [
  makeCatalogItem(1, 'Popular Hero Show'),
  makeCatalogItem(2, 'Featured Show A'),
  makeCatalogItem(3, 'Featured Show B'),
  makeCatalogItem(4, 'Featured Show C'),
  makeCatalogItem(5, 'Trending Show D'),
  makeCatalogItem(6, 'Trending Show E'),
  makeCatalogItem(7, 'Trending Show F'),
];

const topRatedItems = Array.from({ length: 10 }, (_, i) =>
  makeCatalogItem(200 + i, `Top Rated ${i + 1}`),
);

const onTheAirItems = [
  makeCatalogItem(101, 'On The Air One'),
  makeCatalogItem(102, 'On The Air Two'),
];

const actionItems = [makeCatalogItem(301, 'Action Show')];
const sciFiItems = [makeCatalogItem(401, 'Sci-Fi Show')];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Return different pages based on the params passed to browse()
  (tvService.browse as ReturnType<typeof vi.fn>).mockImplementation(
    (params: { api?: string; sort?: string; genre?: number }) => {
      if (params.genre === 10759) return Promise.resolve(makeCatalogPage(actionItems));
      if (params.genre === 10765) return Promise.resolve(makeCatalogPage(sciFiItems));
      if (params.api === 'on_the_air') return Promise.resolve(makeCatalogPage(onTheAirItems));
      if (params.api === 'top_rated') return Promise.resolve(makeCatalogPage(topRatedItems));
      // Default: popular
      return Promise.resolve(makeCatalogPage(popularItems));
    },
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SeriesBrowse', () => {
  it('shows the skeleton initially (synchronous render with pending data)', async () => {
    // Delay all browse calls so the skeleton is visible on first render.
    let resolveAll!: () => void;
    const gate = new Promise<void>((res) => {
      resolveAll = res;
    });

    (tvService.browse as ReturnType<typeof vi.fn>).mockImplementation(
      async (params: { api?: string; sort?: string; genre?: number }) => {
        await gate;
        if (params.genre === 10759) return makeCatalogPage(actionItems);
        if (params.genre === 10765) return makeCatalogPage(sciFiItems);
        if (params.api === 'on_the_air') return makeCatalogPage(onTheAirItems);
        if (params.api === 'top_rated') return makeCatalogPage(topRatedItems);
        return makeCatalogPage(popularItems);
      },
    );

    render(<SeriesBrowse />);
    // Before any fetch completes, the skeleton should be present.
    expect(screen.getByTestId('series-skeleton')).toBeInTheDocument();

    // Open the gate and wait for the full-page render.
    resolveAll();
    await screen.findByTestId('mock-browse-screen');
  });

  it('renders the BrowseScreen once data loads', async () => {
    render(<SeriesBrowse />);
    await screen.findByTestId('mock-browse-screen');
  });

  it('passes the first popular item as the hero', async () => {
    render(<SeriesBrowse />);
    const heroTitle = await screen.findByTestId('mock-hero-title');
    expect(heroTitle).toHaveTextContent('Popular Hero Show');
  });

  it('renders the "Trending Series" row title', async () => {
    render(<SeriesBrowse />);
    const rowTitles = await screen.findAllByTestId('mock-row-title');
    const titles = rowTitles.map((el) => el.textContent);
    expect(titles).toContain('Trending Series');
  });

  it('renders the "Top Rated Series" ranked row title', async () => {
    render(<SeriesBrowse />);
    const rowTitles = await screen.findAllByTestId('mock-row-title');
    const titles = rowTitles.map((el) => el.textContent);
    expect(titles).toContain('Top Rated Series');
  });

  it('renders the "On The Air" row title', async () => {
    render(<SeriesBrowse />);
    const rowTitles = await screen.findAllByTestId('mock-row-title');
    const titles = rowTitles.map((el) => el.textContent);
    expect(titles).toContain('On The Air');
  });

  it('renders genre row titles (Action & Adventure, Sci-Fi & Fantasy)', async () => {
    render(<SeriesBrowse />);
    const rowTitles = await screen.findAllByTestId('mock-row-title');
    const titles = rowTitles.map((el) => el.textContent);
    expect(titles).toContain('Action & Adventure');
    expect(titles).toContain('Sci-Fi & Fantasy');
  });

  it('calls tvService.browse 5 times (popular, top_rated, on_the_air, action, scifi)', async () => {
    render(<SeriesBrowse />);
    await screen.findByTestId('mock-browse-screen');
    expect(tvService.browse).toHaveBeenCalledTimes(5);
  });

  it('a PosterCard links to /tv/{id} (driven by media_type: tv)', async () => {
    render(<SeriesBrowse />);
    await screen.findByTestId('mock-browse-screen');

    // The mock renders an <a> for the first item of each row. The Trending row's
    // first item is popularItems[0] (tmdb_id: 1). Its media_type is 'tv'.
    const links = screen.getAllByTestId('mock-poster-card-link');
    // At least one link should point to /tv/{tmdb_id}
    const hrefs = links.map((el) => el.getAttribute('href'));
    expect(hrefs.some((href) => href?.startsWith('/tv/'))).toBe(true);
    // Verify specific format: /tv/1 for the hero/trending item
    expect(hrefs).toContain('/tv/1');
  });

  it('degrades gracefully when a browse call rejects', async () => {
    // Make the action genre call fail; others succeed.
    (tvService.browse as ReturnType<typeof vi.fn>).mockImplementation(
      (params: { api?: string; sort?: string; genre?: number }) => {
        if (params.genre === 10759) return Promise.reject(new Error('Network error'));
        if (params.genre === 10765) return Promise.resolve(makeCatalogPage(sciFiItems));
        if (params.api === 'on_the_air') return Promise.resolve(makeCatalogPage(onTheAirItems));
        if (params.api === 'top_rated') return Promise.resolve(makeCatalogPage(topRatedItems));
        return Promise.resolve(makeCatalogPage(popularItems));
      },
    );

    render(<SeriesBrowse />);
    // Should still render successfully — the failed row is just empty (filtered by BrowseScreen)
    await screen.findByTestId('mock-browse-screen');
    // Hero still loads from popular
    const heroTitle = screen.getByTestId('mock-hero-title');
    expect(heroTitle).toHaveTextContent('Popular Hero Show');
  });
});
