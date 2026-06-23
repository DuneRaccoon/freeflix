/**
 * PosterCard — Vitest + RTL tests
 *
 * Spec (Task 2):
 *  - renders title, year, rounded rating
 *  - detail href matches media_type (movie → /movies/{id}, tv → /tv/{id})
 *  - the overview / genre overlay is present in the DOM
 *  - missing poster_url → graceful placeholder (no broken img)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosterCard from './PosterCard';
import type { CatalogItem } from '@/types';

// ---------------------------------------------------------------------------
// Mock WatchlistContext so PosterCard can render without a real provider.
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
  overview: 'Paul Atreides unites with the Fremen to wage war against the House that destroyed his family.',
  poster_url: 'https://image.tmdb.org/t/p/w500/test-poster.jpg',
  backdrop_url: null,
  genre_ids: [878, 12],
  genres: ['Science Fiction', 'Adventure', 'Action'],
  vote_average: 8.4,
  vote_count: 12000,
  popularity: 995.3,
  original_language: 'en',
};

const tvItem: CatalogItem = {
  tmdb_id: 84958,
  media_type: 'tv',
  title: 'Loki',
  year: 2021,
  overview: 'The mercurial villain Loki resumes his role as the God of Mischief.',
  poster_url: 'https://image.tmdb.org/t/p/w500/loki-poster.jpg',
  backdrop_url: null,
  genre_ids: [10759, 10765],
  genres: ['Action & Adventure', 'Sci-Fi & Fantasy'],
  vote_average: 8.2,
  vote_count: 7500,
  popularity: 430.1,
  original_language: 'en',
};

const noImageItem: CatalogItem = {
  ...movieItem,
  tmdb_id: 999,
  title: 'No Image Film',
  poster_url: null,
};

describe('PosterCard', () => {
  it('renders the title in the resting caption', () => {
    render(<PosterCard item={movieItem} />);
    // resting caption is aria-hidden but still in the DOM
    const titles = screen.getAllByText('Dune: Part Two');
    expect(titles.length).toBeGreaterThan(0);
  });

  it('renders the year', () => {
    render(<PosterCard item={movieItem} />);
    const years = screen.getAllByText('2024');
    expect(years.length).toBeGreaterThan(0);
  });

  it('renders the vote average rounded to 1 decimal', () => {
    render(<PosterCard item={movieItem} />);
    // 8.4 → "8.4"
    const ratings = screen.getAllByText('8.4');
    expect(ratings.length).toBeGreaterThan(0);
  });

  it('rounds vote_average correctly (e.g. 8.7 → "8.7")', () => {
    const item = { ...movieItem, vote_average: 8.7 };
    render(<PosterCard item={item} />);
    const ratings = screen.getAllByText('8.7');
    expect(ratings.length).toBeGreaterThan(0);
  });

  describe('detail href by media_type', () => {
    it('links to /movies/{tmdb_id} for media_type=movie', () => {
      render(<PosterCard item={movieItem} />);
      // The main card link has aria-label "Dune: Part Two (2024)" — use exact match
      const link = screen.getByRole('link', { name: 'Dune: Part Two (2024)' });
      expect(link).toHaveAttribute('href', '/movies/693134');
    });

    it('links to /tv/{tmdb_id} for media_type=tv', () => {
      render(<PosterCard item={tvItem} />);
      // The main card link has aria-label "Loki (2021)"
      const link = screen.getByRole('link', { name: 'Loki (2021)' });
      expect(link).toHaveAttribute('href', '/tv/84958');
    });
  });

  describe('hover-reveal overlay', () => {
    it('renders the overview text in the DOM (overlay present even when hidden)', () => {
      render(<PosterCard item={movieItem} />);
      expect(
        screen.getByText(/Paul Atreides unites with the Fremen/i),
      ).toBeInTheDocument();
    });

    it('renders genre chips for up to 3 genres', () => {
      render(<PosterCard item={movieItem} />);
      // genres: ['Science Fiction', 'Adventure', 'Action'] — all 3 should appear
      expect(screen.getByText('Science Fiction')).toBeInTheDocument();
      expect(screen.getByText('Adventure')).toBeInTheDocument();
      expect(screen.getByText('Action')).toBeInTheDocument();
    });

    it('renders no more than 3 genre chips even if item has more', () => {
      const itemWith4 = {
        ...movieItem,
        genres: ['Drama', 'Comedy', 'Thriller', 'Romance'],
      };
      render(<PosterCard item={itemWith4} />);
      // 4th genre should not appear
      expect(screen.queryByText('Romance')).not.toBeInTheDocument();
    });

    it('renders the play action in the overlay', () => {
      render(<PosterCard item={movieItem} />);
      // Play is rendered as an <a> link in the overlay
      const playLinks = screen.getAllByRole('link', { name: /Play Dune/i });
      expect(playLinks.length).toBeGreaterThan(0);
    });

    it('renders the info link within the overlay', () => {
      render(<PosterCard item={movieItem} />);
      const infoLinks = screen.getAllByRole('link', { name: /More info about/i });
      expect(infoLinks.length).toBeGreaterThan(0);
      expect(infoLinks[0]).toHaveAttribute('href', '/movies/693134');
    });

    it('renders the Add to My List button (unsaved state)', () => {
      mockIsSaved.mockReturnValue(false);
      render(<PosterCard item={movieItem} />);
      expect(
        screen.getByRole('button', { name: /Add .* to My List/i }),
      ).toBeInTheDocument();
    });

    it('shows Remove from My List when item is saved', () => {
      mockIsSaved.mockReturnValue(true);
      render(<PosterCard item={movieItem} />);
      expect(
        screen.getByRole('button', { name: /Remove .* from My List/i }),
      ).toBeInTheDocument();
    });

    it('calls toggle with correct content_id for a movie', async () => {
      mockIsSaved.mockReturnValue(false);
      mockToggle.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<PosterCard item={movieItem} />);
      await user.click(screen.getByTestId('postercard-mylist-button'));
      expect(mockToggle).toHaveBeenCalledWith(
        expect.objectContaining({
          content_id: 'movie:693134',
          media_type: 'movie',
          poster_url: 'https://image.tmdb.org/t/p/w500/test-poster.jpg',
          year: 2024,
          vote_average: 8.4,
        }),
      );
    });

    it('calls toggle with tv content_id for a tv item', async () => {
      mockIsSaved.mockReturnValue(false);
      mockToggle.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<PosterCard item={tvItem} />);
      await user.click(screen.getByTestId('postercard-mylist-button'));
      expect(mockToggle).toHaveBeenCalledWith(
        expect.objectContaining({ content_id: 'tv:84958', media_type: 'tv' }),
      );
    });
  });

  describe('missing poster_url', () => {
    it('renders without a broken img when poster_url is null', () => {
      render(<PosterCard item={noImageItem} />);
      const img = document.querySelector('img');
      expect(img).toBeInTheDocument();
      // src should be the placeholder data URI (not null/undefined)
      expect(img?.getAttribute('src')).toBeTruthy();
      expect(img?.getAttribute('src')).toContain('data:image/svg+xml');
    });

    it('still renders the title when poster_url is null', () => {
      render(<PosterCard item={noImageItem} />);
      expect(screen.getAllByText('No Image Film').length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('renders gracefully when overview is null', () => {
      const item = { ...movieItem, overview: null };
      render(<PosterCard item={item} />);
      expect(screen.getAllByText('Dune: Part Two').length).toBeGreaterThan(0);
    });

    it('renders gracefully when year is null', () => {
      const item = { ...movieItem, year: null };
      render(<PosterCard item={item} />);
      expect(screen.getAllByText('Dune: Part Two').length).toBeGreaterThan(0);
    });

    it('renders gracefully when genres is empty', () => {
      const item = { ...movieItem, genres: [] };
      render(<PosterCard item={item} />);
      expect(screen.getAllByText('Dune: Part Two').length).toBeGreaterThan(0);
    });
  });
});
