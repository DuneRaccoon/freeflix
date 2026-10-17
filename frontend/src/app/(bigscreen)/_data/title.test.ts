import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamingProgress, TorrentStatus, VideoFile } from '@/types';

vi.mock('@/services/streaming', () => ({
  streamingService: { getProgressByMovie: vi.fn(), getFiles: vi.fn() },
}));
vi.mock('@/services/torrents', () => ({
  torrentsService: { listTorrents: vi.fn(), downloadCatalogMovie: vi.fn(), getTorrentStatus: vi.fn(), performTorrentAction: vi.fn() },
}));

import { streamingService } from '@/services/streaming';
import { torrentsService } from '@/services/torrents';
import { requestTitle, resumeTitle, takeFourKAsk, titleStateFor } from './title';

const getProgress = vi.mocked(streamingService.getProgressByMovie);
const getFiles = vi.mocked(streamingService.getFiles);
const list = vi.mocked(torrentsService.listTorrents);
const download = vi.mocked(torrentsService.downloadCatalogMovie);
const getStatus = vi.mocked(torrentsService.getTorrentStatus);
const act = vi.mocked(torrentsService.performTorrentAction);

function torrent(o: Partial<TorrentStatus> = {}): TorrentStatus {
  return {
    id: 't1',
    movie_title: 'Unrelated Free Text',
    quality: '1080p',
    state: 'finished',
    progress: 100,
    tmdb_id: 603,
    media_type: 'movie',
    season: null,
    episode: null,
    ...o,
  } as unknown as TorrentStatus;
}

function progress(o: Partial<StreamingProgress> = {}): StreamingProgress {
  return {
    id: 'p1',
    user_id: 'u1',
    torrent_id: 't1',
    movie_id: 'movie:603',
    current_time: 600,
    duration: 1200,
    percentage: 50,
    completed: false,
    last_watched_at: '2026-10-01T10:00:00',
    created_at: '',
    updated_at: '',
    file_index: null,
    title: 'x',
    ...o,
  };
}

const files = (...eps: Array<[number, number, number]>): VideoFile[] =>
  eps.map(([index, season, episode]) => ({ index, season, episode }) as VideoFile);

const movie = { mediaType: 'movie' as const, tmdbId: 603, userId: 'u1' };
const ep = (season: number, episode: number) => ({
  mediaType: 'tv' as const,
  tmdbId: 1399,
  season,
  episode,
  userId: 'u1',
});
const httpError = (status: number, detail?: unknown) => ({ response: { status, data: { detail } } });

beforeEach(() => {
  vi.resetAllMocks();
  getProgress.mockResolvedValue(null);
  list.mockResolvedValue([]);
  getFiles.mockResolvedValue([]);
  getStatus.mockResolvedValue(null);
});

describe('titleStateFor: progress', () => {
  it('a 423 resolves locked and makes no further calls', async () => {
    getProgress.mockRejectedValue(httpError(423));
    const state = await titleStateFor(movie);
    expect(state.locked).toBe(true);
    // Not play: a consumer that forgets `locked` must still be unable to mint.
    expect(state.action.kind).toBe('blocked');
    expect(list).not.toHaveBeenCalled();
    expect(getFiles).not.toHaveBeenCalled();
  });

  it('asks for progress under the content id; no userId skips the call', async () => {
    await titleStateFor(ep(1, 3));
    expect(getProgress).toHaveBeenCalledWith('u1', 'tv:1399:s1:e3');
    getProgress.mockClear();
    await titleStateFor({ ...movie, userId: null });
    expect(getProgress).not.toHaveBeenCalled();
  });

  it('a finished torrent with resumable progress resumes at the saved second', async () => {
    list.mockResolvedValue([torrent()]);
    getProgress.mockResolvedValue(progress({ current_time: 612.5 }));
    const state = await titleStateFor(movie);
    expect(state).toEqual({
      locked: false,
      action: { kind: 'resume', href: '/bigscreen/watch/t1', atSeconds: 612.5 },
    });
  });

  it('a progress row with torrent_id null does not become resume', async () => {
    list.mockResolvedValue([torrent()]);
    getProgress.mockResolvedValue(progress({ torrent_id: null }));
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'open', href: '/bigscreen/watch/t1' });
  });

  it('a row past 95% or completed is finished, not resumable', async () => {
    list.mockResolvedValue([torrent()]);
    getProgress.mockResolvedValue(progress({ percentage: 96 }));
    expect((await titleStateFor(movie)).action.kind).toBe('open');
    getProgress.mockResolvedValue(progress({ percentage: 40, completed: true }));
    expect((await titleStateFor(movie)).action.kind).toBe('open');
  });

  it('a non-423 progress failure is ignored, not fatal', async () => {
    getProgress.mockRejectedValue(httpError(500));
    list.mockResolvedValue([torrent()]);
    const state = await titleStateFor(movie);
    expect(state.locked).toBe(false);
    expect(state.action.kind).toBe('open');
  });

  it('resume keeps the saved file index (file 0 included)', async () => {
    list.mockResolvedValue([torrent({ id: 't9', media_type: 'tv', tmdb_id: 1399, season: 1, episode: null })]);
    getProgress.mockResolvedValue(progress({ torrent_id: 't9', file_index: 0, movie_id: 'tv:1399:s1:e1' }));
    const state = await titleStateFor(ep(1, 1));
    expect(state.action).toMatchObject({ kind: 'resume', href: '/bigscreen/watch/t9?file=0' });
  });
});

