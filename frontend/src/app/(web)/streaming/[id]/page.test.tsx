import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

/**
 * THE WEB STREAMING PAGE'S NEXT EPISODE, wired: the owner's threshold prefetch, and the Up Next
 * card for a season pack's next file AND a single-episode download's next episode.
 *
 * The lookup, the latch and the Play next href are `useUpNextEpisode`'s and pinned in its own
 * suite. These rows pin only the page's wiring: that every tick reaches the hook first (before
 * the duration guard), what `nextFileInTorrent` means, which id is the content id, and where
 * Play next goes. `UpNextCard` stays real, because it is the thing being clicked.
 */

const nav = vi.hoisted(() => ({
  id: 'ep-2',
  search: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
}));

/** The player stub's latest props. A plain function, so `vi.resetAllMocks()` cannot wipe it. */
const player = vi.hoisted(() => ({
  onProgress: null as null | ((p: { currentTime: number; duration: number }) => void),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: nav.id }),
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => nav.search,
}));

vi.mock('@/services/torrents', () => ({
  torrentsService: {
    getTorrentStatus: vi.fn(),
    prioritizeForStreaming: vi.fn(),
    getSources: vi.fn(),
    downloadCatalogMovie: vi.fn(),
  },
}));

vi.mock('@/services/streaming', () => ({
  streamingService: { getFiles: vi.fn(), getStreamingInfo: vi.fn(), getStreamingUrl: vi.fn() },
}));

vi.mock('@/utils/streaming', () => ({ isStreamingReady: vi.fn() }));

vi.mock('@/services/tv', () => ({ tvService: { getSeason: vi.fn(), getShow: vi.fn() } }));

vi.mock('@/services/instance', () => ({ instanceService: { getPlayback: vi.fn() } }));

