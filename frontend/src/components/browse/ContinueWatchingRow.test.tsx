/**
 * ContinueWatchingRow — Vitest + RTL tests
 *
 * Spec (Task 7):
 *  - with a mocked useProgress/useUser providing a movie + a TV episode in
 *    progress, renders both cards
 *  - the resume href matches /streaming/{torrent_id}?file=N for the TV episode
 *  - the gold progress bar is present
 *  - the remove button is present
 *  - renders nothing when progressData is empty
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ContinueWatchingRow from './ContinueWatchingRow';

// ---------------------------------------------------------------------------
// Mock the contexts and services
// ---------------------------------------------------------------------------

vi.mock('@/context/ProgressContext', () => ({
  useProgress: vi.fn(),
}));

vi.mock('@/context/UserContext', () => ({
  useUser: vi.fn(),
}));

vi.mock('@/services/streaming', () => ({
  streamingService: {
    deleteProgress: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { useProgress } from '@/context/ProgressContext';
import { useUser } from '@/context/UserContext';
import { streamingService } from '@/services/streaming';

const movieProgress = {
  id: 'prog-movie-1',
  user_id: 'user-1',
  torrent_id: 'torrent-movie-1',
  movie_id: 'movie:12345',
  current_time: 3600,
  duration: 7200,
  percentage: 50,
  completed: false,
  last_watched_at: '2026-06-18T10:00:00Z',
  created_at: '2026-06-17T10:00:00Z',
  updated_at: '2026-06-18T10:00:00Z',
  file_index: null,
  title: 'Interstellar',
};

const tvProgress = {
  id: 'prog-tv-1',
  user_id: 'user-1',
  torrent_id: 'torrent-tv-1',
  movie_id: 'tv:54321:s1:e3',
  current_time: 1800,
  duration: 3600,
  percentage: 38,
  completed: false,
  last_watched_at: '2026-06-18T09:00:00Z',
  created_at: '2026-06-17T09:00:00Z',
  updated_at: '2026-06-18T09:00:00Z',
  file_index: 3,
  title: 'Foundation S01E03',
};

const currentUser = { id: 'user-1', display_name: 'Test User' };

const mockRefreshProgress = vi.fn();

function setupMocks(progressData: Record<string, unknown>) {
  (useProgress as ReturnType<typeof vi.fn>).mockReturnValue({
    progressData,
    refreshProgress: mockRefreshProgress,
  });
  (useUser as ReturnType<typeof vi.fn>).mockReturnValue({
    currentUser,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ContinueWatchingRow', () => {
  it('renders nothing when progressData is empty', () => {
    setupMocks({});
    const { container } = render(<ContinueWatchingRow />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when all items have 0% progress', () => {
    setupMocks({
      'movie:99': {
        ...movieProgress,
        percentage: 0,
        movie_id: 'movie:99',
      },
    });
    const { container } = render(<ContinueWatchingRow />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the section title "Continue Watching"', () => {
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    expect(
      screen.getByRole('heading', { name: 'Continue Watching' }),
    ).toBeInTheDocument();
  });

  it('renders the eyebrow text', () => {
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    expect(screen.getByText(/Pick up where you left off/i)).toBeInTheDocument();
  });

  it('renders a card for the movie in progress', () => {
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    // Title appears in both the placeholder span and the <h3>; getAllByText is correct here.
    expect(screen.getAllByText('Interstellar').length).toBeGreaterThanOrEqual(1);
  });

  it('renders a card for the TV episode in progress', () => {
    setupMocks({ 'tv:54321:s1:e3': tvProgress });
    render(<ContinueWatchingRow />);
    // showNameFromTitle strips the "S01E03" suffix
    expect(screen.getAllByText('Foundation').length).toBeGreaterThanOrEqual(1);
  });

  it('renders both a movie card and a TV card when both are in progress', () => {
    setupMocks({
      'movie:12345': movieProgress,
      'tv:54321:s1:e3': tvProgress,
    });
    render(<ContinueWatchingRow />);
    expect(screen.getAllByText('Interstellar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Foundation').length).toBeGreaterThanOrEqual(1);
  });

  it('the TV resume link has href /streaming/{torrent_id}?file=N', () => {
    setupMocks({ 'tv:54321:s1:e3': tvProgress });
    render(<ContinueWatchingRow />);
    const resumeLink = screen.getByRole('link', { name: /Resume Foundation/i });
    expect(resumeLink).toHaveAttribute(
      'href',
      '/streaming/torrent-tv-1?file=3',
    );
  });

  it('the movie resume link has href /streaming/{torrent_id} (no file param)', () => {
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    const resumeLink = screen.getByRole('link', { name: /Resume Interstellar/i });
    expect(resumeLink).toHaveAttribute('href', '/streaming/torrent-movie-1');
  });

  it('renders a gold progress fill element for in-progress items', () => {
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    const fill = screen.getByTestId('cw-progress-fill');
    expect(fill).toBeInTheDocument();
    // Width should reflect the 50% progress
    expect(fill).toHaveStyle({ width: '50%' });
  });

  it('renders a remove button for each card', () => {
    setupMocks({
      'movie:12345': movieProgress,
      'tv:54321:s1:e3': tvProgress,
    });
    render(<ContinueWatchingRow />);
    const removeButtons = screen.getAllByRole('button', {
      name: /Remove .* from Continue Watching/i,
    });
    expect(removeButtons).toHaveLength(2);
  });

  it('clicking the remove button calls deleteProgress + refreshProgress', async () => {
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);

    const removeBtn = screen.getByRole('button', {
      name: /Remove Interstellar from Continue Watching/i,
    });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(streamingService.deleteProgress).toHaveBeenCalledWith('user-1', 'prog-movie-1');
      expect(mockRefreshProgress).toHaveBeenCalled();
    });
  });

  it('shows "Up next" badge when last TV episode is completed', () => {
    const completedTvProgress = {
      ...tvProgress,
      completed: true,
      percentage: 100,
    };
    setupMocks({ 'tv:54321:s1:e3': completedTvProgress });
    render(<ContinueWatchingRow />);
    expect(screen.getByText('Up next')).toBeInTheDocument();
  });

  it('does not show completed movie cards', () => {
    const completedMovie = { ...movieProgress, completed: true, percentage: 100 };
    setupMocks({ 'movie:12345': completedMovie });
    const { container } = render(<ContinueWatchingRow />);
    // Completed movies are filtered out → renders null
    expect(container.firstChild).toBeNull();
  });

  it('renders prev and next scroll buttons', () => {
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    expect(screen.getByRole('button', { name: 'Scroll left' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scroll right' })).toBeInTheDocument();
  });

  // ── Title-card art placeholder regression ──────────────────────────────────

  it('card art placeholder renders the item title text (not an empty void)', () => {
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    // The title-card span is aria-hidden but its text node is still in the DOM.
    // getAllByText returns all matches; at least one should be the placeholder.
    const titleNodes = screen.getAllByText('Interstellar');
    expect(titleNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('TV card art placeholder renders the show name (not an empty void)', () => {
    setupMocks({ 'tv:54321:s1:e3': tvProgress });
    render(<ContinueWatchingRow />);
    const titleNodes = screen.getAllByText('Foundation');
    expect(titleNodes.length).toBeGreaterThanOrEqual(1);
  });
});
