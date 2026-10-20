/**
 * /bigscreen/watch/[id] — the next episode: the cell, the prefetch, the prompt, the press.
 *
 * WHY THIS FILE EXISTS AT ALL, and it is the one lesson this branch inherited. Stage 9 built
 * `pollSubtitles` and `streamingService.fetchSubtitle`, tested both, reviewed both sixteen
 * times adversarially, and shipped them with NO PRODUCTION CALLER — because every review was
 * scoped to a diff and the defect was the absence of one. `_data/nextEpisode.test.ts` proves
 * the rules; `noDeadExports.test.ts` proves something calls them; only this file proves that
 * what calls them does so AT THE RIGHT MOMENT, WITH THE RIGHT ARGUMENTS, ONCE.
 *
 * THE FOUR WIRES, each of which is a seam no unit suite can see:
 *  1. the cell exists for an episode and not for a film (the route's `episodeRefOf`);
 *  2. the box is asked to start the next episode at 80% — and only then, only once, and only
 *     when the profile's setting says so;
 *  3. the prompt appears near the end and holds the band up, which is what makes the cell
 *     reachable at the moment it is for;
 *  4. a press flushes the position and replaces the URL, rather than pushing a second one.
 *
 * HARNESS NOTES, inherited from this directory's other files because they cost something to
 * learn: a press is fired at `document.activeElement` (the house `arrow()` helper dispatches
 * at `window`, above the React root, where no React `onKeyDown` sees it); one `act()` per
 * timer slice, because React commits queued updates only when `act()` exits; and jsdom
 * implements no media, so `duration` and `currentTime` have to be defined on the element.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { SeasonDetail, ShowDetail, StreamingInfo, TorrentStatus, VideoFile } from '@/types';
import { streamingService } from '@/services/streaming';
import { torrentsService } from '@/services/torrents';
import { tvService } from '@/services/tv';
import { usersService } from '@/services/users';
import { useTvProfile } from '../../../_data/useTvProfile';
import { AUTO_NEXT_AT, END_PROMPT_S } from '../../../_data/nextEpisode';
import { transportCellCount } from '../../../_player/TransportBar';
import WatchPage from './page';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  params: { current: { id: 'pk' } as Record<string, string> },
  search: { current: new URLSearchParams() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  useParams: () => nav.params.current,
  usePathname: () => '/bigscreen/watch/pk',
  useSearchParams: () => nav.search.current,
}));

vi.mock('@/services/streaming', () => ({
  streamingService: {
    getStreamingInfo: vi.fn(),
    getFiles: vi.fn(),
    getProgressByMovie: vi.fn(),
    getProgressByTorrent: vi.fn(),
    saveProgress: vi.fn(),
    updateProgress: vi.fn(),
    getSubtitles: vi.fn(),
  },
}));
vi.mock('@/services/torrents', () => ({
  torrentsService: {
    getTorrentStatus: vi.fn(),
    listTorrents: vi.fn(),
    downloadCatalogMovie: vi.fn(),
    performTorrentAction: vi.fn(),
  },
}));
vi.mock('@/services/tv', () => ({ tvService: { getShow: vi.fn(), getSeason: vi.fn() } }));
vi.mock('@/services/users', () => ({
  usersService: { getUserSettings: vi.fn(), updateUserSettings: vi.fn() },
}));
vi.mock('../../../_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));

/**
 * `_data/title` and `_data/nextEpisode` are REAL here on purpose. The whole claim of this
 * file is that the route reaches the box through them at the right moment — a mock of either
 * would be a second copy of the rule under test, and a mock of `title` in particular would
 * hide the thing most worth proving: that a season pack ALREADY COVERING the next episode
 * leads to no download at all.
 */
const svc = vi.mocked(streamingService);
const torrents = vi.mocked(torrentsService);
const tv = vi.mocked(tvService);
const users = vi.mocked(usersService);
const profileHook = vi.mocked(useTvProfile);

// --- fixtures ----------------------------------------------------------------------

const PACK = 'pk';
const DURATION = 2400;

const statusRow = (over: Record<string, unknown> = {}): TorrentStatus =>
  ({
    id: PACK,
    movie_title: 'Show 1399 S02',
    quality: '1080p',
    state: 'downloading',
    progress: 42,
    num_peers: 4,
    download_rate: 1_500_000,
    tmdb_id: 1399,
    media_type: 'tv',
    season: 2,
    episode: null,
    ...over,
  }) as TorrentStatus;

