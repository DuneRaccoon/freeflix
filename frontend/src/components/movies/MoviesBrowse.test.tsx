/**
 * MoviesBrowse — Vitest + RTL tests
 *
 * Spec (Task 10):
 *  - mocks moviesService.browse to resolve catalog pages
 *  - asserts the hero + row titles render (use findBy* for async fetch)
 *  - no act warnings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MoviesBrowse from './MoviesBrowse';

// ---------------------------------------------------------------------------
// Mock moviesService so tests don't make real HTTP requests
// ---------------------------------------------------------------------------

vi.mock('@/services/movies', () => ({
  moviesService: {
    browse: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock BrowseScreen to keep tests focused on MoviesBrowse fetch/compose logic
// ---------------------------------------------------------------------------

vi.mock('@/components/browse/BrowseScreen', () => ({
  default: ({
    hero,
    rows,
  }: {
    hero?: { title: string };
    rows: Array<{ title: string }>;
  }) => (
    <div data-testid="mock-browse-screen">
      {hero && <h1 data-testid="mock-hero-title">{hero.title}</h1>}
      {rows.map((row) => (
        <h2 key={row.title} data-testid="mock-row-title">
          {row.title}
        </h2>
      ))}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { moviesService } from '@/services/movies';

function makeCatalogItem(id: number, title: string) {
  return {
    tmdb_id: id,
    media_type: 'movie' as const,
    title,
    year: 2024,
    overview: `Overview for ${title}`,
    poster_url: `https://image.tmdb.org/t/p/w500/poster-${id}.jpg`,
    backdrop_url: `https://image.tmdb.org/t/p/w1280/backdrop-${id}.jpg`,
    genre_ids: [28],
    genres: ['Action'],
    vote_average: 7.5,
    vote_count: 1000,
    popularity: 100,
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
  makeCatalogItem(1, 'Popular Hero Movie'),
  makeCatalogItem(2, 'Featured Film A'),
  makeCatalogItem(3, 'Featured Film B'),
  makeCatalogItem(4, 'Featured Film C'),
  makeCatalogItem(5, 'Trending Film D'),
  makeCatalogItem(6, 'Trending Film E'),
  makeCatalogItem(7, 'Trending Film F'),
];

const topRatedItems = Array.from({ length: 10 }, (_, i) =>
  makeCatalogItem(200 + i, `Top Rated ${i + 1}`),
);

const latestItems = [
  makeCatalogItem(101, 'New Release One'),
  makeCatalogItem(102, 'New Release Two'),
];

const actionItems = [makeCatalogItem(301, 'Action Flick')];
const dramaItems = [makeCatalogItem(401, 'Drama Film')];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Return different pages based on the params passed to browse()
  (moviesService.browse as ReturnType<typeof vi.fn>).mockImplementation(
    (params: { api?: string; sort?: string; genre?: number }) => {
      if (params.genre === 28) return Promise.resolve(makeCatalogPage(actionItems));
      if (params.genre === 18) return Promise.resolve(makeCatalogPage(dramaItems));
      if (params.sort === 'primary_release_date.desc')
        return Promise.resolve(makeCatalogPage(latestItems));
      if (params.api === 'top_rated')
        return Promise.resolve(makeCatalogPage(topRatedItems));
      // Default: popular
      return Promise.resolve(makeCatalogPage(popularItems));
    },
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MoviesBrowse', () => {
  it('shows the skeleton initially (synchronous render with pending data)', async () => {
    // Delay all browse calls so the skeleton is visible on first render.
    let resolveAll!: () => void;
    const gate = new Promise<void>((res) => {
      resolveAll = res;
    });

    (moviesService.browse as ReturnType<typeof vi.fn>).mockImplementation(
      async (params: { api?: string; sort?: string; genre?: number }) => {
        await gate;
        if (params.genre === 28) return makeCatalogPage(actionItems);
        if (params.genre === 18) return makeCatalogPage(dramaItems);
        if (params.sort === 'primary_release_date.desc') return makeCatalogPage(latestItems);
        if (params.api === 'top_rated') return makeCatalogPage(topRatedItems);
        return makeCatalogPage(popularItems);
      },
    );

    render(<MoviesBrowse />);
    // Before any fetch completes, the skeleton should be present.
    expect(screen.getByTestId('movies-skeleton')).toBeInTheDocument();

    // Open the gate and wait for the full-page render.
    resolveAll();
    await screen.findByTestId('mock-browse-screen');
  });

  it('renders the BrowseScreen once data loads', async () => {
    render(<MoviesBrowse />);
    await screen.findByTestId('mock-browse-screen');
  });

  it('passes the first popular item as the hero', async () => {
    render(<MoviesBrowse />);
    const heroTitle = await screen.findByTestId('mock-hero-title');
    expect(heroTitle).toHaveTextContent('Popular Hero Movie');
  });

  it('renders the "Trending Movies" row title', async () => {
    render(<MoviesBrowse />);
    const rowTitles = await screen.findAllByTestId('mock-row-title');
    const titles = rowTitles.map((el) => el.textContent);
    expect(titles).toContain('Trending Movies');
  });

  it('renders the "Top Rated Movies" ranked row title', async () => {
    render(<MoviesBrowse />);
    const rowTitles = await screen.findAllByTestId('mock-row-title');
    const titles = rowTitles.map((el) => el.textContent);
    expect(titles).toContain('Top Rated Movies');
  });

  it('renders the "New Releases" row title', async () => {
    render(<MoviesBrowse />);
    const rowTitles = await screen.findAllByTestId('mock-row-title');
    const titles = rowTitles.map((el) => el.textContent);
    expect(titles).toContain('New Releases');
  });

  it('renders genre row titles (Action & Adventure, Drama)', async () => {
    render(<MoviesBrowse />);
    const rowTitles = await screen.findAllByTestId('mock-row-title');
    const titles = rowTitles.map((el) => el.textContent);
    expect(titles).toContain('Action & Adventure');
    expect(titles).toContain('Drama');
  });

  it('calls moviesService.browse 5 times (popular, top_rated, latest, action, drama)', async () => {
    render(<MoviesBrowse />);
    await screen.findByTestId('mock-browse-screen');
    expect(moviesService.browse).toHaveBeenCalledTimes(5);
  });

  it('degrades gracefully when a browse call rejects', async () => {
    // Make the action genre call fail; others succeed.
    (moviesService.browse as ReturnType<typeof vi.fn>).mockImplementation(
      (params: { api?: string; sort?: string; genre?: number }) => {
        if (params.genre === 28) return Promise.reject(new Error('Network error'));
        if (params.genre === 18) return Promise.resolve(makeCatalogPage(dramaItems));
        if (params.sort === 'primary_release_date.desc')
          return Promise.resolve(makeCatalogPage(latestItems));
        if (params.api === 'top_rated')
          return Promise.resolve(makeCatalogPage(topRatedItems));
        return Promise.resolve(makeCatalogPage(popularItems));
      },
    );

    render(<MoviesBrowse />);
    // Should still render successfully — the failed row is just empty (filtered by BrowseScreen)
    await screen.findByTestId('mock-browse-screen');
    // Hero still loads from popular
    const heroTitle = screen.getByTestId('mock-hero-title');
    expect(heroTitle).toHaveTextContent('Popular Hero Movie');
  });
});
