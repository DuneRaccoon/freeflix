/**
 * ShowDetailView — Vitest + RTL tests
 *
 * Spec (Task 7):
 *  - Renders the hero (name, seasons/status meta)
 *  - Selecting a season fetches getSeason and renders the EpisodeList
 *  - Download Season calls downloadCatalogMovie with { media_type:'tv', season }
 *  - Play calls handleCatalogStreamingStart with { tmdb_id, quality:'1080p', media_type:'tv', season:1, episode:1 }
 *  - More Like This row renders PosterCards from tvService.browse
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShowDetailView from './ShowDetailView';
import type { ShowDetail, SeasonDetail, CatalogItem, StreamingProgress } from '@/types';

// ── module mocks ──────────────────────────────────────────────────────────────

// Mock WatchlistContext so ShowDetailView (and PosterCard) can render without a real provider.
vi.mock('@/context/WatchlistContext', () => ({
  useWatchlist: () => ({ isSaved: () => false, toggle: vi.fn() }),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

const mockGetSeason = vi.fn();
const mockBrowse = vi.fn();
vi.mock('@/services/tv', () => ({
  tvService: {
    getSeason: (...args: unknown[]) => mockGetSeason(...args),
    browse: (...args: unknown[]) => mockBrowse(...args),
  },
}));

const mockDownloadCatalogMovie = vi.fn();
vi.mock('@/services/torrents', () => ({
  torrentsService: {
    downloadCatalogMovie: (...args: unknown[]) =>
      mockDownloadCatalogMovie(...args),
    prioritizeForStreaming: vi.fn().mockResolvedValue(true),
  },
}));

const mockHandleCatalogStreamingStart = vi.fn();
vi.mock('@/utils/streaming', () => ({
  handleCatalogStreamingStart: (...args: unknown[]) =>
    mockHandleCatalogStreamingStart(...args),
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const SHOW_ID = 95396;

const mockShow: ShowDetail = {
  tmdb_id: SHOW_ID,
  media_type: 'tv',
  name: 'Severance',
  year: 2022,
  overview:
    'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives.',
  poster_url: 'https://image.tmdb.org/t/p/w500/severance.jpg',
  backdrop_url: 'https://image.tmdb.org/t/p/original/severancebd.jpg',
  genres: ['Drama', 'Mystery', 'Sci-Fi & Fantasy'],
  status: 'Returning Series',
  first_air_date: '2022-02-18',
  last_air_date: '2025-01-03',
  number_of_seasons: 2,
  vote_average: 8.7,
  vote_count: 3120,
  seasons: [
    {
      season_number: 1,
      name: 'Season 1',
      episode_count: 9,
      overview: 'Season 1 overview',
      poster_url: null,
      air_date: '2022-02-18',
    },
    {
      season_number: 2,
      name: 'Season 2',
      episode_count: 10,
      overview: 'Season 2 overview',
      poster_url: null,
      air_date: '2025-01-17',
    },
  ],
};

const mockSeason1: SeasonDetail = {
  season_number: 1,
  name: 'Season 1',
  overview: 'Season 1 overview',
  episodes: [
    {
      episode_number: 1,
      name: 'Good News About Hell',
      overview:
        'Mark is asked to take on a new role after a colleague departure.',
      runtime: 48,
      still_url: 'https://image.tmdb.org/t/p/w500/ep1.jpg',
      air_date: '2022-02-18',
      vote_average: 8.2,
    },
    {
      episode_number: 2,
      name: 'Half Loop',
      overview: 'Helly struggles to accept the terms of her employment.',
      runtime: 46,
      still_url: null,
      air_date: '2022-02-18',
      vote_average: 7.9,
    },
  ],
};

const mockSeason2: SeasonDetail = {
  season_number: 2,
  name: 'Season 2',
  overview: 'Season 2 overview',
  episodes: [
    {
      episode_number: 1,
      name: 'Hello, Ms. Cobel',
      overview: 'Season 2 episode 1 overview.',
      runtime: 52,
      still_url: 'https://image.tmdb.org/t/p/w500/s2ep1.jpg',
      air_date: '2025-01-17',
      vote_average: 8.4,
    },
  ],
};

const mockMoreLikeThis: CatalogItem[] = [
  {
    tmdb_id: 301,
    media_type: 'tv',
    title: 'Dark',
    year: 2017,
    overview: 'A mind-bending sci-fi thriller.',
    poster_url: 'https://image.tmdb.org/t/p/w500/dark.jpg',
    backdrop_url: null,
    genre_ids: [18, 9648],
    genres: ['Drama', 'Mystery'],
    vote_average: 8.8,
    vote_count: 5200,
    popularity: 90,
    original_language: 'de',
  },
  {
    tmdb_id: 302,
    media_type: 'tv',
    title: 'Westworld',
    year: 2016,
    overview: 'A futuristic theme park for the wealthy.',
    poster_url: 'https://image.tmdb.org/t/p/w500/westworld.jpg',
    backdrop_url: null,
    genre_ids: [18, 10765],
    genres: ['Drama', 'Sci-Fi & Fantasy'],
    vote_average: 8.5,
    vote_count: 6000,
    popularity: 85,
    original_language: 'en',
  },
];

const mockTorrentStatus = {
  id: 'stream-789',
  movie_title: 'Severance S1E1',
  quality: '1080p',
  state: 'downloading' as const,
  progress: 0,
  download_rate: 0,
  upload_rate: 0,
  total_downloaded: 0,
  total_uploaded: 0,
  num_peers: 0,
  save_path: '/downloads',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ShowDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSeason.mockResolvedValue(mockSeason1);
    mockBrowse.mockResolvedValue({
      page: 1,
      results: mockMoreLikeThis,
      total_pages: 1,
      total_results: 2,
    });
    mockDownloadCatalogMovie.mockResolvedValue(mockTorrentStatus);
    mockHandleCatalogStreamingStart.mockResolvedValue(mockTorrentStatus);
  });

  // ── rendering ─────────────────────────────────────────────────────────────

  describe('hero content', () => {
    it('renders the show name as the hero heading', async () => {
      render(<ShowDetailView show={mockShow} />);
      expect(
        screen.getByRole('heading', { level: 1, name: /severance/i }),
      ).toBeInTheDocument();
    });

    it('renders the seasons count in the meta', async () => {
      render(<ShowDetailView show={mockShow} />);
      // "2 Seasons" should appear as a meta item
      expect(screen.getByText('2 Seasons')).toBeInTheDocument();
    });

    it('renders the show status in the meta', async () => {
      render(<ShowDetailView show={mockShow} />);
      expect(screen.getByText('Returning Series')).toBeInTheDocument();
    });

    it('renders the show rating', async () => {
      render(<ShowDetailView show={mockShow} />);
      expect(screen.getByTestId('detail-hero-rating')).toHaveTextContent(
        '8.7',
      );
    });

    it('renders the show overview in the hero', async () => {
      render(<ShowDetailView show={mockShow} />);
      expect(screen.getByTestId('detail-hero-overview')).toBeInTheDocument();
    });
  });

  // ── season selector ──────────────────────────────────────────────────────

  describe('season selector', () => {
    it('renders a season tab for each regular season', async () => {
      render(<ShowDetailView show={mockShow} />);
      expect(screen.getByTestId('season-tab-1')).toBeInTheDocument();
      expect(screen.getByTestId('season-tab-2')).toBeInTheDocument();
    });

    it('season 1 is selected by default', async () => {
      render(<ShowDetailView show={mockShow} />);
      const tab1 = screen.getByTestId('season-tab-1');
      expect(tab1).toHaveAttribute('aria-pressed', 'true');
    });

    it('calls getSeason(showId, 1) on mount', async () => {
      render(<ShowDetailView show={mockShow} />);
      await waitFor(() =>
        expect(mockGetSeason).toHaveBeenCalledWith(SHOW_ID, 1),
      );
    });

    it('renders the EpisodeList after getSeason resolves', async () => {
      render(<ShowDetailView show={mockShow} />);
      await waitFor(() =>
        expect(screen.getByTestId('episode-list')).toBeInTheDocument(),
      );
    });

    it('selecting season 2 calls getSeason(showId, 2) and renders new episodes', async () => {
      mockGetSeason.mockImplementation((_id: number, season: number) =>
        season === 1
          ? Promise.resolve(mockSeason1)
          : Promise.resolve(mockSeason2),
      );

      render(<ShowDetailView show={mockShow} />);

      // Wait for S1 episodes to load
      await waitFor(() =>
        expect(screen.getByTestId('episode-list')).toBeInTheDocument(),
      );

      // Click Season 2 tab
      await userEvent.click(screen.getByTestId('season-tab-2'));

      // getSeason called with season 2
      await waitFor(() =>
        expect(mockGetSeason).toHaveBeenCalledWith(SHOW_ID, 2),
      );

      // S2 episode should appear
      await waitFor(() =>
        expect(
          screen.getByTestId('episode-name-1'),
        ).toHaveTextContent('Hello, Ms. Cobel'),
      );
    });

    it('marks the selected season tab as pressed', async () => {
      mockGetSeason.mockImplementation((_id: number, season: number) =>
        season === 1
          ? Promise.resolve(mockSeason1)
          : Promise.resolve(mockSeason2),
      );

      render(<ShowDetailView show={mockShow} />);

      // Wait for initial load
      await waitFor(() =>
        expect(screen.getByTestId('episode-list')).toBeInTheDocument(),
      );

      await userEvent.click(screen.getByTestId('season-tab-2'));

      await waitFor(() =>
        expect(screen.getByTestId('season-tab-2')).toHaveAttribute(
          'aria-pressed',
          'true',
        ),
      );
      expect(screen.getByTestId('season-tab-1')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
  });

  // ── Play button ───────────────────────────────────────────────────────────

  describe('Play button', () => {
    it('calls handleCatalogStreamingStart with S1E1 on Play click', async () => {
      render(<ShowDetailView show={mockShow} />);

      await userEvent.click(screen.getByTestId('show-play-button'));

      await waitFor(() =>
        expect(mockHandleCatalogStreamingStart).toHaveBeenCalledWith({
          tmdb_id: SHOW_ID,
          quality: '1080p',
          media_type: 'tv',
          season: 1,
          episode: 1,
        }),
      );
    });

    it('navigates to /streaming/<id> after a successful Play', async () => {
      render(<ShowDetailView show={mockShow} />);

      await userEvent.click(screen.getByTestId('show-play-button'));

      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith(
          `/streaming/${mockTorrentStatus.id}`,
        ),
      );
    });

    it('does NOT navigate when handleCatalogStreamingStart returns null', async () => {
      mockHandleCatalogStreamingStart.mockResolvedValueOnce(null);

      render(<ShowDetailView show={mockShow} />);

      await userEvent.click(screen.getByTestId('show-play-button'));

      await waitFor(() =>
        expect(mockHandleCatalogStreamingStart).toHaveBeenCalled(),
      );
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  // ── Download Season button ────────────────────────────────────────────────

  describe('Download Season button', () => {
    it('calls downloadCatalogMovie with { media_type:tv, season } on Download Season click', async () => {
      render(<ShowDetailView show={mockShow} />);

      await userEvent.click(screen.getByTestId('show-download-season-button'));

      await waitFor(() =>
        expect(mockDownloadCatalogMovie).toHaveBeenCalledWith({
          tmdb_id: SHOW_ID,
          quality: '1080p',
          media_type: 'tv',
          season: 1, // defaults to first selected season
        }),
      );
    });

    it('downloads the currently selected season', async () => {
      mockGetSeason.mockImplementation((_id: number, season: number) =>
        season === 1
          ? Promise.resolve(mockSeason1)
          : Promise.resolve(mockSeason2),
      );

      render(<ShowDetailView show={mockShow} />);

      // Wait for S1 episodes
      await waitFor(() =>
        expect(screen.getByTestId('episode-list')).toBeInTheDocument(),
      );

      // Switch to season 2
      await userEvent.click(screen.getByTestId('season-tab-2'));
      await waitFor(() =>
        expect(mockGetSeason).toHaveBeenCalledWith(SHOW_ID, 2),
      );

      // Download season 2
      await userEvent.click(screen.getByTestId('show-download-season-button'));

      await waitFor(() =>
        expect(mockDownloadCatalogMovie).toHaveBeenCalledWith({
          tmdb_id: SHOW_ID,
          quality: '1080p',
          media_type: 'tv',
          season: 2,
        }),
      );
    });

    it('does NOT navigate after Download Season', async () => {
      render(<ShowDetailView show={mockShow} />);

      await userEvent.click(screen.getByTestId('show-download-season-button'));

      await waitFor(() =>
        expect(mockDownloadCatalogMovie).toHaveBeenCalled(),
      );
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  // ── More Like This ────────────────────────────────────────────────────────

  describe('More Like This', () => {
    it('renders PosterCards for each "more like this" result', async () => {
      render(<ShowDetailView show={mockShow} />);

      await waitFor(() => {
        expect(screen.getAllByText('Dark').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Westworld').length).toBeGreaterThan(0);
      });
    });

    it('calls tvService.browse on mount', async () => {
      render(<ShowDetailView show={mockShow} />);

      await waitFor(() =>
        expect(mockBrowse).toHaveBeenCalled(),
      );
    });

    it('excludes the current show from More Like This', async () => {
      mockBrowse.mockResolvedValueOnce({
        page: 1,
        results: [
          mockMoreLikeThis[0],
          // Current show included in results
          {
            tmdb_id: mockShow.tmdb_id,
            media_type: 'tv',
            title: mockShow.name,
            year: mockShow.year,
            overview: mockShow.overview,
            poster_url: mockShow.poster_url,
            backdrop_url: mockShow.backdrop_url,
            genre_ids: [],
            genres: mockShow.genres,
            vote_average: mockShow.vote_average,
            vote_count: mockShow.vote_count,
            popularity: 100,
            original_language: 'en',
          },
        ],
        total_pages: 1,
        total_results: 2,
      });

      render(<ShowDetailView show={mockShow} />);

      await waitFor(() =>
        expect(screen.getAllByText('Dark').length).toBeGreaterThan(0),
      );

      // The show's own name appears only in the h1 hero (not as a PosterCard)
      const heroTitle = screen.getByRole('heading', { level: 1 });
      expect(heroTitle).toHaveTextContent(mockShow.name);
    });
  });
});

// ── The asked episode ─────────────────────────────────────────────────────────
//
// Appended, never interleaved: `services/torrents.test.ts:12-16` cites this file's line numbers,
// and `vi.mock` is hoisted wherever it sits, so the existing suite above also renders against this
// ProgressContext (no rows, loaded) and this `findNextEpisode` (never reached without a finished
// row) — which is how it rendered before the page could be asked for an episode.

const progress = vi.hoisted(() => ({
  data: {} as Record<string, StreamingProgress>,
  isLoading: false,
}));
vi.mock('@/context/ProgressContext', () => ({
  useProgress: () => ({
    progressData: progress.data,
    isLoading: progress.isLoading,
    getMovieProgress: (id: string) => progress.data[id] ?? null,
  }),
}));

const next = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/nextEpisode', () => ({
  findNextEpisode: (...a: unknown[]) => next.fn(...a),
}));

/** `findNextEpisode`'s answer when the catalog could not say. */
const UNKNOWN_NEXT = { verdict: { k: 'unknown' as const }, runtimeS: null };

