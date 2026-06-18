import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TorrentState, TorrentStatus } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListTorrents = vi.fn();
const mockPerformTorrentAction = vi.fn();
const mockDeleteTorrent = vi.fn();
const mockPrioritizeForStreaming = vi.fn();

vi.mock('@/services/torrents', () => ({
  torrentsService: {
    listTorrents: (...args: unknown[]) => mockListTorrents(...args),
    performTorrentAction: (...args: unknown[]) => mockPerformTorrentAction(...args),
    deleteTorrent: (...args: unknown[]) => mockDeleteTorrent(...args),
    prioritizeForStreaming: (...args: unknown[]) => mockPrioritizeForStreaming(...args),
  },
}));

// next/navigation mock — must be set up before the component import
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeTorrent = (overrides: Partial<TorrentStatus> = {}): TorrentStatus => ({
  id: 'tor-1',
  movie_title: 'Test Movie',
  quality: '1080p',
  state: TorrentState.DOWNLOADING,
  progress: 42,
  download_rate: 512,
  upload_rate: 64,
  total_downloaded: 1024,
  total_uploaded: 128,
  num_peers: 5,
  save_path: '/downloads',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:01:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Dynamic import after mocks are set up
let DownloadsView: React.ComponentType;

beforeEach(async () => {
  vi.clearAllMocks();
  mockListTorrents.mockResolvedValue([]);
  mockPerformTorrentAction.mockResolvedValue({});
  mockDeleteTorrent.mockResolvedValue({});
  mockPrioritizeForStreaming.mockResolvedValue(true);
  // Import component fresh each test suite (cached after first load)
  if (!DownloadsView) {
    const mod = await import('./DownloadsView');
    DownloadsView = mod.default;
  }
});

describe('DownloadsView', () => {
  it('renders an item per torrent with title, state badge and progress', async () => {
    const t1 = makeTorrent({ id: 'tor-1', movie_title: 'Alpha' });
    const t2 = makeTorrent({
      id: 'tor-2',
      movie_title: 'Beta',
      state: TorrentState.PAUSED,
    });
    mockListTorrents.mockResolvedValue([t1, t2]);

    render(<DownloadsView />);

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    // State badges
    const rows = screen.getAllByTestId('torrent-row');
    expect(rows).toHaveLength(2);

    // Progress bars present (role=progressbar)
    const bars = screen.getAllByRole('progressbar');
    expect(bars.length).toBeGreaterThanOrEqual(2);
  });

  it('pause action calls performTorrentAction(id, "pause")', async () => {
    mockListTorrents.mockResolvedValue([
      makeTorrent({ id: 'tor-42', state: TorrentState.DOWNLOADING }),
    ]);

    render(<DownloadsView />);

    const pause = await screen.findByRole('button', { name: 'Pause' });
    await userEvent.click(pause);

    expect(mockPerformTorrentAction).toHaveBeenCalledWith('tor-42', 'pause');
  });

  it('remove (confirmed) calls deleteTorrent(id, false)', async () => {
    mockListTorrents.mockResolvedValue([
      makeTorrent({ id: 'tor-99', movie_title: 'Delete Me' }),
    ]);

    render(<DownloadsView />);

    // Click Remove button
    const removeBtn = await screen.findByRole('button', { name: 'Remove' });
    await userEvent.click(removeBtn);

    // Confirm modal should appear
    const dialog = await screen.findByRole('dialog', { name: 'Confirm removal' });
    expect(dialog).toBeInTheDocument();

    // Click the confirm button inside the dialog
    const confirmBtn = within(dialog).getByRole('button', { name: 'Confirm remove' });
    await userEvent.click(confirmBtn);

    expect(mockDeleteTorrent).toHaveBeenCalledWith('tor-99', false);
  });

  it('shows "Active N / 2" header reflecting active-state torrent count', async () => {
    mockListTorrents.mockResolvedValue([
      makeTorrent({ id: 't1', state: TorrentState.DOWNLOADING }),
      makeTorrent({ id: 't2', state: TorrentState.QUEUED }),
      makeTorrent({ id: 't3', state: TorrentState.PAUSED }), // not active
      makeTorrent({ id: 't4', state: TorrentState.FINISHED }), // not active
    ]);

    render(<DownloadsView />);

    const counter = await screen.findByTestId('active-count');
    // DOWNLOADING + QUEUED = 2 active
    expect(counter).toHaveTextContent('Active 2 / 2');
  });

  it('a filter Pill narrows the visible list', async () => {
    mockListTorrents.mockResolvedValue([
      makeTorrent({ id: 't1', movie_title: 'Downloading One', state: TorrentState.DOWNLOADING }),
      makeTorrent({ id: 't2', movie_title: 'Paused One', state: TorrentState.PAUSED }),
    ]);

    render(<DownloadsView />);

    // Wait for both to appear
    await screen.findByText('Downloading One');
    await screen.findByText('Paused One');

    // Click the "Paused" filter pill
    await userEvent.click(screen.getByRole('button', { name: 'Paused' }));

    // Only the paused torrent should be visible
    expect(screen.getByText('Paused One')).toBeInTheDocument();
    expect(screen.queryByText('Downloading One')).toBeNull();
  });

  it('shows an empty state when there are no torrents', async () => {
    mockListTorrents.mockResolvedValue([]);

    render(<DownloadsView />);

    await screen.findByTestId('empty-state');
  });
});
