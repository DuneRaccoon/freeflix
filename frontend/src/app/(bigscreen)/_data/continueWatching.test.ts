import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MovieDetail, ShowDetail, StreamingProgress } from '@/types';
import type { WatchlistItem } from '@/services/watchlist';

vi.mock('@/services/streaming', () => ({ streamingService: { getRecentProgress: vi.fn() } }));
vi.mock('@/services/watchlist', () => ({ watchlistService: { list: vi.fn() } }));
vi.mock('@/services/movies', () => ({ moviesService: { getDetail: vi.fn(), browse: vi.fn() } }));
vi.mock('@/services/tv', () => ({ tvService: { getShow: vi.fn(), browse: vi.fn() } }));

import { streamingService } from '@/services/streaming';
import { watchlistService } from '@/services/watchlist';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { railCellCount } from '../_components/Rail';
import { fetchContinueWatching, fetchMyList } from './continueWatching';

const getRecent = vi.mocked(streamingService.getRecentProgress);
const listWatchlist = vi.mocked(watchlistService.list);
const getMovie = vi.mocked(moviesService.getDetail);
const getShow = vi.mocked(tvService.getShow);

function row(overrides: Partial<StreamingProgress> = {}): StreamingProgress {
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
    created_at: '2026-10-01T09:00:00',
    updated_at: '2026-10-01T10:00:00',
    file_index: null,
    title: 'The Matrix',
    ...overrides,
  };
}

function refused(status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  });
}

