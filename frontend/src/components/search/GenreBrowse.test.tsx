/**
 * GenreBrowse — Vitest + RTL tests
 *
 * Spec (Task 5):
 *  - Renders a tile per real genre (not "All Genres")
 *  - Clicking a tile calls onPick with that genre id
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GenreBrowse from './GenreBrowse';
import { GENRE_OPTIONS } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All genre options excluding the "All Genres" sentinel (value 0). */
const REAL_GENRES = GENRE_OPTIONS.filter((g) => g.value !== 0);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GenreBrowse', () => {
  it('renders a tile for every genre except "All Genres"', () => {
    render(<GenreBrowse onPick={vi.fn()} />);

    // Should have exactly REAL_GENRES.length buttons
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(REAL_GENRES.length);

    // Each genre label should appear in the document
    for (const genre of REAL_GENRES) {
      expect(
        screen.getByRole('button', { name: genre.label }),
      ).toBeInTheDocument();
    }
  });

  it('does NOT render a tile for "All Genres" (value 0)', () => {
    render(<GenreBrowse onPick={vi.fn()} />);
    const allGenresOption = GENRE_OPTIONS.find((g) => g.value === 0)!;
    // Query by text — should not exist
    expect(screen.queryByRole('button', { name: allGenresOption.label })).toBeNull();
  });

  it('calls onPick with the correct genre id when a tile is clicked', async () => {
    const onPick = vi.fn();
    render(<GenreBrowse onPick={onPick} />);

    const firstGenre = REAL_GENRES[0];
    await userEvent.click(screen.getByRole('button', { name: firstGenre.label }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(firstGenre.value);
  });

  it('calls onPick with the correct genre id for each tile independently', async () => {
    const onPick = vi.fn();
    render(<GenreBrowse onPick={onPick} />);

    // Click a few different tiles and check each call
    for (const genre of REAL_GENRES.slice(0, 3)) {
      await userEvent.click(screen.getByRole('button', { name: genre.label }));
    }

    expect(onPick).toHaveBeenCalledTimes(3);
    expect(onPick).toHaveBeenNthCalledWith(1, REAL_GENRES[0].value);
    expect(onPick).toHaveBeenNthCalledWith(2, REAL_GENRES[1].value);
    expect(onPick).toHaveBeenNthCalledWith(3, REAL_GENRES[2].value);
  });

  it('renders a section with accessible label "Browse by genre"', () => {
    render(<GenreBrowse onPick={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Browse by genre' })).toBeInTheDocument();
  });
});
