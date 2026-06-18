/**
 * BrowseScreen — Vitest + RTL tests
 *
 * Spec (Task 8):
 *  - given a hero + two rows (one poster, one ranked) renders the hero title +
 *    both row titles + the right number of cards/numerals
 *  - omits the FeaturedRail when featured is empty
 *  - renders the FeaturedRail when featured items are provided
 *  - skips rows with zero items
 *  - renders ContinueWatchingRow when showContinueWatching is true
 *  - does NOT render ContinueWatchingRow when showContinueWatching is false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import BrowseScreen from './BrowseScreen';
import type { CatalogItem } from '@/types';

// ---------------------------------------------------------------------------
// Mock child components to isolate BrowseScreen logic and avoid deep tree issues
// (ContinueWatchingRow reads contexts; mock it so we don't need to stub them)
// ---------------------------------------------------------------------------

vi.mock('./Hero', () => ({
  default: ({ item }: { item: CatalogItem }) => (
    <div data-testid="mock-hero">{item.title}</div>
  ),
}));

vi.mock('./FeaturedRail', () => ({
  default: ({ items }: { items: CatalogItem[] }) =>
    items.length > 0 ? (
      <div data-testid="mock-featured-rail">
        {items.map((i) => (
          <span key={i.tmdb_id}>{i.title}</span>
        ))}
      </div>
    ) : null,
}));

vi.mock('./ContinueWatchingRow', () => ({
  default: () => (
    <section data-testid="mock-continue-watching">Continue Watching</section>
  ),
}));

vi.mock('./Row', () => ({
  default: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <section data-testid={`mock-row-${title}`}>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

vi.mock('./RankedRow', () => ({
  default: ({ title, items }: { title: string; items: CatalogItem[] }) => (
    <section data-testid={`mock-ranked-row-${title}`}>
      <h2>{title}</h2>
      {items.map((item, index) => (
        <span key={item.tmdb_id} data-testid="ranked-numeral">
          {index + 1}
        </span>
      ))}
    </section>
  ),
}));

vi.mock('./PosterCard', () => ({
  default: ({ item }: { item: CatalogItem }) => (
    <div data-testid="mock-poster-card">{item.title}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(id: number, title: string, mediaType: 'movie' | 'tv' = 'movie'): CatalogItem {
  return {
    tmdb_id: id,
    media_type: mediaType,
    title,
    year: 2024,
    overview: `Overview of ${title}`,
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

const heroItem = makeItem(1, 'Dune: Part Two');
const featuredItems = [makeItem(2, 'Oppenheimer'), makeItem(3, 'Barbie')];

const posterRowItems = [makeItem(4, 'Film One'), makeItem(5, 'Film Two'), makeItem(6, 'Film Three')];
const rankedRowItems = [makeItem(7, 'Top Film A'), makeItem(8, 'Top Film B'), makeItem(9, 'Top Film C')];

const posterRow = {
  key: 'trending',
  title: 'Trending Now',
  items: posterRowItems,
  variant: 'poster' as const,
};

const rankedRow = {
  key: 'top10',
  title: 'Top 10 Movies',
  items: rankedRowItems,
  variant: 'ranked' as const,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BrowseScreen', () => {
  describe('hero rendering', () => {
    it('renders the hero when provided', () => {
      render(<BrowseScreen hero={heroItem} rows={[]} />);
      expect(screen.getByTestId('mock-hero')).toBeInTheDocument();
      expect(screen.getByText('Dune: Part Two')).toBeInTheDocument();
    });

    it('does not render a hero when hero prop is not provided', () => {
      render(<BrowseScreen rows={[]} />);
      expect(screen.queryByTestId('mock-hero')).not.toBeInTheDocument();
    });
  });

  describe('FeaturedRail', () => {
    it('renders the FeaturedRail when featured items are provided', () => {
      render(
        <BrowseScreen
          hero={heroItem}
          featured={featuredItems}
          rows={[]}
        />,
      );
      expect(screen.getByTestId('mock-featured-rail')).toBeInTheDocument();
    });

    it('omits the FeaturedRail when featured is an empty array', () => {
      render(
        <BrowseScreen
          hero={heroItem}
          featured={[]}
          rows={[]}
        />,
      );
      expect(screen.queryByTestId('mock-featured-rail')).not.toBeInTheDocument();
    });

    it('omits the FeaturedRail when featured prop is not provided', () => {
      render(<BrowseScreen hero={heroItem} rows={[]} />);
      expect(screen.queryByTestId('mock-featured-rail')).not.toBeInTheDocument();
    });
  });

  describe('ContinueWatchingRow', () => {
    it('renders ContinueWatchingRow when showContinueWatching is true', () => {
      render(
        <BrowseScreen rows={[]} showContinueWatching />,
      );
      expect(screen.getByTestId('mock-continue-watching')).toBeInTheDocument();
    });

    it('does NOT render ContinueWatchingRow when showContinueWatching is false', () => {
      render(
        <BrowseScreen rows={[]} showContinueWatching={false} />,
      );
      expect(screen.queryByTestId('mock-continue-watching')).not.toBeInTheDocument();
    });

    it('does NOT render ContinueWatchingRow when showContinueWatching is omitted', () => {
      render(<BrowseScreen rows={[]} />);
      expect(screen.queryByTestId('mock-continue-watching')).not.toBeInTheDocument();
    });
  });

  describe('content rows', () => {
    it('renders the poster row title', () => {
      render(<BrowseScreen rows={[posterRow]} />);
      expect(screen.getByRole('heading', { name: 'Trending Now' })).toBeInTheDocument();
    });

    it('renders the ranked row title', () => {
      render(<BrowseScreen rows={[rankedRow]} />);
      expect(screen.getByRole('heading', { name: 'Top 10 Movies' })).toBeInTheDocument();
    });

    it('renders both row titles when given a poster and a ranked row', () => {
      render(<BrowseScreen rows={[posterRow, rankedRow]} />);
      expect(screen.getByRole('heading', { name: 'Trending Now' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Top 10 Movies' })).toBeInTheDocument();
    });

    it('renders the correct number of PosterCards in a poster row', () => {
      render(<BrowseScreen rows={[posterRow]} />);
      const cards = screen.getAllByTestId('mock-poster-card');
      expect(cards).toHaveLength(posterRowItems.length);
    });

    it('renders the correct number of ranked numerals in a ranked row', () => {
      render(<BrowseScreen rows={[rankedRow]} />);
      const numerals = screen.getAllByTestId('ranked-numeral');
      expect(numerals).toHaveLength(rankedRowItems.length);
    });

    it('renders ranked numerals as 1-indexed sequential numbers', () => {
      render(<BrowseScreen rows={[rankedRow]} />);
      const numerals = screen.getAllByTestId('ranked-numeral');
      numerals.forEach((el, idx) => {
        expect(el.textContent).toBe(String(idx + 1));
      });
    });

    it('skips rows with no items (does not render an empty section)', () => {
      const emptyRow = { key: 'empty', title: 'Empty Row', items: [] };
      render(<BrowseScreen rows={[emptyRow, posterRow]} />);
      // The empty row should not appear
      expect(screen.queryByRole('heading', { name: 'Empty Row' })).not.toBeInTheDocument();
      // The poster row should still appear
      expect(screen.getByRole('heading', { name: 'Trending Now' })).toBeInTheDocument();
    });

    it('renders poster row items as PosterCards with correct titles', () => {
      render(<BrowseScreen rows={[posterRow]} />);
      expect(screen.getByText('Film One')).toBeInTheDocument();
      expect(screen.getByText('Film Two')).toBeInTheDocument();
      expect(screen.getByText('Film Three')).toBeInTheDocument();
    });
  });

  describe('full composition', () => {
    it('renders hero title + both row titles + correct card/numeral counts', () => {
      render(
        <BrowseScreen
          hero={heroItem}
          featured={featuredItems}
          rows={[posterRow, rankedRow]}
          showContinueWatching
        />,
      );

      // Hero
      expect(screen.getByText('Dune: Part Two')).toBeInTheDocument();

      // Featured rail is rendered
      expect(screen.getByTestId('mock-featured-rail')).toBeInTheDocument();

      // Continue Watching section
      expect(screen.getByTestId('mock-continue-watching')).toBeInTheDocument();

      // Both row titles
      expect(screen.getByRole('heading', { name: 'Trending Now' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Top 10 Movies' })).toBeInTheDocument();

      // Correct number of PosterCards for the poster row
      const cards = screen.getAllByTestId('mock-poster-card');
      expect(cards).toHaveLength(posterRowItems.length);

      // Correct number of ranked numerals for the ranked row
      const numerals = screen.getAllByTestId('ranked-numeral');
      expect(numerals).toHaveLength(rankedRowItems.length);
    });

    it('renders the browse-screen container', () => {
      render(<BrowseScreen rows={[]} />);
      expect(screen.getByTestId('browse-screen')).toBeInTheDocument();
    });
  });
});
