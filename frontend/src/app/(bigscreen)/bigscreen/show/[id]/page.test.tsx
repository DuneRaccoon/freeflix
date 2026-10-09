import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { SeasonDetail, ShowDetail, StreamingProgress, Episode } from '@/types';
import { tvService } from '@/services/tv';
import { streamingService } from '@/services/streaming';
import { requestTitle, resumeTitle, titleStateFor, type TitleAction } from '../../../_data/title';
import { useTvProfile } from '../../../_data/useTvProfile';
import ShowPage from './page';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ id: '1399' }) }));
vi.mock('../../../_data/title', () => ({ titleStateFor: vi.fn(), requestTitle: vi.fn(), resumeTitle: vi.fn() }));
vi.mock('../../../_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));
vi.mock('@/services/tv', () => ({ tvService: { getShow: vi.fn(), getSeason: vi.fn() } }));
vi.mock('@/services/streaming', () => ({ streamingService: { getRecentProgress: vi.fn() } }));

const getShow = vi.mocked(tvService.getShow);
const getSeason = vi.mocked(tvService.getSeason);
const recent = vi.mocked(streamingService.getRecentProgress);
const stateFor = vi.mocked(titleStateFor);
const request = vi.mocked(requestTitle);
const resume = vi.mocked(resumeTitle);
const profileHook = vi.mocked(useTvProfile);
const clear = vi.fn();

const ep = (n: number, over: Partial<Episode> = {}): Episode => ({
  episode_number: n, name: `Ep ${n}`, overview: null, runtime: 40, still_url: null, air_date: null, vote_average: 0, ...over,
});
const season = (n: number, count: number): SeasonDetail => ({
  season_number: n, name: `Season ${n}`, overview: null, episodes: Array.from({ length: count }, (_, i) => ep(i + 1)),
});
const show = (over: Partial<ShowDetail> = {}): ShowDetail =>
  ({
    tmdb_id: 1399, media_type: 'tv', name: 'Thrones Like', year: 2011, overview: 'Houses fight.',
    poster_url: null, backdrop_url: 'https://image.tmdb.org/t/p/w1280/b.jpg', genres: [], status: null,
    first_air_date: '2011-04-17', last_air_date: null, number_of_seasons: 2, vote_average: 8, vote_count: 1,
    seasons: [
      { season_number: 0, name: 'Specials', episode_count: 2, overview: null, poster_url: null, air_date: null },
      { season_number: 1, name: 'Season 1', episode_count: 3, overview: null, poster_url: null, air_date: null },
      { season_number: 2, name: 'Season 2', episode_count: 2, overview: null, poster_url: null, air_date: null },
    ],
    ...over,
  }) as ShowDetail;
const prog = (movie_id: string, over: Partial<StreamingProgress> = {}): StreamingProgress =>
  ({ id: movie_id, user_id: 'p1', torrent_id: 't', movie_id, current_time: 0, duration: 100, percentage: 0, completed: false, ...over }) as StreamingProgress;
const stateOf = (action: TitleAction, locked = false) => ({ action, locked });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

async function mount() {
  const view = render(<ShowPage />);
  await screen.findByRole('heading', { level: 1, name: 'Thrones Like' });
  // the default control's own lookup must land before a test presses anything
  await waitFor(() => expect(screen.queryByText('Checking this episode…')).toBeNull());
  return view;
}
const epButtons = () => screen.queryAllByRole('button', { name: /^\d+\s/ });
const seasonBtn = (n: number) => screen.getByRole('button', { name: new RegExp(`Season ${n}`) });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  profileHook.mockReturnValue({ profile: { id: 'p1', display_name: 'Ben', avatar: null }, loading: false, select: vi.fn(), clear });
  getShow.mockResolvedValue(show());
  getSeason.mockImplementation(async (_id, n) => season(n, n === 1 ? 3 : 2));
  recent.mockResolvedValue([]);
  stateFor.mockResolvedValue(stateOf({ kind: 'play' }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('show detail screen', () => {
  it('renders the show by `name` (a ShowDetail has no `title`)', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Thrones Like' })).toBeInTheDocument();
    expect(screen.getByText('Houses fight.')).toBeInTheDocument();
  });

  it('draws specials out and offers the other seasons as one row of buttons', async () => {
    await mount();
    expect(screen.queryByRole('button', { name: /Specials/ })).toBeNull();
    expect(seasonBtn(1)).toHaveAttribute('aria-pressed', 'true');
    expect(seasonBtn(2)).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens the first season and shows its episodes, one cell each', async () => {
    await mount();
    await waitFor(() => expect(epButtons()).toHaveLength(3));
    expect(getSeason).toHaveBeenCalledTimes(1);
    expect(getSeason).toHaveBeenCalledWith(1399, 1);
  });

  it('fetches a season once; reopening a cached one does not refetch', async () => {
    await mount();
    await waitFor(() => expect(epButtons()).toHaveLength(3));
    fireEvent.click(seasonBtn(2));
    await waitFor(() => expect(epButtons()).toHaveLength(2));
    expect(getSeason).toHaveBeenCalledTimes(2);
    fireEvent.click(seasonBtn(1));
    await waitFor(() => expect(epButtons()).toHaveLength(3));
    fireEvent.click(seasonBtn(2));
    await waitFor(() => expect(epButtons()).toHaveLength(2));
    expect(getSeason).toHaveBeenCalledTimes(2);
  });

  it('a double press while a season loads does not fetch it twice', async () => {
    await mount();
    await waitFor(() => expect(epButtons()).toHaveLength(3));
    const d = deferred<SeasonDetail>();
    getSeason.mockReturnValueOnce(d.promise);
    fireEvent.click(seasonBtn(2));
    fireEvent.click(seasonBtn(2));
    expect(getSeason).toHaveBeenCalledTimes(2);
    await act(async () => d.resolve(season(2, 2)));
    await screen.findByText(/S2 · E1/);
  });

  it('while a season loads there are no episode cells, and Up/Down still has the other rows', async () => {
    await mount();
    await waitFor(() => expect(epButtons()).toHaveLength(3));
    getSeason.mockReturnValueOnce(deferred<SeasonDetail>().promise);
    fireEvent.click(seasonBtn(2));
    expect(epButtons()).toHaveLength(0);
    expect(screen.getByText(/loading episodes/i)).toBeInTheDocument();
  });

  it('opening a season changes the grid: Down from the picker lands on the first episode, and the last episode is reachable', async () => {
    await mount();
    await waitFor(() => expect(epButtons()).toHaveLength(3));
    fireEvent.click(seasonBtn(2));
    await waitFor(() => expect(epButtons()).toHaveLength(2));
    await screen.findByText(/S2 · E1/);
    act(() => seasonBtn(2).focus());
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(epButtons()[0]);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(epButtons()[1]);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(epButtons()[1]); // end of the list: nothing beyond it
  });

  it('focus is never left on a row that shrank', async () => {
    getSeason.mockImplementation(async (_id, n) => season(n, n === 1 ? 3 : 1));
    await mount();
    await waitFor(() => expect(epButtons()).toHaveLength(3));
    act(() => seasonBtn(1).focus());
    // Walk to the last episode, back up to the picker, across to season 2 and open it: the
    // episode rows shrink from 3 to 1 underneath the picker.
    for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(epButtons()[2]);
    for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(seasonBtn(1));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(seasonBtn(2));
    fireEvent.click(seasonBtn(2));
    await waitFor(() => expect(epButtons()).toHaveLength(1));
    await screen.findByText(/S2 · E1/);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement!.isConnected).toBe(true);
  });

  describe('episode press', () => {
    it('asks titleStateFor for that season and episode', async () => {
      await mount();
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      stateFor.mockClear();
      stateFor.mockResolvedValue(stateOf({ kind: 'open', href: '/bigscreen/watch/pk?file=4' }));
      fireEvent.click(epButtons()[1]);
      await waitFor(() => expect(router.push).toHaveBeenCalled());
      expect(stateFor).toHaveBeenCalledWith({ mediaType: 'tv', tmdbId: 1399, season: 1, episode: 2, userId: 'p1' });
    });

    it('navigates to the resolved href, ?file= included, for open / resume / preparing', async () => {
      await mount();
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      stateFor.mockResolvedValue(stateOf({ kind: 'open', href: '/bigscreen/watch/pk?file=0' }));
      fireEvent.click(epButtons()[0]);
      await waitFor(() => expect(router.push).toHaveBeenLastCalledWith('/bigscreen/watch/pk?file=0'));
      stateFor.mockResolvedValue(stateOf({ kind: 'resume', href: '/bigscreen/watch/pk?file=7', atSeconds: 60 }));
      fireEvent.click(epButtons()[1]);
      await waitFor(() => expect(router.push).toHaveBeenLastCalledWith('/bigscreen/watch/pk?file=7'));
      stateFor.mockResolvedValue(stateOf({ kind: 'preparing', torrentId: 'tp', progress: 3 }));
      fireEvent.click(epButtons()[2]);
      await waitFor(() => expect(router.push).toHaveBeenLastCalledWith('/bigscreen/watch/tp'));
    });

    it('unresolvedEpisode: does NOT navigate; says it may be the wrong episode and waits for a second, deliberate press', async () => {
      await mount();
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      stateFor.mockResolvedValue(stateOf({ kind: 'unresolvedEpisode', href: '/bigscreen/watch/pk' }));
      fireEvent.click(epButtons()[1]);
      await screen.findByRole('note');
      expect(router.push).not.toHaveBeenCalled();
      expect(screen.getByRole('note')).toHaveTextContent(/may be a different episode/i);
      expect(screen.getByText(/S1 · E2/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Play anyway' }));
      expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/pk');
    });

    it('unresolvedEpisode with progress: Resume anyway, still disclosed', async () => {
      await mount();
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      stateFor.mockResolvedValue(stateOf({ kind: 'unresolvedEpisode', href: '/bigscreen/watch/pk', atSeconds: 90 }));
      fireEvent.click(epButtons()[0]);
      await screen.findByRole('button', { name: 'Resume from 1:30 anyway' });
      expect(screen.getByRole('note')).toBeInTheDocument();
    });

    it('play (not on the box): says so, does not navigate, and moves focus to the control', async () => {
      await mount();
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      stateFor.mockResolvedValue(stateOf({ kind: 'play' }));
      fireEvent.click(epButtons()[1]);
      await screen.findByText(/isn.t on the box yet/i);
      expect(router.push).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Play' }));
    });

    it('paused / blocked are shown through the shared control, never navigated', async () => {
      await mount();
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      stateFor.mockResolvedValue(stateOf({ kind: 'blocked', reason: 'Box said no.' }));
      fireEvent.click(epButtons()[0]);
      expect(await screen.findByRole('alert')).toHaveTextContent('Box said no.');
      expect(router.push).not.toHaveBeenCalled();
    });

    it('a second press while one is being asked is ignored', async () => {
      await mount();
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      stateFor.mockClear();
      const d = deferred<ReturnType<typeof stateOf>>();
      stateFor.mockReturnValueOnce(d.promise);
      fireEvent.click(epButtons()[0]);
      fireEvent.click(epButtons()[1]);
      expect(stateFor).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Checking…', { selector: '.bs-ep__mark' })).toBeInTheDocument();
      await act(async () => d.resolve(stateOf({ kind: 'open', href: '/bigscreen/watch/x' })));
    });

    it('a locked answer clears the profile and goes to the picker', async () => {
      await mount();
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      stateFor.mockResolvedValue(stateOf({ kind: 'blocked', reason: 'locked' }, true));
      fireEvent.click(epButtons()[0]);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/bigscreen/profiles'));
      expect(clear).toHaveBeenCalled();
    });

    it('Back pressed while the state is out: no late navigation', async () => {
      const view = await mount();
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      const d = deferred<ReturnType<typeof stateOf>>();
      stateFor.mockReturnValueOnce(d.promise);
      fireEvent.click(epButtons()[0]);
      view.unmount();
      await act(async () => d.resolve(stateOf({ kind: 'open', href: '/bigscreen/watch/late' })));
      expect(router.push).not.toHaveBeenCalled();
    });

    it('Back pressed while the state is out: a locked answer does not clear the profile', async () => {
      const view = await mount();
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      const d = deferred<ReturnType<typeof stateOf>>();
      stateFor.mockReturnValueOnce(d.promise);
      fireEvent.click(epButtons()[0]);
      view.unmount();
      await act(async () => d.resolve(stateOf({ kind: 'blocked', reason: 'x' }, true)));
      expect(clear).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
    });
  });

  describe('the default control (row 0)', () => {
    it('offers the first unwatched episode of the open season', async () => {
      recent.mockResolvedValue([prog('tv:1399:s1:e1', { completed: true })]);
      stateFor.mockResolvedValue(stateOf({ kind: 'open', href: '/bigscreen/watch/pk?file=1' }));
      await mount();
      await screen.findByText(/S1 · E2/);
      expect(stateFor).toHaveBeenCalledWith(expect.objectContaining({ season: 1, episode: 2 }));
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
      expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/pk?file=1');
    });

    it('opens the season of the most recent watch', async () => {
      recent.mockResolvedValue([prog('tv:1399:s2:e1', { percentage: 30 })]);
      await mount();
      await waitFor(() => expect(seasonBtn(2)).toHaveAttribute('aria-pressed', 'true'));
      expect(getSeason).not.toHaveBeenCalledWith(1399, 1);
    });

    it('marks watched and in-progress episodes from history', async () => {
      recent.mockResolvedValue([prog('tv:1399:s1:e2', { percentage: 40 }), prog('tv:1399:s1:e1', { completed: true })]);
      await mount();
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      expect(screen.getByRole('button', { name: /Ep 1.*Watched/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Ep 2.*In progress/ })).toBeInTheDocument();
    });
  });

  describe('the default control is honest while it is still being worked out', () => {
    it('keeps the label "Back to home" (it only goes home) and says the lookup in a status line', async () => {
      const d = deferred<ReturnType<typeof stateOf>>();
      stateFor.mockReturnValue(d.promise);
      render(<ShowPage />);
      const home = await screen.findByRole('button', { name: 'Back to home' });
      await screen.findByText('Checking this episode…');
      expect(screen.queryByRole('button', { name: /checking/i })).toBeNull();
      fireEvent.click(home);
      expect(router.push).toHaveBeenCalledWith('/bigscreen');
      await act(async () => d.resolve(stateOf({ kind: 'play' })));
    });
  });

  describe('a season pack never plays its default file (episode 1) for another episode', () => {
    it('preparing with a fileIndex navigates with ?file=, from an episode press and from the default control', async () => {
      stateFor.mockResolvedValue(stateOf({ kind: 'preparing', torrentId: 'pk', progress: 20, fileIndex: 4 }));
      await mount();
      fireEvent.click(await screen.findByRole('button', { name: 'Preparing… 20%' }));
      expect(router.push).toHaveBeenLastCalledWith('/bigscreen/watch/pk?file=4');
      fireEvent.click(epButtons()[1]);
      await waitFor(() => expect(router.push).toHaveBeenCalledTimes(2));
      expect(router.push).toHaveBeenLastCalledWith('/bigscreen/watch/pk?file=4');
    });

    it('resuming a paused pack goes to the episode file', async () => {
      stateFor.mockResolvedValue(stateOf({ kind: 'paused', torrentId: 'pk', fileIndex: 3 }));
      resume.mockResolvedValue({ ok: true });
      await mount();
      fireEvent.click(await screen.findByRole('button', { name: 'Resume download' }));
      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/pk?file=3'));
    });

    it('resuming a paused pack whose files are unknown re-asks instead of navigating', async () => {
      stateFor.mockResolvedValueOnce(stateOf({ kind: 'paused', torrentId: 'pk', fileUnknown: true }));
      resume.mockResolvedValue({ ok: true });
      await mount();
      stateFor.mockResolvedValue(stateOf({ kind: 'unresolvedEpisode', href: '/bigscreen/watch/pk' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Resume download' }));
      expect(await screen.findByRole('note')).toHaveTextContent(/may be a different episode/i);
      expect(router.push).not.toHaveBeenCalled();
    });

    it('a Play the box satisfies with a located pack file goes to ?file=', async () => {
      request.mockResolvedValue({ ok: true, torrentId: 'pk', fileIndex: 6 });
      await mount();
      fireEvent.click(screen.getByRole('button', { name: 'Play' }));
      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/pk?file=6'));
    });

    it('a Play satisfied by a pack whose files are unreadable re-asks and discloses, never navigates', async () => {
      request.mockResolvedValue({ ok: true, torrentId: 'pk', unresolved: true });
      await mount();
      stateFor.mockResolvedValue(stateOf({ kind: 'unresolvedEpisode', href: '/bigscreen/watch/pk' }));
      fireEvent.click(screen.getByRole('button', { name: 'Play' }));
      expect(await screen.findByRole('note')).toHaveTextContent(/may be a different episode/i);
      expect(router.push).not.toHaveBeenCalled();
    });
  });

  describe('nothing left to watch', () => {
    it('does not claim it while an earlier season still has an unwatched episode', async () => {
      // S2 (the last season) finished; S1 was never watched. Landing on S2 requires history there.
      recent.mockResolvedValue([prog('tv:1399:s2:e2', { completed: true }), prog('tv:1399:s2:e1', { completed: true })]);
      await mount();
      await screen.findByText(/finished season 2\. pick another season/i); // season 1 unseen: hedged
      fireEvent.click(seasonBtn(1)); // now season 1 is seen, and nothing in it is watched
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      fireEvent.click(seasonBtn(2));
      await screen.findByText(/finished season 2\. pick another season/i);
      expect(screen.queryByText(/nothing left to watch/i)).toBeNull();
    });

    const watchedAll = (s: number, n: number) =>
      Array.from({ length: n }, (_, i) => prog(`tv:1399:s${s}:e${n - i}`, { completed: true }));

    it('the last episode of the last season finished, every season seen: reads as finished, no Play', async () => {
      recent.mockResolvedValue([...watchedAll(2, 2), ...watchedAll(1, 3)]);
      await mount();
      await screen.findByText(/finished season 2/i); // season 1 not fetched yet: hedged, not absolute
      expect(screen.queryByText(/nothing left to watch/i)).toBeNull();
      fireEvent.click(seasonBtn(1));
      await screen.findByText(/finished season 1/i);
      fireEvent.click(seasonBtn(2));
      await screen.findByText(/nothing left to watch/i);
      expect(screen.queryByRole('button', { name: /^(Play|Open|Resume)/ })).toBeNull();
      expect(stateFor).not.toHaveBeenCalled();
      // and it keeps a focus target in row 0
      expect(screen.getByRole('button', { name: /home/i })).toHaveAttribute('tabindex', '0');
    });

    it('a finished season with a later one moves on to the next season', async () => {
      recent.mockResolvedValue(watchedAll(1, 3));
      await mount();
      await waitFor(() => expect(seasonBtn(2)).toHaveAttribute('aria-pressed', 'true'));
      await screen.findByText(/S2 · E1/);
    });

    it('a finished season the viewer opens by hand says so, and points at the other seasons', async () => {
      recent.mockResolvedValue(watchedAll(1, 3));
      getSeason.mockImplementation(async (_id, n) => season(n, n === 1 ? 3 : 2));
      await mount();
      await waitFor(() => expect(seasonBtn(2)).toHaveAttribute('aria-pressed', 'true'));
      fireEvent.click(seasonBtn(1));
      await screen.findByText(/finished season 1/i);
      expect(screen.queryByText(/nothing left to watch/i)).toBeNull();
    });
  });

  describe('empty states keep a focus target', () => {
    it('a show with no seasons', async () => {
      getShow.mockResolvedValue(show({ seasons: [] }));
      await mount();
      expect(screen.getByText(/no seasons/i)).toBeInTheDocument();
      expect(getSeason).not.toHaveBeenCalled();
      const home = screen.getByRole('button', { name: /home/i });
      expect(home).toHaveAttribute('tabindex', '0');
      expect(document.activeElement).toBe(home);
    });

    it('a show with only specials is the same', async () => {
      getShow.mockResolvedValue(show({ seasons: [show().seasons[0]] }));
      await mount();
      expect(screen.getByText(/no seasons/i)).toBeInTheDocument();
    });

    it('a season with no episodes', async () => {
      getSeason.mockResolvedValue(season(1, 0));
      await mount();
      await screen.findByText(/no episodes listed/i);
      const other = screen.getByRole('button', { name: /pick another season/i });
      fireEvent.click(other);
      expect(document.activeElement).toBe(seasonBtn(1));
    });

    it('a season whose episodes array is missing reads as empty instead of crashing the screen', async () => {
      getSeason.mockResolvedValue({ season_number: 1, name: 'Season 1', overview: null } as unknown as SeasonDetail);
      await mount();
      await screen.findByText(/no episodes listed/i);
    });

    it('a season that fails to load can be retried', async () => {
      getSeason.mockRejectedValueOnce(new Error('boom'));
      await mount();
      await screen.findByText(/couldn.t load this season/i);
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      await waitFor(() => expect(epButtons()).toHaveLength(3));
      expect(getSeason).toHaveBeenCalledTimes(2);
    });
  });

  describe('locked profile', () => {
    it('while the picker loads it says why, offers the two ways out, and never grows a Try again', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      stateFor.mockResolvedValue(stateOf({ kind: 'blocked', reason: 'locked' }, true));
      render(<ShowPage />);
      await waitFor(() => expect(router.replace).toHaveBeenCalled());
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This profile is locked');
      expect(screen.getByRole('status')).toHaveTextContent(/enter its passcode/i);
      expect(screen.queryByText(/loading/i)).toBeNull();
      expect(screen.getByRole('link', { name: 'Who’s watching?' })).toHaveAttribute('href', '/bigscreen/profiles');
      expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/bigscreen');
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  it('Back goes home', async () => {
    await mount();
    fireEvent.keyDown(window, { key: 'Backspace', keyCode: 8 });
    expect(router.push).toHaveBeenCalledWith('/bigscreen');
  });

  it('a failed show load offers a retry and a way back', async () => {
    getShow.mockRejectedValueOnce(new Error('down'));
    render(<ShowPage />);
    await screen.findByText(/couldn.t load this show/i);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { level: 1, name: 'Thrones Like' });
  });

  it('works with no profile selected (no history, no progress call)', async () => {
    profileHook.mockReturnValue({ profile: null, loading: false, select: vi.fn(), clear });
    await mount();
    expect(recent).not.toHaveBeenCalled();
    expect(stateFor).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });

  it('a recheck on a blocked default control re-asks the state', async () => {
    stateFor.mockResolvedValue(stateOf({ kind: 'blocked', reason: 'Box said no.' }));
    await mount();
    await screen.findByRole('button', { name: 'Check again' });
    stateFor.mockResolvedValue(stateOf({ kind: 'open', href: '/bigscreen/watch/ok' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByRole('button', { name: 'Open' });
  });
});
