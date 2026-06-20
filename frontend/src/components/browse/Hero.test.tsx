/**
 * Hero — Vitest + RTL tests
 *
 * Spec (Task 6):
 *  - renders the title
 *  - renders the rounded rating (vote_average.toFixed(1))
 *  - renders the overview
 *  - renders a Play control linking to the correct detail route
 *  - renders a More Info link linking to the correct detail route
 *  - movie → /movies/{tmdb_id}, tv → /tv/{tmdb_id}
 *  - uses backdrop_url as the backdrop image src
 *  - graceful when backdrop_url is null (uses placeholder)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Hero from './Hero';
import type { CatalogItem } from '@/types';

// ---------------------------------------------------------------------------
// Mock WatchlistContext so Hero can render without a real provider.
// ---------------------------------------------------------------------------
const mockToggle = vi.fn();
const mockIsSaved = vi.fn(() => false);

vi.mock('@/context/WatchlistContext', () => ({
  useWatchlist: () => ({ isSaved: mockIsSaved, toggle: mockToggle }),
}));

const movieItem: CatalogItem = {
  tmdb_id: 693134,
  media_type: 'movie',
  title: 'Dune: Part Two',
  year: 2024,
  overview:
    'Paul Atreides unites with the Fremen to wage war against the House that destroyed his family — torn between the love of his life and the fate of the universe.',
  poster_url: 'https://image.tmdb.org/t/p/w500/poster.jpg',
  backdrop_url: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
  genre_ids: [878, 12, 28],
  genres: ['Science Fiction', 'Adventure', 'Action'],
  vote_average: 8.4,
  vote_count: 12000,
  popularity: 995.3,
  original_language: 'en',
};

const tvItem: CatalogItem = {
  tmdb_id: 84958,
  media_type: 'tv',
  title: 'Severance',
  year: 2022,
  overview: 'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives.',
  poster_url: 'https://image.tmdb.org/t/p/w500/sev-poster.jpg',
  backdrop_url: 'https://image.tmdb.org/t/p/w1280/sev-backdrop.jpg',
  genre_ids: [18, 9648],
  genres: ['Drama', 'Mystery'],
  vote_average: 8.7,
  vote_count: 5000,
  popularity: 320.5,
  original_language: 'en',
};

const noBackdropItem: CatalogItem = {
  ...movieItem,
  tmdb_id: 9999,
  title: 'No Backdrop Film',
  backdrop_url: null,
};

describe('Hero', () => {
  describe('content rendering', () => {
    it('renders the item title as a heading', () => {
      render(<Hero item={movieItem} />);
      expect(screen.getByRole('heading', { name: 'Dune: Part Two' })).toBeInTheDocument();
    });

    it('renders the vote_average rounded to 1 decimal', () => {
      render(<Hero item={movieItem} />);
      // 8.4 → "8.4"
      expect(screen.getByText('8.4')).toBeInTheDocument();
    });

    it('renders the overview logline', () => {
      render(<Hero item={movieItem} />);
      expect(
        screen.getByText(/Paul Atreides unites with the Fremen/i),
      ).toBeInTheDocument();
    });

    it('renders the year in the meta row', () => {
      render(<Hero item={movieItem} />);
      expect(screen.getByText('2024')).toBeInTheDocument();
    });

    it('renders up to 3 genres in the meta row', () => {
      render(<Hero item={movieItem} />);
      // genres joined: "Science Fiction, Adventure, Action"
      expect(
        screen.getByText('Science Fiction, Adventure, Action'),
      ).toBeInTheDocument();
    });

    it('renders the "Featured" eyebrow', () => {
      render(<Hero item={movieItem} />);
      expect(screen.getByText('Featured')).toBeInTheDocument();
    });
  });

  describe('action links', () => {
    it('renders a Play control for a movie', () => {
      render(<Hero item={movieItem} />);
      const playLink = screen.getByTestId('hero-play');
      expect(playLink).toBeInTheDocument();
    });

    it('Play link points to /movies/{tmdb_id} for a movie', () => {
      render(<Hero item={movieItem} />);
      const playLink = screen.getByTestId('hero-play');
      expect(playLink).toHaveAttribute('href', '/movies/693134');
    });

    it('Play link points to /tv/{tmdb_id} for a tv item', () => {
      render(<Hero item={tvItem} />);
      const playLink = screen.getByTestId('hero-play');
      expect(playLink).toHaveAttribute('href', '/tv/84958');
    });

    it('More Info link points to /movies/{tmdb_id} for a movie', () => {
      render(<Hero item={movieItem} />);
      const moreInfo = screen.getByTestId('hero-more-info');
      expect(moreInfo).toHaveAttribute('href', '/movies/693134');
    });

    it('More Info link points to /tv/{tmdb_id} for a tv item', () => {
      render(<Hero item={tvItem} />);
      const moreInfo = screen.getByTestId('hero-more-info');
      expect(moreInfo).toHaveAttribute('href', '/tv/84958');
    });

    it('renders the Add to My List button (unsaved state)', () => {
      mockIsSaved.mockReturnValue(false);
      render(<Hero item={movieItem} />);
      expect(
        screen.getByRole('button', { name: 'Add to My List' }),
      ).toBeInTheDocument();
    });

    it('shows Remove from My List when item is saved', () => {
      mockIsSaved.mockReturnValue(true);
      render(<Hero item={movieItem} />);
      expect(
        screen.getByRole('button', { name: 'Remove from My List' }),
      ).toBeInTheDocument();
    });

    it('calls toggle with correct content_id for a movie', async () => {
      mockIsSaved.mockReturnValue(false);
      mockToggle.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<Hero item={movieItem} />);
      await user.click(screen.getByTestId('hero-mylist-button'));
      expect(mockToggle).toHaveBeenCalledWith(
        expect.objectContaining({ content_id: 'movie:693134', media_type: 'movie' }),
      );
    });

    it('calls toggle with tv content_id for a tv item', async () => {
      mockIsSaved.mockReturnValue(false);
      mockToggle.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<Hero item={tvItem} />);
      await user.click(screen.getByTestId('hero-mylist-button'));
      expect(mockToggle).toHaveBeenCalledWith(
        expect.objectContaining({ content_id: 'tv:84958', media_type: 'tv' }),
      );
    });
  });

  describe('backdrop image', () => {
    it('uses backdrop_url as the src when available', () => {
      render(<Hero item={movieItem} />);
      const img = screen.getByTestId('hero-backdrop') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe(
        'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
      );
    });

    it('uses the placeholder data URI when backdrop_url is null', () => {
      render(<Hero item={noBackdropItem} />);
      const img = screen.getByTestId('hero-backdrop') as HTMLImageElement;
      expect(img.getAttribute('src')).toContain('data:image/svg+xml');
    });

    it('still renders the title when backdrop_url is null', () => {
      render(<Hero item={noBackdropItem} />);
      expect(
        screen.getByRole('heading', { name: 'No Backdrop Film' }),
      ).toBeInTheDocument();
    });
  });

  describe('TV item', () => {
    it('renders the TV item title', () => {
      render(<Hero item={tvItem} />);
      expect(screen.getByRole('heading', { name: 'Severance' })).toBeInTheDocument();
    });

    it('renders the TV item rating', () => {
      render(<Hero item={tvItem} />);
      expect(screen.getByText('8.7')).toBeInTheDocument();
    });

    it('renders the TV item overview', () => {
      render(<Hero item={tvItem} />);
      expect(
        screen.getByText(/memories have been surgically divided/i),
      ).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('renders gracefully when overview is null', () => {
      const item = { ...movieItem, overview: null };
      render(<Hero item={item} />);
      expect(
        screen.getByRole('heading', { name: 'Dune: Part Two' }),
      ).toBeInTheDocument();
    });

    it('renders gracefully when year is null', () => {
      const item = { ...movieItem, year: null };
      render(<Hero item={item} />);
      expect(
        screen.getByRole('heading', { name: 'Dune: Part Two' }),
      ).toBeInTheDocument();
    });

    it('renders gracefully when genres is empty', () => {
      const item = { ...movieItem, genres: [] };
      render(<Hero item={item} />);
      expect(
        screen.getByRole('heading', { name: 'Dune: Part Two' }),
      ).toBeInTheDocument();
    });

    it('caps meta genres at 3 when item has more', () => {
      const item = { ...movieItem, genres: ['Drama', 'Comedy', 'Thriller', 'Romance'] };
      render(<Hero item={item} />);
      // Only first 3 should appear joined
      expect(screen.getByText('Drama, Comedy, Thriller')).toBeInTheDocument();
      expect(screen.queryByText(/Romance/)).not.toBeInTheDocument();
    });
  });
});