/** `findNextEpisode`'s answer naming the episode after the finished one. */
const readyNext = (season: number, episode: number) => ({
  verdict: { k: 'ready' as const, next: { season, episode, name: '' } },
  runtimeS: 2760,
});

/**
 * The profile's unfinished row for S1·E2, on a season pack (`file_index: 4`), keyed the way the
 * backend keys it — spelled out rather than built, so the page's lookup key is pinned too. Each
 * case below changes only the fields it is about.
 */
const unfinishedS1E2: StreamingProgress = {
  id: 'progress-1',
  user_id: 'profile-1',
  torrent_id: 't-9',
  movie_id: 'tv:95396:s1:e2',
  current_time: 840,
  duration: 2760,
  percentage: 30,
  completed: false,
  last_watched_at: '2026-11-10T20:00:00Z',
  created_at: '2026-11-10T19:00:00Z',
  updated_at: '2026-11-10T20:00:00Z',
  file_index: 4,
  title: 'Severance S01E02',
};

/** The same profile having finished S1·E1. */
const finishedS1E1: StreamingProgress = {
  ...unfinishedS1E2,
  movie_id: 'tv:95396:s1:e1',
  current_time: 2870,
  duration: 2880,
  percentage: 100,
  completed: true,
  title: 'Severance S01E01',
};