const file = (index: number, episode: number): VideoFile => ({
  index,
  name: `show.s02e0${episode}.mkv`,
  size: 2_000_000_000,
  downloaded: 1_000_000_000,
  progress: 50,
  mime_type: 'video/x-matroska',
  stream_url: `/api/v1/streaming/${PACK}/video?file_index=${index}`,
  season: 2,
  episode,
});

/**
 * `/files` as the backend sends it: season/episode sorted. A bare arrival (no `?file=`) takes
 * the FIRST entry, which is the lowest episode — so the episode on screen is EPISODE 1 and
 * the one after it is episode 2, whose file index in this pack is 0.
 */
const FILES = [file(4, 1), file(0, 2), file(7, 3)];

const infoRow = (): StreamingInfo =>
  ({
    torrent_id: PACK,
    video_file: {
      index: 0,
      name: 'show.s02e02.mkv',
      size: 2_000_000_000,
      downloaded: 1_000_000_000,
      progress: 50,
      mime_type: 'video/x-matroska',
      contiguous: { run_start: 0, run_end: 2_000_000_000, file_size: 2_000_000_000 },
    },
  }) as unknown as StreamingInfo;

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

const show = (): ShowDetail =>
  ({
    tmdb_id: 1399,
    media_type: 'tv',
    name: 'Show',
    year: 2011,
    overview: null,
    poster_url: null,
    backdrop_url: null,
    genres: [],
    status: null,
    first_air_date: null,
    last_air_date: null,
    number_of_seasons: 1,
    vote_average: 0,
    vote_count: 0,
    seasons: [
      { season_number: 2, name: 'Season 2', episode_count: 3, overview: null, poster_url: null, air_date: null },
    ],
  }) as ShowDetail;

const settingsRow = (autoNext: boolean) =>
  ({
    id: 's1',
    user_id: 'p1',
    maturity_restriction: 'none',
    require_passcode: false,
    has_passcode: false,
    passcode_len: null,
    theme: 'dark',
    default_quality: '1080p',
    auto_next_episode: autoNext,
  }) as unknown as Awaited<ReturnType<typeof usersService.getUserSettings>>;

beforeAll(() => {
  window.HTMLMediaElement.prototype.load = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  sessionStorage.clear();
  localStorage.clear();
  nav.params.current = { id: PACK };
  nav.search.current = new URLSearchParams();
  Element.prototype.scrollIntoView = vi.fn();
  profileHook.mockReturnValue({
    profile: { id: 'p1', display_name: 'Ben', avatar: null },
    loading: false,
    select: vi.fn(),
    clear: vi.fn(),
  });
  torrents.getTorrentStatus.mockResolvedValue(statusRow());
  // Nothing else on the box, so `titleStateFor` answers `play` for the next episode and the
  // prefetch is actually allowed to start one. The pack case is its own row below.
  torrents.listTorrents.mockResolvedValue([]);
  // `episode: 2` on the answer is what makes this a SINGLE-episode torrent: `requestTitle`
  // only looks a file up inside what the box returns when the row names no episode of its
  // own, which is the season-pack case and has its own row below.
  torrents.downloadCatalogMovie.mockResolvedValue({ id: 'next-torrent', episode: 2 } as unknown as TorrentStatus);
  svc.getFiles.mockResolvedValue(FILES);
  svc.getStreamingInfo.mockResolvedValue(infoRow());
  svc.getProgressByMovie.mockResolvedValue(null);
  svc.saveProgress.mockResolvedValue(null as never);
  svc.getSubtitles.mockResolvedValue({ coverage: 'none', subtitles: [] } as never);
  tv.getSeason.mockResolvedValue(season([1, 2, 3]));
  tv.getShow.mockResolvedValue(show());
  users.getUserSettings.mockResolvedValue(settingsRow(true));
});

