import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock the UserContext so we can control currentUser without a real backend.
// ---------------------------------------------------------------------------
const mockUser = { id: 'user-1', username: 'alice', display_name: 'Alice', avatar: null, created_at: '' };

vi.mock('@/context/UserContext', () => ({
  useUser: () => ({ currentUser: mockUser }),
}));

// ---------------------------------------------------------------------------
// Mock the watchlistService so no real HTTP calls are made.
// ---------------------------------------------------------------------------
const mockAdd = vi.fn();
const mockRemove = vi.fn();
const mockList = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/services/watchlist', () => ({
  watchlistService: {
    add: (...args: unknown[]) => mockAdd(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    list: (...args: unknown[]) => mockList(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

const mockGetDetail = vi.fn();
const mockGetShow = vi.fn();
vi.mock('@/services/movies', () => ({
  moviesService: { getDetail: (...a: unknown[]) => mockGetDetail(...a) },
}));
vi.mock('@/services/tv', () => ({
  tvService: { getShow: (...a: unknown[]) => mockGetShow(...a) },
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up.
// ---------------------------------------------------------------------------
import { WatchlistProvider, useWatchlist } from './WatchlistContext';

// ---------------------------------------------------------------------------
// Helper: a component that uses every part of the context.
// ---------------------------------------------------------------------------
function Probe({ contentId = 'movie:1' }: { contentId?: string }) {
  const { items, isSaved, toggle, isLoading } = useWatchlist();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="count">{items.length}</span>
      <span data-testid="saved">{String(isSaved(contentId))}</span>
      <button
        data-testid="toggle"
        onClick={() => toggle({ content_id: contentId, tmdb_id: '1', media_type: 'movie', title: 'Test' })}
      >
        toggle
      </button>
    </div>
  );
}

function renderWithProvider(contentId?: string) {
  return render(
    <WatchlistProvider>
      <Probe contentId={contentId} />
    </WatchlistProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WatchlistContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDetail.mockResolvedValue({ poster_url: 'p.jpg', year: 1999, vote_average: 8.4, title: 'X' });
    mockGetShow.mockResolvedValue({ poster_url: 'p.jpg', year: 2011, vote_average: 8.4, name: 'X' });
    mockUpdate.mockResolvedValue({});
  });

  it('loads the watchlist on mount and is no longer loading', async () => {
    mockList.mockResolvedValueOnce([]);
    renderWithProvider();
    // Initially loading
    expect(screen.getByTestId('loading').textContent).toBe('true');
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(mockList).toHaveBeenCalledWith('user-1');
  });

  it('exposes items returned by the service', async () => {
    mockList.mockResolvedValueOnce([
      {
        id: 'w1',
        user_id: 'user-1',
        content_id: 'movie:42',
        tmdb_id: '42',
        media_type: 'movie',
        title: 'Foo',
        added_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ]);
    renderWithProvider('movie:42');
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(screen.getByTestId('saved').textContent).toBe('true');
  });

  it('isSaved returns false for unsaved content', async () => {
    mockList.mockResolvedValueOnce([]);
    renderWithProvider('movie:99');
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('saved').textContent).toBe('false');
  });

  it('toggle adds an item when not yet saved', async () => {
    mockList.mockResolvedValueOnce([]);
    const savedItem = {
      id: 'w2',
      user_id: 'user-1',
      content_id: 'movie:1',
      tmdb_id: '1',
      media_type: 'movie',
      title: 'Test',
      added_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    mockAdd.mockResolvedValueOnce(savedItem);

    const user = userEvent.setup();
    renderWithProvider('movie:1');
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await user.click(screen.getByTestId('toggle'));

    expect(mockAdd).toHaveBeenCalledWith('user-1', {
      content_id: 'movie:1',
      tmdb_id: '1',
      media_type: 'movie',
      title: 'Test',
    });
    await waitFor(() => expect(screen.getByTestId('saved').textContent).toBe('true'));
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('toggle removes an item when already saved', async () => {
    const existing = {
      id: 'w3',
      user_id: 'user-1',
      content_id: 'movie:1',
      tmdb_id: '1',
      media_type: 'movie',
      title: 'Test',
      added_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    mockList.mockResolvedValueOnce([existing]);
    mockRemove.mockResolvedValueOnce(undefined);

    const user = userEvent.setup();
    renderWithProvider('movie:1');
    await waitFor(() => expect(screen.getByTestId('saved').textContent).toBe('true'));

    await user.click(screen.getByTestId('toggle'));

    expect(mockRemove).toHaveBeenCalledWith('user-1', 'movie:1');
    await waitFor(() => expect(screen.getByTestId('saved').textContent).toBe('false'));
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('hydrates a saved item that is missing poster metadata', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'w1', user_id: 'user-1', content_id: 'movie:550', tmdb_id: '550',
        media_type: 'movie', title: 'Fight Club',
        added_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ]);
    mockGetDetail.mockResolvedValueOnce({ poster_url: 'fc.jpg', year: 1999, vote_average: 8.4, title: 'Fight Club' });

    renderWithProvider('movie:550');
    await waitFor(() => expect(mockGetDetail).toHaveBeenCalledWith(550));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('user-1', 'movie:550', {
        poster_url: 'fc.jpg', year: 1999, vote_average: 8.4, title: 'Fight Club',
      }),
    );
  });

  it('does not hydrate items that already have a poster_url', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'w2', user_id: 'user-1', content_id: 'movie:551', tmdb_id: '551',
        media_type: 'movie', title: 'X', poster_url: 'already.jpg',
        added_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ]);
    renderWithProvider('movie:551');
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(mockGetDetail).not.toHaveBeenCalled();
  });

  it('useWatchlist throws when used outside WatchlistProvider', () => {
    // Suppress the expected console.error from React
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function BadConsumer() {
      useWatchlist();
      return null;
    }
    expect(() => render(<BadConsumer />)).toThrow(
      'useWatchlist must be used within a WatchlistProvider',
    );
    spy.mockRestore();
  });
});