beforeEach(() => {
  getRecent.mockReset();
  listWatchlist.mockReset();
  getMovie.mockReset();
  getShow.mockReset();
  // Artwork is cosmetic; by default no title has any, and the tests that care say so.
  getMovie.mockResolvedValue({ backdrop_url: null } as MovieDetail);
  getShow.mockResolvedValue({ backdrop_url: null } as ShowDetail);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchContinueWatching', () => {
  it('asks for the profile\'s 24 most recent rows', async () => {
    getRecent.mockResolvedValue([]);
    await fetchContinueWatching({ userId: 'u1' });
    expect(getRecent).toHaveBeenCalledWith('u1', 24);
  });

  it('is a wide rail named Continue Watching', async () => {
    getRecent.mockResolvedValue([row()]);
    const rail = await fetchContinueWatching({ userId: 'u1' });
    expect(rail).toMatchObject({
      key: 'continue-watching',
      title: 'Continue Watching',
      shape: 'wide',
    });
    expect(rail.loading).toBe(false);
  });

  it('says loading: false outright, so a merge over a loading placeholder cannot leave it true', async () => {
    // `{ ...placeholder, ...result }` keeps the placeholder's `loading: true` if the
    // result merely omits the key, and railCellCount then reports 0 focusable cells for
    // a rail that is full: a dead row with nothing erroring anywhere.
    getRecent.mockResolvedValue([row({ id: 'a' }), row({ id: 'b', movie_id: 'movie:2', title: 'Two' })]);
    const rail = await fetchContinueWatching({ userId: 'u1' });
    const placeholder = { key: 'continue-watching', title: 'Continue Watching', shape: 'wide' as const, items: [], loading: true };
    expect(railCellCount({ ...placeholder, ...rail })).toBe(2);
    getRecent.mockRejectedValue(refused(423));
    const refusedRail = await fetchContinueWatching({ userId: 'u1' });
    expect(refusedRail.loading).toBe(false);
    expect({ ...placeholder, ...refusedRail }.loading).toBe(false);
  });

  it('reads the content id from movie_id, not content_id', async () => {
    // The ORM table has both columns but the response model exposes only movie_id, so
    // content_id is undefined on every row the client sees. The decoy proves which one
    // is read: parsing it would turn this episode into movie 999.
    const decoy = { ...row({ movie_id: 'tv:1399:s1:e1', title: 'Game of Thrones S01E01' }), content_id: 'movie:999' };
    getRecent.mockResolvedValue([decoy as StreamingProgress]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('tv:1399');
    expect(items[0].title).toBe('Game of Thrones');
    expect(getShow).toHaveBeenCalledWith(1399);
    expect(getMovie).not.toHaveBeenCalled();
  });

  it('drops a row whose torrent was removed', async () => {
    // torrent_id is ON DELETE SET NULL: the history row survives, but nothing can resume.
    getRecent.mockResolvedValue([
      row({ id: 'gone', torrent_id: null, movie_id: 'movie:1', title: 'Gone' }),
      row({ id: 'kept', movie_id: 'movie:2', title: 'Kept' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items.map((c) => c.title)).toEqual(['Kept']);
  });

  it('drops a completed movie', async () => {
    getRecent.mockResolvedValue([
      row({ id: 'done', completed: true, percentage: 100, movie_id: 'movie:1', title: 'Seen' }),
      row({ id: 'mid', movie_id: 'movie:2', title: 'Half' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items.map((c) => c.title)).toEqual(['Half']);
  });

  it('drops a row with nothing watched yet', async () => {
    getRecent.mockResolvedValue([row({ percentage: 0 })]);
    expect((await fetchContinueWatching({ userId: 'u1' })).items).toEqual([]);
  });

  it('keeps one card per show, the most recently watched, whatever order the rows come in', async () => {
    getRecent.mockResolvedValue([
      row({
        id: 'older',
        torrent_id: 'pack',
        file_index: 0,
        movie_id: 'tv:1399:s1:e1',
        title: 'Game of Thrones S01E01',
        last_watched_at: '2026-09-28T20:00:00',
      }),
      row({
        id: 'newer',
        torrent_id: 'pack',
        file_index: 1,
        movie_id: 'tv:1399:s1:e2',
        title: 'Game of Thrones S01E02',
        last_watched_at: '2026-10-02T20:00:00',
      }),
      row({ id: 'film', movie_id: 'movie:603', last_watched_at: '2026-10-01T20:00:00' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items.map((c) => c.id)).toEqual(['tv:1399', 'movie:603']);
    expect(items[0].subtitle).toBe('S01 · E02');
    expect(items[0].href).toBe('/bigscreen/watch/pack?file=1');
  });

  it('orders newest first, whatever order the backend sent', async () => {
    getRecent.mockResolvedValue([
      row({ id: 'a', movie_id: 'movie:1', title: 'Old', last_watched_at: '2026-09-01T10:00:00' }),
      row({ id: 'b', movie_id: 'movie:2', title: 'New', last_watched_at: '2026-10-05T10:00:00' }),
      row({ id: 'c', movie_id: 'movie:3', title: 'Mid', last_watched_at: '2026-09-20T10:00:00' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items.map((c) => c.title)).toEqual(['New', 'Mid', 'Old']);
  });

  it('turns a completed episode into an Up next card that opens the show screen', async () => {
    // Nothing in a progress row says whether episode + 1 exists or where its file is, so
    // the card claims neither: it goes to the show's detail screen, where the viewer
    // picks. The web resumes the episode just finished, which is the bug this avoids.
    getShow.mockResolvedValue({ backdrop_url: 'https://img.test/got.jpg' } as ShowDetail);
    getRecent.mockResolvedValue([
      row({
        completed: true,
        percentage: 100,
        torrent_id: 'pack',
        file_index: 2,
        movie_id: 'tv:1399:s1:e3',
        title: 'Game of Thrones S01E03',
      }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: 'tv:1399:up-next',
      href: '/bigscreen/show/1399',
      title: 'Game of Thrones',
      subtitle: null,
      badge: 'Up next',
      artUrl: 'https://img.test/got.jpg',
    });
    // No bar (nothing to resume) and no watch route (no file exists for episode + 1).
    expect(items[0].progressPct).toBeUndefined();
    expect(items[0].href).not.toContain('/bigscreen/watch/');
    expect(getShow).toHaveBeenCalledWith(1399);
  });

  it('badges only the Up next card', async () => {
    getRecent.mockResolvedValue([
      row({ id: 'a', completed: true, percentage: 100, movie_id: 'tv:1399:s1:e1', title: 'Game of Thrones S01E01', last_watched_at: '2026-10-03T00:00:00' }),
      row({ id: 'b', movie_id: 'tv:66732:s2:e4', title: 'Stranger Things S02E04', last_watched_at: '2026-10-02T00:00:00' }),
      row({ id: 'c', movie_id: 'movie:603', last_watched_at: '2026-10-01T00:00:00' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items.map((c) => [c.id, c.badge ?? null])).toEqual([
      ['tv:1399:up-next', 'Up next'],
      ['tv:66732', null],
      ['movie:603', null],
    ]);
  });

  it('lets a finished latest episode stand for the show, so an older half-watched one cannot resurface behind it', async () => {
    // The show is represented by its most recent row, claimed BEFORE the completed check.
    // If that order were swapped, the finished E3 would be skipped without claiming the
    // show and the half-watched E2 below it would take its place: a card offering the
    // viewer something they have already moved past.
    getRecent.mockResolvedValue([
      row({
        id: 'e2',
        movie_id: 'tv:1399:s1:e2',
        title: 'Game of Thrones S01E02',
        last_watched_at: '2026-09-30T20:00:00',
      }),
      row({
        id: 'e3',
        completed: true,
        percentage: 100,
        movie_id: 'tv:1399:s1:e3',
        title: 'Game of Thrones S01E03',
        last_watched_at: '2026-10-02T20:00:00',
      }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items.map((c) => c.id)).toEqual(['tv:1399:up-next']);
    expect(items.some((c) => c.subtitle === 'S01 · E02')).toBe(false);
  });

  it('prefers a newer in-progress episode to an older completed one', async () => {
    getRecent.mockResolvedValue([
      row({
        id: 'e1',
        completed: true,
        percentage: 100,
        movie_id: 'tv:1399:s1:e1',
        title: 'Game of Thrones S01E01',
        last_watched_at: '2026-09-30T20:00:00',
      }),
      row({
        id: 'e2',
        torrent_id: 'pack',
        file_index: 1,
        movie_id: 'tv:1399:s1:e2',
        title: 'Game of Thrones S01E02',
        last_watched_at: '2026-10-02T20:00:00',
      }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'tv:1399', subtitle: 'S01 · E02', href: '/bigscreen/watch/pack?file=1' });
    expect(items[0].badge).toBeUndefined();
  });

  it('still offers Up next for a finished episode whose torrent was removed', async () => {
    // Up next opens the show screen, so it needs no torrent.
    getRecent.mockResolvedValue([
      row({ completed: true, percentage: 100, torrent_id: null, movie_id: 'tv:1399:s1:e3', title: 'Game of Thrones S01E03' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items.map((c) => c.id)).toEqual(['tv:1399:up-next']);
  });

  it('does not let an unresumable newest episode claim the show from an older resumable one', async () => {
    getRecent.mockResolvedValue([
      row({ id: 'new', torrent_id: null, movie_id: 'tv:1399:s1:e3', title: 'Game of Thrones S01E03', last_watched_at: '2026-10-02T20:00:00' }),
      row({ id: 'old', movie_id: 'tv:1399:s1:e2', title: 'Game of Thrones S01E02', last_watched_at: '2026-09-30T20:00:00' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items.map((c) => [c.id, c.subtitle])).toEqual([['tv:1399', 'S01 · E02']]);
  });

  it('links to a bigscreen watch route, with ?file= when file_index is set', async () => {
    getRecent.mockResolvedValue([
      row({ id: 'a', torrent_id: 'abc', file_index: 3, movie_id: 'tv:10:s1:e4', title: 'Show S01E04' }),
      row({ id: 'b', torrent_id: 'def', file_index: null, movie_id: 'movie:2', title: 'Film' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    const hrefs = Object.fromEntries(items.map((c) => [c.id, c.href]));
    expect(hrefs['tv:10']).toBe('/bigscreen/watch/abc?file=3');
    expect(hrefs['movie:2']).toBe('/bigscreen/watch/def');
    // resumeUrlFor would answer /streaming/{id}, a (web) route that leaves the TV's
    // root layout.
    for (const c of items) expect(c.href).not.toContain('/streaming/');
  });

  it('keeps file_index 0: the first file of a season pack is a real file', async () => {
    getRecent.mockResolvedValue([row({ torrent_id: 'pack', file_index: 0, movie_id: 'tv:10:s1:e1', title: 'Show S01E01' })]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items[0].href).toBe('/bigscreen/watch/pack?file=0');
  });

  it('rounds the progress percentage', async () => {
    getRecent.mockResolvedValue([
      row({ id: 'a', movie_id: 'movie:1', percentage: 41.6, last_watched_at: '2026-10-03T00:00:00' }),
      row({ id: 'b', movie_id: 'movie:2', percentage: 12.4, last_watched_at: '2026-10-02T00:00:00' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items.map((c) => c.progressPct)).toEqual([42, 12]);
  });

  it('uses the title\'s backdrop as the artwork, fetched by tmdb id', async () => {
    getMovie.mockResolvedValue({ backdrop_url: 'https://img.test/m.jpg' } as MovieDetail);
    getShow.mockResolvedValue({ backdrop_url: 'https://img.test/s.jpg' } as ShowDetail);
    getRecent.mockResolvedValue([
      row({ id: 'a', movie_id: 'movie:603', last_watched_at: '2026-10-03T00:00:00' }),
      row({ id: 'b', movie_id: 'tv:1399:s1:e1', title: 'Game of Thrones S01E01', last_watched_at: '2026-10-02T00:00:00' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(getMovie).toHaveBeenCalledWith(603);
    expect(getShow).toHaveBeenCalledWith(1399);
    expect(items.map((c) => c.artUrl)).toEqual(['https://img.test/m.jpg', 'https://img.test/s.jpg']);
  });

  it('still returns the card, artless, when the artwork lookup fails', async () => {
    getMovie.mockRejectedValue(refused(502));
    getRecent.mockResolvedValue([row()]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items).toHaveLength(1);
    expect(items[0].artUrl).toBeNull();
  });

  it('does not look up artwork for a title it cannot identify', async () => {
    getRecent.mockResolvedValue([row({ movie_id: 'The Old Title', title: 'The Old Title' })]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('The Old Title');
    expect(getMovie).not.toHaveBeenCalled();
  });

  it('skips a tv row whose content id does not parse, rather than guessing its show', async () => {
    getRecent.mockResolvedValue([row({ movie_id: 'tv:garbage' })]);
    expect((await fetchContinueWatching({ userId: 'u1' })).items).toEqual([]);
  });

  it('does not wait for a lookup that never settles, and the other cards keep their artwork', async () => {
    // apiClient has no timeout and a cold movie detail can take ~35s. One slow title must
    // cost that title its artwork, not leave the whole rail a skeleton with no cells.
    vi.useFakeTimers();
    getMovie.mockImplementation((id: number) =>
      id === 1
        ? new Promise<MovieDetail>(() => {})
        : Promise.resolve({ backdrop_url: `https://img.test/${id}.jpg` } as MovieDetail),
    );
    getRecent.mockResolvedValue([
      row({ id: 'a', movie_id: 'movie:1', title: 'Stuck', last_watched_at: '2026-10-03T00:00:00' }),
      row({ id: 'b', movie_id: 'movie:2', title: 'Two', last_watched_at: '2026-10-02T00:00:00' }),
      row({ id: 'c', movie_id: 'movie:3', title: 'Three', last_watched_at: '2026-10-01T00:00:00' }),
    ]);

    let done = false;
    const pending = fetchContinueWatching({ userId: 'u1' }).then((rail) => {
      done = true;
      return rail;
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false); // still inside the budget
    await vi.advanceTimersByTimeAsync(2000);
    expect(done).toBe(true); // resolved by 3s although one lookup never will

    const { items } = await pending;
    expect(items.map((c) => [c.title, c.artUrl])).toEqual([
      ['Stuck', null],
      ['Two', 'https://img.test/2.jpg'],
      ['Three', 'https://img.test/3.jpg'],
    ]);
    expect(railCellCount(await pending)).toBe(3);
  });

  it('leaves no timer behind once every lookup has answered', async () => {
    vi.useFakeTimers();
    getRecent.mockResolvedValue([row({ id: 'a' }), row({ id: 'b', movie_id: 'movie:2', title: 'Two' })]);
    await fetchContinueWatching({ userId: 'u1' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the other cards\' artwork when one lookup rejects', async () => {
    getMovie.mockImplementation((id: number) =>
      id === 1 ? Promise.reject(refused(502)) : Promise.resolve({ backdrop_url: `https://img.test/${id}.jpg` } as MovieDetail),
    );
    getRecent.mockResolvedValue([
      row({ id: 'a', movie_id: 'movie:1', title: 'Broken', last_watched_at: '2026-10-03T00:00:00' }),
      row({ id: 'b', movie_id: 'movie:2', title: 'Fine', last_watched_at: '2026-10-02T00:00:00' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items.map((c) => [c.title, c.artUrl])).toEqual([
      ['Broken', null],
      ['Fine', 'https://img.test/2.jpg'],
    ]);
  });

  it('still returns an Up next card, artless, when its show lookup rejects', async () => {
    getShow.mockRejectedValue(refused(502));
    getRecent.mockResolvedValue([
      row({ completed: true, percentage: 100, movie_id: 'tv:1399:s1:e3', title: 'Game of Thrones S01E03' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items).toEqual([
      {
        id: 'tv:1399:up-next',
        href: '/bigscreen/show/1399',
        title: 'Game of Thrones',
        subtitle: null,
        badge: 'Up next',
        artUrl: null,
      },
    ]);
  });

  it('costs a malformed row only that row, never the rail', async () => {
    getRecent.mockResolvedValue([
      null as unknown as StreamingProgress,
      row({ id: 'num', movie_id: 42 as unknown as string, last_watched_at: '2026-10-09T00:00:00' }),
      row({ id: 'badtitle', movie_id: 'tv:7:s1:e1', title: 7 as unknown as string, last_watched_at: '2026-10-08T00:00:00' }),
      row({ id: 'good', movie_id: 'movie:2', title: 'Good', last_watched_at: '2026-10-01T00:00:00' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items.map((c) => c.title)).toEqual(['Good']);
  });

  it('gives a movie with an empty title the same fallback as one with none', async () => {
    getRecent.mockResolvedValue([
      row({ id: 'a', movie_id: 'movie:1', title: '', last_watched_at: '2026-10-02T00:00:00' }),
      row({ id: 'b', movie_id: 'movie:2', title: null, last_watched_at: '2026-10-01T00:00:00' }),
    ]);
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items.map((c) => c.title)).toEqual(['Untitled', 'Untitled']);
  });

  it('caps the rail at 6 cards, which also bounds the artwork lookups', async () => {
    getRecent.mockResolvedValue(
      Array.from({ length: 24 }, (_, i) =>
        row({
          id: `r${i}`,
          movie_id: `movie:${i + 1}`,
          title: `Film ${i + 1}`,
          last_watched_at: `2026-10-01T00:${String(59 - i).padStart(2, '0')}:00`,
        }),
      ),
    );
    const { items } = await fetchContinueWatching({ userId: 'u1' });
    expect(items).toHaveLength(6);
    expect(items[0].title).toBe('Film 1');
    expect(items[5].title).toBe('Film 6');
    expect(getMovie).toHaveBeenCalledTimes(6);
  });

  it.each([403, 404, 423])('resolves to an empty rail, and does not throw, on a %i', async (status) => {
    getRecent.mockRejectedValue(refused(status));
    const rail = await fetchContinueWatching({ userId: 'u1' });
    expect(rail.items).toEqual([]);
    expect(rail).toMatchObject({ key: 'continue-watching', shape: 'wide' });
  });

  it('resolves to an empty rail on a network failure too', async () => {
    getRecent.mockRejectedValue(new Error('Network Error'));
    expect((await fetchContinueWatching({ userId: 'u1' })).items).toEqual([]);
  });

  // Home cannot tell a locked profile from a new one by looking at an empty rail, and a
  // restored profile id is trusted without being checked. The fetcher is the only place
  // that sees the status, so it says so.
  describe('reporting a passcode lock', () => {
    it('says locked on a 423, because the profile needs its passcode before it can be used', async () => {
      getRecent.mockRejectedValue(refused(423));
      const rail = await fetchContinueWatching({ userId: 'u1' });
      expect(rail.locked).toBe(true);
      expect(rail.items).toEqual([]);
      expect(rail.loading).toBe(false);
    });

    it.each([403, 404, 500, 502])('does not say locked on a %i', async (status) => {
      getRecent.mockRejectedValue(refused(status));
      expect((await fetchContinueWatching({ userId: 'u1' })).locked).toBe(false);
    });

    it('does not say locked on a network failure, an empty history, or a full rail', async () => {
      getRecent.mockRejectedValue(new Error('Network Error'));
      expect((await fetchContinueWatching({ userId: 'u1' })).locked).toBe(false);
      getRecent.mockResolvedValue([]);
      expect((await fetchContinueWatching({ userId: 'u1' })).locked).toBe(false);
      getRecent.mockResolvedValue([row()]);
      expect((await fetchContinueWatching({ userId: 'u1' })).locked).toBe(false);
    });

    it('does not say locked when there is no profile, and makes no call to find out', async () => {
      expect((await fetchContinueWatching({ userId: '' })).locked).toBe(false);
      expect(getRecent).not.toHaveBeenCalled();
    });

    it('does not take a 423 from an artwork lookup for a lock', async () => {
      getRecent.mockResolvedValue([row()]);
      getMovie.mockRejectedValue(refused(423));
      const rail = await fetchContinueWatching({ userId: 'u1' });
      expect(rail.locked).toBe(false);
      expect(rail.items).toHaveLength(1);
    });
  });

  it('does not call the backend at all when no profile is selected', async () => {
    const rail = await fetchContinueWatching({ userId: '' });
    expect(rail.items).toEqual([]);
    expect(getRecent).not.toHaveBeenCalled();
  });
});

describe('fetchMyList', () => {
  function entry(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
    return {
      id: 'w1',
      user_id: 'u1',
      content_id: 'movie:603',
      tmdb_id: '603',
      media_type: 'movie',
      title: 'The Matrix',
      poster_url: 'https://img.test/poster-603.jpg',
      year: 1999,
      vote_average: 8.2,
      added_at: '2026-10-01T00:00:00',
      created_at: '2026-10-01T00:00:00',
      ...overrides,
    };
  }

  it('is a poster rail named My List', async () => {
    listWatchlist.mockResolvedValue([entry()]);
    const rail = await fetchMyList({ userId: 'u1' });
    expect(listWatchlist).toHaveBeenCalledWith('u1');
    expect(rail).toMatchObject({ key: 'my-list', title: 'My List', shape: 'poster' });
  });

  it('links each entry to its bigscreen detail route by media type', async () => {
    listWatchlist.mockResolvedValue([
      entry({ tmdb_id: '603', media_type: 'movie' }),
      entry({ id: 'w2', tmdb_id: '1399', media_type: 'tv', content_id: 'tv:1399', title: 'Game of Thrones', year: 2011 }),
    ]);
    const { items } = await fetchMyList({ userId: 'u1' });
    expect(items.map((c) => c.href)).toEqual(['/bigscreen/movie/603', '/bigscreen/show/1399']);
    expect(items.map((c) => c.id)).toEqual(['movie:603', 'tv:1399']);
    expect(items[1]).toMatchObject({ title: 'Game of Thrones', subtitle: '2011' });
  });

  it('skips an entry whose tmdb_id is not a number, rather than linking to /NaN', async () => {
    // This is what actually distinguishes converting the string from interpolating it:
    // a template literal happily builds /bigscreen/movie/abc.
    listWatchlist.mockResolvedValue([
      entry({ id: 'w1', tmdb_id: 'abc', title: 'Alpha' }),
      entry({ id: 'w2', tmdb_id: '', title: 'Empty' }),
      entry({ id: 'w3', tmdb_id: '0', title: 'Zero' }),
      entry({ id: 'w4', tmdb_id: '12.5', title: 'Fraction' }),
      entry({ id: 'w5', tmdb_id: '603', title: 'Fine' }),
    ]);
    const { items } = await fetchMyList({ userId: 'u1' });
    expect(items.map((c) => c.title)).toEqual(['Fine']);
    for (const c of items) expect(c.href).not.toMatch(/NaN|undefined/);
  });

  it('costs a null or malformed entry only that entry', async () => {
    listWatchlist.mockResolvedValue([
      null as unknown as WatchlistItem,
      entry({ id: 'w2', tmdb_id: '2', title: 'Two' }),
    ]);
    const { items } = await fetchMyList({ userId: 'u1' });
    expect(items.map((c) => c.title)).toEqual(['Two']);
  });

  it('caps the list at 20, counting only the entries that became cards', async () => {
    listWatchlist.mockResolvedValue([
      entry({ id: 'bad', tmdb_id: 'abc', title: 'Bad' }),
      ...Array.from({ length: 30 }, (_, i) => entry({ id: `w${i}`, tmdb_id: String(i + 1), title: `T${i + 1}` })),
    ]);
    const { items } = await fetchMyList({ userId: 'u1' });
    expect(items).toHaveLength(20);
    expect(items[0].title).toBe('T1');
    expect(items[19].title).toBe('T20');
  });

  it('says loading: false outright, including when it is refused', async () => {
    listWatchlist.mockResolvedValue([entry()]);
    const rail = await fetchMyList({ userId: 'u1' });
    expect(rail.loading).toBe(false);
    const placeholder = { key: 'my-list', title: 'My List', shape: 'poster' as const, items: [], loading: true };
    expect(railCellCount({ ...placeholder, ...rail })).toBe(1);
    listWatchlist.mockRejectedValue(refused(403));
    expect((await fetchMyList({ userId: 'u1' })).loading).toBe(false);
  });

  it('uses the stored poster, because a watchlist row has no backdrop', async () => {
    listWatchlist.mockResolvedValue([entry(), entry({ id: 'w2', tmdb_id: '2', poster_url: null })]);
    const { items } = await fetchMyList({ userId: 'u1' });
    expect(items.map((c) => c.artUrl)).toEqual(['https://img.test/poster-603.jpg', null]);
    expect(getMovie).not.toHaveBeenCalled();
  });

  it('keeps the list in the order the backend sent it (newest first)', async () => {
    listWatchlist.mockResolvedValue([
      entry({ id: 'w1', tmdb_id: '3', title: 'C' }),
      entry({ id: 'w2', tmdb_id: '1', title: 'A' }),
    ]);
    const { items } = await fetchMyList({ userId: 'u1' });
    expect(items.map((c) => c.title)).toEqual(['C', 'A']);
  });

  it.each([403, 404, 423])('resolves to an empty rail, and does not throw, on a %i', async (status) => {
    listWatchlist.mockRejectedValue(refused(status));
    const rail = await fetchMyList({ userId: 'u1' });
    expect(rail.items).toEqual([]);
    expect(rail).toMatchObject({ key: 'my-list', shape: 'poster' });
  });

  it('does not call the backend at all when no profile is selected', async () => {
    expect((await fetchMyList({ userId: '' })).items).toEqual([]);
    expect(listWatchlist).not.toHaveBeenCalled();
  });

  describe('reporting a passcode lock', () => {
    it('says locked on a 423', async () => {
      listWatchlist.mockRejectedValue(refused(423));
      const rail = await fetchMyList({ userId: 'u1' });
      expect(rail.locked).toBe(true);
      expect(rail.items).toEqual([]);
      expect(rail.loading).toBe(false);
    });

    it.each([403, 404, 500])('does not say locked on a %i', async (status) => {
      listWatchlist.mockRejectedValue(refused(status));
      expect((await fetchMyList({ userId: 'u1' })).locked).toBe(false);
    });

    it('does not say locked for an empty list, a full one, or no profile', async () => {
      listWatchlist.mockResolvedValue([]);
      expect((await fetchMyList({ userId: 'u1' })).locked).toBe(false);
      listWatchlist.mockResolvedValue([entry()]);
      expect((await fetchMyList({ userId: 'u1' })).locked).toBe(false);
      expect((await fetchMyList({ userId: '' })).locked).toBe(false);
    });
  });
});
