'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { TorrentState, TorrentStatus, TorrentBatchActionType, DiskUsage } from '@/types';
import { torrentsService } from '@/services/torrents';
import { activityService } from '@/services/activity';
import { Badge, Button, Modal, Pill, Progress, RadioGroup } from '@/components/ui/fre';
import { cn } from '@/lib/cn';
import { parseUtc } from '@/lib/parseUtc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** States that count toward the ARM 2-download limit */
const ACTIVE_STATES = new Set<TorrentState>([
  TorrentState.QUEUED,
  TorrentState.CHECKING,
  TorrentState.DOWNLOADING_METADATA,
  TorrentState.DOWNLOADING,
  TorrentState.ALLOCATING,
  TorrentState.CHECKING_FASTRESUME,
]);

type FilterKey = 'all' | 'downloading' | 'completed' | 'paused' | 'error';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'downloading', label: 'Downloading' },
  { key: 'completed', label: 'Completed' },
  { key: 'paused', label: 'Paused' },
  { key: 'error', label: 'Error' },
];

function matchesFilter(t: TorrentStatus, f: FilterKey): boolean {
  switch (f) {
    case 'all': return true;
    case 'downloading':
      return t.state === TorrentState.DOWNLOADING || t.state === TorrentState.DOWNLOADING_METADATA;
    case 'completed':
      return t.state === TorrentState.FINISHED || t.state === TorrentState.SEEDING;
    case 'paused':
      return t.state === TorrentState.PAUSED;
    case 'error':
      return t.state === TorrentState.ERROR;
  }
}

function formatSpeed(kbps: number): string {
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${kbps.toFixed(1)} KB/s`;
}

function formatETA(secs?: number): string {
  if (!secs || secs <= 0) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${secs}s`;
}

