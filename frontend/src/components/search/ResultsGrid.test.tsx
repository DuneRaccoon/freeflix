/**
 * ResultsGrid — Vitest + RTL tests
 *
 * Spec (Task 3):
 *  - renders one PosterCard per item with correct detail links
 *  - shows the empty label when items is empty and not loading
 *  - shows a skeleton loading state when isLoading and items is empty
 *  - shows "Load more" only when hasMore && onLoadMore are provided
 *  - clicking "Load more" calls onLoadMore
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResultsGrid from './ResultsGrid';
import type { CatalogItem } from '@/types';

// Mock WatchlistContext so PosterCard (used inside ResultsGrid) can render without a real provider.
vi.mock('@/context/WatchlistContext', () => ({
  useWatchlist: () => ({ isSaved: () => false, toggle: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(
  media_type: 'movie' | 'tv',
  tmdb_id: number,
  title: string,
): CatalogItem {
  return {
    tmdb_id,
    media_type,
    title,
    year: 2024,
    overview: null,
    poster_url: null,
    backdrop_url: null,
    genre_ids: [],
    genres: [],
    vote_average: 7.5,
    vote_count: 100,
    popularity: 100,
    original_language: 'en',
  };
}

const movieItem = makeItem('movie', 693134, 'Dune: Part Two');
const tvItem = makeItem('tv', 84958, 'Loki');
const movieItem2 = makeItem('movie', 27205, 'Inception');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResultsGrid', () => {
  describe('renders PosterCards for items', () => {
    it('renders one PosterCard per item (title visible)', () => {
      render(<ResultsGrid items={[movieItem, tvItem, movieItem2]} />);
      expect(screen.getAllByText('Dune: Part Two').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Loki').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Inception').length).toBeGreaterThan(0);
    });

    it('renders the correct detail link for a movie (href /movies/{id})', () => {
      render(<ResultsGrid items={[movieItem]} />);
      // PosterCard main link has aria-label "{title} ({year})"
      const link = screen.getByRole('link', { name: 'Dune: Part Two (2024)' });
      expect(link).toHaveAttribute('href', '/movies/693134');
    });

    it('renders the correct detail link for a tv show (href /tv/{id})', () => {
      render(<ResultsGrid items={[tvItem]} />);
      // PosterCard main link has aria-label "{title} ({year})"
      const link = screen.getByRole('link', { name: 'Loki (2024)' });
      expect(link).toHaveAttribute('href', '/tv/84958');
    });
  });

  describe('empty state', () => {
    it('shows the default empty label when items is empty and not loading', () => {
      render(<ResultsGrid items={[]} />);
      expect(screen.getByRole('status')).toHaveTextContent('No results found.');
    });

    it('shows a custom emptyLabel when provided', () => {
      render(<ResultsGrid items={[]} emptyLabel="Try a different search term." />);
      expect(screen.getByRole('status')).toHaveTextContent('Try a different search term.');
    });

    it('does NOT show the empty label while loading (skeleton instead)', () => {
      render(<ResultsGrid items={[]} isLoading />);
      // skeleton has role="status" with "Loading results" aria-label
      expect(screen.getByRole('status', { name: 'Loading results' })).toBeInTheDocument();
      // the empty-state role="status" should not appear
      expect(screen.queryByText('No results found.')).not.toBeInTheDocument();
    });
  });

  describe('skeleton loading state', () => {
    it('shows the loading skeleton when isLoading and items is empty', () => {
      render(<ResultsGrid items={[]} isLoading />);
      expect(screen.getByRole('status', { name: 'Loading results' })).toBeInTheDocument();
    });

    it('does NOT show the skeleton when items are already present', () => {
      render(<ResultsGrid items={[movieItem]} isLoading />);
      expect(screen.queryByRole('status', { name: 'Loading results' })).not.toBeInTheDocument();
    });
  });

  describe('Load more button', () => {
    it('renders "Load more" when hasMore and onLoadMore are provided', () => {
      render(
        <ResultsGrid
          items={[movieItem]}
          hasMore
          onLoadMore={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
    });

    it('does NOT render "Load more" when hasMore is false', () => {
      render(
        <ResultsGrid
          items={[movieItem]}
          hasMore={false}
          onLoadMore={vi.fn()}
        />,
      );
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });

    it('does NOT render "Load more" when onLoadMore is not provided', () => {
      render(<ResultsGrid items={[movieItem]} hasMore />);
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });

    it('calls onLoadMore when "Load more" is clicked', async () => {
      const onLoadMore = vi.fn();
      render(
        <ResultsGrid
          items={[movieItem]}
          hasMore
          onLoadMore={onLoadMore}
        />,
      );
      const button = screen.getByRole('button', { name: /load more/i });
      await userEvent.click(button);
      expect(onLoadMore).toHaveBeenCalledOnce();
    });
  });
});