describe('titleStateFor: matching torrents', () => {
  it('finds a torrent by tmdb_id + media_type whatever its movie_title says', async () => {
    list.mockResolvedValue([torrent({ movie_title: 'Completely Different', state: 'downloading', progress: 12 } as never)]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'preparing', torrentId: 't1', progress: 12 });
  });

  it('does not match on title alone', async () => {
    list.mockResolvedValue([torrent({ movie_title: 'The Matrix', tmdb_id: 999 })]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'play' });
  });

  it('an episode is NOT matched to a movie row with the same tmdb_id', async () => {
    // Season set so only media_type can tell it apart from a pack: this is the case that
    // fails if media_type stops being compared.
    list.mockResolvedValue([torrent({ tmdb_id: 1399, media_type: 'movie', season: 1, episode: null })]);
    getFiles.mockResolvedValue(files([0, 1, 1])); // the file IS there; only media_type rules the row out
    expect((await titleStateFor(ep(1, 1))).action).toEqual({ kind: 'play' });
  });

  it('a movie is NOT matched to a tv row with the same tmdb_id', async () => {
    // Null season/episode: only media_type separates this from a movie row.
    list.mockResolvedValue([torrent({ media_type: 'tv', season: null, episode: null })]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'play' });
  });

  it('a movie row carrying a season is a mislabelled tv row: no match (contract note 3)', async () => {
    list.mockResolvedValue([torrent({ media_type: 'movie', season: 2, episode: 4 })]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'play' });
  });

  it('a row with a null media_type or tmdb_id matches nothing', async () => {
    list.mockResolvedValue([torrent({ media_type: null }), torrent({ tmdb_id: null })]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'play' });
  });

  it('a different episode of the same show is not a match', async () => {
    list.mockResolvedValue([torrent({ media_type: 'tv', tmdb_id: 1399, season: 1, episode: 2 })]);
    expect((await titleStateFor(ep(1, 3))).action).toEqual({ kind: 'play' });
  });

  it('a different season is not a match, even for a pack', async () => {
    list.mockResolvedValue([torrent({ media_type: 'tv', tmdb_id: 1399, season: 2, episode: null })]);
    expect((await titleStateFor(ep(1, 3))).action).toEqual({ kind: 'play' });
  });

  it('a season pack (season N, episode null) covers an episode of that season', async () => {
    list.mockResolvedValue([torrent({ id: 'pack', media_type: 'tv', tmdb_id: 1399, season: 1, episode: null })]);
    getFiles.mockResolvedValue(files([0, 1, 1], [1, 1, 2], [2, 1, 3]));
    const state = await titleStateFor(ep(1, 3));
    expect(getFiles).toHaveBeenCalledWith('pack');
    expect(state.action).toEqual({ kind: 'open', href: '/bigscreen/watch/pack?file=2' });
  });

  it('a pack that lacks the episode offers play, not a wrong file', async () => {
    list.mockResolvedValue([torrent({ id: 'pack', media_type: 'tv', tmdb_id: 1399, season: 1, episode: null })]);
    getFiles.mockResolvedValue(files([0, 1, 1]));
    expect((await titleStateFor(ep(1, 9))).action).toEqual({ kind: 'play' });
  });

  describe('a pack that is still downloading (streams while it downloads)', () => {
    const downloading = (state = 'downloading') =>
      list.mockResolvedValue([
        torrent({ id: 'pack', media_type: 'tv', tmdb_id: 1399, season: 1, episode: null, state, progress: 30 } as never),
      ]);

    it('is preparing WITH the file of the episode inside it, so it never plays the default file', async () => {
      downloading();
      getFiles.mockResolvedValue(files([0, 1, 1], [1, 1, 2], [2, 1, 3]));
      expect((await titleStateFor(ep(1, 3))).action).toEqual({ kind: 'preparing', torrentId: 'pack', progress: 30, fileIndex: 2 });
    });
    it('file 0 is a real index', async () => {
      downloading();
      getFiles.mockResolvedValue(files([0, 1, 1]));
      expect((await titleStateFor(ep(1, 1))).action).toEqual({ kind: 'preparing', torrentId: 'pack', progress: 30, fileIndex: 0 });
    });
    it.each(['downloading', 'downloading_metadata', 'queued'])(
      'an unreadable file list on a %s pack is still preparing, flagged fileUnknown (never Play anyway)',
      async (state) => {
        downloading(state);
        getFiles.mockRejectedValue(new Error('no metadata yet'));
        expect((await titleStateFor(ep(1, 3))).action).toEqual({ kind: 'preparing', torrentId: 'pack', progress: 30, fileUnknown: true });
      },
    );
    it('a pack that was listed and lacks the episode does not cover it: Play', async () => {
      downloading();
      getFiles.mockResolvedValue(files([0, 1, 1]));
      expect((await titleStateFor(ep(1, 9))).action).toEqual({ kind: 'play' });
    });
    it('a paused pack carries the file so resuming lands on the episode', async () => {
      downloading('paused');
      getFiles.mockResolvedValue(files([0, 1, 1], [4, 1, 2]));
      expect((await titleStateFor(ep(1, 2))).action).toEqual({ kind: 'paused', torrentId: 'pack', fileIndex: 4 });
    });
    it('a paused pack with an unreadable list stays paused and says the file is unknown', async () => {
      downloading('paused');
      getFiles.mockRejectedValue(new Error('x'));
      expect((await titleStateFor(ep(1, 2))).action).toEqual({ kind: 'paused', torrentId: 'pack', fileUnknown: true });
    });
    it('a single-episode torrent needs no file lookup', async () => {
      list.mockResolvedValue([torrent({ id: 'e', media_type: 'tv', tmdb_id: 1399, season: 1, episode: 3, state: 'downloading', progress: 5 } as never)]);
      expect((await titleStateFor(ep(1, 3))).action).toEqual({ kind: 'preparing', torrentId: 'e', progress: 5 });
      expect(getFiles).not.toHaveBeenCalled();
    });
  });

  it('an exact single-episode row opens without a file lookup', async () => {
    list.mockResolvedValue([torrent({ id: 'one', media_type: 'tv', tmdb_id: 1399, season: 1, episode: 3 })]);
    const state = await titleStateFor(ep(1, 3));
    expect(state.action).toEqual({ kind: 'open', href: '/bigscreen/watch/one' });
    expect(getFiles).not.toHaveBeenCalled();
  });

  it('prefers a ready torrent over a downloading one, and the progress row\'s torrent among ready ones', async () => {
    list.mockResolvedValue([
      torrent({ id: 'dl', state: 'downloading' } as never),
      torrent({ id: 'a' }),
      torrent({ id: 'b' }),
    ]);
    getProgress.mockResolvedValue(progress({ torrent_id: 'b' }));
    expect((await titleStateFor(movie)).action).toMatchObject({ kind: 'resume', href: '/bigscreen/watch/b' });
  });
});