afterEach(async () => {
  await act(async () => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
});

// --- harness -----------------------------------------------------------------------

const video = () => document.querySelector('video');
const nextCell = () => screen.queryByRole('button', { name: 'Next episode' });
const transportRow = () => document.querySelectorAll('.bs-player__row')[1] ?? document.querySelector('.bs-player__row');
const transportButtons = () => [...(transportRow()?.querySelectorAll('button') ?? [])];
const hint = () => [...document.querySelectorAll('.bs-player__hint')].map((p) => p.textContent).join(' | ');
const noteOf = (el: Element | null) => el?.querySelector('.bs-player__commit')?.textContent ?? null;

/**
 * Give the element the two properties jsdom leaves unusable, and RECORD what the route writes
 * to the playhead.
 *
 * `seek()` moves `t` behind the setter's back on purpose: it stands in for playback, so the
 * only thing in `writes` is a seek the ROUTE asked for. That is the whole instrument for the
 * episode-change row below — asserting `currentTime === 0` afterwards would be vacuous,
 * because a freshly wired element starts there anyway.
 */
function wire(el: HTMLVideoElement, duration: number) {
  let t = 0;
  const writes: number[] = [];
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get: () => t,
    set: (v: number) => {
      writes.push(v);
      t = v;
    },
  });
  Object.defineProperty(el, 'duration', { configurable: true, get: () => duration });
  return { seek: (v: number) => { t = v; }, writes };
}

/**
 * Mount, settle the arrival chain, announce metadata, and let the next-episode lookup land.
 *
 * SIX FLUSHES, not four: the arrival is a chain (the torrent row and `/files`, then the
 * resume read keyed on the identity they produce, then `/info`), and the lookup is keyed on
 * that identity too, so its own two reads come after all of it.
 */
async function playing({ duration = DURATION }: { duration?: number } = {}) {
  const view = render(<WatchPage />);
  for (let i = 0; i < 6; i++) await act(async () => {});
  expect(video(), 'the player mounted').not.toBeNull();
  const handle = wire(video()!, duration);
  await act(async () => {
    fireEvent.loadedMetadata(video()!);
  });
  for (let i = 0; i < 3; i++) await act(async () => {});
  return { ...handle, view };
}

/** Move the playhead and let the route see it, which is what `timeupdate` is for. */
async function playTo(handle: { seek: (v: number) => void }, seconds: number) {
  handle.seek(seconds);
  await act(async () => {
    fireEvent.timeUpdate(video()!);
  });
  for (let i = 0; i < 3; i++) await act(async () => {});
}

const PAST_80 = Math.ceil(DURATION * AUTO_NEXT_AT) + 1;
const NEAR_END = DURATION - END_PROMPT_S + 1;

// =====================================================================================

describe('the Next-episode cell', () => {
  it('is in the row for an episode, and says which episode is next', async () => {
    await playing();
    expect.soft(nextCell(), 'the cell is there').not.toBeNull();
    expect.soft(noteOf(nextCell()), 'and it names the next one').toBe('S02 · E02');
    expect.soft(nextCell()?.getAttribute('data-next')).toBe('ready');
    expect.soft(transportButtons()).toHaveLength(transportCellCount({ retry: false, next: true }));
  });

  it('is absent for a film, and the row is one cell shorter', async () => {
    // `episodeRefOf` is the whole test, and a film is the case where a cell would be a focus
    // stop with nothing behind it.
    torrents.getTorrentStatus.mockResolvedValue(
      statusRow({ media_type: 'movie', season: null, episode: null, movie_title: 'A Film' }),
    );
    svc.getFiles.mockResolvedValue([{ ...file(0, 1), season: null, episode: null }]);
    await playing();
    expect.soft(nextCell()).toBeNull();
    expect.soft(transportButtons()).toHaveLength(transportCellCount({ retry: false }));
    // ...and nothing was asked of the catalog on a film's behalf.
    expect.soft(tv.getSeason).not.toHaveBeenCalled();
  });

  it('says it is looking before the catalog answers, and never nothing', async () => {
    let settle: (v: SeasonDetail) => void = () => {};
    tv.getSeason.mockReturnValue(
      new Promise<SeasonDetail>((resolve) => {
        settle = resolve;
      }),
    );
    render(<WatchPage />);
    for (let i = 0; i < 6; i++) await act(async () => {});
    expect.soft(nextCell()?.getAttribute('data-next')).toBe('checking');
    expect.soft(noteOf(nextCell())).toMatch(/looking/i);
    await act(async () => {
      settle(season([1, 2, 3]));
    });
    expect.soft(nextCell()?.getAttribute('data-next')).toBe('ready');
  });

  it('says so when the catalog lists nothing after this episode', async () => {
    tv.getSeason.mockResolvedValue(season([1]));
    await playing();
    expect.soft(nextCell()?.getAttribute('data-next')).toBe('none');
    // The cell is still a focus stop, because a cell dressed as disabled is a control that
    // refuses to act and the row's declared count would still be counting it.
    expect.soft(nextCell()?.getAttribute('tabindex')).not.toBeNull();
  });
});

