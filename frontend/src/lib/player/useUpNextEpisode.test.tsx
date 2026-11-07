import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/services/tv', () => ({ tvService: { getSeason: vi.fn(), getShow: vi.fn() } }));
vi.mock('@/services/torrents', () => ({ torrentsService: { downloadCatalogMovie: vi.fn() } }));
vi.mock('@/services/streaming', () => ({ streamingService: { getFiles: vi.fn() } }));
vi.mock('@/services/instance', () => ({ instanceService: { getPlayback: vi.fn() } }));

import { tvService } from '@/services/tv';
import { torrentsService } from '@/services/torrents';
import { streamingService } from '@/services/streaming';
import { instanceService, type PlaybackSettings } from '@/services/instance';
import type { SeasonDetail, TorrentStatus, VideoFile } from '@/types';
import { useUpNextEpisode } from './useUpNextEpisode';

const tv = vi.mocked(tvService);
const torrents = vi.mocked(torrentsService);
const streaming = vi.mocked(streamingService);
const instance = vi.mocked(instanceService);

const CID = 'tv:1399:s2:e2';

/** The shape `watch/[id]/page.next.test.tsx` uses: season 2, TMDB runtime in minutes. */
const season = (episodes: number[], runtime: number | null = 40): SeasonDetail =>
  ({
    season_number: 2,
    name: 'Season 2',
    overview: null,
    episodes: episodes.map((n) => ({
      episode_number: n,
      name: `Episode ${n}`,
      overview: null,
      runtime,
      still_url: null,
      air_date: null,
      vote_average: 0,
    })),
  }) as SeasonDetail;

const playback = (enabled: boolean, pct = 80): PlaybackSettings => ({ auto_next_enabled: enabled, auto_next_pct: pct });

const row = (over: Partial<TorrentStatus>): TorrentStatus => ({ id: 'next-1', season: 2, episode: 3, ...over }) as TorrentStatus;

const file = (index: number, s: number, e: number): VideoFile => ({ index, season: s, episode: e }) as VideoFile;

/** What a Play next or a prefetch for S02E03 must send, and nothing else. */
const BODY = { tmdb_id: 1399, quality: '1080p', media_type: 'tv', season: 2, episode: 3 };

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued mockResolvedValueOnce must not leak into the next row.
  vi.resetAllMocks();
  tv.getSeason.mockResolvedValue(season([1, 2, 3]));
  instance.getPlayback.mockResolvedValue(playback(true));
  torrents.downloadCatalogMovie.mockResolvedValue(row({}));
});

const flush = async () => {
  for (let i = 0; i < 3; i++) await act(async () => {});
};

type Props = Parameters<typeof useUpNextEpisode>[0];

async function mount(over: Partial<Props> = {}) {
  const hook = renderHook((p: Props) => useUpNextEpisode(p), {
    initialProps: { contentId: CID, quality: '1080p', nextFileInTorrent: false, ...over },
  });
  await flush();
  const tick = async (t: number, d = 2400) => {
    act(() => hook.result.current.onProgress(t, d));
    await flush();
  };
  return { ...hook, tick };
}

const asked = () => torrents.downloadCatalogMovie.mock.calls.map(([b]) => b);

describe('useUpNextEpisode — the lookup', () => {
  it('names the next episode from the catalog, and asks once', async () => {
    const { result, rerender } = await mount();
    rerender({ contentId: CID, quality: '1080p', nextFileInTorrent: false });
    await flush();
    expect.soft(result.current.next).toEqual({ season: 2, episode: 3, name: 'Episode 3' });
    expect.soft(tv.getSeason).toHaveBeenCalledTimes(1);
  });

  it('asks the catalog nothing for a film', async () => {
    const { result } = await mount({ contentId: 'movie:603' });
    expect.soft(result.current.next).toBeNull();
    expect.soft(tv.getSeason).not.toHaveBeenCalled();
  });

  it('drops a previous episode’s late answer', async () => {
    let settle: (v: SeasonDetail) => void = () => {};
    tv.getSeason.mockReturnValueOnce(new Promise((r) => { settle = r; }));
    tv.getSeason.mockResolvedValueOnce(season([1, 2, 3, 4]));
    const { result, rerender } = await mount();
    rerender({ contentId: 'tv:1399:s2:e3', quality: '1080p', nextFileInTorrent: false });
    await flush();
    await act(async () => settle(season([1, 2, 3])));
    await flush();
    expect(result.current.next?.episode).toBe(4);
  });
});