vi.mock('react-hot-toast', () => ({
  toast: Object.assign(vi.fn(), { loading: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/components/player/PatchedVideoPlayer', () => ({
  default: function PlayerStub(props: { onProgress?: (p: { currentTime: number; duration: number }) => void }) {
    player.onProgress = props.onProgress ?? null;
    return <div data-testid="player" />;
  },
}));

import { torrentsService } from '@/services/torrents';
import { streamingService } from '@/services/streaming';
import { isStreamingReady } from '@/utils/streaming';
import { tvService } from '@/services/tv';
import { instanceService } from '@/services/instance';
import type { PlaybackSettings } from '@/services/instance';
import { toast } from 'react-hot-toast';
import type { SeasonDetail, ShowDetail, StreamingInfo, TorrentStatus, VideoFile } from '@/types';
import StreamingPage from './page';

const torrents = vi.mocked(torrentsService);
const streaming = vi.mocked(streamingService);
const tv = vi.mocked(tvService);
const instance = vi.mocked(instanceService);

const playback = (enabled: boolean, pct = 80): PlaybackSettings => ({ auto_next_enabled: enabled, auto_next_pct: pct });

/** Season `n` listing `episodes`, each 40 minutes: TMDB's scale is 2400 s. */
const season = (n: number, episodes: number[]): SeasonDetail =>
  ({
    season_number: n,
    name: `Season ${n}`,
    overview: null,
    episodes: episodes.map((e) => ({
      episode_number: e,
      name: `Episode ${e}`,
      overview: null,
      runtime: 40,
      still_url: null,
      air_date: null,
      vote_average: 0,
    })),
  }) as SeasonDetail;

const status = (over: Partial<TorrentStatus> = {}): TorrentStatus =>
  ({
    id: 'ep-2',
    quality: '1080p',
    state: 'downloading',
    progress: 50,
    download_rate: 1,
    num_peers: 3,
    media_type: 'tv',
    tmdb_id: 1399,
    season: 2,
    episode: 2,
    movie_title: 'Show S02E02',
    ...over,
  }) as TorrentStatus;

const info = (over: Partial<StreamingInfo> = {}): StreamingInfo =>
  ({
    torrent_id: 'ep-2',
    content_id: 'tv:1399:s2:e2',
    video_file: { name: 'e2.mkv', progress: 50, size: 1, downloaded: 1, mime_type: 'video/mp4', stream_url: '/v' },
    ...over,
  }) as StreamingInfo;

const file = (index: number, e: number): VideoFile =>
  ({
    index,
    name: `e${e}.mkv`,
    size: 1,
    downloaded: 1,
    progress: 50,
    mime_type: 'video/mp4',
    stream_url: '/v',
    season: 2,
    episode: e,
  }) as VideoFile;

/** A season pack: the file order is the episode order, and the indices are not. */
const PACK_FILES = [file(4, 1), file(0, 2), file(7, 3)];

function asPack(contentId: string) {
  nav.id = 'pk';
  torrents.getTorrentStatus.mockResolvedValue(status({ id: 'pk', episode: null, movie_title: 'Show S02' }));
  streaming.getFiles.mockResolvedValue(PACK_FILES);
  streaming.getStreamingInfo.mockResolvedValue(info({ torrent_id: 'pk', content_id: contentId }));
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued once-value must not leak into the next row.
  vi.resetAllMocks();
  nav.id = 'ep-2';
  nav.search = new URLSearchParams();
  player.onProgress = null;
  torrents.getTorrentStatus.mockResolvedValue(status());
  torrents.prioritizeForStreaming.mockResolvedValue(true);
  torrents.getSources.mockResolvedValue([]);
  torrents.downloadCatalogMovie.mockResolvedValue({ id: 'next-1', season: 2, episode: 3 } as TorrentStatus);
  streaming.getFiles.mockResolvedValue([file(0, 2)]);
  streaming.getStreamingInfo.mockResolvedValue(info());
  streaming.getStreamingUrl.mockReturnValue('/v');
  vi.mocked(isStreamingReady).mockResolvedValue(true);
  tv.getSeason.mockResolvedValue(season(2, [1, 2, 3]));
  instance.getPlayback.mockResolvedValue(playback(true));
});

afterEach(() => {
  vi.useRealTimers();
});

async function open() {
  const view = render(<StreamingPage />);
  await screen.findByTestId('player');
  for (let i = 0; i < 3; i++) await act(async () => {});
  return view;
}

async function tick(t: number, d = 2400) {
  await act(async () => player.onProgress!({ currentTime: t, duration: d }));
  for (let i = 0; i < 2; i++) await act(async () => {});
}

const asked = () => torrents.downloadCatalogMovie.mock.calls.map(([b]) => b);

describe('StreamingPage — the next episode', () => {
  it('a single-episode download starts the next episode past the owner’s threshold, once', async () => {
    await open();
    await tick(1900);
    expect.soft(torrents.downloadCatalogMovie, 'not before 80%').not.toHaveBeenCalled();
    await tick(1921);
    await tick(2000);
    expect.soft(asked()).toEqual([{ tmdb_id: 1399, quality: '1080p', media_type: 'tv', season: 2, episode: 3 }]);
  });

  it('starts it by TMDB’s runtime when the player reports a duration of 0', async () => {
    // getSeason's fixture lists 40-minute episodes, so the scale is 2400 s from TMDB.
    await open();
    await tick(2000, 0);
    expect(asked()).toEqual([{ tmdb_id: 1399, quality: '1080p', media_type: 'tv', season: 2, episode: 3 }]);
  });

  it('the last episode of a pack reaches into the next season', async () => {
    asPack('tv:1399:s2:e3');
    nav.search = new URLSearchParams('file=7');
    tv.getSeason.mockImplementation(async (_id: number, n: number) =>
      n === 2 ? season(2, [1, 2, 3]) : season(3, [1, 2, 3, 4, 5, 6, 7, 8]),
    );
    tv.getShow.mockResolvedValue({
      seasons: [
        { season_number: 2, episode_count: 3 },
        { season_number: 3, episode_count: 8 },
      ],
    } as unknown as ShowDetail);
    await open();
    await tick(2000);
    expect(asked()).toEqual([{ tmdb_id: 1399, quality: '1080p', media_type: 'tv', season: 3, episode: 1 }]);
  });

  it('inside a season pack the next FILE is next: no download, and Play next swaps the file', async () => {
    // No ?file: the pack plays its first file, index 4 = S02E01.
    asPack('tv:1399:s2:e1');
    await open();
    await tick(2399);
    expect.soft(torrents.downloadCatalogMovie).not.toHaveBeenCalled();
    expect.soft(screen.getByTestId('upnext-label').textContent).toBe('S02E02');
    await act(async () => fireEvent.click(screen.getByTestId('upnext-play')));
    for (let i = 0; i < 3; i++) await act(async () => {});
    // Only the file swap: the pack's Play next never also asks the box for the catalog's next.
    expect.soft(nav.replace.mock.calls).toEqual([['/streaming/pk?file=0']]);
    expect.soft(torrents.downloadCatalogMovie).not.toHaveBeenCalled();
  });

  it('a single-episode download offers the next episode near the end, and Play next goes to its download', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    await open();
    await tick(2390);
    expect.soft(screen.getByTestId('upnext-label').textContent).toBe('S02E03');
    await act(async () => fireEvent.click(screen.getByTestId('upnext-play')));
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect.soft(nav.replace).toHaveBeenCalledWith('/streaming/next-1');
  });

  it('says so, and stays put, when the box will not start the next episode', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    torrents.downloadCatalogMovie.mockRejectedValue(new Error('503'));
    await open();
    await tick(2390);
    await act(async () => fireEvent.click(screen.getByTestId('upnext-play')));
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect.soft(asked()).toEqual([{ tmdb_id: 1399, quality: '1080p', media_type: 'tv', season: 2, episode: 3 }]);
    expect.soft(vi.mocked(toast.error)).toHaveBeenCalledWith('Could not start the next episode.', { id: 'play-next' });
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  // The player ticks about 4 times a second, and every tick in the last 30 s used to reopen the
  // card with a fresh 15 s countdown that then played next by itself. These rows tick after the
  // card is closed: a card that came back would be on screen, and its countdown would start
  // the very download the viewer turned down.
  it('Dismiss sticks: the card stays closed for the rest of this episode, and nothing starts the next one', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    await open();
    await tick(2390);
    expect(screen.getByTestId('upnext-card')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByTestId('upnext-dismiss')));
    // Fake timers from here, so a card that came back would run its whole 15 s countdown.
    vi.useFakeTimers();
    await tick(2391);
    await tick(2395);
    await tick(2399);
    expect.soft(screen.queryByTestId('upnext-card')).toBeNull();
    // A second at a time: the card's countdown is a state updater, so it only reaches 0 (and
    // schedules its Play next) when React renders between the interval's ticks.
    for (let s = 0; s < 17; s++) await act(async () => vi.advanceTimersByTime(1000));
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect.soft(torrents.downloadCatalogMovie).not.toHaveBeenCalled();
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('a failed Play next does not come back to try again', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    torrents.downloadCatalogMovie.mockRejectedValue(new Error('503'));
    await open();
    await tick(2390);
    await act(async () => fireEvent.click(screen.getByTestId('upnext-play')));
    for (let i = 0; i < 3; i++) await act(async () => {});
    await tick(2392);
    await tick(2399);
    expect.soft(screen.queryByTestId('upnext-card')).toBeNull();
    expect.soft(asked()).toEqual([{ tmdb_id: 1399, quality: '1080p', media_type: 'tv', season: 2, episode: 3 }]);
  });

  it('a dismissal is for that episode only: the next file of the pack offers its own next', async () => {
    asPack('tv:1399:s2:e1');
    const view = await open();
    await tick(2399);
    await act(async () => fireEvent.click(screen.getByTestId('upnext-dismiss')));
    await tick(2399);
    expect.soft(screen.queryByTestId('upnext-card'), 'dismissed on S02E01').toBeNull();
    // The viewer picks S02E02 (index 0): the page re-reads the stream for it.
    nav.search = new URLSearchParams('file=0');
    streaming.getStreamingInfo.mockResolvedValue(info({ torrent_id: 'pk', content_id: 'tv:1399:s2:e2' }));
    view.rerender(<StreamingPage />);
    for (let i = 0; i < 3; i++) await act(async () => {});
    await tick(2399);
    expect.soft(screen.queryByTestId('upnext-label')?.textContent).toBe('S02E03');
  });

  it('a film has no Up Next and asks the catalog nothing', async () => {
    torrents.getTorrentStatus.mockResolvedValue(
      status({ media_type: 'movie', tmdb_id: 603, season: null, episode: null, movie_title: 'The Matrix' }),
    );
    streaming.getStreamingInfo.mockResolvedValue(info({ content_id: 'movie:603' }));
    await open();
    await tick(2399);
    expect.soft(screen.queryByTestId('upnext-card')).toBeNull();
    expect.soft(tv.getSeason).not.toHaveBeenCalled();
  });
});