describe('titleStateFor: state mapping', () => {
  it.each(['downloading', 'downloading_metadata', 'queued'])('%s is preparing', async (state) => {
    list.mockResolvedValue([torrent({ state, progress: 5 } as never)]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'preparing', torrentId: 't1', progress: 5 });
  });

  it.each(['finished', 'seeding'])('%s is open', async (state) => {
    list.mockResolvedValue([torrent({ state } as never)]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'open', href: '/bigscreen/watch/t1' });
  });

  it('blocked carries the row\'s block_reason', async () => {
    list.mockResolvedValue([torrent({ state: 'blocked', block_reason: 'Disk is full' } as never)]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'blocked', reason: 'Disk is full' });
  });

  it('blocked without a reason still says something', async () => {
    list.mockResolvedValue([torrent({ state: 'blocked' } as never)]);
    const a = (await titleStateFor(movie)).action;
    expect(a.kind === 'blocked' && a.reason.length > 0).toBe(true);
  });

  it.each(['paused', 'stopped', 'error'])('%s is paused: resumable, never Play', async (state) => {
    list.mockResolvedValue([torrent({ state } as never)]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'paused', torrentId: 't1' });
  });

  it.each(['mystery', undefined, null])('an unknown state (%s) on a matched row is preparing, never play', async (state) => {
    list.mockResolvedValue([torrent({ state, progress: 7 } as never)]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'preparing', torrentId: 't1', progress: 7 });
  });

  it('a known unready row wins over an unknown-state row', async () => {
    list.mockResolvedValue([torrent({ id: 'u', state: 'mystery' } as never), torrent({ id: 'p', state: 'paused' } as never)]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'paused', torrentId: 'p' });
  });

  it('never exposes chosen_quality: the stored quality is what matters (contract note 4)', async () => {
    // chosen_quality is None on every poll; a row carrying only `quality` must still match.
    list.mockResolvedValue([torrent({ quality: '720p', chosen_quality: undefined })]);
    expect((await titleStateFor(movie)).action.kind).toBe('open');
  });
});

const legacy = (o: Partial<TorrentStatus> = {}) =>
  torrent({ tmdb_id: null, media_type: null, season: null, episode: null, ...o });

