/**
 * The web heartbeat names the download it is streaming.
 *
 * The player finds an existing progress row by content_id and PUTs to it from then on.
 * That row can still point at a removed download, or at another copy of the title, while
 * the viewer streams this one. So every PUT carries `torrent_id` and `file_index`, and
 * the backend repoints the row: the vacuum's touch, recently-played protection and
 * watched attribution then read the download actually playing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const vp: {
  onProgress: ((s: { currentTime: number; duration: number }) => void) | null;
  onEnded: (() => void) | null;
} = { onProgress: null, onEnded: null };

vi.mock('@/components/player/VideoPlayer', () => ({
  default: function VideoPlayerStub(props: {
    onProgress?: (s: { currentTime: number; duration: number }) => void;
    onEnded?: () => void;
  }) {
    vp.onProgress = props.onProgress ?? null;
    vp.onEnded = props.onEnded ?? null;
    return <div data-testid="video" />;
  },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/UserContext', () => ({ useUser: () => ({ currentUser: { id: 'u1' } }) }));
const updateLocalProgress = vi.fn();
vi.mock('@/context/ProgressContext', () => ({ useProgress: () => ({ updateLocalProgress }) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services/streaming', () => ({
  streamingService: {
    getProgressByMovie: vi.fn(),
    getProgressByTorrent: vi.fn(),
    updateProgress: vi.fn(),
    saveProgress: vi.fn(),
  },
}));

import PatchedVideoPlayer from './PatchedVideoPlayer';
import { streamingService } from '@/services/streaming';

const svc = vi.mocked(streamingService);

/** A row found by content_id, still pointing at the old download t-A. */
const OLD_ROW = {
  id: 'p-old', user_id: 'u1', torrent_id: 't-A', movie_id: 'tv:1399:s1:e5',
  current_time: 120, duration: 1000, percentage: 12, completed: false,
  last_watched_at: '', created_at: '', updated_at: '', file_index: 0,
};

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mountOn(props: { torrentId: string; fileIndex?: number; contentId: string }) {
  render(<PatchedVideoPlayer src="/stream" movieId="legacy" {...props} />);
  await flush();
  expect(screen.getByTestId('video')).toBeTruthy();
  act(() => { vp.onProgress?.({ currentTime: 200, duration: 1000 }); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  svc.getProgressByMovie.mockResolvedValue(OLD_ROW);
  svc.getProgressByTorrent.mockResolvedValue(null);
  svc.updateProgress.mockResolvedValue(OLD_ROW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PatchedVideoPlayer progress PUT', () => {
  it('the 30 s heartbeat carries the torrent and file being streamed', async () => {
    await mountOn({ torrentId: 't-B', fileIndex: 4, contentId: 'tv:1399:s1:e5' });

    await act(async () => { vi.advanceTimersByTime(30_000); });
    await flush();

    expect(svc.saveProgress).not.toHaveBeenCalled();
    expect(svc.updateProgress).toHaveBeenCalledTimes(1);
    expect(svc.updateProgress).toHaveBeenCalledWith('u1', 'p-old', expect.objectContaining({
      current_time: 200, torrent_id: 't-B', file_index: 4,
    }));
  });

  it('the completed PUT at the end carries them too', async () => {
    await mountOn({ torrentId: 't-B', fileIndex: 4, contentId: 'tv:1399:s1:e5' });

    await act(async () => { vp.onEnded?.(); });
    await flush();

    expect(svc.updateProgress).toHaveBeenCalledWith('u1', 'p-old', expect.objectContaining({
      completed: true, torrent_id: 't-B', file_index: 4,
    }));
  });

  it('a film has no file index: it sends null, never a stale one', async () => {
    svc.getProgressByMovie.mockResolvedValue({ ...OLD_ROW, movie_id: 'movie:603' });
    await mountOn({ torrentId: 't-B', contentId: 'movie:603' });

    await act(async () => { vi.advanceTimersByTime(30_000); });
    await flush();

    expect(svc.updateProgress).toHaveBeenCalledWith('u1', 'p-old', expect.objectContaining({
      torrent_id: 't-B', file_index: null,
    }));
  });
});
