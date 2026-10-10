/**
 * The watch identity and the progress heartbeat.
 *
 * WHAT THIS FILE IS DEFENDING. Every assertion here is a row the viewer's history gets
 * wrong if it goes:
 *
 *  - `getProgressByTorrent` filters on torrent + user ONLY, so on a season pack it answers
 *    the row for whichever episode was watched last. Used as a fallback it resumes episode 5
 *    at episode 3's timestamp — which is what the web does. The call must never be made.
 *  - `progress_upsert` puts `title`, `file_index` and `content_id` in `update_cols`
 *    UNCONDITIONALLY, so a POST with `title: null` erases what the web wrote and takes
 *    Continue Watching's label with it. Every write carries a title.
 *  - `StreamingProgressUpdate` has four fields, so a PUT can never correct `file_index`,
 *    `title` or `torrent_id`. The POST upserts on `(user_id, movie_id)`, so there is no
 *    reason to ever hold a progress id — and holding one is how the second write stops
 *    carrying the episode.
 *  - `resolve_content_id`'s last resort mints `tv:{tmdb}:s0:e{file_index}`, which parses
 *    cleanly, matches nothing the detail screens build, and draws as `S00 · E04`. The id is
 *    built here instead, and never under an `s0:`.
 *
 * The 401 half lives in `useWatchProgress.allow401.test.tsx`, which drives the REAL
 * api-client interceptor and so cannot share this file's service mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { StreamingProgress, TorrentStatus, VideoFile } from '@/types';
import { showNameFromTitle } from '@/lib/contentId';
import { streamingService } from '@/services/streaming';
import {
  PROGRESS_CADENCE_MS,
  useWatchProgress,
  watchIdentity,
  type WatchProgressState,
} from './useWatchProgress';

vi.mock('@/services/streaming', () => ({
  streamingService: {
    getProgressByMovie: vi.fn(),
    getProgressByTorrent: vi.fn(),
    saveProgress: vi.fn(),
    updateProgress: vi.fn(),
  },
}));

const svc = vi.mocked(streamingService);

const statusRow = (over: Partial<TorrentStatus> = {}): TorrentStatus =>
  ({
    id: 'pk',
    movie_title: 'Show 1399 S02',
    quality: '1080p',
    state: 'downloading',
    progress: 40,
    tmdb_id: 1399,
    media_type: 'tv',
    season: 2,
    episode: null,
    ...over,
  }) as TorrentStatus;

const file = (index: number, season: number | null, episode: number | null): VideoFile => ({
  index,
  name: `f${index}.mkv`,
  size: 2_000_000_000,
  downloaded: 1_000_000_000,
  progress: 50,
  mime_type: 'video/x-matroska',
  stream_url: '',
  season,
  episode,
});

const progressRow = (over: Partial<StreamingProgress> = {}): StreamingProgress => ({
  id: 'pr1',
  user_id: 'p1',
  torrent_id: 'pk',
  movie_id: 'tv:1399:s2:e5',
  current_time: 1200,
  duration: 2400,
  percentage: 50,
  completed: false,
  last_watched_at: '2026-10-01T10:00:00',
  created_at: '2026-10-01T10:00:00',
  updated_at: '2026-10-01T10:00:00',
  file_index: 4,
  title: 'Show 1399 S02E05',
  ...over,
});

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });

// ---------------------------------------------------------------------------------
// The host. The playhead is a VALUE, not an element: React detaches host refs before a
// passive cleanup runs, so an unmount flush that read the element would always find null.
// ---------------------------------------------------------------------------------

let latest: WatchProgressState;

function Host(props: {
  userId: string | null;
  torrentId: string;
  contentId: string | null;
  title: string | null;
  fileIndex?: number;
  position: number;
  duration: number;
  ended?: boolean;
  writing: boolean;
}) {
  latest = useWatchProgress(props);
  return <p>{latest.resume.ready ? 'ready' : 'waiting'}</p>;
}

interface MountOptions {
  userId?: string | null;
  contentId?: string | null;
  title?: string | null;
  fileIndex?: number;
  writing?: boolean;
  duration?: number;
}

async function mount(opts: MountOptions = {}) {
  const props = {
    userId: opts.userId === undefined ? 'p1' : opts.userId,
    torrentId: 'pk',
    contentId: opts.contentId === undefined ? 'tv:1399:s2:e5' : opts.contentId,
    title: opts.title === undefined ? 'Show 1399 S02E05' : opts.title,
    fileIndex: opts.fileIndex === undefined ? 4 : opts.fileIndex,
    duration: opts.duration ?? 2400,
    writing: opts.writing ?? true,
  };
  let position = 0;
  let ended = false;
  const view = render(<Host {...props} position={position} duration={props.duration} />);
  const draw = () =>
    view.rerender(<Host {...props} position={position} duration={props.duration} ended={ended} />);
  // Let the resume read settle before any assertion about it.
  await act(async () => {});
  return {
    view,
    /** Move the playhead the way the page does: a re-render with the new second. */
    seek: (v: number) => {
      position = v;
      act(() => draw());
    },
    end: () => {
      ended = true;
      act(() => draw());
    },
  };
}