describe('titleStateFor: progress names the torrent (legacy rows)', () => {
  it('resumes a torrent whose four identity fields are all NULL', async () => {
    getProgress.mockResolvedValue(progress({ torrent_id: 'old', current_time: 300 }));
    getStatus.mockResolvedValue(legacy({ id: 'old' }));
    list.mockResolvedValue([legacy({ id: 'old' })]); // identity match finds nothing
    const state = await titleStateFor(movie);
    expect(getStatus).toHaveBeenCalledWith('old');
    expect(state.action).toEqual({ kind: 'resume', href: '/bigscreen/watch/old', atSeconds: 300 });
  });

  it('resolves a legacy pack episode through the saved file index without a lookup', async () => {
    getProgress.mockResolvedValue(progress({ torrent_id: 'old', file_index: 4, movie_id: 'tv:1399:s1:e5' }));
    getStatus.mockResolvedValue(legacy({ id: 'old' }));
    const state = await titleStateFor(ep(1, 5));
    expect(state.action).toMatchObject({ kind: 'resume', href: '/bigscreen/watch/old?file=4' });
    expect(getFiles).not.toHaveBeenCalled();
  });

  it('a legacy torrent still downloading is preparing, not play', async () => {
    getProgress.mockResolvedValue(progress({ torrent_id: 'old' }));
    getStatus.mockResolvedValue(legacy({ id: 'old', state: 'downloading', progress: 40 } as never));
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'preparing', torrentId: 'old', progress: 40 });
  });

  it('a legacy paused torrent is paused', async () => {
    getProgress.mockResolvedValue(progress({ torrent_id: 'old' }));
    getStatus.mockResolvedValue(legacy({ id: 'old', state: 'paused' } as never));
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'paused', torrentId: 'old' });
  });

  it('a vanished torrent (status call rejects) falls back to the identity match', async () => {
    getProgress.mockResolvedValue(progress({ torrent_id: 'gone' }));
    getStatus.mockRejectedValue(httpError(404));
    list.mockResolvedValue([torrent({ id: 'other' })]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'open', href: '/bigscreen/watch/other' });
  });

  it.each([
    ['finished (past 95%)', { percentage: 99 }],
    ['completed', { completed: true, percentage: 40 }],
    ['opened at 0%', { percentage: 0 }],
  ])('a %s film on a legacy NULL-identity torrent opens, not play', async (_n, over) => {
    getProgress.mockResolvedValue(progress({ torrent_id: 'old', ...over }));
    getStatus.mockResolvedValue(legacy({ id: 'old' }));
    list.mockResolvedValue([legacy({ id: 'old' })]);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'open', href: '/bigscreen/watch/old' });
  });

  it('a non-resumable progress row whose torrent is paused is paused', async () => {
    getProgress.mockResolvedValue(progress({ torrent_id: 'old', percentage: 99 }));
    getStatus.mockResolvedValue(legacy({ id: 'old', state: 'paused' } as never));
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'paused', torrentId: 'old' });
  });

  it('a progress row with no torrent_id never asks for one', async () => {
    getProgress.mockResolvedValue(progress({ torrent_id: null }));
    await titleStateFor(movie);
    expect(getStatus).not.toHaveBeenCalled();
  });
});

describe('resumeTitle', () => {
  it('sends resume for the torrent', async () => {
    act.mockResolvedValue({ success: true });
    expect(await resumeTitle('t1')).toEqual({ ok: true });
    expect(act).toHaveBeenCalledWith('t1', 'resume');
  });
  it('turns failures into readable reasons and never rejects', async () => {
    act.mockRejectedValue(httpError(404));
    const gone = await resumeTitle('t1');
    expect(!gone.ok && gone.reason).toMatch(/may have been removed/i);
    expect(!gone.ok && gone.reason).not.toMatch(/no longer on the box/i);
    act.mockRejectedValue(new Error('x'));
    const other = await resumeTitle('t1');
    expect(!other.ok && other.reason).toMatch(/try again/i);
  });
});

