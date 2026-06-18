/**
 * RankedRow — Vitest + RTL tests
 *
 * Spec (Task 4):
 *  - renders the title
 *  - renders one numeral per item (1..n)
 *  - renders posters with correct detail hrefs (movie → /movies/{id}, tv → /tv/{id})
 *  - caps at 10 items even if more are passed
 *  - renders "See all" link when seeAllHref is provided; absent otherwise
 *  - both scroll arrow buttons present
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RankedRow from './RankedRow';
import type { CatalogItem } from '@/types';

/** Build a minimal CatalogItem for test purposes */
function makeItem(id: number, title: string, mediaType: 'movie' | 'tv' = 'movie'): CatalogItem {
  return {
    tmdb_id: id,
    media_type: mediaType,
    title,
    year: 2023,
    overview: `Overview of ${title}`,
    poster_url: `https://image.tmdb.org/t/p/w500/poster-${id}.jpg`,
    backdrop_url: null,
    genre_ids: [28],
    genres: ['Action'],
    vote_average: 7.5,
    vote_count: 1000,
    popularity: 500,
    original_language: 'en',
  };
}

const movieItems: CatalogItem[] = [
  makeItem(1, 'Oppenheimer', 'movie'),
  makeItem(2, 'Blade Runner 2049', 'movie'),
  makeItem(3, 'Interstellar', 'movie'),
];

const tvItems: CatalogItem[] = [
  makeItem(101, 'Foundation', 'tv'),
  makeItem(102, 'Severance', 'tv'),
];

/** 12 items to test the cap-at-10 behaviour */
const twelveItems: CatalogItem[] = Array.from({ length: 12 }, (_, i) =>
  makeItem(i + 1, `Film ${i + 1}`, 'movie'),
);

describe('RankedRow', () => {
  it('renders the section title', () => {
    render(<RankedRow title="Top 10 Movies This Week" items={movieItems} />);
    expect(
      screen.getByRole('heading', { name: 'Top 10 Movies This Week' }),
    ).toBeInTheDocument();
  });

  it('renders one numeral per item (1-based)', () => {
    render(<RankedRow title="Top 10" items={movieItems} />);
    // Numerals are aria-hidden spans; query by text content
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders numerals from 1 to items.length', () => {
    const fiveItems = Array.from({ length: 5 }, (_, i) =>
      makeItem(i + 10, `Movie ${i + 1}`, 'movie'),
    );
    render(<RankedRow title="Top 5" items={fiveItems} />);
    for (let n = 1; n <= 5; n++) {
      expect(screen.getByText(String(n))).toBeInTheDocument();
    }
  });

  describe('correct detail hrefs', () => {
    it('movie items link to /movies/{tmdb_id}', () => {
      render(<RankedRow title="Top 10" items={movieItems} />);
      const link = screen.getByRole('link', { name: /Number 1: Oppenheimer/i });
      expect(link).toHaveAttribute('href', '/movies/1');
    });

    it('tv items link to /tv/{tmdb_id}', () => {
      render(<RankedRow title="Top Shows" items={tvItems} />);
      const link = screen.getByRole('link', { name: /Number 1: Foundation/i });
      expect(link).toHaveAttribute('href', '/tv/101');
    });

    it('second item has the correct href', () => {
      render(<RankedRow title="Top 10" items={movieItems} />);
      const link = screen.getByRole('link', { name: /Number 2: Blade Runner 2049/i });
      expect(link).toHaveAttribute('href', '/movies/2');
    });
  });

  it('caps at 10 items even when more are provided', () => {
    render(<RankedRow title="Capped" items={twelveItems} />);
    // Only numerals 1-10 should appear; 11 and 12 should not
    for (let n = 1; n <= 10; n++) {
      expect(screen.getByText(String(n))).toBeInTheDocument();
    }
    expect(screen.queryByText('11')).not.toBeInTheDocument();
    expect(screen.queryByText('12')).not.toBeInTheDocument();
  });

  it('renders a "See all" link when seeAllHref is provided', () => {
    render(<RankedRow title="Top 10" items={movieItems} seeAllHref="/top-10" />);
    const link = screen.getByRole('link', { name: /See all/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/top-10');
  });

  it('does NOT render a "See all" link when seeAllHref is absent', () => {
    render(<RankedRow title="Top 10" items={movieItems} />);
    expect(screen.queryByRole('link', { name: /See all/i })).not.toBeInTheDocument();
  });

  it('renders both scroll arrow buttons', () => {
    render(<RankedRow title="Top 10" items={movieItems} />);
    expect(screen.getByRole('button', { name: 'Scroll left' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scroll right' })).toBeInTheDocument();
  });

  it('renders the scroll track with role=list', () => {
    render(<RankedRow title="Top 10" items={movieItems} />);
    // There are multiple role=list elements (section also has aria-labelledby)
    // The scroll track has role="list" and aria-labelledby
    const lists = screen.getAllByRole('list');
    expect(lists.length).toBeGreaterThan(0);
  });

  it('renders the poster image for each item', () => {
    render(<RankedRow title="Top 10" items={movieItems} />);
    // Each item should have an img with alt text matching the title
    expect(screen.getByRole('img', { name: 'Oppenheimer' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Blade Runner 2049' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Interstellar' })).toBeInTheDocument();
  });

  it('uses the placeholder when poster_url is null', () => {
    const itemNoImg: CatalogItem = { ...makeItem(999, 'No Poster'), poster_url: null };
    render(<RankedRow title="Top 10" items={[itemNoImg]} />);
    const img = screen.getByRole('img', { name: 'No Poster' });
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toContain('data:image/svg+xml');
  });

  it('renders an empty track gracefully when items is empty', () => {
    render(<RankedRow title="Empty Row" items={[]} />);
    expect(screen.getByRole('heading', { name: 'Empty Row' })).toBeInTheDocument();
    // No list items
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  // ── Eyebrow prop regression ─────────────────────────────────────────────────

  it('renders the eyebrow text when eyebrow prop is provided', () => {
    render(<RankedRow title="Top 10" items={movieItems} eyebrow="Most watched · this week" />);
    expect(screen.getByText('Most watched · this week')).toBeInTheDocument();
  });

  it('renders the eyebrow with "Critically acclaimed" text', () => {
    render(<RankedRow title="Top Rated" items={movieItems} eyebrow="Critically acclaimed" />);
    expect(screen.getByText('Critically acclaimed')).toBeInTheDocument();
  });

  it('does NOT render an eyebrow element when eyebrow prop is omitted', () => {
    render(<RankedRow title="Top 10" items={movieItems} />);
    expect(screen.queryByText('Most watched · this week')).not.toBeInTheDocument();
    expect(screen.queryByText('Critically acclaimed')).not.toBeInTheDocument();
  });
});