describe('useUpNextEpisode — the prefetch', () => {
  it('starts the next episode downloading once, at the owner’s threshold', async () => {
    const { tick } = await mount();
    await tick(1919); // 79.96 %
    expect.soft(asked(), 'not before').toEqual([]);
    await tick(1920); // exactly 80 %
    expect.soft(asked(), 'AT the point, not one tick after it').toHaveLength(1);
    for (const t of [1921, 2000, 2399]) await tick(t);
    expect.soft(asked()).toEqual([BODY]);
  });

  it('uses the threshold the owner chose', async () => {
    instance.getPlayback.mockResolvedValue(playback(true, 60));
    const { tick } = await mount();
    await tick(1439);
    expect.soft(asked(), 'not before 60 %').toEqual([]);
    await tick(1440);
    expect.soft(asked()).toHaveLength(1);
  });

  it('uses TMDB’s runtime when the element has no duration', async () => {
    const { tick } = await mount();
    await tick(1920, NaN); // 80 % of the 40-minute runtime
    expect(asked()).toHaveLength(1);
  });

  it('lets the element’s own duration win over TMDB’s runtime', async () => {
    const { tick } = await mount();
    await tick(1920, 3000); // 80 % of the runtime, 64 % of the file
    expect.soft(asked(), 'measured against the file').toEqual([]);
    await tick(2400, 3000);
    expect.soft(asked()).toHaveLength(1);
  });

  it('carries this torrent’s quality', async () => {
    const { tick } = await mount({ quality: '2160p' });
    await tick(2000);
    expect(asked()[0]?.quality).toBe('2160p');
  });

  it('sends 1080p for a quality it does not know', async () => {
    const { tick } = await mount({ quality: 'weird' });
    await tick(2000);
    expect(asked()[0]?.quality).toBe('1080p');
  });

  it('starts NOTHING when the next episode is in this torrent', async () => {
    const { tick } = await mount({ nextFileInTorrent: true });
    await tick(2399);
    expect(asked()).toEqual([]);
  });

  it('starts NOTHING when the setting is off', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    const { tick } = await mount();
    await tick(2399);
    expect(asked()).toEqual([]);
  });

  it('starts NOTHING when the setting could not be read', async () => {
    instance.getPlayback.mockRejectedValue(new Error('offline'));
    const { tick } = await mount();
    await tick(2399);
    expect(asked()).toEqual([]);
  });

  it('starts NOTHING when the catalog could not say', async () => {
    tv.getSeason.mockRejectedValue(new Error('tmdb down'));
    const { result, tick } = await mount();
    expect.soft(result.current.next).toBeNull();
    await tick(2399);
    expect.soft(asked()).toEqual([]);
  });

  it('is silent when the box refuses the prefetch', async () => {
    torrents.downloadCatalogMovie.mockRejectedValue(new Error('500'));
    const { result, tick } = await mount();
    await tick(2000);
    expect.soft(asked()).toHaveLength(1);
    expect.soft(result.current.next?.episode).toBe(3);
  });

  it('latches per content id, not once for ever', async () => {
    tv.getSeason.mockResolvedValue(season([1, 2, 3, 4]));
    const { result, rerender, tick } = await mount();
    await tick(2000);
    rerender({ contentId: 'tv:1399:s2:e3', quality: '1080p', nextFileInTorrent: false });
    expect.soft(result.current.next, 'reset the moment the episode changes').toBeNull();
    await flush();
    await tick(2000);
    expect(asked().map((b) => b.episode)).toEqual([3, 4]);
  });
});