describe('titleStateFor: never rejects', () => {
  it('listTorrents rejecting yields play', async () => {
    list.mockRejectedValue(new Error('down'));
    expect(await titleStateFor(movie)).toEqual({ locked: false, action: { kind: 'play' } });
  });

  it('listTorrents resolving a non-array yields play', async () => {
    list.mockResolvedValue({ oops: 1 } as never);
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'play' });
  });

  it('a null or malformed row costs that row only', async () => {
    list.mockResolvedValue([null as never, 5 as never, torrent()]);
    expect((await titleStateFor(movie)).action.kind).toBe('open');
  });

  it.each([
    ['rejects', () => getFiles.mockRejectedValue(new Error('down'))],
    ['answers empty', () => getFiles.mockResolvedValue([])],
    ['answers junk', () => getFiles.mockResolvedValue(null as never)],
  ])('a downloaded pack whose getFiles %s opens the pack, never play, and SAYS it is unresolved', async (_n, setup) => {
    list.mockResolvedValue([torrent({ id: 'pack', media_type: 'tv', tmdb_id: 1399, season: 1, episode: null })]);
    setup();
    // `episodeUnresolved` is what lets the screen admit it could not pinpoint the episode.
    // Without it the only options are to play the wrong episode silently or to offer Play
    // and mint a duplicate of a season already on disk — both worse than saying so.
    expect((await titleStateFor(ep(1, 3))).action).toEqual({
      kind: 'unresolvedEpisode',
      href: '/bigscreen/watch/pack',
    });
  });

  it('a MID-WATCH viewer is told the episode is unresolved too, not quietly resumed', async () => {
    // This is the gap the first version of the flag left: it sat on `open` only, so a
    // mid-watch legacy row returned `resume` with no ?file= and no disclosure — the viewer
    // was dropped back at their timestamp into possibly the wrong episode, told nothing.
    // The old assertion used toMatchObject({kind:'resume'}) and so enshrined it.
    getProgress.mockResolvedValue(progress({ torrent_id: 'old', file_index: null, movie_id: 'tv:1399:s1:e3' }));
    getStatus.mockResolvedValue(legacy({ id: 'old' }));
    getFiles.mockRejectedValue(new Error('down'));
    const action = (await titleStateFor(ep(1, 3))).action;
    expect(action.kind).toBe('unresolvedEpisode');
    // The timestamp survives, so the screen can still offer to pick up where they were.
    expect(action).toEqual({ kind: 'unresolvedEpisode', href: '/bigscreen/watch/old', atSeconds: 600 });
  });

  it('a pack whose filenames do not parse at all is unknown, not absent', async () => {
    // /files derives season/episode from the FILENAME, so an unconventionally named pack
    // yields null for every file. Reading that as "absent" would offer Play and
    // re-download a season already on disk.
    list.mockResolvedValue([torrent({ id: 'pack', media_type: 'tv', tmdb_id: 1399, season: 1, episode: null })]);
    getFiles.mockResolvedValue([
      { index: 0, name: 'disc1_track3.mkv', size: 900, season: null, episode: null },
      { index: 1, name: 'disc1_track4.mkv', size: 950, season: null, episode: null },
    ] as never);
    expect((await titleStateFor(ep(1, 3))).action).toEqual({
      kind: 'unresolvedEpisode',
      href: '/bigscreen/watch/pack',
    });
  });

  it('a pack that IS labelled and lacks the episode is absent, so Play is right', async () => {
    list.mockResolvedValue([torrent({ id: 'pack', media_type: 'tv', tmdb_id: 1399, season: 1, episode: null })]);
    getFiles.mockResolvedValue([
      { index: 0, name: 'S01E01.mkv', size: 900, season: 1, episode: 1 },
    ] as never);
    expect((await titleStateFor(ep(1, 9))).action).toEqual({ kind: 'play' });
  });

  it('a synchronous throw from a service still resolves', async () => {
    list.mockImplementation(() => {
      throw new Error('sync');
    });
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'play' });
  });
});

