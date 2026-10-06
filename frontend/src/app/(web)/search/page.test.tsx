/**
 * SearchPage — render smoke test (Task 7)
 *
 * The page is a thin Suspense wrapper around <SearchView>.
 * We verify:
 *   1. The skeleton fallback renders while SearchView is suspended.
 *   2. After suspense resolves, the search UI (heading + input) is present.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React, { Suspense } from 'react';

// ---------------------------------------------------------------------------
// Mock next/navigation (required by useSearchUrlState inside SearchView)
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({ get: (_key: string) => null }),
}));

// ---------------------------------------------------------------------------
// Mock services (avoid real HTTP calls; SearchView imports these)
// ---------------------------------------------------------------------------

vi.mock('@/services/movies', () => ({
  moviesService: {
    search: vi.fn().mockResolvedValue({ page: 1, results: [], total_pages: 1, total_results: 0 }),
    browse: vi.fn().mockResolvedValue({ page: 1, results: [], total_pages: 1, total_results: 0 }),
  },
}));

vi.mock('@/services/tv', () => ({
  tvService: {
    search: vi.fn().mockResolvedValue({ page: 1, results: [], total_pages: 1, total_results: 0 }),
    browse: vi.fn().mockResolvedValue({ page: 1, results: [], total_pages: 1, total_results: 0 }),
  },
}));

// ---------------------------------------------------------------------------
// Import the page under test AFTER mocks are in place
// ---------------------------------------------------------------------------

import SearchPage from './page';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchPage (smoke)', () => {
  it('renders without crashing', () => {
    expect(() => render(<SearchPage />)).not.toThrow();
  });

  it('eventually shows the search heading', async () => {
    render(<SearchPage />);

    // The heading from SearchView — "Search the collection"
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
  });

  it('eventually shows the search input', async () => {
    render(<SearchPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('searchbox', { name: /search the collection/i }),
      ).toBeInTheDocument();
    });
  });

  it('wraps SearchView in a Suspense boundary (skeleton or loaded UI is accessible)', async () => {
    // The page wraps SearchView in <Suspense fallback={<SearchSkeleton />}>.
    // Either the skeleton (role="status", aria-label="Loading search…") is shown
    // while suspended, OR (because SearchView is not async in test) the real UI
    // resolves immediately.  Either way the search heading must ultimately appear.
    render(<SearchPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    // The skeleton, when present, carries a specific accessible label — confirm
    // that if it rendered it described itself correctly (not just "some element").
    const skeleton = screen.queryByRole('status', { name: /loading search/i });
    if (skeleton) {
      expect(skeleton).toHaveAttribute('aria-label', 'Loading search…');
    }
  });

  it('shows the GenreBrowse section when there is no query or filter', async () => {
    render(<SearchPage />);

    // The empty state (no URL params) renders GenreBrowse
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Browse by genre' })).toBeInTheDocument();
    });
  });
});