/** One act() per slice: React commits queued updates only when act() exits, so a single
 *  long advance cannot observe a re-render — and makes a dep-array defect unfalsifiable. */
async function tick(ms: number, slices = 4) {
  for (let i = 0; i < slices; i++) {
    await act(async () => {
      vi.advanceTimersByTime(Math.ceil(ms / slices));
    });
  }
}

const posts = () => svc.saveProgress.mock.calls.map(([, payload]) => payload);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  svc.getProgressByMovie.mockResolvedValue(null);
  svc.getProgressByTorrent.mockResolvedValue(progressRow({ current_time: 1800 }));
  svc.saveProgress.mockResolvedValue(progressRow());
  svc.updateProgress.mockResolvedValue(progressRow());
});

afterEach(() => {
  act(() => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
});

// ===================================================================================
// watchIdentity — the join key and the label, built here rather than trusted
// ===================================================================================

describe('watchIdentity', () => {
  it('a movie is keyed by its tmdb id', () => {
    const id = watchIdentity({
      status: statusRow({ media_type: 'movie', season: null, episode: null, movie_title: 'The Matrix' }),
      file: null,
    });
    expect(id.contentId).toBe('movie:1399');
    expect(id.title).toBe('The Matrix');
  });

  it('an episode is keyed s{season}:e{episode} from the torrent row', () => {
    const id = watchIdentity({ status: statusRow({ season: 2, episode: 5 }), file: null });
    expect(id.contentId).toBe('tv:1399:s2:e5');
  });

  it('a pack takes the season and episode off the /files row for the file being played', () => {
    // The pack row carries `episode: null` — "this season is covered" — so the EPISODE can
    // only come from the file. `/files` labels every entry from `parse_episode`.
    const id = watchIdentity({ status: statusRow(), file: file(4, 2, 5) });
    expect(id.contentId).toBe('tv:1399:s2:e5');
    // And the label is strippable, so Continue Watching draws the show's name and not the
    // release's: `showNameFromTitle` is what reads it back.
    expect(id.title).toBe('Show 1399 S02E05');
    expect(showNameFromTitle(id.title, 1399)).toBe('Show 1399');
  });

  it('never mints an s0: id when the episode is unknown', () => {
    // `resolve_content_id`'s last resort is `tv:{tmdb}:s0:e{file_index}` — it parses, matches
    // nothing any detail screen builds, and draws as "S00 · E04". The show-level id is the
    // honest answer for "this season pack, episode unknown".
    const id = watchIdentity({ status: statusRow(), file: file(4, null, null) });
    expect(id.contentId).toBe('tv:1399');
    expect(id.contentId).not.toContain(':s0:');
    expect(id.title).toBe('Show 1399');
  });

  it('answers null when the torrent carries no identity at all', () => {
    // Rows written before the identity columns existed have them NULL and `sync_columns`
    // never backfills. A guessed id is worse than none: it writes history under a key
    // nothing else on either surface will ever look up.
    expect(watchIdentity({ status: statusRow({ tmdb_id: null }), file: null }).contentId).toBeNull();
    expect(watchIdentity({ status: null, file: null }).contentId).toBeNull();
  });

  it('a tv torrent stored as "movie" is still keyed by what the row says', () => {
    // `manager.py` stores a TV torrent as media_type "movie" when the caller omits it; the
    // row is the only thing we have, so the kind follows it rather than the season fields.
    const id = watchIdentity({ status: statusRow({ media_type: 'movie' }), file: file(4, 2, 5) });
    expect(id.contentId).toBe('movie:1399');
  });
});

// ===================================================================================
// The resume read
// ===================================================================================

describe('the resume read', () => {
  it('asks for the row that names this episode, and never the one that names the torrent', async () => {
    svc.getProgressByMovie.mockResolvedValue(progressRow({ current_time: 1200 }));
    await mount();
    expect(svc.getProgressByMovie).toHaveBeenCalledWith('p1', 'tv:1399:s2:e5');
    expect(svc.getProgressByTorrent).not.toHaveBeenCalled();
    // `totalSeconds` is the row's own duration: the only scale there is for turning the
    // resume second into the byte `/info` measures the seek boundary around, since the
    // element reports NaN until `loadedmetadata`.
    expect(latest.resume).toEqual({ ready: true, atSeconds: 1200, totalSeconds: 2400 });
  });

  it('a two-episode pack with no row for THIS episode resumes from the start', async () => {
    // The fallback's exact damage: `getProgressByTorrent` would answer episode 3's row
    // (1800s) for a viewer who asked for episode 5, and the player would start there.
    svc.getProgressByMovie.mockResolvedValue(null);
    await mount();
    expect.soft(latest.resume).toEqual({ ready: true, atSeconds: 0, totalSeconds: null });
    expect.soft(svc.getProgressByTorrent).not.toHaveBeenCalled();
  });

  it('a finished row is not where you left off', async () => {
    svc.getProgressByMovie.mockResolvedValue(progressRow({ percentage: 99, completed: true }));
    await mount();
    expect(latest.resume).toEqual({ ready: true, atSeconds: 0, totalSeconds: 2400 });
  });

  it('is ready at once, with no call, when there is no identity or no profile', async () => {
    await mount({ contentId: null });
    expect.soft(latest.resume).toEqual({ ready: true, atSeconds: 0, totalSeconds: null });
    await mount({ userId: null });
    expect.soft(latest.resume).toEqual({ ready: true, atSeconds: 0, totalSeconds: null });
    expect.soft(svc.getProgressByMovie).not.toHaveBeenCalled();
  });

  it('423 is the one failure that surfaces: the profile is passcode-locked', async () => {
    svc.getProgressByMovie.mockRejectedValue(httpError(423));
    await mount();
    expect.soft(latest.locked).toBe(true);
    // And it is still "ready": the screen is leaving for the picker, not waiting for bytes.
    expect.soft(latest.resume.ready).toBe(true);
  });

  it('an unreachable box is not a lock, and does not stop playback', async () => {
    svc.getProgressByMovie.mockRejectedValue(new Error('network'));
    await mount();
    expect.soft(latest.locked).toBe(false);
    expect.soft(latest.resume).toEqual({ ready: true, atSeconds: 0, totalSeconds: null });
  });
});

// ===================================================================================
// The heartbeat
// ===================================================================================

describe('the heartbeat', () => {
  it('POSTs on the cadence and never PUTs, and every write still names the episode', async () => {
    const { seek } = await mount();
    seek(600);
    await tick(PROGRESS_CADENCE_MS);
    seek(900);
    await tick(PROGRESS_CADENCE_MS);

    expect.soft(posts()).toHaveLength(2);
    expect.soft(svc.updateProgress).not.toHaveBeenCalled();
    // The second write is the one a progress-id cache breaks: a PUT carries four fields and
    // so cannot correct file_index, title or torrent_id.
    for (const payload of posts()) {
      expect.soft(payload.file_index).toBe(4);
      expect.soft(payload.movie_id).toBe('tv:1399:s2:e5');
      expect.soft(payload.torrent_id).toBe('pk');
    }
    expect.soft(posts()[1].current_time).toBe(900);
  });

  it('always sends a title, in the shape showNameFromTitle can strip', async () => {
    const { seek } = await mount();
    seek(600);
    await tick(PROGRESS_CADENCE_MS);
    const payload = posts()[0];
    expect.soft(payload.title).toBe('Show 1399 S02E05');
    expect.soft(payload.title).not.toBeNull();
    expect.soft(showNameFromTitle(payload.title, 1399)).toBe('Show 1399');
  });

  it('reports percentage out of 100 and marks a title complete near the end', async () => {
    const { seek, end } = await mount({ duration: 1000 });
    seek(500);
    await tick(PROGRESS_CADENCE_MS);
    expect.soft(posts()[0].percentage).toBeCloseTo(50);
    expect.soft(posts()[0].completed).toBe(false);
    seek(970);
    await tick(PROGRESS_CADENCE_MS);
    expect.soft(posts()[1].percentage).toBeCloseTo(97);
    expect.soft(posts()[1].completed).toBe(true);
    // `ended` is the certain case, and it reports the whole title however the arithmetic
    // rounded: the show screen's "watched" mark and Continue Watching's "Up next" card both
    // read `completed`, so an episode that ran to the credits must never read as unwatched.
    end();
    await tick(PROGRESS_CADENCE_MS);
    expect.soft(posts()[2].percentage).toBe(100);
    expect.soft(posts()[2].completed).toBe(true);
  });

  it('flushes in the unmount cleanup, because a Back press fires no unload event at all', async () => {
    // A Back press is a client-side route change: neither `beforeunload` nor `pagehide`
    // fires, and the only thing that does happen is this component unmounting.
    const { view, seek } = await mount();
    seek(777);
    expect.soft(posts()).toHaveLength(0);
    view.unmount();
    expect.soft(posts()).toHaveLength(1);
    expect.soft(posts()[0].current_time).toBe(777);
  });

  it('flushes on pagehide, which an unmount cleanup would not see', async () => {
    const { seek } = await mount();
    seek(300);
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(posts()[0].current_time).toBe(300);
  });

  it('flush() writes now, for a press that is about to leave the player', async () => {
    const { seek } = await mount();
    seek(450);
    await act(async () => {
      latest.flush();
    });
    expect(posts()[0].current_time).toBe(450);
  });

  it('writes nothing at all without a profile or an identity', async () => {
    const { view, seek } = await mount({ contentId: null });
    seek(600);
    await tick(PROGRESS_CADENCE_MS);
    view.unmount();
    expect(posts()).toHaveLength(0);
  });

  it('writes nothing before there is playback to record', async () => {
    const { view, seek } = await mount({ writing: false });
    seek(600);
    await tick(PROGRESS_CADENCE_MS);
    view.unmount();
    expect(posts()).toHaveLength(0);
  });

  it('does not record a title the viewer barely started', async () => {
    const { view, seek } = await mount();
    seek(2);
    await tick(PROGRESS_CADENCE_MS);
    view.unmount();
    expect(posts()).toHaveLength(0);
  });

  it('a failed write is swallowed: a heartbeat may never take the player down', async () => {
    svc.saveProgress.mockRejectedValue(httpError(500));
    const { view, seek } = await mount();
    seek(600);
    await tick(PROGRESS_CADENCE_MS);
    expect(() => view.unmount()).not.toThrow();
  });
});
