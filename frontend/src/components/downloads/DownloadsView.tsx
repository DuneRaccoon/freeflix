'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { TorrentState, TorrentStatus, TorrentBatchActionType } from '@/types';
import { torrentsService } from '@/services/torrents';
import { activityService } from '@/services/activity';
import { Badge, Button, Modal, Pill, Progress, RadioGroup } from '@/components/ui/fre';
import { cn } from '@/lib/cn';

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
  const [deleteMode, setDeleteMode] = useState<'keep' | 'all'>('keep');

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
          <span className="font-display text-sm font-semibold text-text flex-1 min-w-0 truncate">
            {torrent.movie_title}
          </span>
          <Badge tone={stateTone(torrent.state)}>{stateLabel(torrent.state)}</Badge>
          {torrent.quality && (
            <Badge tone="default">{torrent.quality}</Badge>
          )}
        </div>

        {/* Progress bar */}
        <Progress
          value={torrent.progress}
          label={`${torrent.movie_title} progress`}
        />

        {/* Stats row */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-ui text-xs text-muted">
          <span>
            <span className="text-text/60">↓ </span>
            {formatSpeed(torrent.download_rate)}
          </span>
          <span>
            <span className="text-text/60">↑ </span>
            {formatSpeed(torrent.upload_rate)}
          </span>
          <span>
            <span className="text-text/60">Peers: </span>
            {torrent.num_peers}
          </span>
          {torrent.state === TorrentState.DOWNLOADING && torrent.eta != null && (
            <span>
              <span className="text-text/60">ETA: </span>
              {formatETA(torrent.eta)}
            </span>
          )}
        </div>

        {/* Error message */}
        {torrent.state === TorrentState.ERROR && torrent.error_message && (
          <p className="font-ui text-xs text-danger">{torrent.error_message}</p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {canWatch && (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={watch}
              aria-label="Watch"
            >
              Watch
            </Button>
          )}
          {canPause && (
            <Button
              size="sm"
              variant="glass"
              disabled={busy}
              onClick={() => act('pause')}
              aria-label="Pause"
            >
              Pause
            </Button>
          )}
          {canResume && (
            <Button
              size="sm"
              variant="glass"
              disabled={busy}
              onClick={() => act('resume')}
              aria-label="Resume"
            >
              Resume
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
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
  const pollingRef = useRef(polling);
  pollingRef.current = polling;

  const fetch = useCallback(async () => {
    try {
      const data = await torrentsService.listTorrents();
      setTorrents(data);
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
