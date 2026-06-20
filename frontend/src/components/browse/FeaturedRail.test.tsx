/**
 * FeaturedRail — Vitest + RTL tests
 *
 * Spec (Task 5):
 *  - renders a tile per item with the title + correct detail href
 *  - renders nothing when items is empty
 *  - "Featured" badge is present on each tile
 *  - movie items link to /movies/{tmdb_id}
 *  - tv items link to /tv/{tmdb_id}
 *  - the section has the accessible label "Featured collection"
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FeaturedRail from './FeaturedRail';
import type { CatalogItem } from '@/types';

/** Build a minimal CatalogItem for test purposes */
function makeItem(
  id: number,
  title: string,
  mediaType: 'movie' | 'tv' = 'movie',
): CatalogItem {
  return {
    tmdb_id: id,
    media_type: mediaType,
    title,
    year: 2023,
    overview: `Overview of ${title}`,
    poster_url: `https://image.tmdb.org/t/p/w500/poster-${id}.jpg`,
    backdrop_url: `https://image.tmdb.org/t/p/w1280/backdrop-${id}.jpg`,
    genre_ids: [28],
    genres: ['Action'],
    vote_average: 7.8,
    vote_count: 2000,
    popularity: 800,
    original_language: 'en',
  };
}

const movieItems: CatalogItem[] = [
  makeItem(1, 'Dune: Part Two', 'movie'),
  makeItem(2, 'Oppenheimer', 'movie'),
  makeItem(3, 'The Batman', 'movie'),
];

const tvItems: CatalogItem[] = [
  makeItem(101, 'Severance', 'tv'),
  makeItem(102, 'The Last of Us', 'tv'),
];

describe('FeaturedRail', () => {
  it('renders nothing when items is empty', () => {
    const { container } = render(<FeaturedRail items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a tile for each item', () => {
    render(<FeaturedRail items={movieItems} />);
    // Each tile has an accessible name matching the title (aria-label on the Link)
    expect(screen.getByRole('link', { name: 'Dune: Part Two' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Oppenheimer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'The Batman' })).toBeInTheDocument();
  });

  it('renders the title text within each tile', () => {
    render(<FeaturedRail items={movieItems} />);
    expect(screen.getByText('Dune: Part Two')).toBeInTheDocument();
    expect(screen.getByText('Oppenheimer')).toBeInTheDocument();
    expect(screen.getByText('The Batman')).toBeInTheDocument();
  });

  it('movie items link to /movies/{tmdb_id}', () => {
    render(<FeaturedRail items={movieItems} />);
    expect(screen.getByRole('link', { name: 'Dune: Part Two' })).toHaveAttribute(
      'href',
      '/movies/1',
    );
    expect(screen.getByRole('link', { name: 'Oppenheimer' })).toHaveAttribute(
      'href',
      '/movies/2',
    );
  });

  it('tv items link to /tv/{tmdb_id}', () => {
    render(<FeaturedRail items={tvItems} />);
    expect(screen.getByRole('link', { name: 'Severance' })).toHaveAttribute(
      'href',
      '/tv/101',
    );
    expect(screen.getByRole('link', { name: 'The Last of Us' })).toHaveAttribute(
      'href',
      '/tv/102',
    );
  });

  it('renders the "Featured" badge on each tile', () => {
    render(<FeaturedRail items={movieItems} />);
    const badges = screen.getAllByText('Featured');
    // One badge per item
    expect(badges).toHaveLength(movieItems.length);
  });

  it('renders the section with the accessible label "Featured collection"', () => {
    render(<FeaturedRail items={movieItems} />);
    expect(
      screen.getByRole('region', { name: 'Featured collection' }),
    ).toBeInTheDocument();
  });

  it('renders a single item correctly', () => {
    const single = [makeItem(999, 'Blade Runner 2049', 'movie')];
    render(<FeaturedRail items={single} />);
    expect(screen.getByRole('link', { name: 'Blade Runner 2049' })).toHaveAttribute(
      'href',
      '/movies/999',
    );
    expect(screen.getByText('Blade Runner 2049')).toBeInTheDocument();
  });

  it('uses the backdrop placeholder when backdrop_url is null', () => {
    const itemNoBackdrop: CatalogItem = {
      ...makeItem(888, 'No Backdrop'),
      backdrop_url: null,
    };
    render(<FeaturedRail items={[itemNoBackdrop]} />);
    const img = document.querySelector('img[aria-hidden="true"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    // src should be the placeholder data URI when backdrop_url is null
    expect(img.getAttribute('src')).toContain('data:image/svg+xml');
  });

  it('renders the scroll track list element', () => {
    render(<FeaturedRail items={movieItems} />);
    const list = screen.getByRole('list', { name: 'Featured' });
    expect(list).toBeInTheDocument();
  });
});
