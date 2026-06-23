/**
 * MyListView — Vitest + RTL tests
 *
 * Spec (Task B5):
 *  - shows skeleton while loading
 *  - shows empty state when list is empty + empty-state browse links
 *  - renders PosterCards for each watchlist item when loaded
 *  - shows item count in the header when items exist
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { WatchlistItem } from '@/services/watchlist';

// ---------------------------------------------------------------------------
// Mock WatchlistContext
// ---------------------------------------------------------------------------

const mockItems: WatchlistItem[] = [];
let mockIsLoading = false;

const mockIsSaved = vi.fn(() => false);
const mockToggle = vi.fn();

vi.mock('@/context/WatchlistContext', () => ({
  useWatchlist: () => ({
    items: mockItems,
    isLoading: mockIsLoading,
    isSaved: mockIsSaved,
    toggle: mockToggle,
    savedIds: new Set<string>(),
    refresh: vi.fn(),
  }),
}));

// Silence Next.js Link warnings in jsdom
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('a', { href, ...rest }, children),
}));

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------

import MyListView from './MyListView';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    id: 'w1',
    user_id: 'user-1',
    content_id: 'movie:42',
    tmdb_id: '42',
    media_type: 'movie',
    title: 'Dune: Part Two',
    added_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MyListView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset shared state
    mockItems.length = 0;
    mockIsLoading = false;
  });

  it('renders the page heading', () => {
    render(<MyListView />);
    expect(screen.getByRole('heading', { level: 1, name: /My List/i })).toBeInTheDocument();
  });

  it('shows the eyebrow label "Your Collection"', () => {
    render(<MyListView />);
    expect(screen.getByText(/Your Collection/i)).toBeInTheDocument();
  });

  it('shows skeleton (aria-busy) while loading', () => {
    mockIsLoading = true;
    render(<MyListView />);
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    // Grid should NOT be rendered
    expect(screen.queryByTestId('my-list-grid')).not.toBeInTheDocument();
  });

  it('shows empty state when list is empty and not loading', () => {
    render(<MyListView />);
    expect(screen.getByText(/Your list is empty/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse Movies/i })).toHaveAttribute('href', '/movies');
    expect(screen.getByRole('link', { name: /Browse Series/i })).toHaveAttribute('href', '/tv');
  });

  it('does not show empty state while loading', () => {
    mockIsLoading = true;
    render(<MyListView />);
    expect(screen.queryByText(/Your list is empty/i)).not.toBeInTheDocument();
  });

  it('renders a PosterCard for each watchlist item', () => {
    mockItems.push(
      makeItem({ content_id: 'movie:42', tmdb_id: '42', title: 'Dune: Part Two' }),
      makeItem({ content_id: 'movie:43', id: 'w2', tmdb_id: '43', title: 'Oppenheimer' }),
    );
    render(<MyListView />);
    expect(screen.getByTestId('my-list-grid')).toBeInTheDocument();
    // PosterCard renders titles in resting caption
    expect(screen.getAllByText('Dune: Part Two').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Oppenheimer').length).toBeGreaterThan(0);
  });

  it('shows item count when items exist', () => {
    mockItems.push(
      makeItem({ content_id: 'movie:42', tmdb_id: '42', title: 'Dune: Part Two' }),
    );
    render(<MyListView />);
    expect(screen.getByText(/1 title saved/i)).toBeInTheDocument();
  });

  it('uses plural "titles" when more than one item', () => {
    mockItems.push(
      makeItem({ content_id: 'movie:42', tmdb_id: '42', title: 'Dune: Part Two' }),
      makeItem({ content_id: 'movie:43', id: 'w2', tmdb_id: '43', title: 'Oppenheimer' }),
    );
    render(<MyListView />);
    expect(screen.getByText(/2 titles saved/i)).toBeInTheDocument();
  });

  it('does not show item count when loading', () => {
    mockIsLoading = true;
    render(<MyListView />);
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });

  it('handles tv items in watchlist (renders via PosterCard)', () => {
    mockItems.push(
      makeItem({
        content_id: 'tv:84958',
        tmdb_id: '84958',
        media_type: 'tv',
        title: 'Loki',
      }),
    );
    render(<MyListView />);
    expect(screen.getAllByText('Loki').length).toBeGreaterThan(0);
  });

  it('renders the root container with data-testid my-list-view', () => {
    render(<MyListView />);
    expect(screen.getByTestId('my-list-view')).toBeInTheDocument();
  });

  it('renders the stored poster year and rating for a saved item', () => {
    mockItems.push(
      makeItem({ content_id: 'movie:550', tmdb_id: '550', title: 'Fight Club', year: 1999, vote_average: 8.4 }),
    );
    render(<MyListView />);
    expect(screen.getAllByText('1999').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8.4').length).toBeGreaterThan(0);
  });
});
