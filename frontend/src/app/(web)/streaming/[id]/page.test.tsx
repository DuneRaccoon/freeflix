import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

/**
 * THE WEB STREAMING PAGE'S NEXT EPISODE, wired: the owner's threshold prefetch, and the Up Next
 * card for a season pack's next file AND a single-episode download's next episode.
 *
 * The lookup, the latch and the Play next href are `useUpNextEpisode`'s and pinned in its own
 * suite. These rows pin only the page's wiring: that every tick reaches the hook first (before
 * the duration guard), what `nextFileInTorrent` means, which id is the content id, and where
 * Play next goes. `UpNextCard` stays real, because it is the thing being clicked.
 *
 * AND WHERE THE BACK ARROW GOES: the title the page is playing, by `@/lib/titlePageHref`.
 * Which title is `titleOfStream`'s and pinned in `contentId.test.ts`; these rows pin what the
 * page hands it (the torrent row, then `/info` when it answered for the file on screen, else
 * the current `/files` entry) in every state that draws a way back — playing, buffering,
 * blocked and failed — and what the blocked state's button is called for each kind.
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
  toast: Object.assign(vi.fn(), { loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
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
import { TorrentState } from '@/types';
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

  it('shows that it is starting the next episode while the box searches, then clears it', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    let start!: (t: TorrentStatus) => void;
    torrents.downloadCatalogMovie.mockReturnValue(new Promise<TorrentStatus>((res) => { start = res; }));
    await open();
    await tick(2390);
    await act(async () => fireEvent.click(screen.getByTestId('upnext-play')));
    for (let i = 0; i < 3; i++) await act(async () => {});
    // The card is gone and the search can take seconds: without this, nothing is on screen.
    expect.soft(vi.mocked(toast.loading)).toHaveBeenCalledWith('Starting the next episode…', { id: 'play-next' });
    expect.soft(vi.mocked(toast.dismiss)).not.toHaveBeenCalled();
    expect.soft(nav.replace).not.toHaveBeenCalled();

    await act(async () => start({ id: 'next-1', season: 2, episode: 3 } as TorrentStatus));
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect.soft(nav.replace).toHaveBeenCalledWith('/streaming/next-1');
    expect.soft(vi.mocked(toast.dismiss)).toHaveBeenCalledWith('play-next');
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

/**
 * THE BACK ARROW RETURNS TO THE TITLE, and its label names where it goes: `Back to {name}`, or
 * `Back to downloads` only for a download that cannot say which title it is.
 *
 * Every row presses the control by its accessible name and reads `nav.push`'s WHOLE call list,
 * so a press that went somewhere else first, or twice, is red; and asserts `nav.replace` was
 * never called, so the way back stays a push. A pack row builds its `/info` with `packInfo`,
 * which sets the `season`, `episode` and `file_index` that `info()` leaves out: the first two
 * name a pack's episode, and only once the third says it is the file on screen. The one row
 * that leaves `file_index` out says why.
 *
 * The buffering, blocked and failed rows never mount the player (`streamingInfo` is null, or
 * the page drew something else), so they cannot use `open()`. They wait for the control.
 */