describe('the prefetch at 80%', () => {
  /** Did the box get asked to start a download, and for what? */
  const asked = () => torrents.downloadCatalogMovie.mock.calls.map(([body]) => body);

  it('starts the next episode downloading past the 80% point, and not before', async () => {
    const handle = await playing();
    await playTo(handle, Math.floor(DURATION * AUTO_NEXT_AT) - 60);
    expect.soft(asked(), 'nothing before the point').toEqual([]);
    await playTo(handle, PAST_80);
    expect.soft(asked()).toHaveLength(1);
    expect.soft(asked()[0]).toMatchObject({
      tmdb_id: 1399,
      media_type: 'tv',
      season: 2,
      episode: 2,
      quality: '1080p',
      client: 'lg-webos22-floor',
    });
  });

  it('asks ONCE, however many times the playhead moves', async () => {
    // The effect that watches this re-runs about once a second, because the playhead is one
    // of its dependencies. The latch is what makes it one request, not the dependency list.
    const handle = await playing();
    for (const at of [PAST_80, PAST_80 + 1, PAST_80 + 2, DURATION - 1]) await playTo(handle, at);
    expect(asked()).toHaveLength(1);
  });

  it('starts NOTHING when the profile has the setting off', async () => {
    users.getUserSettings.mockResolvedValue(settingsRow(false));
    const handle = await playing();
    await playTo(handle, PAST_80);
    expect(asked()).toEqual([]);
  });

  it('starts NOTHING when the setting could not be read', async () => {
    // An unreadable settings call leaves the toggle showing the default, because a control
    // has to render something — but a multi-gigabyte download on a Raspberry Pi is not a
    // thing to do on a default. `useAutoNext` reports the two separately for this.
    users.getUserSettings.mockRejectedValue(new Error('offline'));
    const handle = await playing();
    await playTo(handle, PAST_80);
    expect(asked()).toEqual([]);
  });

  it('starts NOTHING when the catalog could not say what is next', async () => {
    // `unknown` is a refusal, not a fact: a failed lookup must never justify a download for
    // an episode nobody has established exists.
    tv.getSeason.mockRejectedValue(new Error('offline'));
    const handle = await playing();
    await playTo(handle, PAST_80);
    expect.soft(asked()).toEqual([]);
    expect.soft(nextCell()?.getAttribute('data-next')).toBe('unknown');
  });

  it('starts NOTHING when the season pack on screen already covers the next episode', async () => {
    // THE COMMON CASE, and the one that must not download. `covers()` matches a pack
    // (`season: 2, episode: null`) for any episode of that season, so `titleStateFor` answers
    // `open` and there is nothing to fetch. `POST /download` mints a fresh uuid with no
    // dedupe, so getting this wrong is a second copy of a season already on the box.
    torrents.listTorrents.mockResolvedValue([statusRow({ state: 'seeding' })]);
    const handle = await playing();
    await playTo(handle, PAST_80);
    expect(asked()).toEqual([]);
  });

  it('uses TMDB’s runtime when the element never reports a duration', async () => {
    // Which on this television is the ordinary case for an in-progress stream: the scrub row
    // is absent for the whole film because `video.duration` is never finite. Without the
    // third scale the prefetch would simply never fire.
    const handle = await playing({ duration: Number.NaN });
    // The season fixture says 40 minutes, so 80% is 1920s.
    await playTo(handle, 40 * 60 * AUTO_NEXT_AT - 60);
    expect.soft(asked(), 'not yet, by TMDB’s clock').toEqual([]);
    await playTo(handle, Math.ceil(40 * 60 * AUTO_NEXT_AT) + 1);
    expect.soft(asked()).toHaveLength(1);
  });

  it('starts nothing when NOTHING can say how long the episode is', async () => {
    tv.getSeason.mockResolvedValue(season([1, 2, 3], null));
    const handle = await playing({ duration: Number.NaN });
    await playTo(handle, 10_000);
    expect(asked()).toEqual([]);
  });
});

