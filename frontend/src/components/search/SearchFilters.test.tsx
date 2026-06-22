/**
 * SearchFilters — Vitest + RTL tests
 *
 * Spec (Task 4):
 *  - Three type pills render (All, Movies, Series) with the active one aria-pressed=true
 *  - Clicking "Series" calls onChange({ type: 'tv' })
 *  - Clicking "Movies" calls onChange({ type: 'movie' })
 *  - Clicking "All" calls onChange({ type: 'all' })
 *  - Changing the genre control calls onChange({ genre: <id> })
 *  - Genre chip opens a popover with options; selecting one calls onChange
 *  - Year chip opens and calls onChange({ year: ... })
 *  - Sort chip opens and calls onChange({ sort: ... })
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchFilters from './SearchFilters';
import { GENRE_OPTIONS, SORT_OPTIONS } from '@/types';

// ---------------------------------------------------------------------------
// Default props helper
// ---------------------------------------------------------------------------

function defaultProps(overrides?: Partial<React.ComponentProps<typeof SearchFilters>>) {
  return {
    type: 'all' as const,
    genre: 0,
    year: 0,
    sort: '',
    provider: 0,
    origin: '',
    company: 0,
    collection: 0,
    api: '',
    onChange: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchFilters', () => {
  describe('type toggle pills', () => {
    it('renders All, Movies, and Series pills', () => {
      render(<SearchFilters {...defaultProps()} />);
      expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Movies' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Series' })).toBeInTheDocument();
    });

    it('marks "All" as aria-pressed=true when type is "all"', () => {
      render(<SearchFilters {...defaultProps({ type: 'all' })} />);
      expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Movies' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Series' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('marks "Movies" as aria-pressed=true when type is "movie"', () => {
      render(<SearchFilters {...defaultProps({ type: 'movie' })} />);
      expect(screen.getByRole('button', { name: 'Movies' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Series' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('marks "Series" as aria-pressed=true when type is "tv"', () => {
      render(<SearchFilters {...defaultProps({ type: 'tv' })} />);
      expect(screen.getByRole('button', { name: 'Series' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Movies' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('calls onChange({ type: "tv" }) when "Series" is clicked', async () => {
      const onChange = vi.fn();
      render(<SearchFilters {...defaultProps({ onChange })} />);
      await userEvent.click(screen.getByRole('button', { name: 'Series' }));
      expect(onChange).toHaveBeenCalledWith({ type: 'tv' });
    });

    it('calls onChange({ type: "movie" }) when "Movies" is clicked', async () => {
      const onChange = vi.fn();
      render(<SearchFilters {...defaultProps({ onChange })} />);
      await userEvent.click(screen.getByRole('button', { name: 'Movies' }));
      expect(onChange).toHaveBeenCalledWith({ type: 'movie' });
    });

    it('calls onChange({ type: "all" }) when "All" is clicked', async () => {
      const onChange = vi.fn();
      render(<SearchFilters {...defaultProps({ type: 'movie', onChange })} />);
      await userEvent.click(screen.getByRole('button', { name: 'All' }));
      expect(onChange).toHaveBeenCalledWith({ type: 'all' });
    });
  });

  describe('genre chip', () => {
    it('renders the Genre chip', () => {
      render(<SearchFilters {...defaultProps()} />);
      expect(screen.getByRole('button', { name: 'Genre filter' })).toBeInTheDocument();
    });

    it('opens a popover with genre options when the chip is clicked', async () => {
      render(<SearchFilters {...defaultProps()} />);
      await userEvent.click(screen.getByRole('button', { name: 'Genre filter' }));
      // First option is "All Genres"
      const genreOption = GENRE_OPTIONS.find((o) => o.value === 0);
      expect(screen.getByRole('option', { name: genreOption?.label })).toBeInTheDocument();
    });

    it('calls onChange({ genre: <id> }) when a genre option is selected', async () => {
      const onChange = vi.fn();
      render(<SearchFilters {...defaultProps({ onChange })} />);
      // Open the genre chip
      await userEvent.click(screen.getByRole('button', { name: 'Genre filter' }));
      // Click the second option (index 1), which has a real genre id
      const secondOption = GENRE_OPTIONS[1];
      const optionBtn = screen.getByRole('option', { name: secondOption.label });
      await userEvent.click(optionBtn);
      expect(onChange).toHaveBeenCalledWith({ genre: secondOption.value });
    });

    it('marks the active genre as aria-selected=true', async () => {
      const actionOption = GENRE_OPTIONS[1];
      render(<SearchFilters {...defaultProps({ genre: actionOption.value })} />);
      // Open the chip
      await userEvent.click(screen.getByRole('button', { name: 'Genre filter' }));
      const activeOpt = screen.getByRole('option', { name: actionOption.label });
      expect(activeOpt).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('year chip', () => {
    it('renders the Year chip', () => {
      render(<SearchFilters {...defaultProps()} />);
      expect(screen.getByRole('button', { name: 'Year filter' })).toBeInTheDocument();
    });

    it('opens a popover with year options and calls onChange({ year: ... })', async () => {
      const onChange = vi.fn();
      render(<SearchFilters {...defaultProps({ onChange })} />);
      await userEvent.click(screen.getByRole('button', { name: 'Year filter' }));
      // Find a year option (e.g. 2024)
      const yearOpt = screen.getByRole('option', { name: '2024' });
      await userEvent.click(yearOpt);
      expect(onChange).toHaveBeenCalledWith({ year: 2024 });
    });
  });

  describe('sort chip', () => {
    it('renders the Sort chip', () => {
      render(<SearchFilters {...defaultProps()} />);
      expect(screen.getByRole('button', { name: 'Sort by' })).toBeInTheDocument();
    });

    it('opens a popover with sort options and calls onChange({ sort: ... })', async () => {
      const onChange = vi.fn();
      render(<SearchFilters {...defaultProps({ onChange })} />);
      await userEvent.click(screen.getByRole('button', { name: 'Sort by' }));
      const sortOpt = SORT_OPTIONS[0];
      const btn = screen.getByRole('option', { name: sortOpt.label });
      await userEvent.click(btn);
      expect(onChange).toHaveBeenCalledWith({ sort: sortOpt.value });
    });

    it('marks the active sort option as aria-selected=true', async () => {
      const sortOpt = SORT_OPTIONS[1]; // Top Rated
      render(<SearchFilters {...defaultProps({ sort: sortOpt.value })} />);
      await userEvent.click(screen.getByRole('button', { name: 'Sort by' }));
      const activeOpt = screen.getByRole('option', { name: sortOpt.label });
      expect(activeOpt).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('new discover dimension chips', () => {
    it('shows Studio + Collection chips only for type=movie', () => {
      const { rerender } = render(
        <SearchFilters type="all" genre={0} year={0} sort="" provider={0} origin="" company={0} collection={0} api="" onChange={() => {}} />,
      );
      expect(screen.queryByLabelText('Studio filter')).toBeNull();
      rerender(
        <SearchFilters type="movie" genre={0} year={0} sort="" provider={0} origin="" company={0} collection={0} api="" onChange={() => {}} />,
      );
      expect(screen.getByLabelText('Studio filter')).toBeInTheDocument();
    });

    it('renders Streaming and Origin chips for all types', () => {
      render(
        <SearchFilters type="all" genre={0} year={0} sort="" provider={0} origin="" company={0} collection={0} api="" onChange={() => {}} />,
      );
      expect(screen.getByLabelText('Streaming filter')).toBeInTheDocument();
      expect(screen.getByLabelText('Origin filter')).toBeInTheDocument();
    });
  });
});