describe('the back arrow returns to the title', () => {
  /**
   * The pack's `/info` for one of its files: the season and episode it carries, and the file it
   * answered for, which `api/streaming.py` always sends. `PACK_FILES` puts S02E01 at index 4.
   */
  const packInfo = (s: number | null, e: number | null, contentId: string, fileIndex: number) =>
    info({ torrent_id: 'pk', content_id: contentId, season: s, episode: e, file_index: fileIndex });

  const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

  /** The page drew a way back: the header arrow, the blocked state's button or the error's. */
  const wayBack = () => screen.findByRole('button', { name: /back to|choose another source/i });

  it('a single-episode download goes to its own episode on the show page', async () => {
    await open();
    press('Back to Show');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399?season=2&episode=2']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('a season pack goes to the episode it is playing', async () => {
    asPack('tv:1399:s2:e1');
    streaming.getStreamingInfo.mockResolvedValue(packInfo(2, 1, 'tv:1399:s2:e1', 4));
    await open();
    press('Back to Show');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399?season=2&episode=1']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('a file switch inside the pack moves it, though the page does not remount', async () => {
    asPack('tv:1399:s2:e1');
    streaming.getStreamingInfo.mockResolvedValue(packInfo(2, 1, 'tv:1399:s2:e1', 4));
    const view = await open();
    // The viewer picks S02E02 (index 0): a search-only change, so the page re-reads the stream.
    nav.search = new URLSearchParams('file=0');
    streaming.getStreamingInfo.mockResolvedValue(packInfo(2, 2, 'tv:1399:s2:e2', 0));
    view.rerender(<StreamingPage />);
    // The rerender put the loading screen up; the player comes back with the new `/info`.
    await waitFor(() => expect(streaming.getStreamingInfo).toHaveBeenLastCalledWith('pk', 0));
    await screen.findByTestId('player');
    press('Back to Show');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399?season=2&episode=2']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('a file switch whose `/info` fails names the file picked, not the one left', async () => {
    asPack('tv:1399:s2:e1');
    nav.search = new URLSearchParams('file=4');
    streaming.getStreamingInfo.mockResolvedValue(packInfo(2, 1, 'tv:1399:s2:e1', 4));
    const view = await open();
    // The viewer picks S02E02 (index 0) and the box cannot answer for it, so the last `/info`
    // the page holds is still S02E01's. The retries run out and the error state draws the way back.
    nav.search = new URLSearchParams('file=0');
    streaming.getStreamingInfo.mockRejectedValue(new Error('503'));
    view.rerender(<StreamingPage />);
    await screen.findByText('Unable to Stream');
    expect.soft(streaming.getStreamingInfo).toHaveBeenLastCalledWith('pk', 0);
    press('Back to Show');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399?season=2&episode=2']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('a pack of one file has no file index to compare, so `/info` alone names its episode', async () => {
    // A season search whose best hit was one episode: the row is a pack, the torrent one file.
    nav.id = 'pk';
    torrents.getTorrentStatus.mockResolvedValue(status({ id: 'pk', episode: null, movie_title: 'Show S02' }));
    streaming.getFiles.mockResolvedValue([file(0, 4)]);
    streaming.getStreamingInfo.mockResolvedValue(packInfo(2, 4, 'tv:1399:s2:e4', 0));
    await open();
    press('Back to Show');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399?season=2&episode=4']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('a pack file the box could not identify goes to the show, never to season 0', async () => {
    // The backend's `s0` last resort: `/info` names no season or episode. It answered for
    // index 4, the file on screen, which the file list calls S02E01; so this row also pins that
    // an `/info` about the file on screen is the hint, over the `/files` entry for it.
    asPack('tv:1399:s0:e4');
    streaming.getStreamingInfo.mockResolvedValue(packInfo(null, null, 'tv:1399:s0:e4', 4));
    await open();
    press('Back to Show');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('an `/info` that does not say which file it answered for gives way to the file list', async () => {
    // The box always says; one that did not could not be shown to be about the file on screen,
    // and after a file switch it may not be. Index 4 is S02E01 by the file list.
    asPack('tv:1399:s2:e5');
    streaming.getStreamingInfo.mockResolvedValue(
      info({ torrent_id: 'pk', content_id: 'tv:1399:s2:e5', season: 2, episode: 5 }),
    );
    await open();
    press('Back to Show');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399?season=2&episode=1']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('a film goes to its movie page, named', async () => {
    torrents.getTorrentStatus.mockResolvedValue(
      status({ media_type: 'movie', tmdb_id: 603, season: null, episode: null, movie_title: 'The Matrix' }),
    );
    streaming.getStreamingInfo.mockResolvedValue(info({ content_id: 'movie:603' }));
    await open();
    press('Back to The Matrix');
    expect.soft(nav.push.mock.calls).toEqual([['/movies/603']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('while buffering, before there is any `/info`, it still knows the episode', async () => {
    vi.mocked(isStreamingReady).mockResolvedValue(false);
    render(<StreamingPage />);
    await wayBack();
    press('Back to Show');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399?season=2&episode=2']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
    expect.soft(streaming.getStreamingInfo).not.toHaveBeenCalled();
  });

  it('a pack buffering, before there is any `/info`, takes its episode from the file list', async () => {
    asPack('tv:1399:s2:e1');
    vi.mocked(isStreamingReady).mockResolvedValue(false);
    render(<StreamingPage />);
    await wayBack();
    // The picker is drawn from the file list, so the current file (index 4 = S02E01) is known.
    await screen.findByRole('button', { name: 'S02E01' });
    press('Back to Show');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399?season=2&episode=1']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
    expect.soft(streaming.getStreamingInfo).not.toHaveBeenCalled();
  });

  it('a pack buffering at a file other than its first takes THAT file from the list', async () => {
    asPack('tv:1399:s2:e3');
    nav.search = new URLSearchParams('file=7');
    vi.mocked(isStreamingReady).mockResolvedValue(false);
    render(<StreamingPage />);
    await wayBack();
    await screen.findByRole('button', { name: 'S02E03' });
    // Index 7 is the list's last entry, S02E03; its first, index 4, is S02E01.
    press('Back to Show');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399?season=2&episode=3']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
    expect.soft(streaming.getStreamingInfo).not.toHaveBeenCalled();
  });

  it('a download from before the media columns goes to downloads, and says so', async () => {
    // `info()` still answers `tv:1399:s2:e2`: the way back never reads `/info`'s content id,
    // whose last resort is the backend's `s0` fallback, so the row alone decides.
    torrents.getTorrentStatus.mockResolvedValue(status({ tmdb_id: null, media_type: null }));
    await open();
    press('Back to downloads');
    expect.soft(nav.push.mock.calls).toEqual([['/downloads']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('a film with no name goes to downloads rather than wear a label that is not where it goes', async () => {
    torrents.getTorrentStatus.mockResolvedValue(
      status({ media_type: 'movie', tmdb_id: 603, season: null, episode: null, movie_title: ' ' }),
    );
    streaming.getStreamingInfo.mockResolvedValue(info({ content_id: 'movie:603' }));
    await open();
    press('Back to downloads');
    expect.soft(nav.push.mock.calls).toEqual([['/downloads']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('a show with no name still goes to its page, named by its id', async () => {
    torrents.getTorrentStatus.mockResolvedValue(status({ movie_title: ' ' }));
    await open();
    press('Back to Show 1399');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399?season=2&episode=2']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('blocked: a show is labelled for its show page, which offers no source picker', async () => {
    torrents.getTorrentStatus.mockResolvedValue(status({ state: TorrentState.BLOCKED }));
    vi.mocked(isStreamingReady).mockResolvedValue(false);
    render(<StreamingPage />);
    await wayBack();
    expect.soft(screen.getByText('Blocked for Safety')).toBeTruthy();
    expect.soft(screen.queryByRole('button', { name: 'Choose another source' })).toBeNull();
    press('Back to Show');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399?season=2&episode=2']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('blocked: a film offers another source, on its movie page where the picker is', async () => {
    torrents.getTorrentStatus.mockResolvedValue(
      status({
        state: TorrentState.BLOCKED,
        media_type: 'movie',
        tmdb_id: 603,
        season: null,
        episode: null,
        movie_title: 'The Matrix',
      }),
    );
    vi.mocked(isStreamingReady).mockResolvedValue(false);
    render(<StreamingPage />);
    await wayBack();
    expect.soft(screen.getByText('Blocked for Safety')).toBeTruthy();
    press('Choose another source');
    expect.soft(nav.push.mock.calls).toEqual([['/movies/603']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('blocked: a download that cannot name its title still offers another source, from downloads', async () => {
    torrents.getTorrentStatus.mockResolvedValue(
      status({ state: TorrentState.BLOCKED, tmdb_id: null, media_type: null }),
    );
    vi.mocked(isStreamingReady).mockResolvedValue(false);
    render(<StreamingPage />);
    await wayBack();
    expect.soft(screen.getByText('Blocked for Safety')).toBeTruthy();
    press('Choose another source');
    expect.soft(nav.push.mock.calls).toEqual([['/downloads']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('a download that is gone goes back to downloads', async () => {
    torrents.getTorrentStatus.mockResolvedValue(null);
    render(<StreamingPage />);
    await wayBack();
    press('Back to Downloads');
    expect.soft(nav.push.mock.calls).toEqual([['/downloads']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });

  it('a failure on a download that knows its title is labelled for, and goes to, the title', async () => {
    torrents.prioritizeForStreaming.mockRejectedValue(new Error('503'));
    render(<StreamingPage />);
    await wayBack();
    expect.soft(screen.getByText('Unable to Stream')).toBeTruthy();
    press('Back to Show');
    expect.soft(nav.push.mock.calls).toEqual([['/tv/1399?season=2&episode=2']]);
    expect.soft(nav.replace).not.toHaveBeenCalled();
  });
});