describe('the end-of-episode prompt', () => {
  it('appears in the last stretch of the episode and names what is next', async () => {
    const handle = await playing();
    await playTo(handle, DURATION / 2);
    expect.soft(hint(), 'nothing mid-episode').not.toMatch(/Next up/);
    await playTo(handle, NEAR_END);
    expect.soft(hint()).toMatch(/Next up: S02 · E02 · Episode 2/);
    expect.soft(hint()).toMatch(/Press Next episode/);
  });

  it('appears the moment the episode ends, whatever the clock says', async () => {
    const handle = await playing({ duration: Number.NaN });
    tv.getSeason.mockResolvedValue(season([1, 2, 3], null));
    await act(async () => {
      fireEvent.ended(video()!);
    });
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(hint()).toMatch(/Next up/);
  });

  it('holds the band up, which is the whole point of it', async () => {
    // `mayHide` is `playing && !editOpen && !pickerOpen && message === ''`, so the prompt
    // being a MESSAGE is what keeps the Next-episode cell on screen at the moment it is for.
    // Without it the band fades during the credits and the cell is at opacity 0 with the ring
    // still in it.
    const handle = await playing();
    await playTo(handle, NEAR_END);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(document.querySelector('.bs-player__bar')?.className).not.toMatch(/--hidden/);
  });

  it('says nothing when the catalog could not say what is next', async () => {
    tv.getSeason.mockRejectedValue(new Error('offline'));
    const handle = await playing();
    await playTo(handle, NEAR_END);
    expect(hint()).not.toMatch(/Next up/);
  });

  it('warns when the background start was refused, so the press is not a surprise', async () => {
    torrents.downloadCatalogMovie.mockRejectedValue({ response: { status: 409, data: { detail: 'too many' } } });
    const handle = await playing();
    await playTo(handle, PAST_80);
    await playTo(handle, NEAR_END);
    expect(hint()).toMatch(/couldn’t start it/i);
  });
});