/** 1024-based, one decimal, like backend `_human_size`. '—' when unknown. */
function formatBytes(n?: number | null): string {
  if (n == null || !(n > 0)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** The viewer's own local day (the timestamp is naive UTC). */
function formatAdded(iso?: string | null): string {
  const d = parseUtc(iso);
  if (!d) return 'Added —';
  return 'Added ' + new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(d);
}

/** Episode labels already read "Show SxxEyy"; a pack's label gets "· Season N" instead. */
function displayTitle(t: TorrentStatus): string {
  if (t.media_type === 'tv' && t.season != null && t.episode == null) {
    return `${t.movie_title.replace(/ S\d{2}$/, '')} · Season ${t.season}`;
  }
  return t.movie_title;
}

/** Newest added first, NULL last, id as the tiebreak. Never the server's order. */
function sortDownloads(list: TorrentStatus[]): TorrentStatus[] {
  const ms = (t: TorrentStatus) => parseUtc(t.added_at)?.getTime() ?? null;
  return [...list].sort((a, b) => {
    const x = ms(a);
    const y = ms(b);
    if (x !== y) {
      if (x == null) return 1;
      if (y == null) return -1;
      return y - x;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Map TorrentState to a Badge tone */
function stateTone(state: TorrentState): 'default' | 'gold' | 'success' | 'danger' {
  switch (state) {
    case TorrentState.DOWNLOADING:
    case TorrentState.DOWNLOADING_METADATA:
      return 'gold';
    case TorrentState.FINISHED:
    case TorrentState.SEEDING:
      return 'success';
    case TorrentState.ERROR:
      return 'danger';
    default:
      return 'default';
  }
}

/** Human-readable state label */
function stateLabel(state: TorrentState): string {
  switch (state) {
    case TorrentState.DOWNLOADING_METADATA: return 'Fetching metadata';
    case TorrentState.CHECKING_FASTRESUME: return 'Checking resume';
    default: return state.charAt(0).toUpperCase() + state.slice(1);
  }
}

// ---------------------------------------------------------------------------
// TorrentRow
// ---------------------------------------------------------------------------

interface TorrentRowProps {
  torrent: TorrentStatus;
  onRefresh: () => void;
}

const TorrentRow: React.FC<TorrentRowProps> = ({ torrent, onRefresh }) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'keep' | 'all'>('all');

  const act = async (action: 'pause' | 'resume') => {
    setBusy(true);
    try {
      await torrentsService.performTorrentAction(torrent.id, action);
      toast.success(action === 'pause' ? 'Download paused' : 'Download resumed');
    } catch {
      toast.error(`Could not ${action} download`);
    } finally {
      setBusy(false);
      onRefresh();
    }
  };

  const remove = async () => {
    setBusy(true);
    setConfirmDelete(false);
    const deleteFiles = deleteMode === 'all';
    try {
      await torrentsService.deleteTorrent(torrent.id, deleteFiles);
      toast.success(deleteFiles ? 'Removed and deleted files' : 'Removed from downloads');
    } catch {
      toast.error('Could not remove download');
    } finally {
      setBusy(false);
      onRefresh();
    }
  };

  const watch = async () => {
    setBusy(true);
    try {
      await torrentsService.prioritizeForStreaming(torrent.id);
      router.push(`/streaming/${torrent.id}`);
    } catch {
      setBusy(false);
    }
  };

  const canWatch =
    torrent.state === TorrentState.DOWNLOADING ||
    torrent.state === TorrentState.DOWNLOADING_METADATA ||
    torrent.state === TorrentState.FINISHED ||
    torrent.state === TorrentState.SEEDING;

  const canPause =
    torrent.state === TorrentState.DOWNLOADING ||
    torrent.state === TorrentState.DOWNLOADING_METADATA ||
    torrent.state === TorrentState.QUEUED ||
    torrent.state === TorrentState.CHECKING ||
    torrent.state === TorrentState.ALLOCATING ||
    torrent.state === TorrentState.SEEDING;

  const canResume =
    torrent.state === TorrentState.PAUSED ||
    torrent.state === TorrentState.STOPPED;

  const title = displayTitle(torrent);
  const isError = torrent.state === TorrentState.ERROR;
  const slot = 'inline-block tabular-nums whitespace-nowrap';
  const watchedBy = Array.isArray(torrent.watched_by) ? torrent.watched_by : null;

  return (
    <>
      <div
        data-testid="torrent-row"
        className={cn(
          'rounded-xl border border-hairline bg-surface-2/60 p-4',
          'flex flex-col gap-3',
        )}
      >
        {/* Title + badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="row-title"
            className="font-display text-sm font-semibold text-text flex-1 min-w-0 truncate"
          >
            {title}
          </span>
          <Badge tone={stateTone(torrent.state)}>{stateLabel(torrent.state)}</Badge>
          {torrent.quality && (
            <Badge tone="default">{torrent.quality}</Badge>
          )}
        </div>

        {/* Progress bar */}
        <Progress
          value={torrent.progress}
          label={`${title} progress`}
        />

        {/* Stats: six fixed slots, or the error text in their place */}
        <div
          data-testid="row-stats"
          className="flex flex-wrap gap-x-4 gap-y-1 font-ui text-xs text-muted"
        >
          {isError ? (
            <span className="text-danger truncate">{torrent.error_message ?? 'Download failed'}</span>
          ) : (
            <>
              <span data-testid="stat-down" className={cn(slot, 'w-[15ch]')}>
                {'↓ ' + formatSpeed(torrent.download_rate)}
              </span>
              <span data-testid="stat-up" className={cn(slot, 'w-[15ch]')}>
                {'↑ ' + formatSpeed(torrent.upload_rate)}
              </span>
              <span data-testid="stat-peers" className={cn(slot, 'w-[12ch]')}>
                {`${torrent.num_peers} peers`}
              </span>
              <span data-testid="stat-eta" className={cn(slot, 'w-[14ch]')}>
                {'ETA ' + (torrent.state === TorrentState.DOWNLOADING ? formatETA(torrent.eta) : '—')}
              </span>
              <span data-testid="stat-size" className={cn(slot, 'w-[11ch]')}>
                {formatBytes(torrent.size_bytes)}
              </span>
              <span data-testid="stat-added" className={cn(slot, 'w-[20ch]')}>
                {formatAdded(torrent.added_at)}
              </span>
            </>
          )}
        </div>

        {/* Who watched (owner only) */}
        {watchedBy && (
          <p data-testid="watched-by" className="font-ui text-xs text-muted">
            {'Watched by ' + (watchedBy.length
              ? watchedBy.map((w) => `${w.display_name} ${Math.round(w.percent)}%`).join(' · ')
              : '—')}
          </p>
        )}

        {/* Actions: always the same three, in the same places */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !canWatch}
            onClick={watch}
            aria-label="Watch"
          >
            Watch
          </Button>
          <Button
            size="sm"
            variant="glass"
            disabled={busy || !(canPause || canResume)}
            onClick={() => act(canResume ? 'resume' : 'pause')}
            aria-label={canResume ? 'Resume' : 'Pause'}
          >
            {canResume ? 'Resume' : 'Pause'}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => { setDeleteMode('all'); setConfirmDelete(true); }}
            aria-label="Remove"
          >
            Remove
          </Button>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        label="Confirm removal"
      >
        <p className="font-ui text-sm text-text mb-4">
          Remove <strong className="text-gold-lite">{torrent.movie_title}</strong> from downloads?
        </p>
        <RadioGroup
          name={`remove-${torrent.id}`}
          value={deleteMode}
          onChange={(v) => setDeleteMode(v as 'keep' | 'all')}
          options={[
            { value: 'keep', label: 'Remove from list', hint: 'Keep the downloaded files on disk' },
            { value: 'all', label: 'Delete everything', hint: 'Delete files and the download record' },
          ]}
          className="mb-5"
        />
        <div className="flex gap-3 justify-end">
          <Button size="sm" variant="glass" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={remove} aria-label="Confirm remove">
            Remove
          </Button>
        </div>
      </Modal>
    </>
  );
};

// ---------------------------------------------------------------------------
// DownloadsView
// ---------------------------------------------------------------------------

const POLL_INTERVAL = 2000; // ms

const DownloadsView: React.FC = () => {
  const [torrents, setTorrents] = useState<TorrentStatus[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [polling, setPolling] = useState(true);
  const [loading, setLoading] = useState(true);
  const [maxActive, setMaxActive] = useState(2);
  const [disk, setDisk] = useState<DiskUsage | null>(null);
  const pollingRef = useRef(polling);
  pollingRef.current = polling;

  const fetch = useCallback(async () => {
    // Independent of the list: a failing disk read never blanks the downloads.
    torrentsService.getDisk().then(setDisk).catch(() => {});
    try {
      const data = await torrentsService.listTorrents();
      setTorrents(sortDownloads(data));
    } catch {
      // silently ignore transient errors in the poll loop
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => { fetch(); }, [fetch]);

  // Polling loop
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => { if (pollingRef.current) fetch(); }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetch, polling]);

  // Configured concurrent-download ceiling (ARM-capped on the backend)
  useEffect(() => {
    activityService.getCount()
      .then((c) => setMaxActive(c.max_active_downloads ?? 2))
      .catch(() => {});
  }, []);

  const runBatch = async (action: TorrentBatchActionType, label: string) => {
    try {
      const res = await torrentsService.batchAction(action);
      toast.success(`${label}: ${res.succeeded} done${res.failed ? `, ${res.failed} failed` : ''}`);
    } catch {
      toast.error(`${label} failed`);
    } finally {
      fetch();
    }
  };

  const hasActive = torrents.some((t) => ACTIVE_STATES.has(t.state));
  const hasPaused = torrents.some(
    (t) => t.state === TorrentState.PAUSED || t.state === TorrentState.STOPPED,
  );
  const hasCompleted = torrents.some(
    (t) => t.state === TorrentState.FINISHED || t.state === TorrentState.SEEDING,
  );
  const hasErrored = torrents.some((t) => t.state === TorrentState.ERROR);

  const activeCount = torrents.filter((t) => ACTIVE_STATES.has(t.state)).length;
  const filtered = torrents.filter((t) => matchesFilter(t, filter));

  return (
    <div className="pt-[72px]">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-text">Downloads</h1>
            <p
              data-testid="active-count"
              className="mt-0.5 font-ui text-sm text-muted"
            >
              Active {activeCount} / {maxActive}
            </p>
            {disk && (
              <p data-testid="disk-usage" className="mt-0.5 font-ui text-xs text-muted">
                {`${formatBytes(disk.used_by_downloads_bytes)} in downloads · ${formatBytes(disk.free_bytes)} free of ${formatBytes(disk.total_bytes)}`}
              </p>
            )}
          </div>

          {/* Polling toggle */}
          <button
            type="button"
            aria-pressed={polling}
            onClick={() => setPolling((p) => !p)}
            className={cn(
              'rounded-full border px-3 h-8 font-ui text-xs transition-colors',
              'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
              polling
                ? 'border-gold/40 text-gold-lite bg-gold/10'
                : 'border-hairline text-muted bg-surface-2/60',
            )}
          >
            {polling ? 'Live ●' : 'Paused ○'}
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter downloads">
          {FILTERS.map(({ key, label }) => (
            <Pill
              key={key}
              selected={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </Pill>
          ))}
        </div>

        {/* Batch actions */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Batch actions">
          <Button size="sm" variant="glass" disabled={!hasActive}
            onClick={() => runBatch('pause', 'Paused all')}>Pause all</Button>
          <Button size="sm" variant="glass" disabled={!hasPaused}
            onClick={() => runBatch('resume', 'Resumed all')}>Resume all</Button>
          <Button size="sm" variant="ghost" disabled={!hasCompleted}
            onClick={() => runBatch('clear_completed', 'Cleared completed')}>Clear completed</Button>
          <Button size="sm" variant="ghost" disabled={!hasErrored}
            onClick={() => runBatch('retry', 'Retried errored')}>Retry errored</Button>
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-hairline bg-surface-2/40 h-24 animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div
            data-testid="empty-state"
            className="rounded-xl border border-hairline bg-surface-2/40 p-12 text-center"
          >
            <p className="font-display text-base text-muted">
              {torrents.length === 0
                ? 'No downloads yet. Start by searching for a movie.'
                : 'No downloads match the selected filter.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((t) => (
              <TorrentRow key={t.id} torrent={t} onRefresh={fetch} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DownloadsView;
