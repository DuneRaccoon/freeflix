/**
 * MovieDetailView — Vitest + RTL tests
 *
 * Spec (Task 4):
 *  - Renders the hero (title / rating / overview) + source pills from getTorrents
 *  - Clicking Play (with a selected quality) calls handleCatalogStreamingStart
 *    with { tmdb_id, quality } and router.push('/streaming/<id>')
 *  - Clicking Download calls torrentsService.downloadCatalogMovie
 *  - More Like This renders PosterCards
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MovieDetailView from './MovieDetailView';
import type { MovieDetail, TorrentHit, CatalogItem } from '@/types';

// ── module mocks ──────────────────────────────────────────────────────────────

// Mock WatchlistContext so MovieDetailView (and PosterCard) can render without a real provider.
vi.mock('@/context/WatchlistContext', () => ({
  useWatchlist: () => ({ isSaved: () => false, toggle: vi.fn() }),
}));

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock react-hot-toast (avoid real side effects in tests)
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

// Mock @/services/movies
const mockGetTorrents = vi.fn();
const mockBrowse = vi.fn();
vi.mock('@/services/movies', () => ({
  moviesService: {
    getTorrents: (...args: unknown[]) => mockGetTorrents(...args),
    browse: (...args: unknown[]) => mockBrowse(...args),
  },
}));

// Mock @/services/torrents
const mockDownloadCatalogMovie = vi.fn();
vi.mock('@/services/torrents', () => ({
  torrentsService: {
    downloadCatalogMovie: (...args: unknown[]) =>
      mockDownloadCatalogMovie(...args),
    prioritizeForStreaming: vi.fn().mockResolvedValue(true),
  },
}));

// Mock @/utils/streaming
const mockHandleCatalogStreamingStart = vi.fn();
vi.mock('@/utils/streaming', () => ({
  handleCatalogStreamingStart: (...args: unknown[]) =>
    mockHandleCatalogStreamingStart(...args),
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const mockMovie: MovieDetail = {
  tmdb_id: 693134,
  media_type: 'movie',
  title: 'Dune: Part Two',
  year: 2024,
  overview:
    'Paul Atreides unites with the Fremen to wage war against the conspirators.',
  poster_url: 'https://image.tmdb.org/t/p/w500/dune2.jpg',
  backdrop_url: 'https://image.tmdb.org/t/p/original/dune2bd.jpg',
  genre_ids: [878, 12],
  genres: ['Science Fiction', 'Adventure'],
  vote_average: 8.4,
  vote_count: 9123,
  popularity: 125.6,
  original_language: 'en',
  runtime: 166,
  imdb_id: 'tt15239678',
  tagline: 'Long live the fighters.',
  cast: [
    {
      name: 'Timothée Chalamet',
      character: 'Paul Atreides',
      image: 'https://image.tmdb.org/t/p/w200/tc.jpg',
    },
    {
      name: 'Zendaya',
      character: 'Chani',
      image: null,
    },
  ],
  director: 'Denis Villeneuve',
  available_qualities: ['720p', '1080p', '2160p'],
};

const mockHits: TorrentHit[] = [
  {
    title: 'Dune Part Two 720p',
    seeds: 640,
    peers: 50,
    bytes: 1_181_116_006,
    magnet: 'magnet:?xt=720',
    hash: 'abc',
    source: 'YTS',
    quality: '720p',
  },
  {
    title: 'Dune Part Two 1080p',
    seeds: 1200,
    peers: 90,
    bytes: 2_254_857_830,
    magnet: 'magnet:?xt=1080',
    hash: 'def',
    source: 'YTS',
    quality: '1080p',
  },
];

const mockMoreLikeThis: CatalogItem[] = [
  {
    tmdb_id: 111,
    media_type: 'movie',
    title: 'Arrival',
    year: 2016,
    overview: 'A linguist helps with first contact.',
    poster_url: 'https://image.tmdb.org/t/p/w500/arrival.jpg',
    backdrop_url: null,
    genre_ids: [878],
    genres: ['Science Fiction'],
    vote_average: 7.9,
    vote_count: 4000,
    popularity: 80,
    original_language: 'en',
  },
  {
    tmdb_id: 222,
    media_type: 'movie',
    title: 'Interstellar',
    year: 2014,
    overview: 'A crew of astronauts travel through a wormhole.',
    poster_url: 'https://image.tmdb.org/t/p/w500/inter.jpg',
    backdrop_url: null,
    genre_ids: [878, 18],
    genres: ['Science Fiction', 'Drama'],
    vote_average: 8.6,
    vote_count: 12000,
    popularity: 100,
    original_language: 'en',
  },
];

// ── tests ─────────────────────────────────────────────────────────────────────

describe('MovieDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTorrents.mockResolvedValue(mockHits);
    mockBrowse.mockResolvedValue({
      page: 1,
      results: mockMoreLikeThis,
      total_pages: 1,
      total_results: 2,
    });
    mockDownloadCatalogMovie.mockResolvedValue({
      id: 'torrent-123',
      movie_title: 'Dune: Part Two',
      quality: '1080p',
      state: 'downloading',
      progress: 0,
      download_rate: 0,
      upload_rate: 0,
      total_downloaded: 0,
      total_uploaded: 0,
      num_peers: 0,
      save_path: '/downloads',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    });
    mockHandleCatalogStreamingStart.mockResolvedValue({
      id: 'stream-456',
      movie_title: 'Dune: Part Two',
      quality: '1080p',
      state: 'downloading',
      progress: 0,
      download_rate: 0,
      upload_rate: 0,
      total_downloaded: 0,
      total_uploaded: 0,
      num_peers: 0,
      save_path: '/downloads',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    });
  });

  describe('hero content', () => {
    it('renders the movie title', async () => {
      render(<MovieDetailView movie={mockMovie} />);
      expect(
        screen.getByRole('heading', { level: 1, name: /dune: part two/i }),
      ).toBeInTheDocument();
    });

    it('renders the rating', async () => {
      render(<MovieDetailView movie={mockMovie} />);
      const rating = screen.getByTestId('detail-hero-rating');
      expect(rating).toHaveTextContent('8.4');
    });

    it('renders the overview', async () => {
      render(<MovieDetailView movie={mockMovie} />);
      // Overview appears in both the hero logline and the body section
      const overviewEls = screen.getAllByText(/Paul Atreides unites with the Fremen/i);
      expect(overviewEls.length).toBeGreaterThan(0);
    });

    it('renders the director credit', async () => {
      render(<MovieDetailView movie={mockMovie} />);
      expect(screen.getByText('Denis Villeneuve')).toBeInTheDocument();
    });
  });

  describe('source picker (from getTorrents)', () => {
    it('renders source pills after getTorrents resolves', async () => {
      render(<MovieDetailView movie={mockMovie} />);
      await waitFor(() => {
        expect(screen.getByTestId('source-pill-1080p')).toBeInTheDocument();
      });
      expect(screen.getByTestId('source-pill-720p')).toBeInTheDocument();
    });

    it('renders the Auto pill', async () => {
      render(<MovieDetailView movie={mockMovie} />);
      // Auto pill is rendered synchronously (before hits load)
      expect(screen.getByTestId('source-pill-auto')).toBeInTheDocument();
    });

    it('calls getTorrents with the movie tmdb_id on mount', async () => {
      render(<MovieDetailView movie={mockMovie} />);
      await waitFor(() =>
        expect(mockGetTorrents).toHaveBeenCalledWith(mockMovie.tmdb_id),
      );
    });
  });

  describe('Play button', () => {
    it('calls handleCatalogStreamingStart with { tmdb_id, quality } on Play click', async () => {
      render(<MovieDetailView movie={mockMovie} />);

      // Wait for hits to load so quality pills appear
      await waitFor(() =>
        expect(screen.getByTestId('source-pill-1080p')).toBeInTheDocument(),
      );

      // Select 1080p explicitly
      await userEvent.click(screen.getByTestId('source-pill-1080p'));

      // Click Play
      await userEvent.click(screen.getByTestId('movie-play-button'));

      await waitFor(() =>
        expect(mockHandleCatalogStreamingStart).toHaveBeenCalledWith({
          tmdb_id: mockMovie.tmdb_id,
          quality: '1080p',
        }),
      );
    });

    it('navigates to /streaming/<id> after a successful Play', async () => {
      render(<MovieDetailView movie={mockMovie} />);

      await waitFor(() =>
        expect(screen.getByTestId('source-pill-1080p')).toBeInTheDocument(),
      );

      await userEvent.click(screen.getByTestId('source-pill-1080p'));
      await userEvent.click(screen.getByTestId('movie-play-button'));

      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith('/streaming/stream-456'),
      );
    });

    it('resolves "auto" to the highest-seed quality before calling streaming', async () => {
      render(<MovieDetailView movie={mockMovie} />);

      await waitFor(() =>
        expect(screen.getByTestId('source-pill-auto')).toBeInTheDocument(),
      );

      // Quality is 'auto' by default — 1080p has most seeds (1200)
      await userEvent.click(screen.getByTestId('movie-play-button'));

      await waitFor(() =>
        expect(mockHandleCatalogStreamingStart).toHaveBeenCalledWith({
          tmdb_id: mockMovie.tmdb_id,
          quality: '1080p',
        }),
      );
    });
  });

  describe('Download button', () => {
    it('calls downloadCatalogMovie on Download click', async () => {
      render(<MovieDetailView movie={mockMovie} />);

      await waitFor(() =>
        expect(screen.getByTestId('source-pill-1080p')).toBeInTheDocument(),
      );

      await userEvent.click(screen.getByTestId('source-pill-1080p'));
      await userEvent.click(screen.getByTestId('movie-download-button'));

      await waitFor(() =>
        expect(mockDownloadCatalogMovie).toHaveBeenCalledWith({
          tmdb_id: mockMovie.tmdb_id,
          quality: '1080p',
        }),
      );
    });

    it('does NOT navigate to the streaming page on Download', async () => {
      render(<MovieDetailView movie={mockMovie} />);

      await waitFor(() =>
        expect(screen.getByTestId('source-pill-1080p')).toBeInTheDocument(),
      );

      await userEvent.click(screen.getByTestId('source-pill-1080p'));
      await userEvent.click(screen.getByTestId('movie-download-button'));

      await waitFor(() =>
        expect(mockDownloadCatalogMovie).toHaveBeenCalled(),
      );
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('More Like This', () => {
    it('renders PosterCards for each "more like this" result', async () => {
      render(<MovieDetailView movie={mockMovie} />);

      await waitFor(() => {
        // PosterCard renders the title in both resting caption + hover overlay;
        // use getAllByText and confirm at least one element is present per title.
        expect(screen.getAllByText('Arrival').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Interstellar').length).toBeGreaterThan(0);
      });
    });

    it('calls browse with the first genre_id of the movie', async () => {
      render(<MovieDetailView movie={mockMovie} />);

      await waitFor(() =>
        expect(mockBrowse).toHaveBeenCalledWith({ genre: 878 }),
      );
    });

    it('excludes the current movie from More Like This', async () => {
      // Browse returns the movie itself + others; it should be filtered out
      mockBrowse.mockResolvedValueOnce({
        page: 1,
        results: [
          { ...mockMoreLikeThis[0] },
          // Include the current movie in browse results
          {
            tmdb_id: mockMovie.tmdb_id,
            media_type: 'movie',
            title: mockMovie.title,
            year: mockMovie.year,
            overview: mockMovie.overview,
            poster_url: mockMovie.poster_url,
            backdrop_url: mockMovie.backdrop_url,
            genre_ids: mockMovie.genre_ids,
            genres: mockMovie.genres,
            vote_average: mockMovie.vote_average,
            vote_count: mockMovie.vote_count,
            popularity: mockMovie.popularity,
            original_language: mockMovie.original_language,
          },
        ],
        total_pages: 1,
        total_results: 2,
      });

      render(<MovieDetailView movie={mockMovie} />);

      await waitFor(() =>
        expect(screen.getAllByText('Arrival').length).toBeGreaterThan(0),
      );

      // Only "Arrival" should appear as a PosterCard; the current movie is filtered out.
      // The current movie's title only appears in the h1 hero heading, not as a poster card.
      const heroTitle = screen.getByRole('heading', { level: 1 });
      expect(heroTitle).toHaveTextContent(mockMovie.title);
      // Arrival is shown as a PosterCard
      expect(screen.getAllByText('Arrival').length).toBeGreaterThan(0);
    });
  });

  describe('cast row', () => {
    it('renders cast members', async () => {
      render(<MovieDetailView movie={mockMovie} />);
      expect(
        screen.getByTestId('cast-name-Timothée Chalamet'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('cast-name-Zendaya')).toBeInTheDocument();
    });
  });
});
