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
import { fileIndexForEpisode, requestTitle, resumeTitle, titleStateFor } from './title';

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

  it('a pack that is still downloading is preparing for an episode inside it', async () => {
    list.mockResolvedValue([
      torrent({ id: 'pack', media_type: 'tv', tmdb_id: 1399, season: 1, episode: null, state: 'downloading', progress: 30 } as never),
    ]);
    expect((await titleStateFor(ep(1, 3))).action).toEqual({ kind: 'preparing', torrentId: 'pack', progress: 30 });
    expect(getFiles).not.toHaveBeenCalled();
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
      kind: 'open',
      href: '/bigscreen/watch/pack',
      episodeUnresolved: true,
    });
  });

  it('the legacy progress path (file_index null, episode NULL) also survives a failed lookup', async () => {
    getProgress.mockResolvedValue(progress({ torrent_id: 'old', file_index: null, movie_id: 'tv:1399:s1:e3' }));
    getStatus.mockResolvedValue(legacy({ id: 'old' }));
    getFiles.mockRejectedValue(new Error('down'));
    expect((await titleStateFor(ep(1, 3))).action).toMatchObject({ kind: 'resume', href: '/bigscreen/watch/old' });
  });

  it('a synchronous throw from a service still resolves', async () => {
    list.mockImplementation(() => {
      throw new Error('sync');
    });
    expect((await titleStateFor(movie)).action).toEqual({ kind: 'play' });
  });
});

describe('requestTitle', () => {
  it('posts once at 1080p with the media identity and returns the new id', async () => {
    download.mockResolvedValue(torrent({ id: 'new' }));
    expect(await requestTitle({ mediaType: 'tv', tmdbId: 1399, season: 1, episode: 3 })).toEqual({
      ok: true,
      torrentId: 'new',
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith({
      tmdb_id: 1399,
      quality: '1080p',
      media_type: 'tv',
      season: 1,
      episode: 3,
    });
  });

  it('a movie request sends no season or episode', async () => {
    download.mockResolvedValue(torrent({ id: 'new' }));
    await requestTitle({ mediaType: 'movie', tmdbId: 603 });
    expect(download).toHaveBeenCalledWith({ tmdb_id: 603, quality: '1080p', media_type: 'movie' });
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

describe('fileIndexForEpisode', () => {
  it('prefers the largest file when a sample claims the same episode', async () => {
    getFiles.mockResolvedValue([
      { index: 0, season: 1, episode: 3, size: 30_000_000 },
      { index: 1, season: 1, episode: 3, size: 2_000_000_000 },
      { index: 2, season: 1, episode: 3, size: 40_000_000 },
    ] as VideoFile[]);
    expect(await fileIndexForEpisode('t1', 1, 3)).toBe(1);
  });
  const pack = files([0, 1, 1], [1, 1, 2], [2, 1, 3], [3, 2, 1]);
  it('returns the index for S1E3 out of a pack', async () => {
    getFiles.mockResolvedValue(pack);
    expect(await fileIndexForEpisode('t1', 1, 3)).toBe(2);
    expect(getFiles).toHaveBeenCalledWith('t1');
  });
  it('matches on season as well as episode', async () => {
    getFiles.mockResolvedValue(pack);
    expect(await fileIndexForEpisode('t1', 2, 1)).toBe(3);
  });
  it('returns file 0 as 0, not null', async () => {
    getFiles.mockResolvedValue(pack);
    expect(await fileIndexForEpisode('t1', 1, 1)).toBe(0);
  });
  it('returns null for S9E9 rather than guessing', async () => {
    getFiles.mockResolvedValue(pack);
    expect(await fileIndexForEpisode('t1', 9, 9)).toBeNull();
  });
  it('returns null when getFiles rejects or answers junk', async () => {
    getFiles.mockRejectedValue(new Error('down'));
    expect(await fileIndexForEpisode('t1', 1, 1)).toBeNull();
    getFiles.mockResolvedValue(null as never);
    expect(await fileIndexForEpisode('t1', 1, 1)).toBeNull();
  });
});
