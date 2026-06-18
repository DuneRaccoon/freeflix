/**
 * EpisodeList — Vitest + RTL tests
 *
 * Spec (Task 6):
 *  - Renders a row per episode with the S·E label + name
 *  - Play on an episode calls handleCatalogStreamingStart with the correct
 *    { tmdb_id: showId, media_type:'tv', season, episode } and navigates
 *  - Download calls torrentsService.downloadCatalogMovie with the same shape
 *  - Null still_url → no broken image (placeholder src used)
 *  - Empty episodes list → no rows
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EpisodeList from './EpisodeList';
import type { Episode } from '@/types';

// ── module mocks ──────────────────────────────────────────────────────────────

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
const SEASON = 1;

const mockEpisodes: Episode[] = [
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
    overview:
      'Helly struggles to accept the terms of her employment while Mark tries.',
    runtime: 46,
    still_url: null, // null still_url — tests placeholder fallback
    air_date: '2022-02-18',
    vote_average: 7.9,
  },
  {
    episode_number: 3,
    name: 'In Perpetuity',
    overview: 'The team gives Helly the grand tour.',
    runtime: 48,
    still_url: 'https://image.tmdb.org/t/p/w500/ep3.jpg',
    air_date: '2022-02-25',
    vote_average: 8.5,
  },
];

const mockTorrentStatus = {
  id: 'stream-456',
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

describe('EpisodeList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleCatalogStreamingStart.mockResolvedValue(mockTorrentStatus);
    mockDownloadCatalogMovie.mockResolvedValue(mockTorrentStatus);
  });

  // ── rendering ─────────────────────────────────────────────────────────────

  describe('rendering', () => {
    it('renders a row per episode', () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={mockEpisodes}
        />,
      );
      expect(screen.getByTestId('episode-list')).toBeInTheDocument();
      mockEpisodes.forEach((ep) => {
        expect(
          screen.getByTestId(`episode-row-${ep.episode_number}`),
        ).toBeInTheDocument();
      });
    });

    it('renders the S·E label for each episode', () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={mockEpisodes}
        />,
      );
      expect(screen.getByTestId('episode-label-1')).toHaveTextContent(
        'S1·E1',
      );
      expect(screen.getByTestId('episode-label-2')).toHaveTextContent(
        'S1·E2',
      );
      expect(screen.getByTestId('episode-label-3')).toHaveTextContent(
        'S1·E3',
      );
    });

    it('renders the episode name for each episode', () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={mockEpisodes}
        />,
      );
      expect(screen.getByTestId('episode-name-1')).toHaveTextContent(
        'Good News About Hell',
      );
      expect(screen.getByTestId('episode-name-2')).toHaveTextContent(
        'Half Loop',
      );
      expect(screen.getByTestId('episode-name-3')).toHaveTextContent(
        'In Perpetuity',
      );
    });

    it('renders the still image when still_url is provided', () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[0]]}
        />,
      );
      const img = screen.getByTestId('episode-still-1') as HTMLImageElement;
      expect(img.src).toBe(
        'https://image.tmdb.org/t/p/w500/ep1.jpg',
      );
    });

    it('uses a placeholder when still_url is null (no broken img)', () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[1]]}
        />,
      );
      const img = screen.getByTestId('episode-still-2') as HTMLImageElement;
      // src should be a data URI placeholder, not a real URL
      expect(img.src).toContain('data:image/svg+xml');
    });

    it('renders no rows when episodes is empty', () => {
      render(
        <EpisodeList showId={SHOW_ID} seasonNumber={SEASON} episodes={[]} />,
      );
      expect(screen.queryByTestId('episode-list')).not.toBeInTheDocument();
    });

    it('renders the episode overview', () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[0]]}
        />,
      );
      expect(screen.getByTestId('episode-overview-1')).toBeInTheDocument();
    });

    it('renders quality selector buttons', () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[0]]}
        />,
      );
      expect(
        screen.getByTestId('episode-quality-1-Auto'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('episode-quality-1-1080p'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('episode-quality-1-720p'),
      ).toBeInTheDocument();
    });
  });

  // ── Play button ───────────────────────────────────────────────────────────

  describe('Play button', () => {
    it('calls handleCatalogStreamingStart with correct params on Play click', async () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[0]]}
        />,
      );

      await userEvent.click(screen.getByTestId('episode-play-btn-1'));

      await waitFor(() =>
        expect(mockHandleCatalogStreamingStart).toHaveBeenCalledWith({
          tmdb_id: SHOW_ID,
          quality: '1080p', // Auto resolves to 1080p
          media_type: 'tv',
          season: SEASON,
          episode: 1,
        }),
      );
    });

    it('navigates to /streaming/<id> after successful Play', async () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[0]]}
        />,
      );

      await userEvent.click(screen.getByTestId('episode-play-btn-1'));

      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith(
          `/streaming/${mockTorrentStatus.id}`,
        ),
      );
    });

    it('uses the selected quality when Play is clicked with a non-Auto quality', async () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[0]]}
        />,
      );

      // Select 720p
      await userEvent.click(screen.getByTestId('episode-quality-1-720p'));

      await userEvent.click(screen.getByTestId('episode-play-btn-1'));

      await waitFor(() =>
        expect(mockHandleCatalogStreamingStart).toHaveBeenCalledWith({
          tmdb_id: SHOW_ID,
          quality: '720p',
          media_type: 'tv',
          season: SEASON,
          episode: 1,
        }),
      );
    });

    it('uses the correct episode number for a different episode', async () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={mockEpisodes}
        />,
      );

      // Play episode 3
      await userEvent.click(screen.getByTestId('episode-play-btn-3'));

      await waitFor(() =>
        expect(mockHandleCatalogStreamingStart).toHaveBeenCalledWith({
          tmdb_id: SHOW_ID,
          quality: '1080p',
          media_type: 'tv',
          season: SEASON,
          episode: 3,
        }),
      );
    });

    it('does NOT navigate when handleCatalogStreamingStart returns null', async () => {
      mockHandleCatalogStreamingStart.mockResolvedValueOnce(null);

      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[0]]}
        />,
      );

      await userEvent.click(screen.getByTestId('episode-play-btn-1'));

      await waitFor(() =>
        expect(mockHandleCatalogStreamingStart).toHaveBeenCalled(),
      );
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  // ── Download button ───────────────────────────────────────────────────────

  describe('Download button', () => {
    it('calls downloadCatalogMovie with correct params on Download click', async () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[0]]}
        />,
      );

      await userEvent.click(screen.getByTestId('episode-download-btn-1'));

      await waitFor(() =>
        expect(mockDownloadCatalogMovie).toHaveBeenCalledWith({
          tmdb_id: SHOW_ID,
          quality: '1080p', // Auto → 1080p
          media_type: 'tv',
          season: SEASON,
          episode: 1,
        }),
      );
    });

    it('uses the selected quality when Download is clicked with 2160p', async () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[0]]}
        />,
      );

      // Select 2160p
      await userEvent.click(screen.getByTestId('episode-quality-1-2160p'));

      await userEvent.click(screen.getByTestId('episode-download-btn-1'));

      await waitFor(() =>
        expect(mockDownloadCatalogMovie).toHaveBeenCalledWith({
          tmdb_id: SHOW_ID,
          quality: '2160p',
          media_type: 'tv',
          season: SEASON,
          episode: 1,
        }),
      );
    });

    it('does NOT navigate after Download', async () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[0]]}
        />,
      );

      await userEvent.click(screen.getByTestId('episode-download-btn-1'));

      await waitFor(() =>
        expect(mockDownloadCatalogMovie).toHaveBeenCalled(),
      );
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  // ── Quality selector ──────────────────────────────────────────────────────

  describe('quality selector', () => {
    it('Auto pill is selected by default', () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[0]]}
        />,
      );
      const autoPill = screen.getByTestId('episode-quality-1-Auto');
      expect(autoPill).toHaveAttribute('aria-pressed', 'true');
    });

    it('selecting 1080p marks it as pressed and Auto as not pressed', async () => {
      render(
        <EpisodeList
          showId={SHOW_ID}
          seasonNumber={SEASON}
          episodes={[mockEpisodes[0]]}
        />,
      );

      await userEvent.click(screen.getByTestId('episode-quality-1-1080p'));

      expect(
        screen.getByTestId('episode-quality-1-1080p'),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.getByTestId('episode-quality-1-Auto'),
      ).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
