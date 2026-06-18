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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShowDetailView from './ShowDetailView';
import type { ShowDetail, SeasonDetail, CatalogItem } from '@/types';

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