describe('useUpNextEpisode — Play next', () => {
  it('Play next goes to the download it prefetched, without asking again', async () => {
    const { result, tick } = await mount();
    await tick(2000);
    const href = await act(() => result.current.playNext());
    expect.soft(href).toBe('/streaming/next-1');
    expect.soft(asked()).toHaveLength(1);
  });

  it('Play next never goes to the previous episode’s prefetch', async () => {
    tv.getSeason.mockResolvedValue(season([1, 2, 3, 4]));
    torrents.downloadCatalogMovie
      .mockResolvedValueOnce(row({}))
      .mockResolvedValueOnce(row({ id: 'next-2', episode: 4 }));
    const { result, rerender, tick } = await mount();
    await tick(2000); // prefetches S02E03 for S02E02
    rerender({ contentId: 'tv:1399:s2:e3', quality: '1080p', nextFileInTorrent: false });
    await flush();
    const href = await act(() => result.current.playNext());
    expect.soft(href).toBe('/streaming/next-2');
    expect.soft(asked().map((x) => x.episode)).toEqual([3, 4]);
  });

  it('Play next asks the box when nothing was prefetched', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    const { result } = await mount();
    const href = await act(() => result.current.playNext());
    expect.soft(href).toBe('/streaming/next-1');
    expect.soft(asked()).toEqual([BODY]);
    expect.soft(streaming.getFiles, 'a row that names its episode is that episode').not.toHaveBeenCalled();
  });

  it('Play next asks again when the prefetch was refused', async () => {
    torrents.downloadCatalogMovie.mockRejectedValueOnce(new Error('500'));
    const { result, tick } = await mount();
    await tick(2000);
    const href = await act(() => result.current.playNext());
    expect.soft(href).toBe('/streaming/next-1');
    expect.soft(asked()).toEqual([BODY, BODY]);
  });

  it('Play next into a season pack opens that episode’s file', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    torrents.downloadCatalogMovie.mockResolvedValue(row({ id: 'pack-9', episode: null }));
    streaming.getFiles.mockResolvedValue([file(4, 2, 1), file(0, 2, 3)]);
    const { result } = await mount();
    const href = await act(() => result.current.playNext());
    expect.soft(href).toBe('/streaming/pack-9?file=0');
    expect.soft(streaming.getFiles).toHaveBeenCalledWith('pack-9');
  });

  it('Play next into a season pack without that episode’s file opens the pack', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    torrents.downloadCatalogMovie.mockResolvedValue(row({ id: 'pack-9', episode: null }));
    streaming.getFiles.mockResolvedValue([]);
    const { result } = await mount();
    expect(await act(() => result.current.playNext())).toBe('/streaming/pack-9');
  });

  it('Play next into a season pack whose files cannot be read opens the pack', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    torrents.downloadCatalogMovie.mockResolvedValue(row({ id: 'pack-9', episode: null }));
    streaming.getFiles.mockRejectedValue(new Error('404'));
    const { result } = await mount();
    expect(await act(() => result.current.playNext())).toBe('/streaming/pack-9');
  });

  it('Play next into a reused pack uses the file the server picked', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    // 0 is falsy: a truthiness check on file_index is caught here.
    torrents.downloadCatalogMovie.mockResolvedValue(row({ id: 'pack-9', episode: null, file_index: 0 }));
    const { result } = await mount();
    const href = await act(() => result.current.playNext());
    expect.soft(href).toBe('/streaming/pack-9?file=0');
    expect.soft(streaming.getFiles).not.toHaveBeenCalled();
  });

  it('Play next into a pack whose metadata is not in yet opens the pack, never ?file=undefined', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    torrents.downloadCatalogMovie.mockResolvedValue(row({ id: 'pack-9', episode: null, file_index: null }));
    streaming.getFiles.mockResolvedValue([]);
    const { result } = await mount();
    expect(await act(() => result.current.playNext())).toBe('/streaming/pack-9');
  });

  it('Play next is null when the box refuses', async () => {
    instance.getPlayback.mockResolvedValue(playback(false));
    torrents.downloadCatalogMovie.mockRejectedValue(new Error('500'));
    const { result } = await mount();
    expect(await act(() => result.current.playNext())).toBeNull();
  });

  it('Play next is null when there is no next episode', async () => {
    tv.getSeason.mockResolvedValue(season([1, 2]));
    const { result } = await mount();
    expect.soft(await act(() => result.current.playNext())).toBeNull();
    expect.soft(asked()).toEqual([]);
  });
});