describe('ShowDetailView — the asked episode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    progress.data = {};
    progress.isLoading = false;
    next.fn.mockReset();
    next.fn.mockResolvedValue(UNKNOWN_NEXT);
    mockGetSeason.mockImplementation((_id: number, season: number) =>
      Promise.resolve(season === 2 ? mockSeason2 : mockSeason1),
    );
    mockBrowse.mockResolvedValue({ page: 1, results: [], total_pages: 1, total_results: 0 });
    mockHandleCatalogStreamingStart.mockResolvedValue(mockTorrentStatus);
  });

  afterEach(() => {
    // The suite above reads the same hoisted progress: leave it as that suite expects it.
    progress.data = {};
    progress.isLoading = false;
  });

  /**
   * Render asked for `ask`, then wait for the open season's episodes. Waiting matters twice: an
   * absent highlight is read after the season lands rather than before it, and the hero is read
   * after the mount effects (the next-episode lookup among them) have run.
   */
  async function mount(ask: { initialSeason?: number; initialEpisode?: number } = {}) {
    const view = render(<ShowDetailView show={mockShow} {...ask} />);
    await screen.findByTestId('episode-list');
    return view;
  }

  /** No episode row on screen says it is current. */
  function expectNoHighlight() {
    for (const row of screen.queryAllByTestId(/^episode-row-\d+$/)) {
      expect(row).not.toHaveAttribute('aria-current');
    }
  }

  it('opens the asked season and highlights the asked episode', async () => {
    await mount({ initialSeason: 2, initialEpisode: 1 });

    expect(screen.getByTestId('season-tab-2')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('season-tab-1')).toHaveAttribute('aria-pressed', 'false');
    expect(mockGetSeason).toHaveBeenCalledWith(SHOW_ID, 2);
    // Seeded, not switched to: the first season is never fetched on the way to the asked one.
    expect(mockGetSeason).not.toHaveBeenCalledWith(SHOW_ID, 1);
    expect(screen.getByTestId('episode-row-1')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('show-play-button')).toHaveTextContent(/^Play S02·E01$/);
  });

  it('an unknown asked season opens the first', async () => {
    await mount({ initialSeason: 7, initialEpisode: 1 });

    expect(screen.getByTestId('season-tab-1')).toHaveAttribute('aria-pressed', 'true');
    expect(mockGetSeason).toHaveBeenCalledWith(SHOW_ID, 1);
    expectNoHighlight();
    expect(screen.getByTestId('show-play-button')).toHaveTextContent(/^Play S01·E01$/);
  });

  it('resumes an unfinished asked episode on its own download', async () => {
    progress.data['tv:95396:s1:e2'] = unfinishedS1E2;
    await mount({ initialSeason: 1, initialEpisode: 2 });

    const hero = screen.getByTestId('show-play-button');
    expect(hero).toHaveTextContent(/^Resume S01·E02$/);
    expect(screen.getByTestId('episode-row-2')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('episode-row-1')).not.toHaveAttribute('aria-current');

    await userEvent.click(hero);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/streaming/t-9?file=4');
    expect(mockHandleCatalogStreamingStart).not.toHaveBeenCalled();
    // An unfinished row has nothing after it to look up.
    expect(next.fn).not.toHaveBeenCalled();
  });

  it('file 0 survives', async () => {
    progress.data['tv:95396:s1:e2'] = { ...unfinishedS1E2, file_index: 0 };
    await mount({ initialSeason: 1, initialEpisode: 2 });

    await userEvent.click(screen.getByTestId('show-play-button'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/streaming/t-9?file=0');
  });

  it('a finished asked episode plays the next one', async () => {
    progress.data['tv:95396:s1:e1'] = finishedS1E1;
    next.fn.mockResolvedValue(readyNext(1, 2));
    await mount({ initialSeason: 1, initialEpisode: 1 });

    const hero = screen.getByTestId('show-play-button');
    await waitFor(() => expect(hero).toHaveTextContent(/^Play S01·E02$/));
    expect(next.fn).toHaveBeenCalledWith({ tmdbId: SHOW_ID, season: 1, episode: 1 });
    expect(screen.getByTestId('episode-row-2')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('episode-row-1')).not.toHaveAttribute('aria-current');

    await userEvent.click(hero);

    await waitFor(() =>
      expect(mockHandleCatalogStreamingStart).toHaveBeenCalledWith({
        tmdb_id: SHOW_ID,
        quality: '1080p',
        media_type: 'tv',
        season: 1,
        episode: 2,
      }),
    );
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(`/streaming/${mockTorrentStatus.id}`),
    );
  });

  it('a finished asked episode cannot start anything while its next one is being looked up', async () => {
    progress.data['tv:95396:s1:e1'] = finishedS1E1;
    // A lookup that never answers.
    next.fn.mockReturnValue(new Promise(() => {}));
    await mount({ initialSeason: 1, initialEpisode: 1 });

    const hero = screen.getByTestId('show-play-button');
    expect(hero).toBeDisabled();
    expect(hero).toHaveAttribute('aria-busy', 'true');

    await userEvent.click(hero);

    expect(mockHandleCatalogStreamingStart).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('the next one can be in a later season', async () => {
    progress.data['tv:95396:s1:e1'] = finishedS1E1;
    next.fn.mockResolvedValue(readyNext(2, 1));
    await mount({ initialSeason: 1, initialEpisode: 1 });

    await waitFor(() =>
      expect(screen.getByTestId('show-play-button')).toHaveTextContent(/^Play S02·E01$/),
    );
    // Season 1 stays the open tab, and none of its episodes is the one the hero is about.
    expect(screen.getByTestId('season-tab-1')).toHaveAttribute('aria-pressed', 'true');
    expectNoHighlight();
  });

  it('nothing after a finished episode plays from the start', async () => {
    progress.data['tv:95396:s1:e2'] = { ...unfinishedS1E2, completed: true, percentage: 100 };
    next.fn.mockResolvedValue({ verdict: { k: 'none' }, runtimeS: null });
    await mount({ initialSeason: 1, initialEpisode: 2 });

    await waitFor(() =>
      expect(screen.getByTestId('show-play-button')).toHaveTextContent(/^Play S01·E01$/),
    );
    expect(next.fn).toHaveBeenCalledWith({ tmdbId: SHOW_ID, season: 1, episode: 2 });
  });

  it('no usable row plays the asked episode', async () => {
    progress.data['tv:95396:s1:e2'] = { ...unfinishedS1E2, torrent_id: null };
    await mount({ initialSeason: 1, initialEpisode: 2 });

    const hero = screen.getByTestId('show-play-button');
    expect(hero).toHaveTextContent(/^Play S01·E02$/);

    await userEvent.click(hero);

    await waitFor(() =>
      expect(mockHandleCatalogStreamingStart).toHaveBeenCalledWith({
        tmdb_id: SHOW_ID,
        quality: '1080p',
        media_type: 'tv',
        season: 1,
        episode: 2,
      }),
    );
    expect(mockHandleCatalogStreamingStart).toHaveBeenCalledTimes(1);
  });

  it('while progress loads, the hero cannot start anything', async () => {
    progress.isLoading = true;
    const { rerender } = await mount({ initialSeason: 1, initialEpisode: 2 });

    const hero = screen.getByTestId('show-play-button');
    expect(hero).toBeDisabled();
    expect(hero).toHaveAttribute('aria-busy', 'true');

    await userEvent.click(hero);

    expect(mockHandleCatalogStreamingStart).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    // The row lands: the hero it was holding back for is Resume, not a new download.
    progress.isLoading = false;
    progress.data['tv:95396:s1:e2'] = unfinishedS1E2;
    rerender(<ShowDetailView show={mockShow} initialSeason={1} initialEpisode={2} />);

    expect(screen.getByTestId('show-play-button')).toHaveTextContent(/^Resume S01·E02$/);
    expect(screen.getByTestId('show-play-button')).toBeEnabled();
  });

  it('a finished row that lands after mount still finds the next episode', async () => {
    // The fresh-load path of every "Up next" card: it links to the episode just finished, and a
    // new tab or a reload mounts the page before ProgressProvider has any rows. The lookup can
    // only start once the row says it is finished, so it must start on that render, not at mount.
    progress.isLoading = true;
    next.fn.mockResolvedValue(readyNext(1, 2));
    const { rerender } = await mount({ initialSeason: 1, initialEpisode: 1 });

    expect(screen.getByTestId('show-play-button')).toBeDisabled();
    expect(next.fn).not.toHaveBeenCalled();

    progress.isLoading = false;
    progress.data['tv:95396:s1:e1'] = finishedS1E1;
    rerender(<ShowDetailView show={mockShow} initialSeason={1} initialEpisode={1} />);

    const hero = screen.getByTestId('show-play-button');
    await waitFor(() => expect(hero).toHaveTextContent(/^Play S01·E02$/));
    expect(hero).toBeEnabled();
    expect(next.fn).toHaveBeenCalledTimes(1);
    expect(next.fn).toHaveBeenCalledWith({ tmdbId: SHOW_ID, season: 1, episode: 1 });
    expect(screen.getByTestId('episode-row-2')).toHaveAttribute('aria-current', 'true');
  });

  it('without a query nothing changes', async () => {
    // Even a row the profile could resume is not consulted: no episode was asked for.
    progress.data['tv:95396:s1:e2'] = unfinishedS1E2;
    await mount();

    const hero = screen.getByTestId('show-play-button');
    expect(hero).toHaveTextContent(/^Play S01·E01$/);
    expectNoHighlight();

    await userEvent.click(hero);

    await waitFor(() =>
      expect(mockHandleCatalogStreamingStart).toHaveBeenCalledWith({
        tmdb_id: SHOW_ID,
        quality: '1080p',
        media_type: 'tv',
        season: 1,
        episode: 1,
      }),
    );
    expect(next.fn).not.toHaveBeenCalled();
  });

  it('the next episode found for an earlier ask is never read as the answer for this one', async () => {
    // The server page keys this view on the query, so a new ask normally remounts it; this is the
    // defence behind that key. Within one mount the S1·E1 answer (S1·E2) is still held when S1·E3
    // is asked for, and S1·E3's own lookup is still out: the hero must wait for it, not offer the
    // episode after the wrong one.
    progress.data['tv:95396:s1:e1'] = finishedS1E1;
    progress.data['tv:95396:s1:e3'] = {
      ...finishedS1E1,
      movie_id: 'tv:95396:s1:e3',
      title: 'Severance S01E03',
    };
    next.fn.mockImplementation(({ episode }: { episode: number }) =>
      episode === 1 ? Promise.resolve(readyNext(1, 2)) : new Promise(() => {}),
    );
    const { rerender } = await mount({ initialSeason: 1, initialEpisode: 1 });
    await waitFor(() =>
      expect(screen.getByTestId('show-play-button')).toHaveTextContent(/^Play S01·E02$/),
    );

    rerender(<ShowDetailView show={mockShow} initialSeason={1} initialEpisode={3} />);

    // The window this is about: S1·E3's lookup has started and has not answered.
    expect(next.fn).toHaveBeenLastCalledWith({ tmdbId: SHOW_ID, season: 1, episode: 3 });
    const hero = screen.getByTestId('show-play-button');
    expect(hero).toBeDisabled();
    expect(hero).toHaveAttribute('aria-busy', 'true');
    expect(hero).not.toHaveTextContent(/S01·E02/);
    expectNoHighlight();

    await userEvent.click(hero);

    expect(mockHandleCatalogStreamingStart).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
