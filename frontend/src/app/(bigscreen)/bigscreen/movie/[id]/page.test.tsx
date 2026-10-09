import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { MovieDetail } from '@/types';
import { moviesService } from '@/services/movies';
import { watchlistService } from '@/services/watchlist';
import { requestTitle, resumeTitle, titleStateFor, type TitleAction } from '../../../_data/title';
import { useTvProfile } from '../../../_data/useTvProfile';
import MoviePage from './page';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ id: '603' }) }));
vi.mock('../../../_data/title', () => ({ titleStateFor: vi.fn(), requestTitle: vi.fn(), resumeTitle: vi.fn() }));
vi.mock('../../../_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));
vi.mock('@/services/movies', () => ({ moviesService: { getDetail: vi.fn() } }));
vi.mock('@/services/watchlist', () => ({
  watchlistService: { add: vi.fn(), remove: vi.fn(), list: vi.fn() },
}));

const getDetail = vi.mocked(moviesService.getDetail);
const stateFor = vi.mocked(titleStateFor);
const request = vi.mocked(requestTitle);
const resume = vi.mocked(resumeTitle);
const wl = vi.mocked(watchlistService);
const profileHook = vi.mocked(useTvProfile);
const clear = vi.fn();

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const detail = (over: Partial<MovieDetail> = {}): MovieDetail =>
  ({
    tmdb_id: 603,
    media_type: 'movie',
    title: 'The Matrix',
    year: 1999,
    overview: 'A hacker learns.',
    poster_url: 'https://image.tmdb.org/t/p/w500/p.jpg',
    backdrop_url: 'https://image.tmdb.org/t/p/w1280/b.jpg',
    genre_ids: [],
    genres: [],
    vote_average: 8,
    vote_count: 1,
    popularity: 1,
    original_language: 'en',
    runtime: 136,
    imdb_id: null,
    tagline: null,
    cast: [],
    director: null,
    available_qualities: [],
    ...over,
  }) as MovieDetail;

const stateOf = (action: TitleAction, locked = false) => ({ action, locked });
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

async function mount(action: TitleAction = { kind: 'play' }) {
  stateFor.mockResolvedValue(stateOf(action));
  const view = render(<MoviePage />);
  await screen.findByRole('heading', { level: 1, name: 'The Matrix' });
  return view;
}

const primary = () => screen.getByRole('button', { name: /play|starting|resume download|resuming|check/i });
const listBtn = () => screen.getByRole('button', { name: /my list|saving|removing/i });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  profileHook.mockReturnValue({
    profile: { id: 'p1', display_name: 'Ben', avatar: null },
    loading: false,
    select: vi.fn(),
    clear,
  });
  getDetail.mockResolvedValue(detail());
  wl.list.mockResolvedValue([]);
  wl.add.mockResolvedValue({} as never);
  wl.remove.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('movie detail screen', () => {
  it('asks for the cheap detail form (no server-side torrent searches)', async () => {
    await mount();
    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(getDetail).toHaveBeenCalledWith(603, { withQualities: false });
  });

  it('shows the title facts and a w1920 backdrop', async () => {
    const { container } = await mount();
    expect(screen.getByText('1999 · 2h 16m')).toBeInTheDocument();
    expect(screen.getByText('A hacker learns.')).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>('.bs-title__art')!.style.backgroundImage).toContain('/w1920/b.jpg');
  });

  it('asks titleStateFor about this movie and this profile', async () => {
    await mount();
    expect(stateFor).toHaveBeenCalledWith({ mediaType: 'movie', tmdbId: 603, userId: 'p1' });
  });

  describe('one control per TitleAction kind', () => {
    it('play -> Play button', async () => {
      await mount({ kind: 'play' });
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    });
    it('resume -> button with the timestamp, which goes to the watch screen', async () => {
      await mount({ kind: 'resume', href: '/bigscreen/watch/t1', atSeconds: 3725 });
      fireEvent.click(screen.getByRole('button', { name: 'Resume from 1:02:05' }));
      expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/t1');
    });
    it('open -> Open link', async () => {
      await mount({ kind: 'open', href: '/bigscreen/watch/t2' });
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
      expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/t2');
    });
    it('preparing -> a button to the watch screen, labelled with progress', async () => {
      await mount({ kind: 'preparing', torrentId: 't3', progress: 41.6 });
      fireEvent.click(screen.getByRole('button', { name: 'Preparing… 42%' }));
      expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/t3');
    });
    it('paused -> Resume download button', async () => {
      await mount({ kind: 'paused', torrentId: 't4' });
      expect(screen.getByRole('button', { name: 'Resume download' })).toBeInTheDocument();
    });
    it('unresolvedEpisode -> says it may be the wrong episode, in words', async () => {
      await mount({ kind: 'unresolvedEpisode', href: '/bigscreen/watch/t5', atSeconds: 90 });
      fireEvent.click(screen.getByRole('button', { name: 'Resume from 1:30 anyway' }));
      expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/t5');
      expect(screen.getByRole('note')).toHaveTextContent(/may be a different episode/i);
    });
    it('unresolvedEpisode without progress -> Play anyway, still disclosed', async () => {
      await mount({ kind: 'unresolvedEpisode', href: '/bigscreen/watch/t5' });
      expect(screen.getByRole('button', { name: 'Play anyway' })).toBeInTheDocument();
      expect(screen.getByRole('note')).toBeInTheDocument();
    });
    it('blocked -> the reason on screen and a control to check again', async () => {
      await mount({ kind: 'blocked', reason: 'The box refused this.' });
      expect(screen.getByRole('alert')).toHaveTextContent('The box refused this.');
      expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    });
    it('only play may ever call requestTitle', async () => {
      for (const action of [
        { kind: 'open', href: '/x' },
        { kind: 'paused', torrentId: 't' },
        { kind: 'blocked', reason: 'no' },
      ] as TitleAction[]) {
        resume.mockResolvedValue({ ok: true });
        const { unmount } = await mount(action);
        const control = document.querySelector('.bs-title__action .bs-btn')!;
        await act(async () => { fireEvent.click(control); });
        unmount();
      }
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe('Play', () => {
    it('requests the movie once, then goes to the watch screen', async () => {
      request.mockResolvedValue({ ok: true, torrentId: 'new1' });
      await mount();
      await act(async () => { fireEvent.click(primary()); });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith({ mediaType: 'movie', tmdbId: 603 });
      expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/new1');
    });

    it('a second press while in flight does not request again, and the label says why', async () => {
      const d = deferred<{ ok: true; torrentId: string }>();
      request.mockReturnValue(d.promise);
      await mount();
      fireEvent.click(primary());
      fireEvent.click(primary());
      fireEvent.click(primary());
      expect(request).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Starting…' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
      await act(async () => { d.resolve({ ok: true, torrentId: 'n' }); });
      expect(router.push).toHaveBeenCalledTimes(1);
    });

    it('keeps focus on the control while in flight', async () => {
      request.mockReturnValue(deferred<never>().promise);
      await mount();
      fireEvent.click(primary());
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Starting…' }));
    });

    it('a failed Play prints its reason beside the control and the control still works', async () => {
      request.mockResolvedValueOnce({ ok: false, reason: 'No seeders for this title.', maybeCreated: false });
      await mount();
      await act(async () => { fireEvent.click(primary()); });
      expect(screen.getByRole('alert')).toHaveTextContent('No seeders for this title.');
      expect(router.push).not.toHaveBeenCalled();
      const btn = screen.getByRole('button', { name: 'Play' });
      request.mockResolvedValueOnce({ ok: true, torrentId: 'second' });
      await act(async () => { fireEvent.click(btn); });
      expect(request).toHaveBeenCalledTimes(2);
      expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/second');
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('paused', () => {
    it('resumes the download, then goes to the watch screen', async () => {
      resume.mockResolvedValue({ ok: true });
      await mount({ kind: 'paused', torrentId: 't4' });
      await act(async () => { fireEvent.click(primary()); });
      expect(resume).toHaveBeenCalledWith('t4');
      expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/t4');
      expect(request).not.toHaveBeenCalled();
    });
    it('a failed resume says why and stays usable', async () => {
      resume.mockResolvedValue({ ok: false, reason: 'Could not resume.' });
      await mount({ kind: 'paused', torrentId: 't4' });
      await act(async () => { fireEvent.click(primary()); });
      expect(screen.getByRole('alert')).toHaveTextContent('Could not resume.');
      expect(screen.getByRole('button', { name: 'Resume download' })).toBeInTheDocument();
    });
  });

  describe('blocked', () => {
    it('Check again asks again in place', async () => {
      await mount({ kind: 'blocked', reason: 'Nope.' });
      stateFor.mockResolvedValue(stateOf({ kind: 'play' }));
      await act(async () => { fireEvent.click(primary()); });
      expect(stateFor).toHaveBeenCalledTimes(2);
      expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument();
    });
  });

  describe('locked profile', () => {
    it('clears the stored profile and replaces to the picker', async () => {
      stateFor.mockResolvedValue(stateOf({ kind: 'blocked', reason: 'locked' }, true));
      render(<MoviePage />);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/bigscreen/profiles'));
      expect(clear).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('locked')).toBeNull();
    });
    it('a blocked state that is NOT locked leaves the profile alone', async () => {
      await mount({ kind: 'blocked', reason: 'Refused.' });
      expect(clear).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
    });
  });

  describe('My List', () => {
    it('starts as Add when the movie is not saved, In My List when it is', async () => {
      wl.list.mockResolvedValue([{ content_id: 'movie:603' } as never]);
      await mount();
      expect(await screen.findByRole('button', { name: '✓ In My List' })).toBeInTheDocument();
    });

    it('adds optimistically, with the right payload', async () => {
      const d = deferred<never>();
      wl.add.mockReturnValue(d.promise);
      await mount();
      fireEvent.click(listBtn());
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
      expect(wl.add).toHaveBeenCalledWith('p1', expect.objectContaining({
        content_id: 'movie:603', tmdb_id: '603', media_type: 'movie', title: 'The Matrix',
      }));
      await act(async () => { d.resolve({} as never); });
      expect(screen.getByRole('button', { name: '✓ In My List' })).toBeInTheDocument();
    });

    it('a second press while saving does not call again', async () => {
      wl.add.mockReturnValue(deferred<never>().promise);
      await mount();
      fireEvent.click(listBtn());
      fireEvent.click(listBtn());
      expect(wl.add).toHaveBeenCalledTimes(1);
    });

    it('treats 409 as already saved', async () => {
      wl.add.mockRejectedValue(httpError(409));
      await mount();
      await act(async () => { fireEvent.click(listBtn()); });
      expect(screen.getByRole('button', { name: '✓ In My List' })).toBeInTheDocument();
      expect(screen.queryByText(/couldn.t/i)).toBeNull();
    });

    it('reverts the label and says so when the call fails', async () => {
      wl.add.mockRejectedValue(httpError(500));
      await mount();
      await act(async () => { fireEvent.click(listBtn()); });
      expect(screen.getByRole('button', { name: 'Add to My List' })).toBeInTheDocument();
      expect(screen.getByText(/couldn.t update my list/i)).toBeInTheDocument();
    });

    it('removes a saved movie; a failed removal reverts to saved', async () => {
      wl.list.mockResolvedValue([{ content_id: 'movie:603' } as never]);
      await mount();
      await screen.findByRole('button', { name: '✓ In My List' });
      wl.remove.mockRejectedValue(httpError(500));
      await act(async () => { fireEvent.click(listBtn()); });
      expect(wl.remove).toHaveBeenCalledWith('p1', 'movie:603');
      expect(screen.getByRole('button', { name: '✓ In My List' })).toBeInTheDocument();
      expect(screen.getByText(/couldn.t update my list/i)).toBeInTheDocument();
    });
  });

  describe('keys and focus', () => {
    it('Back goes home', async () => {
      await mount();
      fireEvent.keyDown(window, { key: 'Backspace', keyCode: 8 });
      expect(router.push).toHaveBeenCalledWith('/bigscreen');
    });

    it('focuses the primary control when loaded; Right reaches My List and Left returns', async () => {
      await mount();
      await waitFor(() => expect(document.activeElement).toBe(primary()));
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(listBtn());
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(listBtn());
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(document.activeElement).toBe(primary());
    });

    it('has a focus target while loading', async () => {
      getDetail.mockReturnValue(deferred<MovieDetail>().promise);
      render(<MoviePage />);
      const back = screen.getByRole('link', { name: /back/i });
      await waitFor(() => expect(document.activeElement).toBe(back));
      expect(back).toHaveAttribute('href', '/bigscreen');
    });

    it('offers a retry after the patience window while still loading', async () => {
      vi.useFakeTimers();
      getDetail.mockReturnValue(deferred<MovieDetail>().promise);
      render(<MoviePage />);
      expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
      await act(async () => { vi.advanceTimersByTime(10_000); });
      const retry = screen.getByRole('button', { name: 'Try again' });
      // Two stops now, and arrow keys reach both.
      const back = screen.getByRole('link', { name: 'Back' });
      // Retry took column 0 and Back moved to column 1: Right lands on Back, Left returns.
      expect(document.activeElement).toBe(retry);
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(back);
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(document.activeElement).toBe(retry);
      getDetail.mockResolvedValue(detail());
      await act(async () => { fireEvent.click(retry); });
      expect(getDetail).toHaveBeenCalledTimes(2);
    });

    it('a failed load shows a message, a focusable retry, and retry works', async () => {
      getDetail.mockRejectedValueOnce(httpError(500));
      render(<MoviePage />);
      const retry = await screen.findByRole('button', { name: 'Try again' });
      expect(screen.getByRole('alert')).toBeInTheDocument();
      await waitFor(() => expect(document.activeElement).toBe(retry));
      stateFor.mockResolvedValue(stateOf({ kind: 'play' }));
      await act(async () => { fireEvent.click(retry); });
      expect(await screen.findByRole('heading', { level: 1, name: 'The Matrix' })).toBeInTheDocument();
      expect(getDetail).toHaveBeenCalledTimes(2);
    });

    it('a failed state lookup is also a failed load, not a half-drawn screen', async () => {
      stateFor.mockRejectedValue(new Error('boom'));
      render(<MoviePage />);
      expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });

  describe('ambiguous failure (the backend may have added the torrent)', () => {
    it('re-asks what the title is before re-arming Play, and shows preparing if it exists', async () => {
      request.mockResolvedValue({ ok: false, reason: 'Couldn’t reach the box.', maybeCreated: true });
      await mount();
      stateFor.mockResolvedValue(stateOf({ kind: 'preparing', torrentId: 'made', progress: 3 }));
      await act(async () => { fireEvent.click(primary()); });
      expect(stateFor).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('button', { name: 'Preparing… 3%' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('re-arms Play, with the reason, when the recheck still says play', async () => {
      request.mockResolvedValue({ ok: false, reason: 'Couldn’t reach the box.', maybeCreated: true });
      await mount();
      await act(async () => { fireEvent.click(primary()); });
      expect(stateFor).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t reach the box.');
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    });

    it('says Checking… while it re-asks, and ignores presses', async () => {
      request.mockResolvedValue({ ok: false, reason: 'x', maybeCreated: true });
      await mount();
      const d = deferred<ReturnType<typeof stateOf>>();
      stateFor.mockReturnValue(d.promise);
      await act(async () => { fireEvent.click(primary()); });
      expect(screen.getByRole('button', { name: 'Checking…' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Checking…' }));
      expect(request).toHaveBeenCalledTimes(1);
      await act(async () => { d.resolve(stateOf({ kind: 'play' })); });
    });

    it('a refusal that created nothing (404/409) re-arms Play at once, no recheck', async () => {
      request.mockResolvedValue({ ok: false, reason: 'No sources found.', maybeCreated: false });
      await mount();
      await act(async () => { fireEvent.click(primary()); });
      expect(stateFor).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    });
  });

  describe('Back during an in-flight Play', () => {
    it('does not navigate to the player when the request lands after the viewer left', async () => {
      const d = deferred<{ ok: true; torrentId: string }>();
      request.mockReturnValue(d.promise);
      const view = await mount();
      fireEvent.click(primary());
      view.unmount();
      await act(async () => { d.resolve({ ok: true, torrentId: 'late' }); });
      expect(router.push).not.toHaveBeenCalled();
    });
  });

  describe('focus survives a blocked recheck', () => {
    it.each<[TitleAction, string]>([
      [{ kind: 'open', href: '/w/1' }, 'Open'],
      [{ kind: 'resume', href: '/w/1', atSeconds: 60 }, 'Resume from 1:00'],
      [{ kind: 'preparing', torrentId: 't', progress: 1 }, 'Preparing… 1%'],
      [{ kind: 'unresolvedEpisode', href: '/w/1' }, 'Play anyway'],
      [{ kind: 'play' }, 'Play'],
    ])('blocked -> %j keeps DOM focus on the control', async (next, label) => {
      await mount({ kind: 'blocked', reason: 'Nope.' });
      await waitFor(() => expect(document.activeElement).toBe(primary()));
      stateFor.mockResolvedValue(stateOf(next));
      await act(async () => { fireEvent.click(primary()); });
      const control = screen.getByRole('button', { name: label });
      expect(document.activeElement).toBe(control);
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  describe('no profile', () => {
    it('has one cell and no My List control', async () => {
      profileHook.mockReturnValue({ profile: null, loading: false, select: vi.fn(), clear });
      await mount();
      expect(screen.queryByRole('button', { name: /my list/i })).toBeNull();
      expect(wl.list).not.toHaveBeenCalled();
      expect(stateFor).toHaveBeenCalledWith({ mediaType: 'movie', tmdbId: 603, userId: null });
      await waitFor(() => expect(document.activeElement).toBe(primary()));
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(primary());
    });
  });

  describe('locked profile never shows Play', () => {
    it('does not paint a live Play control when clear() re-runs the load as nobody', async () => {
      stateFor.mockImplementation(async ({ userId }) =>
        userId ? stateOf({ kind: 'blocked', reason: 'locked' }, true) : stateOf({ kind: 'play' }),
      );
      let current: ReturnType<typeof useTvProfile> = profileHook();
      clear.mockImplementation(() => {
        current = { ...current, profile: null };
        profileHook.mockReturnValue(current);
      });
      const view = render(<MoviePage />);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/bigscreen/profiles'));
      view.rerender(<MoviePage />);
      await act(async () => { await Promise.resolve(); });
      expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
      expect(stateFor).toHaveBeenCalledTimes(1);
    });
  });

  describe('My List removal', () => {
    it('counts a 404 on remove as success', async () => {
      wl.list.mockResolvedValue([{ content_id: 'movie:603' } as never]);
      await mount();
      await screen.findByRole('button', { name: '✓ In My List' });
      wl.remove.mockRejectedValue(httpError(404));
      await act(async () => { fireEvent.click(listBtn()); });
      expect(screen.getByRole('button', { name: 'Add to My List' })).toBeInTheDocument();
      expect(screen.queryByText(/couldn.t update my list/i)).toBeNull();
    });
  });
});
describe('/bigscreen/movie/[id]: a recheck that lands after the viewer has left', () => {
  it('does not clear the profile or send them to the picker', async () => {
    // apiClient has no timeout, so the window between a "Check again" press and its answer
    // can be long. Acting on a locked answer then would pull the viewer off whatever screen
    // they went to AND forget the profile they had chosen — worse than a stray navigation,
    // because it silently discards something.
    const view = await mount({ kind: 'blocked', reason: 'nope' });
    const late = deferred<ReturnType<typeof stateOf>>();
    stateFor.mockReturnValue(late.promise);
    fireEvent.click(primary());
    view.unmount();
    clear.mockClear();
    router.replace.mockClear();
    await act(async () => {
      late.resolve(stateOf({ kind: 'blocked', reason: 'locked' }, true));
    });
    expect(clear).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