describe('requestTitle', () => {
  it('posts once at 1080p, under the capability profile, with the media identity', async () => {
    // Exact equality, not objectContaining: `client` is the whole point of stage 8 on this
    // surface and a loose matcher would pass with the profile missing, which on the wire is
    // a 200 ranked by seeds alone -- the quietest possible way for the profile to be absent
    // while looking present. The literal is written out rather than imported from the module
    // under test, so a typo in TV_PROFILE cannot agree with itself.
    download.mockResolvedValue(torrent({ id: 'new', media_type: 'tv', season: 1, episode: 3 }));
    expect(await requestTitle({ mediaType: 'tv', tmdbId: 1399, season: 1, episode: 3 })).toEqual({
      ok: true,
      torrentId: 'new',
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith({
      tmdb_id: 1399,
      quality: '1080p',
      media_type: 'tv',
      client: 'lg-webos22-floor',
      season: 1,
      episode: 3,
    });
  });

  it('fourK raises this one ask to 2160p and still sends the profile', async () => {
    download.mockResolvedValue(torrent({ id: 'uhd' }));
    expect(await requestTitle({ mediaType: 'movie', tmdbId: 603, fourK: true })).toEqual({
      ok: true,
      torrentId: 'uhd',
    });
    expect(download).toHaveBeenCalledWith({
      tmdb_id: 603,
      quality: '2160p',
      media_type: 'movie',
      client: 'lg-webos22-floor',
    });
  });

  it('a pack answer is resolved to the episode file', async () => {
    download.mockResolvedValue(torrent({ id: 'pk', media_type: 'tv', season: 1, episode: null }));
    getFiles.mockResolvedValue(files([0, 1, 1], [3, 1, 2]));
    expect(await requestTitle({ mediaType: 'tv', tmdbId: 1399, season: 1, episode: 2 })).toEqual({ ok: true, torrentId: 'pk', fileIndex: 3 });
  });
  it('a pack answer whose files cannot be read is flagged unresolved, not passed off as resolved', async () => {
    download.mockResolvedValue(torrent({ id: 'pk', media_type: 'tv', season: 1, episode: null }));
    getFiles.mockRejectedValue(new Error('x'));
    expect(await requestTitle({ mediaType: 'tv', tmdbId: 1399, season: 1, episode: 2 })).toEqual({ ok: true, torrentId: 'pk', unresolved: true });
  });

  it('a movie request sends no season or episode', async () => {
    download.mockResolvedValue(torrent({ id: 'new' }));
    await requestTitle({ mediaType: 'movie', tmdbId: 603 });
    expect(download).toHaveBeenCalledWith({
      tmdb_id: 603,
      quality: '1080p',
      media_type: 'movie',
      client: 'lg-webos22-floor',
    });
  });

  it('omitting fourK is 1080p, not undefined', async () => {
    // The backend declares quality as a Literal with a 1080p default, so an absent key
    // would also come back 1080p -- and this surface would be relying on a default it
    // never states. The ask is explicit on every press.
    download.mockResolvedValue(torrent({ id: 'new' }));
    await requestTitle({ mediaType: 'movie', tmdbId: 604 });
    expect(download.mock.calls[0][0].quality).toBe('1080p');
    expect('quality' in download.mock.calls[0][0]).toBe(true);
  });

  it('a tv request without a season is refused without calling the box', async () => {
    const r = await requestTitle({ mediaType: 'tv', tmdbId: 1399 });
    expect(r.ok).toBe(false);
    expect(download).not.toHaveBeenCalled();
  });

  const reason = async (err: unknown) => {
    download.mockRejectedValue(err);
    const r = await requestTitle({ mediaType: 'movie', tmdbId: 603 });
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.reason;
  };

  it('no sources found', async () => {
    expect(await reason(httpError(404, 'No torrents found'))).toMatch(/no sources/i);
  });
  it('title not found is distinct from no sources', async () => {
    const r = await reason(httpError(404, 'Movie not found'));
    expect(r).not.toMatch(/no sources/i);
    expect(r).toMatch(/not found|recogni[sz]e/i);
  });

  /**
   * ONE ROW PER 404 DETAIL THE BOX CAN SEND, the two pre-existing ones above included.
   *
   * THE TWO DEVICE DETAILS ARE READ OFF `api/torrents.py` RATHER THAN RETYPED, because
   * the thing being asserted is a contract across the wire, and a hand-copied fixture
   * pins only this side of it: a copy edit in `_device_refusal` would leave every
   * assertion here green while the television showed the wrong sentence. Same instrument
   * as `legacy-target.test.ts`'s token pin, same reason.
   */
  describe('a capability refusal (stage 8)', () => {
    const PY = join(process.cwd(), '..', 'backend', 'app', 'api', 'torrents.py');

    /** `_device_refusal`'s returned string literals, implicit concatenation joined. */
    const refusals = (): string[] => {
      const src = readFileSync(PY, 'utf8');
      const start = src.indexOf('def _device_refusal');
      expect(start, `_device_refusal is gone from ${PY}`).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf('@dataclass', start));
      // Skip the docstring: it quotes the television's own copy, so its literals would
      // otherwise be read as refusals.
      const doc = body.indexOf('"""');
      const code = body.slice(body.indexOf('"""', doc + 3) + 3);
      return [...code.matchAll(/return\s*\(?((?:\s*"[^"]*")+)\s*\)?/g)].map((m) =>
        [...m[1].matchAll(/"([^"]*)"/g)].map((s) => s[1]).join(''),
      );
    };

    it('sends exactly two details, and BOTH still match /no torrents/i', () => {
      // THE BELT, asserted on its own so the ordering below reads as deliberate rather
      // than accidental. These two properties are what make the pair of defences fail in
      // opposite directions:
      //   - this row holds => losing the new branch degrades to the MILD, true "No
      //     sources found for this title yet.", never to the lie about an unknown title;
      //   - the rows below hold => the new branch sits AHEAD of /no torrents/i, so the
      //     specific sentence is what the viewer actually gets.
      // Move the new branch after /no torrents/i and only the rows below redden; delete
      // the "no torrents" substring from either detail and only this row does.
      const details = refusals();
      expect(details).toHaveLength(2);
      for (const d of details) expect(d, d).toMatch(/no torrents/i);
    });

    it('4K-only (every refusal `withheld`) names the press that can still work', async () => {
      const [withheldOnly] = refusals();
      expect(withheldOnly).toMatch(/only 4k/i);
      const r = await reason(httpError(404, withheldOnly));
      expect(r).toBe('Only 4K sources exist for this title. Press Ask for 4K to try one.');
      // NOT the branch below it, which is the mutation this ordering exists to survive.
      expect(r).not.toMatch(/no sources found for this title yet/i);
    });

    it('anything this panel cannot decode promises nothing, because nothing here would help', async () => {
      const incapable = refusals()[1];
      expect(incapable).not.toMatch(/only 4k/i);
      const r = await reason(httpError(404, incapable));
      expect(r).toBe('No sources this television can play.');
      expect(r).not.toMatch(/4k|press/i);
      expect(r).not.toMatch(/no sources found for this title yet/i);
    });

    it('a 404 that is not a device refusal is untouched by the new branch', async () => {
      // The guard against a branch keyed too loosely: these are the two details that were
      // already on the wire and they must still map exactly where they did.
      expect(await reason(httpError(404, 'No torrents found'))).toBe('No sources found for this title yet.');
      expect(await reason(httpError(404, 'Show not found'))).toBe("The box doesn't recognise this title.");
    });
  });
  it('the box is busy', async () => {
    expect(await reason(httpError(429))).toMatch(/busy/i);
    expect(await reason(httpError(503, 'Too many active downloads'))).toMatch(/busy/i);
  });
  it('the box is unreachable', async () => {
    expect(await reason({ request: {}, message: 'Network Error' })).toMatch(/reach/i);
  });
  it('a generic failure still reads as a sentence', async () => {
    const r = await reason(httpError(500, 'boom'));
    expect(r).toMatch(/couldn.t start|try again/i);
    expect(r).not.toMatch(/boom/);
  });
  it('a non-error rejection and a response without an id are both failures', async () => {
    expect((await reason('weird')).length).toBeGreaterThan(0);
    download.mockResolvedValue({} as never);
    expect((await requestTitle({ mediaType: 'movie', tmdbId: 603 })).ok).toBe(false);
  });
});

describe('requestTitle maybeCreated', () => {
  const maybe = async (err: unknown) => {
    download.mockRejectedValue(err);
    const r = await requestTitle({ mediaType: 'movie', tmdbId: 603 });
    return r.ok ? null : r.maybeCreated;
  };
  it('404 and 409 refused before anything was added', async () => {
    expect(await maybe(httpError(404, 'No torrents found'))).toBe(false);
    expect(await maybe(httpError(409))).toBe(false);
  });
  it('a 5xx may have arrived after the torrent was added', async () => {
    expect(await maybe(httpError(500, 'x'))).toBe(true);
    expect(await maybe(httpError(503))).toBe(true);
  });
  it('no status at all (dropped connection) is ambiguous', async () => {
    expect(await maybe({ request: {}, message: 'Network Error' })).toBe(true);
  });
  it('a 2xx with no id is ambiguous', async () => {
    download.mockResolvedValue({} as never);
    const r = await requestTitle({ mediaType: 'movie', tmdbId: 604 });
    expect(!r.ok && r.maybeCreated).toBe(true);
  });
});

/**
 * THE ONE CHANNEL ON THIS SURFACE THAT CARRIES THE ASK, as opposed to what arrived.
 *
 * The watch route cannot work it out: the URL is `{id}` plus an optional `?file=`, the
 * push carries no state, `TorrentStatus` has no requested-quality field and
 * `chosen_quality` is null on every poll. Without this map the COMMON outcome of the 4K
 * opt-in — health outranks the bucket, so a 4K press is usually answered with 1080p — is
 * silent, which is the defect `unresolvedEpisode` exists to prevent.
 *
 * Every row here is about a LIE THE MAP COULD TELL, not about the happy path.
 */
describe('the 4K ask carrier', () => {
  it('a 4K press records the id it produced, and a 1080p press records nothing', async () => {
    download.mockResolvedValue(torrent({ id: 'uhd1' }));
    await requestTitle({ mediaType: 'movie', tmdbId: 603, fourK: true });
    download.mockResolvedValue(torrent({ id: 'hd1' }));
    await requestTitle({ mediaType: 'movie', tmdbId: 604 });
    // Both halves, because a map that answered true for everything would pass the first.
    expect(takeFourKAsk('uhd1')).toBe(true);
    expect(takeFourKAsk('hd1')).toBe(false);
  });

  it('answers ONCE: the second navigation to the same watch URL is told nothing', async () => {
    // THE LIE THIS EVICTION EXISTS TO PREVENT. Open/Resume sends the viewer back to the
    // same `/bigscreen/watch/{id}` later in the same page session, and a press that has
    // already been answered must not be re-announced there — "the second play inherits
    // the first play's disclosure" would look exactly like a feature.
    download.mockResolvedValue(torrent({ id: 'uhd2' }));
    await requestTitle({ mediaType: 'movie', tmdbId: 605, fourK: true });
    expect(takeFourKAsk('uhd2')).toBe(true);
    expect(takeFourKAsk('uhd2')).toBe(false);
  });

  it('a second press of the same title gets its own answer, never the first press\'s', async () => {
    // `POST /download` mints a fresh uuid4 per press with no dedupe, so a re-press is a
    // DIFFERENT id — the map is keyed on the torrent, so the HD re-press cannot inherit.
    download.mockResolvedValue(torrent({ id: 'first' }));
    await requestTitle({ mediaType: 'movie', tmdbId: 606, fourK: true });
    download.mockResolvedValue(torrent({ id: 'second' }));
    await requestTitle({ mediaType: 'movie', tmdbId: 606 });
    expect(takeFourKAsk('second')).toBe(false);
    expect(takeFourKAsk('first')).toBe(true);
  });

  it('a 4K press that failed records nothing, including a 2xx with no id', async () => {
    download.mockRejectedValue(httpError(404, 'No torrents this television can play'));
    const refused = await requestTitle({ mediaType: 'movie', tmdbId: 607, fourK: true });
    expect(refused.ok).toBe(false);
    download.mockResolvedValue({} as never);
    const noId = await requestTitle({ mediaType: 'movie', tmdbId: 608, fourK: true });
    expect(noId.ok).toBe(false);
    // Nothing to key on, so nothing recorded — and no entry left to be collected later.
    expect(takeFourKAsk('')).toBe(false);
    expect(takeFourKAsk('undefined')).toBe(false);
  });

  it('does not grow without bound: an ask nobody reads is eventually dropped', async () => {
    // NOTHING GUARANTEES A READER. A press the viewer backs out of before the player
    // mounts leaves its entry behind, and the only collector is this cap — so an
    // uncapped map is a leak for the life of the page.
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
    for (const id of ids) {
      download.mockResolvedValue(torrent({ id }));
      await requestTitle({ mediaType: 'movie', tmdbId: 700 + ids.indexOf(id), fourK: true });
    }
    const remembered = ids.filter((id) => takeFourKAsk(id));
    // The oldest go first (Map insertion order), and the most recent press — the one a
    // player is most likely about to ask about — must always survive.
    expect(remembered).toEqual(['a3', 'a4', 'a5', 'a6']);
  });

  it('a tv 4K press records the pack it was answered with', async () => {
    // The pack lookup is a second round trip after the id is known, so recording has to
    // happen before it: a `/files` failure must not be able to lose the ask.
    download.mockResolvedValue(torrent({ id: 'pk4k', media_type: 'tv', season: 1, episode: null }));
    getFiles.mockRejectedValue(new Error('no metadata yet'));
    const r = await requestTitle({ mediaType: 'tv', tmdbId: 1399, season: 1, episode: 2, fourK: true });
    expect(r).toEqual({ ok: true, torrentId: 'pk4k', unresolved: true });
    expect(takeFourKAsk('pk4k')).toBe(true);
  });
});

describe('requestTitle in-flight guard', () => {
  it('a second press for the same title joins the first request', async () => {
    let finish!: (v: TorrentStatus) => void;
    download.mockReturnValue(new Promise((r) => (finish = r)));
    const a = requestTitle({ mediaType: 'movie', tmdbId: 603 });
    const b = requestTitle({ mediaType: 'movie', tmdbId: 603 });
    expect(download).toHaveBeenCalledTimes(1);
    finish(torrent({ id: 'one' }));
    expect(await a).toEqual({ ok: true, torrentId: 'one' });
    expect(await b).toEqual({ ok: true, torrentId: 'one' });
  });

  it('a 4K press during a 1080p search is its own request, not the first one re-served', async () => {
    // The dedupe window is a full provider search wide (~35s cold). With quality out of the
    // key the second press gets the FIRST press's promise: the 4K ask is never sent and the
    // control reports an HD result as the viewer's 4K one. Both halves are asserted -- two
    // calls AND two distinct qualities -- because a key that merely differed would give two
    // calls with the same quality.
    download.mockReturnValue(new Promise(() => {}));
    void requestTitle({ mediaType: 'movie', tmdbId: 603 });
    void requestTitle({ mediaType: 'movie', tmdbId: 603, fourK: true });
    expect(download).toHaveBeenCalledTimes(2);
    expect(download.mock.calls.map((c) => c[0].quality)).toEqual(['1080p', '2160p']);
  });

  it('a second press at the SAME quality still joins the first', async () => {
    // The flag widened the key; it must not have defeated it. Without this row, "quality is
    // in the key" is satisfied by a key that dedupes nothing at all.
    let finish!: (v: TorrentStatus) => void;
    download.mockReturnValue(new Promise((r) => (finish = r)));
    const a = requestTitle({ mediaType: 'movie', tmdbId: 77, fourK: true });
    const b = requestTitle({ mediaType: 'movie', tmdbId: 77, fourK: true });
    expect(download).toHaveBeenCalledTimes(1);
    finish(torrent({ id: 'uhd' }));
    expect(await a).toEqual({ ok: true, torrentId: 'uhd' });
    expect(await b).toEqual({ ok: true, torrentId: 'uhd' });
  });

  it('a movie and an episode of the same tmdb_id do not collide', async () => {
    download.mockReturnValue(new Promise(() => {}));
    void requestTitle({ mediaType: 'movie', tmdbId: 5 });
    void requestTitle({ mediaType: 'tv', tmdbId: 5, season: 1, episode: 1 });
    void requestTitle({ mediaType: 'tv', tmdbId: 5, season: 1, episode: 2 });
    expect(download).toHaveBeenCalledTimes(3);
  });

  it('the guard releases after a failure, so a retry posts again', async () => {
    download.mockRejectedValueOnce(httpError(500));
    expect((await requestTitle({ mediaType: 'movie', tmdbId: 8 })).ok).toBe(false);
    download.mockResolvedValue(torrent({ id: 'again' }));
    expect(await requestTitle({ mediaType: 'movie', tmdbId: 8 })).toEqual({ ok: true, torrentId: 'again' });
    expect(download).toHaveBeenCalledTimes(2);
  });
});
