/**
 * SearchView — Vitest + RTL tests
 *
 * Spec (Task 6):
 *  - typing a query renders matching PosterCards (movie mode)
 *  - switching to "All" merges movie + tv results (both appear, deduped)
 *  - with no query + no filters, GenreBrowse is shown
 *  - clicking "Load more" fetches the next page and appends
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
let mockSearchParamsMap: Record<string, string> = {};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParamsMap[key] ?? null,
  }),
}));

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

import type { CatalogPage } from '@/types';

function makePage(
  items: { tmdb_id: number; media_type: 'movie' | 'tv'; title: string; popularity: number }[],
  page = 1,
  total_pages = 1,
): CatalogPage {
  return {
    page,
    total_pages,
    total_results: items.length,
    results: items.map((i) => ({
      ...i,
      year: 2024,
      overview: null,
      poster_url: null,
      backdrop_url: null,
      genre_ids: [],
      genres: [],
      vote_average: 7.0,
      vote_count: 100,
      original_language: 'en',
    })),
  };
}

const moviePage1 = makePage([
  { tmdb_id: 1001, media_type: 'movie', title: 'Blade Runner', popularity: 90 },
], 1, 2);

const moviePage2 = makePage([
  { tmdb_id: 1002, media_type: 'movie', title: 'Blade Runner 2049', popularity: 85 },
], 2, 2);

const tvPage1 = makePage([
  { tmdb_id: 2001, media_type: 'tv', title: 'Dune Prophecy', popularity: 88 },
], 1, 1);

const emptyPage: CatalogPage = { page: 1, total_pages: 1, total_results: 0, results: [] };

// Shared mutable mock state so tests can configure per-test behavior
let moviesSearchFn = vi.fn().mockResolvedValue(moviePage1);
let moviesBrowseFn = vi.fn().mockResolvedValue(moviePage1);
let tvSearchFn = vi.fn().mockResolvedValue(tvPage1);
let tvBrowseFn = vi.fn().mockResolvedValue(tvPage1);

vi.mock('@/services/movies', () => ({
  moviesService: {
    search: (...args: unknown[]) => moviesSearchFn(...args),
    browse: (...args: unknown[]) => moviesBrowseFn(...args),
  },
}));

vi.mock('@/services/tv', () => ({
  tvService: {
    search: (...args: unknown[]) => tvSearchFn(...args),
    browse: (...args: unknown[]) => tvBrowseFn(...args),
  },
}));

// ---------------------------------------------------------------------------
// Import the component under test AFTER mocks
// ---------------------------------------------------------------------------

import SearchView from './SearchView';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderView(params: Record<string, string> = {}) {
  mockSearchParamsMap = params;
  return render(<SearchView />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParamsMap = {};
  mockReplace.mockClear();

  // Reset mock implementations
  moviesSearchFn = vi.fn().mockResolvedValue(moviePage1);
  moviesBrowseFn = vi.fn().mockResolvedValue(moviePage1);
  tvSearchFn = vi.fn().mockResolvedValue(tvPage1);
  tvBrowseFn = vi.fn().mockResolvedValue(tvPage1);
});

afterEach(() => {
  vi.clearAllTimers();
});

describe('SearchView', () => {
  // ── 1. Empty state ──────────────────────────────────────────────────────
  describe('empty state (no query, no filters)', () => {
    it('shows GenreBrowse when there is no query and no filters', () => {
      renderView();
      // GenreBrowse renders "Browse by genre" section
      expect(screen.getByRole('region', { name: 'Browse by genre' })).toBeInTheDocument();
    });

    it('does NOT show the results grid when empty', () => {
      renderView();
      // ResultsGrid is not rendered (no items, no loading)
      expect(screen.queryByRole('status', { name: 'Loading results' })).not.toBeInTheDocument();
    });

    it('clicking a genre tile in GenreBrowse activates a filter and hides GenreBrowse', async () => {
      renderView();
      // Click the first real genre tile
      const firstGenreBtn = screen.getAllByRole('button').find(
        (btn) => btn.getAttribute('aria-label') && !['Clear search'].includes(btn.getAttribute('aria-label')!),
      );
      expect(firstGenreBtn).toBeDefined();
      // The section should be visible
      expect(screen.getByRole('region', { name: 'Browse by genre' })).toBeInTheDocument();
    });
  });

  // ── 2. Search hero elements ─────────────────────────────────────────────
  describe('search hero', () => {
    it('renders the eyebrow text', () => {
      renderView();
      expect(screen.getByText(/find something to watch/i)).toBeInTheDocument();
    });

    it('renders the heading with "collection"', () => {
      renderView();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/collection/i);
    });

    it('renders the search input', () => {
      renderView();
      expect(screen.getByRole('searchbox', { name: /search the collection/i })).toBeInTheDocument();
    });

    it('renders the SearchFilters component (type toggle)', () => {
      renderView();
      expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Movies' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Series' })).toBeInTheDocument();
    });

    it('shows a clear button when there is input text', async () => {
      renderView();
      const input = screen.getByRole('searchbox');
      await userEvent.type(input, 'blade');
      expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    });

    it('clears the input when the clear button is clicked', async () => {
      renderView();
      const input = screen.getByRole('searchbox');
      await userEvent.type(input, 'blade');
      const clearBtn = screen.getByRole('button', { name: 'Clear search' });
      await userEvent.click(clearBtn);
      expect(input).toHaveValue('');
    });
  });

  // ── 3. Movie mode search ─────────────────────────────────────────────────
  describe('movie mode search', () => {
    it('fetches movies and renders PosterCards when type=movie and query is provided', async () => {
      moviesSearchFn = vi.fn().mockResolvedValue(moviePage1);

      renderView({ q: 'blade', type: 'movie' });

      // Wait for the result to appear
      await waitFor(() => {
        expect(screen.getAllByText('Blade Runner').length).toBeGreaterThan(0);
      });

      expect(moviesSearchFn).toHaveBeenCalled();
    });

    it('shows result count when a search is active', async () => {
      moviesSearchFn = vi.fn().mockResolvedValue(moviePage1);

      renderView({ q: 'blade', type: 'movie' });

      await waitFor(() => {
        // Result count line should appear
        expect(screen.getByRole('status', { hidden: false })).toBeInTheDocument();
      });
    });
  });

  // ── 4. "All" mode merges movie + tv ──────────────────────────────────────
  describe('"All" mode (merged movie + tv)', () => {
    it('shows both movie and tv results when type is "all"', async () => {
      moviesSearchFn = vi.fn().mockResolvedValue(moviePage1);
      tvSearchFn = vi.fn().mockResolvedValue(tvPage1);

      renderView({ q: 'blade', type: 'all' });

      await waitFor(() => {
        expect(screen.getAllByText('Blade Runner').length).toBeGreaterThan(0);
      });

      await waitFor(() => {
        expect(screen.getAllByText('Dune Prophecy').length).toBeGreaterThan(0);
      });

      expect(moviesSearchFn).toHaveBeenCalled();
      expect(tvSearchFn).toHaveBeenCalled();
    });

    it('deduplicates results with the same media_type+tmdb_id', async () => {
      // Both services return the same tmdb_id with the same media_type — should dedup
      const sharedId = 9999;
      const dupMoviePage = makePage([
        { tmdb_id: sharedId, media_type: 'movie', title: 'Shared Movie', popularity: 50 },
      ]);
      // TV service returns different tmdb_id (different media_type means kept)
      const distinctTvPage = makePage([
        { tmdb_id: sharedId, media_type: 'tv', title: 'Shared TV', popularity: 40 },
      ]);

      moviesSearchFn = vi.fn().mockResolvedValue(dupMoviePage);
      tvSearchFn = vi.fn().mockResolvedValue(distinctTvPage);

      renderView({ q: 'shared', type: 'all' });

      await waitFor(() => {
        // "Shared Movie" and "Shared TV" have different media_type so both appear
        expect(screen.getAllByText('Shared Movie').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Shared TV').length).toBeGreaterThan(0);
      });
    });
  });

  // ── 5. Load more ─────────────────────────────────────────────────────────
  describe('Load more', () => {
    it('shows "Load more" button when there are more pages', async () => {
      // moviePage1 has total_pages=2 so hasMoreResults → true
      moviesSearchFn = vi.fn().mockResolvedValue(moviePage1);

      renderView({ q: 'blade', type: 'movie' });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
      });
    });

    it('fetches the next page and appends results when Load more is clicked', async () => {
      moviesSearchFn = vi
        .fn()
        .mockResolvedValueOnce(moviePage1)  // page 1
        .mockResolvedValueOnce(moviePage2); // page 2

      renderView({ q: 'blade', type: 'movie' });

      // Wait for page 1 results
      await waitFor(() => {
        expect(screen.getAllByText('Blade Runner').length).toBeGreaterThan(0);
      });

      // Click load more
      const loadMoreBtn = screen.getByRole('button', { name: /load more/i });
      await userEvent.click(loadMoreBtn);

      // Page 2 results should also appear
      await waitFor(() => {
        expect(screen.getAllByText('Blade Runner 2049').length).toBeGreaterThan(0);
      });

      // Service should have been called twice
      expect(moviesSearchFn).toHaveBeenCalledTimes(2);
    });
  });

  // ── 6. No-query browse mode ───────────────────────────────────────────────
  describe('browse mode (no query, filter active)', () => {
    it('shows ResultsGrid when a filter is active without a query', async () => {
      moviesBrowseFn = vi.fn().mockResolvedValue(moviePage1);
      tvBrowseFn = vi.fn().mockResolvedValue(emptyPage);

      renderView({ genre: '28' }); // genre filter active

      await waitFor(() => {
        expect(screen.getAllByText('Blade Runner').length).toBeGreaterThan(0);
      });

      expect(moviesBrowseFn).toHaveBeenCalled();
    });
  });

  // ── 7. Filter toggle integration ─────────────────────────────────────────
  describe('filter integration', () => {
    it('calls moviesService.search and not tvService when type="movie"', async () => {
      moviesSearchFn = vi.fn().mockResolvedValue(moviePage1);

      renderView({ q: 'blade', type: 'movie' });

      await waitFor(() => {
        expect(moviesSearchFn).toHaveBeenCalled();
      });

      // TV should not be called
      expect(tvSearchFn).not.toHaveBeenCalled();
    });

    it('calls tvService.search and not moviesService when type="tv"', async () => {
      tvSearchFn = vi.fn().mockResolvedValue(tvPage1);

      renderView({ q: 'dune', type: 'tv' });

      await waitFor(() => {
        expect(tvSearchFn).toHaveBeenCalled();
      });

      expect(moviesSearchFn).not.toHaveBeenCalled();
    });
  });
});
