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
const mockBatchAction = vi.fn();
const mockGetDisk = vi.fn();

vi.mock('@/services/torrents', () => ({
  torrentsService: {
    listTorrents: (...args: unknown[]) => mockListTorrents(...args),
    performTorrentAction: (...args: unknown[]) => mockPerformTorrentAction(...args),
    deleteTorrent: (...args: unknown[]) => mockDeleteTorrent(...args),
    prioritizeForStreaming: (...args: unknown[]) => mockPrioritizeForStreaming(...args),
    batchAction: (...args: unknown[]) => mockBatchAction(...args),
    getDisk: (...args: unknown[]) => mockGetDisk(...args),
  },
}));

const mockGetCount = vi.fn();
vi.mock('@/services/activity', () => ({
  activityService: { getCount: (...a: unknown[]) => mockGetCount(...a) },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: {
    success: (...a: unknown[]) => mockToastSuccess(...a),
    error: (...a: unknown[]) => mockToastError(...a),
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
  mockBatchAction.mockResolvedValue({ action: 'pause', succeeded: 0, failed: 0, results: [] });
  mockGetDisk.mockResolvedValue({
    used_by_downloads_bytes: 12884901888,
    free_bytes: 85899345920,
    total_bytes: 536870912000,
  });
  mockGetCount.mockResolvedValue({ active_downloads: 0, aggregate_progress: 0, max_active_downloads: 2 });
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

  it('remove (confirmed) calls deleteTorrent(id, true) by default', async () => {
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

    expect(mockDeleteTorrent).toHaveBeenCalledWith('tor-99', true);
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

  it('shows a Resume button for a stopped torrent', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent({ id: 's1', state: TorrentState.STOPPED })]);
    render(<DownloadsView />);
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('does not show a Stop button', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent({ id: 'd1', state: TorrentState.DOWNLOADING })]);
    render(<DownloadsView />);
    await screen.findByRole('button', { name: 'Pause' });
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('choosing "Remove from list" keeps the files', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent({ id: 'r9', movie_title: 'Bye' })]);
    render(<DownloadsView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm removal' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /Remove from list/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm remove' }));
    expect(mockDeleteTorrent).toHaveBeenCalledWith('r9', false);
  });

  it('Pause all calls batchAction("pause")', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent({ id: 'a', state: TorrentState.DOWNLOADING })]);
    render(<DownloadsView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pause all' }));
    expect(mockBatchAction).toHaveBeenCalledWith('pause');
  });

  it('shows an error toast when an action fails', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent({ id: 'p1', state: TorrentState.DOWNLOADING })]);
    mockPerformTorrentAction.mockRejectedValueOnce(new Error('boom'));
    render(<DownloadsView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });
  const titlesInOrder = () =>
    screen.getAllByTestId('torrent-row').map((r) => within(r).getByTestId('row-title').textContent);

  it('orders rows newest-added first with id as tiebreak, whatever the server order', async () => {
    mockListTorrents.mockResolvedValue([
      makeTorrent({ id: 'b', movie_title: 'B', added_at: '2026-11-01T00:00:00' }),
      makeTorrent({ id: '0', movie_title: 'Legacy', added_at: null }),
      makeTorrent({ id: 'c', movie_title: 'C', added_at: '2026-11-05T00:00:00' }),
      makeTorrent({ id: 'a', movie_title: 'A', added_at: '2026-11-01T00:00:00' }),
    ]);
    render(<DownloadsView />);
    await screen.findByText('Legacy');
    expect(titlesInOrder()).toEqual(['C', 'A', 'B', 'Legacy']);
  });

  it('keeps every stat slot, showing — when a value is unknown', async () => {
    mockListTorrents.mockResolvedValue([
      makeTorrent({ id: 'f', movie_title: 'Done', state: TorrentState.FINISHED, eta: 300, size_bytes: null }),
      makeTorrent({ id: 'd', movie_title: 'Going', state: TorrentState.DOWNLOADING, eta: 300, size_bytes: 1610612736 }),
    ]);
    render(<DownloadsView />);
    await screen.findByText('Done');
    const rows = screen.getAllByTestId('torrent-row');
    const done = rows.find((r) => within(r).queryByText('Done'))!;
    const going = rows.find((r) => within(r).queryByText('Going'))!;
    expect(within(done).getByTestId('stat-eta')).toHaveTextContent('ETA —');
    expect(within(done).getByTestId('stat-size')).toHaveTextContent(/^—$/);
    expect(within(going).getByTestId('stat-eta')).toHaveTextContent('ETA 5m');
    expect(within(going).getByTestId('stat-size')).toHaveTextContent('1.5 GB');
  });

  it('every stat slot is fixed-width tabular and non-wrapping', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent()]);
    const { container } = render(<DownloadsView />);
    await screen.findByTestId('row-stats');
    const slots = container.querySelectorAll('[data-testid^="stat-"]');
    expect(slots).toHaveLength(6);
    slots.forEach((el) => {
      expect(el.className).toContain('tabular-nums');
      expect(el.className).toContain('whitespace-nowrap');
      expect(el.className).toMatch(/w-\[\d+ch\]/);
    });
  });

  it("shows the added date in the viewer's local day", async () => {
    const expected: Record<string, string> = {
      UTC: 'Added 5 Nov 2026',
      'Asia/Tokyo': 'Added 6 Nov 2026',
      'America/Los_Angeles': 'Added 5 Nov 2026',
    };
    const original = process.env.TZ;
    try {
      for (const [tz, text] of Object.entries(expected)) {
        process.env.TZ = tz;
        mockListTorrents.mockResolvedValue([makeTorrent({ added_at: '2026-11-05T23:30:00' })]);
        const { unmount } = render(<DownloadsView />);
        expect(await screen.findByTestId('stat-added')).toHaveTextContent(text);
        unmount();
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('always renders Watch, one Pause/Resume toggle and Remove, disabling what does not apply', async () => {
    mockListTorrents.mockResolvedValue([
      makeTorrent({ id: 'f', movie_title: 'Done', state: TorrentState.FINISHED, added_at: '2026-11-03T00:00:00' }),
      makeTorrent({ id: 'p', movie_title: 'Held', state: TorrentState.PAUSED, added_at: '2026-11-02T00:00:00' }),
      makeTorrent({ id: 'd', movie_title: 'Going', state: TorrentState.DOWNLOADING, added_at: '2026-11-01T00:00:00' }),
    ]);
    render(<DownloadsView />);
    await screen.findByText('Done');
    const [done, held, going] = screen.getAllByTestId('torrent-row');
    const labels = (r: HTMLElement) =>
      within(r).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels(done)).toEqual(['Watch', 'Pause', 'Remove']);
    expect(within(done).getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(within(done).getByRole('button', { name: 'Watch' })).toBeEnabled();
    expect(labels(held)).toEqual(['Watch', 'Resume', 'Remove']);
    expect(within(held).getByRole('button', { name: 'Watch' })).toBeDisabled();
    expect(within(held).getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(within(going).getByRole('button', { name: 'Pause' })).toBeEnabled();
  });

  it('an error replaces the stats line instead of adding one', async () => {
    mockListTorrents.mockResolvedValue([
      makeTorrent({ state: TorrentState.ERROR, error_message: 'tracker said no' }),
    ]);
    render(<DownloadsView />);
    const row = await screen.findByTestId('torrent-row');
    expect(within(row).getByTestId('row-stats')).toHaveTextContent('tracker said no');
    expect(within(row).queryByTestId('stat-eta')).toBeNull();
  });

  it('shows who watched only when the owner gets watched_by', async () => {
    mockListTorrents.mockResolvedValue([
      makeTorrent({
        id: 'w', movie_title: 'W', added_at: '2026-11-03T00:00:00',
        watched_by: [
          { profile_id: 'a', display_name: 'Alice', avatar: null, percent: 80.4 },
          { profile_id: 'b', display_name: 'Bob', avatar: null, percent: 30 },
        ],
      }),
      makeTorrent({ id: 'e', movie_title: 'E', added_at: '2026-11-02T00:00:00', watched_by: [] }),
      makeTorrent({ id: 'n', movie_title: 'N', added_at: '2026-11-01T00:00:00' }),
    ]);
    render(<DownloadsView />);
    await screen.findByText('W');
    const [w, e, n] = screen.getAllByTestId('torrent-row');
    expect(within(w).getByTestId('watched-by')).toHaveTextContent('Watched by Alice 80% · Bob 30%');
    expect(within(e).getByTestId('watched-by')).toHaveTextContent('Watched by —');
    expect(within(n).queryByTestId('watched-by')).toBeNull();
  });

  it('the row shows its own countdown', async () => {
    mockListTorrents.mockResolvedValue([
      makeTorrent({
        id: 'a', movie_title: 'Alpha', added_at: '2026-11-03T00:00:00',
        vacuum: { status: 'scheduled', deletes_at: new Date(Date.now() + 12 * 86_400_000 - 3_600_000).toISOString() },
      }),
      makeTorrent({
        id: 'b', movie_title: 'Beta', added_at: '2026-11-02T00:00:00',
        vacuum: { status: 'kept_watching', deletes_at: null },
      }),
    ]);
    render(<DownloadsView />);
    const rows = await screen.findAllByTestId('torrent-row');
    const alphaRow = rows.find((r) => within(r).queryByText('Alpha'))!;
    const betaRow = rows.find((r) => within(r).queryByText('Beta'))!;
    expect(within(alphaRow).getByTestId('vacuum-line')).toHaveTextContent('Deletes in 12 days');
    expect(within(betaRow).getByTestId('vacuum-line')).toHaveTextContent('Kept: not everyone has finished it');
    expect(screen.getAllByTestId('vacuum-line')).toHaveLength(2);
  });

  it('shows no vacuum line when autovacuum is off', async () => {
    mockListTorrents.mockResolvedValue([
      makeTorrent({ id: 'o', movie_title: 'Off', added_at: '2026-11-03T00:00:00', vacuum: { status: 'off', deletes_at: null } }),
      makeTorrent({ id: 'u', movie_title: 'Und', added_at: '2026-11-02T00:00:00' }),
    ]);
    render(<DownloadsView />);
    await screen.findByText('Off');
    expect(screen.getAllByTestId('torrent-row')).toHaveLength(2);
    expect(screen.queryByTestId('vacuum-line')).toBeNull();
  });

  it('shows disk used and free', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent()]);
    render(<DownloadsView />);
    expect(await screen.findByTestId('disk-usage')).toHaveTextContent(
      '12.0 GB in downloads · 80.0 GB free of 500.0 GB',
    );
  });

  it('a failing disk read hides the line but never blanks the list', async () => {
    mockGetDisk.mockRejectedValue(new Error('nope'));
    mockListTorrents.mockResolvedValue([makeTorrent({ movie_title: 'Still Here' })]);
    render(<DownloadsView />);
    await screen.findByText('Still Here');
    await waitFor(() => expect(mockGetDisk).toHaveBeenCalled());
    expect(screen.queryByTestId('disk-usage')).toBeNull();
  });

  it('Remove defaults to deleting everything', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent({ id: 'tor-99' })]);
    render(<DownloadsView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm removal' });
    expect(within(dialog).getByRole('radio', { name: /Delete everything/i })).toBeChecked();
  });

  it('titles a season pack "Season N"', async () => {
    mockListTorrents.mockResolvedValue([
      makeTorrent({ id: 'p', movie_title: 'The Boys S01', media_type: 'tv', season: 1, episode: null, added_at: '2026-11-02T00:00:00' }),
      makeTorrent({ id: 'e', movie_title: 'The Boys S01E05', media_type: 'tv', season: 1, episode: 5, added_at: '2026-11-01T00:00:00' }),
    ]);
    render(<DownloadsView />);
    await screen.findByText('The Boys · Season 1');
    expect(screen.getByText('The Boys S01E05')).toBeInTheDocument();
  });
});