describe('the Next-episode press', () => {
  it('flushes the position and REPLACES the URL, never pushes it', async () => {
    // Replace, not push: a pushed watch URL leaves a dead history entry pointing at a torrent
    // that may be gone by the time the viewer walks back to it. And the flush has to happen
    // first, or the episode they just finished loses its last 30 seconds of progress.
    const handle = await playing();
    await playTo(handle, PAST_80);
    svc.saveProgress.mockClear();
    await act(async () => {
      fireEvent.click(nextCell()!);
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect.soft(svc.saveProgress, 'the position was written').toHaveBeenCalled();
    expect.soft(nav.replace).toHaveBeenCalledWith('/bigscreen/watch/next-torrent');
    expect.soft(nav.push, 'never pushed').not.toHaveBeenCalled();
  });

  it('goes to the episode the pack already holds, with its file index', async () => {
    torrents.listTorrents.mockResolvedValue([statusRow({ state: 'seeding' })]);
    const handle = await playing();
    await act(async () => {
      fireEvent.click(nextCell()!);
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    // File 0 is episode 2 in `/files`, so this is the pack opened at the right episode —
    // never bare, which would play the pack's default file (its lowest episode, the one just
    // finished).
    expect(nav.replace).toHaveBeenCalledWith(`/bigscreen/watch/${PACK}?file=0`);
  });

  it('says `starting…` while the press is out, because a provider search is slow', async () => {
    let settle: (v: TorrentStatus) => void = () => {};
    torrents.downloadCatalogMovie.mockReturnValue(
      new Promise<TorrentStatus>((resolve) => {
        settle = resolve;
      }),
    );
    const handle = await playing();
    await act(async () => {
      fireEvent.click(nextCell()!);
    });
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect.soft(nextCell()?.getAttribute('data-next')).toBe('starting');
    expect.soft(noteOf(nextCell())).toMatch(/starting/i);
    await act(async () => {
      settle({ id: 'next-torrent', episode: 2 } as unknown as TorrentStatus);
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect.soft(nav.replace).toHaveBeenCalledWith('/bigscreen/watch/next-torrent');
  });

  it('says why when the box refuses, and stays in the film', async () => {
    // A press is never silently refused on this surface, and a refusal is not a reason to
    // throw the viewer out of what they are watching.
    torrents.downloadCatalogMovie.mockRejectedValue({
      response: { status: 409, data: { detail: 'too many downloads' } },
    });
    const handle = await playing();
    await act(async () => {
      fireEvent.click(nextCell()!);
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect.soft(hint()).toMatch(/busy with other downloads/i);
    expect.soft(nav.replace, 'still in the film').not.toHaveBeenCalled();
    expect.soft(video(), 'and the player is still up').not.toBeNull();
    // The sentence goes away by itself, or it would pin the band over the picture for the
    // rest of the film.
    await act(async () => {
      vi.advanceTimersByTime(9000);
    });
    expect.soft(hint()).not.toMatch(/busy with other downloads/i);
  });

  it('refuses to guess which file an unreadable pack holds', async () => {
    // There is nowhere on a transport cell to print "this may be a different episode", so a
    // press that cannot be resolved says so instead of playing the pack's default file.
    torrents.listTorrents.mockResolvedValue([statusRow({ state: 'seeding' })]);
    svc.getFiles.mockResolvedValueOnce(FILES).mockResolvedValue([]);
    const handle = await playing();
    await act(async () => {
      fireEvent.click(nextCell()!);
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect.soft(nav.replace).not.toHaveBeenCalled();
    expect.soft(hint()).toMatch(/which file/i);
  });


  it('starts the next episode of a PACK at the beginning, not at the last one’s playhead', async () => {
    // THE DEFECT THIS ROW IS BUILT FROM, found by reading rather than by failing. A press
    // inside a season pack navigates to the SAME torrent with a different `?file=`, so the
    // torrent id does not change and the arrival does not re-run — which is DELIBERATE and
    // predates this work (a pack's episodes share one torrent; the sidecar read, the seek
    // boundary and the progress read are each keyed on the file instead, and the player is
    // not torn down between episodes). What that left uncovered was the playhead: it carried
    // over, so the new episode's `loadedmetadata` seeked to `Math.max(resume, position)` —
    // half an hour into the episode the viewer had just started, silently.
    torrents.listTorrents.mockResolvedValue([statusRow({ state: 'seeding' })]);
    const { seek, view } = await playing();
    await playTo({ seek }, 1800);
    await act(async () => {
      fireEvent.click(nextCell()!);
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect.soft(nav.replace).toHaveBeenCalledWith(`/bigscreen/watch/${PACK}?file=0`);

    // The router is a mock, so the query string is moved by hand — which is what
    // `useSearchParams` reads and therefore what the route sees.
    nav.search.current = new URLSearchParams('file=0');
    await act(async () => {
      view.rerender(<WatchPage />);
    });
    for (let i = 0; i < 6; i++) await act(async () => {});

    // THE ARRIVAL DID NOT RE-RUN, which is the point: the fix is a reset keyed on the file,
    // not a teardown. `getTorrentStatus` is the quiet witness for that — on this fixture only
    // the arrival calls it, because there is no progress row naming a torrent for
    // `titleStateFor` to look up directly. (`getFiles` is noisier: the press's own pack
    // lookup reads it too.)
    expect
      .soft(torrents.getTorrentStatus, 'the player was NOT torn down to do this')
      .toHaveBeenCalledTimes(1);
    expect.soft(video(), 'and it is still playing').not.toBeNull();

    // The SAME element, re-wired: the player was not remounted, so this is the element that
    // was playing the previous episode and is now playing this one.
    const fresh = video()!;
    const after = wire(fresh, DURATION);
    await act(async () => {
      fireEvent.loadedMetadata(fresh);
    });
    for (let i = 0; i < 3; i++) await act(async () => {});
    // NOTHING was written to the playhead: there is no progress row for the new episode, so
    // the only thing that could have moved it is the previous episode's position.
    expect(after.writes, 'the new episode was not seeked to the old one’s playhead').toEqual([]);
  });

  it('does nothing at all when there is no next episode to go to', async () => {
    tv.getSeason.mockResolvedValue(season([1]));
    const handle = await playing();
    await act(async () => {
      fireEvent.click(nextCell()!);
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect.soft(nav.replace).not.toHaveBeenCalled();
    expect.soft(torrents.downloadCatalogMovie).not.toHaveBeenCalled();
    // ...and the cell still says why, which it has been saying since the lookup answered.
    expect.soft(noteOf(nextCell())).toMatch(/nothing after/i);
  });
});
