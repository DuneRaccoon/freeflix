/**
 * ContinueWatchingRow — Vitest + RTL tests
 *
 * Spec (Task 7, then "Continue Watching opens the title page"):
 *  - with a mocked useProgress/useUser providing a movie + a TV episode in
 *    progress, renders both cards
 *  - a card whose title can be identified opens that title's page —
 *    /movies/{id}, or /tv/{id}?season=S&episode=E for the episode the row is
 *    about — never the player; only a title it cannot identify keeps the
 *    /streaming/{torrent_id}?file=N link
 *  - each card's accessible name says that it opens the title
 *  - the gold progress bar is present
 *  - the remove button is present, and pressing it never follows the card link
 *  - renders nothing when progressData is empty
 *
 * next/link is the real one, as in PosterCard.test.tsx. next/navigation is not
 * mocked: the row never calls useRouter, so a push spy here could not fail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

vi.mock('@/services/movies', () => ({
  moviesService: { getDetail: vi.fn() },
}));

vi.mock('@/services/tv', () => ({
  tvService: { getShow: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { useProgress } from '@/context/ProgressContext';
import { useUser } from '@/context/UserContext';
import { streamingService } from '@/services/streaming';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { __resetTitleImageCache } from '@/lib/useTitleImages';

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
  // Shared module cache in useTitleImages must not leak resolved artwork between cases.
  __resetTitleImageCache();
  // Default: artwork lookups stay pending (never resolve), so cases that don't
  // care about images render in the loading/placeholder state and never fire a
  // late, un-acted state update. Image cases override these per-test.
  (moviesService.getDetail as ReturnType<typeof vi.fn>).mockImplementation(
    () => new Promise(() => {}),
  );
  (tvService.getShow as ReturnType<typeof vi.fn>).mockImplementation(
    () => new Promise(() => {}),
  );
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

  it('the TV card opens the show page on the episode the row is about', () => {
    setupMocks({ 'tv:54321:s1:e3': tvProgress });
    render(<ContinueWatchingRow />);
    const card = screen.getByRole('link', { name: 'Open Foundation, resume S01·E03' });
    expect(card).toHaveAttribute('href', '/tv/54321?season=1&episode=3');
  });

  it('the movie card opens the movie page', () => {
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    const card = screen.getByRole('link', { name: 'Open Interstellar, 50% watched' });
    expect(card).toHaveAttribute('href', '/movies/12345');
  });

  it('an Up next card opens the show page on the finished episode', () => {
    setupMocks({ 'tv:54321:s1:e3': { ...tvProgress, completed: true, percentage: 100 } });
    render(<ContinueWatchingRow />);
    const card = screen.getByRole('link', { name: 'Open Foundation, up next S01·E04' });
    // The episode just finished, not episode + 1: nothing in a progress row says that E04
    // exists, and the show page is what works out which episode follows.
    expect(card).toHaveAttribute('href', '/tv/54321?season=1&episode=3');
    expect(screen.getByText('Up next')).toBeInTheDocument();
  });

  it('a title it cannot identify still opens the player', () => {
    // A legacy title-string id, from before content ids: there is no tmdb id to build a
    // title page on, so the card keeps the only link it can make.
    setupMocks({ Interstellar: { ...movieProgress, movie_id: 'Interstellar' } });
    render(<ContinueWatchingRow />);
    const card = screen.getByRole('link', { name: 'Open Interstellar, 50% watched' });
    expect(card).toHaveAttribute('href', '/streaming/torrent-movie-1');
  });

  it('an unidentified episode keeps its file on the player link, file 0 included', () => {
    // tmdb id 0 names no show, so this show card falls back to the player — and a season
    // pack's player link without `?file=` no longer says which of its files the row was.
    setupMocks({ 'tv:0:s1:e3': { ...tvProgress, movie_id: 'tv:0:s1:e3', file_index: 0 } });
    render(<ContinueWatchingRow />);
    const card = screen.getByRole('link', { name: 'Open Foundation, resume S01·E03' });
    expect(card).toHaveAttribute('href', '/streaming/torrent-tv-1?file=0');
  });

  it('no identified card links to the player', () => {
    setupMocks({
      'movie:12345': movieProgress,
      'tv:54321:s1:e3': tvProgress,
    });
    render(<ContinueWatchingRow />);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    // Both cards are among the links, so the sweep below cannot pass by finding nothing.
    expect(hrefs).toEqual(
      expect.arrayContaining(['/movies/12345', '/tv/54321?season=1&episode=3']),
    );
    for (const href of hrefs) expect(href).not.toMatch(/^\/streaming\//);
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

  it('Remove never navigates', async () => {
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    const remove = screen.getByRole('button', {
      name: 'Remove Interstellar from Continue Watching',
    });
    // The button sits INSIDE the card's link, so a click it leaves uncancelled is a click on
    // that link: the browser follows the href, and next/link stands aside only for a click
    // that is already cancelled.
    expect(remove.closest('a')).toHaveAttribute('href', '/movies/12345');
    // fireEvent returns false only when a handler cancelled the click. jsdom performs no
    // navigation and next/link has no router here, so the cancelled default IS the observable.
    expect(fireEvent.click(remove)).toBe(false);
    expect(streamingService.deleteProgress).toHaveBeenCalledWith('user-1', 'prog-movie-1');
    await waitFor(() => expect(mockRefreshProgress).toHaveBeenCalled());
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

  // ── Card artwork ────────────────────────────────────────────────────────────

  it('renders the movie backdrop image once resolved', async () => {
    (moviesService.getDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      backdrop_url: 'https://img/movie-backdrop.jpg',
      poster_url: 'https://img/movie-poster.jpg',
    });
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    const img = await screen.findByTestId('cw-card-image');
    expect(img).toHaveAttribute('src', 'https://img/movie-backdrop.jpg');
    expect(moviesService.getDetail).toHaveBeenCalledWith(12345);
  });

  it('renders the TV show backdrop image (by show id) once resolved', async () => {
    (tvService.getShow as ReturnType<typeof vi.fn>).mockResolvedValue({
      backdrop_url: 'https://img/tv-backdrop.jpg',
      poster_url: 'https://img/tv-poster.jpg',
    });
    setupMocks({ 'tv:54321:s1:e3': tvProgress });
    render(<ContinueWatchingRow />);
    const img = await screen.findByTestId('cw-card-image');
    expect(img).toHaveAttribute('src', 'https://img/tv-backdrop.jpg');
    expect(tvService.getShow).toHaveBeenCalledWith(54321);
  });

  it('falls back to the poster when the title has no backdrop', async () => {
    (moviesService.getDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      backdrop_url: null,
      poster_url: 'https://img/movie-poster.jpg',
    });
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    const img = await screen.findByTestId('cw-card-image');
    expect(img).toHaveAttribute('src', 'https://img/movie-poster.jpg');
  });

  // ── Title-card art placeholder fallback ─────────────────────────────────────

  it('keeps the title-card placeholder (no image) when the title has no artwork', async () => {
    (moviesService.getDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      backdrop_url: null,
      poster_url: null,
    });
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    // Let the (empty-artwork) lookup settle inside act, then assert no <img>.
    await act(async () => {});
    expect(screen.queryByTestId('cw-card-image')).toBeNull();
    // Placeholder title text (aria-hidden span) is present alongside the meta <h3>.
    expect(screen.getAllByText('Interstellar').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the title-card placeholder when the artwork lookup fails', async () => {
    (moviesService.getDetail as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    setupMocks({ 'movie:12345': movieProgress });
    render(<ContinueWatchingRow />);
    await act(async () => {});
    expect(screen.queryByTestId('cw-card-image')).toBeNull();
    expect(screen.getAllByText('Interstellar').length).toBeGreaterThanOrEqual(1);
  });
});
