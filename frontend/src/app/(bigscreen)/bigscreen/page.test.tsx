import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { CatalogItem } from '@/types';
import type { CardItem } from '../_components/Card';
import { TV_RAILS, fetchRail, toRail, type CatalogRail } from '../_data/rails';
import { fetchContinueWatching, fetchMyList, type ProfileRail } from '../_data/continueWatching';
import { useTvProfile, type TvProfile } from '../_data/useTvProfile';
import HomePage from './page';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

// Real TV_RAILS and toRail, so the lineup under test is the one that ships; only the
// network-touching fetch is replaced.
vi.mock('../_data/rails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../_data/rails')>()),
  fetchRail: vi.fn(),
}));
vi.mock('../_data/continueWatching', () => ({ fetchContinueWatching: vi.fn(), fetchMyList: vi.fn() }));
vi.mock('../_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));

const fetchRailMock = vi.mocked(fetchRail);
const continueMock = vi.mocked(fetchContinueWatching);
const listMock = vi.mocked(fetchMyList);
const profileHook = vi.mocked(useTvProfile);

/** Everything a remote, a Tab key or a screen reader could stop on. */
const FOCUS_STOPS = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';
const SAVED_KEY = 'bs-focus:home';

// --- fixtures -----------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const catalogItem = (tmdbId: number, over: Partial<CatalogItem> = {}): CatalogItem => ({
  tmdb_id: tmdbId,
  media_type: 'movie',
  title: `Title ${tmdbId}`,
  year: 2020,
  overview: `Overview of ${tmdbId}.`,
  poster_url: `https://image.tmdb.org/t/p/w500/p${tmdbId}.jpg`,
  backdrop_url: `https://image.tmdb.org/t/p/w1280/b${tmdbId}.jpg`,
  genre_ids: [],
  genres: [],
  vote_average: 7,
  vote_count: 1,
  popularity: 1,
  original_language: 'en',
  ...over,
});

const specOf = (key: string) => {
  const spec = TV_RAILS.find((s) => s.key === key);
  if (!spec) throw new Error(`no such rail ${key}`);
  return spec;
};

/** A real `toRail` result: n cards, titled `${key} ${i}`, ids unique across rails. */
function catalogRail(key: string, n = 3): CatalogRail {
  const base = (TV_RAILS.findIndex((s) => s.key === key) + 1) * 100;
  const rows = Array.from({ length: n }, (_, i) => catalogItem(base + i, { title: `${key} ${i}` }));
  return toRail(specOf(key), rows, []);
}

const card = (id: string, title: string): CardItem => ({
  id,
  href: `/bigscreen/watch/${id}`,
  title,
  artUrl: `https://img.test/${id}.jpg`,
});

function profileRail(id: string, title: string, n: number, over: Partial<ProfileRail> = {}): ProfileRail {
  return {
    key: id,
    title,
    shape: id === 'continue-watching' ? 'wide' : 'poster',
    items: Array.from({ length: n }, (_, i) => card(`${id}-${i}`, `${title} ${i}`)),
    loading: false,
    locked: false,
    ...over,
  };
}

const BEN: TvProfile = { id: 'p1', display_name: 'Ben', avatar: null };
const clear = vi.fn();
const select = vi.fn();

function useProfile(profile: TvProfile | null, loading = false) {
  profileHook.mockReturnValue({ profile, loading, select, clear });
}

/** One deferred per fetchRail call, by rail key; a retry replaces the entry. */
const railAnswers = new Map<string, ReturnType<typeof deferred<CatalogRail>>>();
const continueAnswer = { current: deferred<ProfileRail>() };
const listAnswer = { current: deferred<ProfileRail>() };

const settle = () => act(async () => {});
const answer = (key: string, n = 3) =>
  act(async () => { railAnswers.get(key)!.resolve(catalogRail(key, n)); });
const answerAll = async (n = 3) => {
  for (const spec of TV_RAILS) if (railAnswers.has(spec.key)) await answer(spec.key, n);
};
const arrow = (k: string) => fireEvent.keyDown(window, { key: k });

const fetchedKeys = () => fetchRailMock.mock.calls.map(([spec]) => spec.key);
const wrapperOf = (key: string) => document.querySelector(`[data-rail="${key}"]`) as HTMLElement;
const railTitles = () => [...document.querySelectorAll('.bs-rail__title')].map((h) => h.textContent);
const stopsIn = (el: Element) => el.querySelectorAll(FOCUS_STOPS);
const active = () => document.activeElement as HTMLElement;

// --- a controllable IntersectionObserver ---------------------------------------------

class FakeObserver {
  static instances: FakeObserver[] = [];
  observed = new Set<Element>();
  observe = vi.fn((el: Element) => { this.observed.add(el); });
  unobserve = vi.fn((el: Element) => { this.observed.delete(el); });
  disconnect = vi.fn(() => { this.observed.clear(); });
  takeRecords = () => [];
  constructor(public callback: IntersectionObserverCallback, public options: IntersectionObserverInit = {}) {
    FakeObserver.instances.push(this);
  }
  /** The element for `key` comes within the lookahead. Fires whether or not it is still observed. */
  see(key: string) {
    const target = wrapperOf(key);
    return act(async () => {
      this.callback([{ target, isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    });
  }
}
const observer = () => FakeObserver.instances[FakeObserver.instances.length - 1];

function renderHome() {
  return render(<HomePage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  railAnswers.clear();
  FakeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  localStorage.clear();
  sessionStorage.clear();
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  useProfile(null);
  fetchRailMock.mockImplementation((spec) => {
    const d = deferred<CatalogRail>();
    railAnswers.set(spec.key, d);
    return d.promise;
  });
  continueAnswer.current = deferred<ProfileRail>();
  listAnswer.current = deferred<ProfileRail>();
  continueMock.mockImplementation(() => continueAnswer.current.promise);
  listMock.mockImplementation(() => listAnswer.current.promise);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// --- tests --------------------------------------------------------------------------

describe('/bigscreen home: progressive paint', () => {
  it('fetches only the first rail on mount', () => {
    // 16 catalog calls in two waves is what the web does; the TV costs two requests at first paint.
    renderHome();
    expect(fetchRailMock).toHaveBeenCalledTimes(1);
    expect(fetchRailMock).toHaveBeenCalledWith(specOf('trending'));
    expect(fetchRailMock).toHaveBeenCalledWith(TV_RAILS[0]);
  });

  it('paints the hero from the first rail, as soon as it resolves', async () => {
    renderHome();
    expect(document.querySelector('.bs-hero__title')).toBeNull();
    await answer('trending', 3);
    expect(screen.getByRole('heading', { name: 'trending 0' })).toHaveClass('bs-hero__title');
    expect(screen.getByText('Overview of 100.')).toHaveClass('bs-hero__overview');
    // The rail itself is drawn from the same answer.
    expect(wrapperOf('trending').querySelectorAll('a.bs-card')).toHaveLength(3);
  });

  it('draws the hero at w1920 rather than the w1280 the catalog returns', async () => {
    renderHome();
    await answer('trending');
    const art = document.querySelector<HTMLElement>('.bs-hero__art');
    expect(art?.style.backgroundImage).toContain('/t/p/w1920/b100.jpg');
    expect(art?.style.backgroundImage).not.toContain('w1280');
    expect(art?.style.backgroundImage).not.toContain('original');
  });

  it('makes the hero open the first card’s detail screen', async () => {
    renderHome();
    await answer('trending');
    expect(document.querySelector('.bs-hero')).toHaveAttribute('href', '/bigscreen/movie/100');
  });

  it('focuses something once the first rail has resolved', async () => {
    renderHome();
    await answer('trending');
    expect(active()).toBe(document.querySelector('.bs-hero'));
    // A roving tabindex: exactly one stop is in the tab order.
    expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it('draws every other rail as a skeleton with nothing focusable in it', async () => {
    renderHome();
    await answer('trending');
    for (const spec of TV_RAILS.slice(1)) {
      const wrapper = wrapperOf(spec.key);
      expect(wrapper.querySelectorAll('.bs-skel').length, spec.key).toBeGreaterThan(0);
      expect(stopsIn(wrapper), spec.key).toHaveLength(0);
      expect(wrapper.querySelector('section')).toHaveAttribute('aria-busy', 'true');
    }
    // The hero and the three trending cards are the only stops on the screen.
    expect(stopsIn(document.body)).toHaveLength(4);
  });

  it('keeps every rail’s title on screen while it is a skeleton, in lineup order', async () => {
    renderHome();
    await answer('trending');
    expect(railTitles()).toEqual(TV_RAILS.map((s) => s.title));
  });

  describe('the lookahead', () => {
    it('observes the scroll container with a 600px lookahead', () => {
      renderHome();
      expect(observer().options.rootMargin).toBe('600px 0px');
      expect(observer().options.root).toBe(document.querySelector('.bs-shell__scroll'));
    });

    it('is a single observer, watching the lazy rails and not the one it fetches itself', () => {
      renderHome();
      expect(FakeObserver.instances).toHaveLength(1);
      const watched = [...observer().observed].map((el) => el.getAttribute('data-rail'));
      expect(watched).toEqual(TV_RAILS.slice(1).map((s) => s.key));
    });

    it('fetches a rail the first time it nears the viewport, and only then', async () => {
      renderHome();
      expect(fetchedKeys()).toEqual(['trending']);
      await observer().see('top-rated');
      expect(fetchedKeys()).toEqual(['trending', 'top-rated']);
      expect(fetchRailMock).toHaveBeenLastCalledWith(specOf('top-rated'));
    });

    it('fetches each rail once, however often the observer reports it', async () => {
      renderHome();
      await observer().see('top-rated');
      await observer().see('top-rated');
      await observer().see('top-rated');
      expect(fetchedKeys().filter((k) => k === 'top-rated')).toHaveLength(1);
    });

    it('stops watching a rail once it has fetched it', async () => {
      renderHome();
      const el = wrapperOf('top-rated');
      await observer().see('top-rated');
      expect(observer().unobserve).toHaveBeenCalledWith(el);
      expect(observer().observed.has(el)).toBe(false);
    });

    it('ignores an entry that is not intersecting', async () => {
      renderHome();
      const target = wrapperOf('new');
      await act(async () => {
        observer().callback([{ target, isIntersecting: false } as unknown as IntersectionObserverEntry], observer() as unknown as IntersectionObserver);
      });
      expect(fetchedKeys()).toEqual(['trending']);
    });

    it('ignores a target it does not recognise', async () => {
      renderHome();
      await act(async () => {
        observer().callback([{ target: document.body, isIntersecting: true } as unknown as IntersectionObserverEntry], observer() as unknown as IntersectionObserver);
      });
      expect(fetchRailMock).toHaveBeenCalledTimes(1);
    });

    it('fetches every rail at once when there is no IntersectionObserver', () => {
      vi.stubGlobal('IntersectionObserver', undefined);
      renderHome();
      expect(fetchedKeys()).toEqual(TV_RAILS.map((s) => s.key));
    });

    it('fetches every rail at once when the observer cannot be constructed', () => {
      vi.stubGlobal('IntersectionObserver', function Broken() { throw new TypeError('bad options'); });
      renderHome();
      expect(fetchedKeys()).toEqual(TV_RAILS.map((s) => s.key));
    });

    it('disconnects the observer on unmount', () => {
      const { unmount } = renderHome();
      const io = observer();
      unmount();
      expect(io.disconnect).toHaveBeenCalled();
    });
  });

  it('does not touch state after unmount, whenever its fetches come back', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    useProfile(BEN);
    const { unmount } = renderHome();
    unmount();
    await act(async () => {
      railAnswers.get('trending')!.resolve(catalogRail('trending'));
      continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 2));
      listAnswer.current.resolve(profileRail('my-list', 'My List', 2));
    });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('/bigscreen home: no rail holds the screen', () => {
  it('shows the first rail while every other rail is still out', async () => {
    renderHome();
    await observer().see('top-rated');
    await observer().see('new');
    await answer('trending');
    expect(active()).toBe(document.querySelector('.bs-hero'));
    expect(wrapperOf('top-rated').querySelector('.bs-skel')).not.toBeNull();
  });

  it('lets a later rail land before a slower earlier one, without waiting for it', async () => {
    renderHome();
    await observer().see('new');
    await answer('new', 4);
    expect(wrapperOf('new').querySelectorAll('a.bs-card')).toHaveLength(4);
    // Trending is still out, so the hero's place is held by the status panel, at the hero's size.
    expect(document.querySelector('.bs-hero')).toHaveTextContent('Loading…');
    // And the rail that landed is reachable: a hung first rail must not strand the rest.
    arrow('ArrowDown');
    expect(active().closest('[data-rail]')).toBe(wrapperOf('new'));
  });

  it('keeps focus at the top when a lower rail beats the first rail to the screen', async () => {
    // Left alone, the grid focuses the first populated row, which is whichever rail won the
    // race, and the page scrolls down to it before the hero has been drawn.
    renderHome();
    const link = screen.getByRole('link', { name: 'Who’s watching?' });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    await observer().see('new');
    await answer('new', 4);
    expect(active()).toBe(link);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    await answer('trending', 3);
    expect(active()).toBe(document.querySelector('.bs-hero'));
  });

  it('keeps focus at the top when a profile rail beats the first rail to the screen', async () => {
    useProfile(BEN);
    renderHome();
    const link = screen.getByRole('link', { name: 'Who’s watching?' });
    await act(async () => { listAnswer.current.resolve(profileRail('my-list', 'My List', 3)); });
    expect(railTitles()).toContain('My List');
    expect(active()).toBe(link);
    await answer('trending', 3);
    expect(active()).toBe(document.querySelector('.bs-hero'));
  });

  it('does not pull focus off a rail the viewer has already moved to when the first rail arrives', async () => {
    renderHome();
    await observer().see('new');
    await answer('new', 4);
    arrow('ArrowDown');
    const focused = active();
    expect(focused.closest('[data-rail]')).toBe(wrapperOf('new'));
    await answer('trending', 3);
    expect(active()).toBe(focused);
    // And the hero is now there to be reached.
    expect(document.querySelector('.bs-hero')).toHaveAttribute('href', '/bigscreen/movie/100');
    arrow('ArrowUp');
    expect(active()).toBe(wrapperOf('trending').querySelector('a.bs-card'));
  });

  it('survives a rail whose fetch rejects, which the data layer promises never to do', async () => {
    renderHome();
    fetchRailMock.mockRejectedValueOnce(new Error('contract broken'));
    await observer().see('top-rated');
    await answer('trending');
    expect(wrapperOf('top-rated').querySelector('section')).toBeNull();
    expect(active()).toBe(document.querySelector('.bs-hero'));
  });

  it('removes a rail that comes back empty and skips it when moving down', async () => {
    renderHome();
    await observer().see('top-rated');
    await observer().see('new');
    await answer('trending');
    await act(async () => { railAnswers.get('top-rated')!.resolve({ ...catalogRail('top-rated', 0) }); });
    await answer('new', 2);
    expect(railTitles()).not.toContain('Top Rated');
    arrow('ArrowDown'); // hero -> trending
    arrow('ArrowDown'); // trending -> new, over the empty top-rated
    expect(active().closest('[data-rail]')).toBe(wrapperOf('new'));
  });

  it('never lands focus on a skeleton, however many times Down is pressed', async () => {
    renderHome();
    await answer('trending');
    for (let i = 0; i < 6; i++) arrow('ArrowDown');
    expect(active().closest('[data-rail]')).toBe(wrapperOf('trending'));
    expect(active().tagName).toBe('A');
  });

  it('reaches a skeleton rail once it has filled', async () => {
    renderHome();
    await answer('trending');
    await observer().see('top-rated');
    arrow('ArrowDown');
    arrow('ArrowDown');
    expect(active().closest('[data-rail]')).toBe(wrapperOf('trending'));
    await answer('top-rated', 2);
    arrow('ArrowDown');
    expect(active().closest('[data-rail]')).toBe(wrapperOf('top-rated'));
  });

  it('replaces a placeholder wholesale: a filled rail is entirely focusable, not just present', async () => {
    renderHome();
    await observer().see('top-rated');
    await answer('top-rated', 4);
    const wrapper = wrapperOf('top-rated');
    expect(wrapper.querySelector('section')).not.toHaveAttribute('aria-busy');
    expect(wrapper.querySelectorAll('.bs-skel')).toHaveLength(0);
    expect(stopsIn(wrapper)).toHaveLength(4);
  });
});

describe('/bigscreen home: the profile’s rails', () => {
  it('fetches neither Continue Watching nor My List without a profile', async () => {
    renderHome();
    await answer('trending');
    await settle();
    expect(continueMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
    expect(railTitles()).not.toContain('Continue Watching');
    expect(railTitles()).not.toContain('My List');
  });

  it('waits for a remembered profile to be resolved before asking for its rails', async () => {
    useProfile(null, true);
    const { rerender } = renderHome();
    await settle();
    expect(continueMock).not.toHaveBeenCalled();
    useProfile(BEN);
    rerender(<HomePage />);
    await settle();
    expect(continueMock).toHaveBeenCalledWith({ userId: 'p1' });
    expect(listMock).toHaveBeenCalledWith({ userId: 'p1' });
  });

  it('fetches both with the profile’s id, once each', async () => {
    useProfile(BEN);
    renderHome();
    await settle();
    expect(continueMock).toHaveBeenCalledTimes(1);
    expect(continueMock).toHaveBeenCalledWith({ userId: 'p1' });
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith({ userId: 'p1' });
  });

  it('does not refetch them when the screen re-renders', async () => {
    useProfile(BEN);
    const { rerender } = renderHome();
    await settle();
    rerender(<HomePage />);
    // `useTvProfile` hands back a fresh object each render; only the id matters.
    useProfile({ ...BEN });
    rerender(<HomePage />);
    await settle();
    expect(continueMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('splices them in directly after the first rail', async () => {
    useProfile(BEN);
    renderHome();
    await answer('trending');
    await act(async () => {
      continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 2));
      listAnswer.current.resolve(profileRail('my-list', 'My List', 2));
    });
    expect(railTitles()).toEqual([
      'Trending This Week',
      'Continue Watching',
      'My List',
      ...TV_RAILS.slice(1).map((s) => s.title),
    ]);
  });

  it('puts them in the same place however they arrive', async () => {
    useProfile(BEN);
    renderHome();
    await answer('trending');
    await act(async () => { listAnswer.current.resolve(profileRail('my-list', 'My List', 2)); });
    expect(railTitles().slice(0, 2)).toEqual(['Trending This Week', 'My List']);
    await act(async () => { continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 2)); });
    expect(railTitles().slice(0, 3)).toEqual(['Trending This Week', 'Continue Watching', 'My List']);
  });

  it('draws nothing for them until they answer, and nothing for an empty answer', async () => {
    useProfile(BEN);
    renderHome();
    await answer('trending');
    expect(railTitles()).not.toContain('Continue Watching');
    await act(async () => {
      continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 0));
      listAnswer.current.resolve(profileRail('my-list', 'My List', 0));
    });
    expect(railTitles()).toEqual(TV_RAILS.map((s) => s.title));
    expect(clear).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('makes their cards focusable and reachable', async () => {
    useProfile(BEN);
    renderHome();
    await answer('trending');
    await act(async () => { continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 3)); });
    arrow('ArrowDown'); // hero -> trending
    arrow('ArrowDown'); // trending -> continue watching
    expect(active().closest('[data-rail]')).toBe(wrapperOf('continue-watching'));
    expect(active()).toHaveClass('bs-card--wide');
  });

  it('draws each as it lands, without waiting for the other', async () => {
    useProfile(BEN);
    renderHome();
    await answer('trending');
    await act(async () => { listAnswer.current.resolve(profileRail('my-list', 'My List', 2)); });
    expect(railTitles()).toContain('My List');
    expect(railTitles()).not.toContain('Continue Watching');
  });

  it('survives a profile rail that rejects, which the data layer promises never to do', async () => {
    useProfile(BEN);
    renderHome();
    await answer('trending');
    await act(async () => {
      continueAnswer.current.reject(new Error('contract broken'));
      listAnswer.current.resolve(profileRail('my-list', 'My List', 2));
    });
    expect(railTitles()).toContain('My List');
    expect(clear).not.toHaveBeenCalled();
  });

  it('drops an answer meant for a profile the viewer is no longer on', async () => {
    useProfile(BEN);
    const { rerender } = renderHome();
    await answer('trending');
    const stale = continueAnswer.current;
    continueAnswer.current = deferred<ProfileRail>();
    useProfile({ id: 'p2', display_name: 'Mum', avatar: null });
    rerender(<HomePage />);
    await settle();
    expect(continueMock).toHaveBeenLastCalledWith({ userId: 'p2' });
    await act(async () => { stale.resolve(profileRail('continue-watching', 'Ben’s Continue Watching', 2)); });
    expect(railTitles()).not.toContain('Continue Watching');
  });

  it('takes Ben’s rails away when the profile is cleared', async () => {
    useProfile(BEN);
    const { rerender } = renderHome();
    await answer('trending');
    await act(async () => { continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 2)); });
    expect(railTitles()).toContain('Continue Watching');
    useProfile(null);
    rerender(<HomePage />);
    await settle();
    expect(railTitles()).not.toContain('Continue Watching');
  });

  describe('a passcode-locked profile', () => {
    // useTvProfile trusts a stored id without checking it. The first profile-scoped call that
    // comes back 423 is the only place the lock shows, and the fetchers resolve rather than
    // reject, so they say so with `locked`.
    it('forgets the stored profile and sends the viewer to the picker when Continue Watching is locked', async () => {
      useProfile(BEN);
      renderHome();
      await answer('trending');
      await act(async () => { continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 0, { locked: true })); });
      expect(clear).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith('/bigscreen/profiles');
    });

    it('does the same when only My List is locked', async () => {
      useProfile(BEN);
      renderHome();
      await answer('trending');
      await act(async () => {
        continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 2));
        listAnswer.current.resolve(profileRail('my-list', 'My List', 0, { locked: true }));
      });
      expect(clear).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith('/bigscreen/profiles');
    });

    it('redirects once when both are locked', async () => {
      useProfile(BEN);
      renderHome();
      await answer('trending');
      await act(async () => {
        continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 0, { locked: true }));
        listAnswer.current.resolve(profileRail('my-list', 'My List', 0, { locked: true }));
      });
      expect(clear).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledTimes(1);
    });

    it('does not take empty rails for a lock: a profile with no history stays on Home', async () => {
      useProfile(BEN);
      renderHome();
      await answer('trending');
      await act(async () => {
        continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 0));
        listAnswer.current.resolve(profileRail('my-list', 'My List', 0));
      });
      await settle();
      expect(clear).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
    });

    it('does not redirect for a rail that merely failed', async () => {
      useProfile(BEN);
      renderHome();
      await answer('trending');
      await act(async () => {
        continueAnswer.current.reject(new Error('Network Error'));
        listAnswer.current.resolve(profileRail('my-list', 'My List', 0));
      });
      expect(clear).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
    });

    it('draws nothing from a locked answer', async () => {
      useProfile(BEN);
      renderHome();
      await answer('trending');
      await act(async () => {
        continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 2, { locked: true }));
      });
      expect(railTitles()).not.toContain('Continue Watching');
    });
  });
});

describe('/bigscreen home: never nothing to focus', () => {
  const hasFocusStop = () => stopsIn(document.body).length > 0;
  const drawn = () => document.body.textContent ?? '';

  it('has a focus stop, and focus on it, on the very first paint', () => {
    renderHome();
    expect(hasFocusStop()).toBe(true);
    const link = screen.getByRole('link', { name: 'Who’s watching?' });
    expect(link).toHaveAttribute('href', '/bigscreen/profiles');
    expect(active()).toBe(link);
    expect(drawn()).toContain('Loading…');
  });

  it('keeps that stop for as long as the first rail is out', async () => {
    renderHome();
    await settle();
    await settle();
    expect(active()).toBe(screen.getByRole('link', { name: 'Who’s watching?' }));
  });

  it('has it with no profile selected, and with one', () => {
    renderHome();
    expect(screen.getByRole('link', { name: 'Who’s watching?' })).toBeInTheDocument();
    useProfile(BEN);
    document.body.innerHTML = '';
    renderHome();
    expect(screen.getByRole('link', { name: 'Who’s watching?' })).toBeInTheDocument();
  });

  it('never claims there is nothing to show while a rail is still out', async () => {
    renderHome();
    await answer('trending', 0);
    expect(drawn()).not.toContain('Nothing to show');
    expect(drawn()).toContain('Loading…');
    expect(hasFocusStop()).toBe(true);
  });

  it('hands focus to the content when it arrives, rather than leaving it on <body>', async () => {
    renderHome();
    expect(active()).toBe(screen.getByRole('link', { name: 'Who’s watching?' }));
    await answer('trending');
    expect(screen.queryByRole('link', { name: 'Who’s watching?' })).toBeNull();
    expect(active()).not.toBe(document.body);
    expect(active()).toBe(document.querySelector('.bs-hero'));
    expect(drawn()).not.toContain('Loading…');
  });

  it('hands focus to the first populated rail when the first rail has nothing but another does', async () => {
    renderHome();
    await observer().see('top-rated');
    await answer('trending', 0);
    await answer('top-rated', 3);
    expect(document.querySelector('.bs-hero')).toBeNull();
    expect(active().closest('[data-rail]')).toBe(wrapperOf('top-rated'));
    expect(drawn()).not.toContain('Nothing to show');
  });

  describe('when nothing loads', () => {
    async function everythingEmpty() {
      vi.stubGlobal('IntersectionObserver', undefined);
      const view = renderHome();
      for (const spec of TV_RAILS) {
        await act(async () => { railAnswers.get(spec.key)!.resolve(catalogRail(spec.key, 0)); });
      }
      return view;
    }

    it('says so, and offers Try again and Who’s watching?, with focus on Try again', async () => {
      await everythingEmpty();
      expect(screen.getByRole('heading', { name: 'Nothing to show right now' })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(/could not load any titles/i);
      expect(active()).toBe(screen.getByRole('button', { name: 'Try again' }));
      expect(stopsIn(document.body)).toHaveLength(2);
    });

    it('moves between the two with Left and Right', async () => {
      await everythingEmpty();
      arrow('ArrowRight');
      expect(active()).toBe(screen.getByRole('link', { name: 'Who’s watching?' }));
      arrow('ArrowLeft');
      expect(active()).toBe(screen.getByRole('button', { name: 'Try again' }));
    });

    it('does not say so while a profile’s rails are still out', async () => {
      // A hung watchlist must not keep Try again off a screen that has nothing else.
      useProfile(BEN);
      await everythingEmpty();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('fetches every rail again on Try again, and keeps a focus stop the whole time', async () => {
      await everythingEmpty();
      fetchRailMock.mockClear();
      const button = screen.getByRole('button', { name: 'Try again' });
      fireEvent.click(button);
      await settle();
      expect(fetchedKeys()).toEqual(TV_RAILS.map((s) => s.key));
      // The same button, relabelled: an unmounted focused control would drop focus to <body>.
      expect(screen.getByRole('button', { name: 'Trying again…' })).toBe(button);
      expect(active()).toBe(button);
      expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    });

    it('ignores a second press while the retry is out', async () => {
      await everythingEmpty();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await settle();
      fetchRailMock.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Trying again…' }));
      await settle();
      expect(fetchRailMock).not.toHaveBeenCalled();
    });

    it('shows the content, with focus on the hero, when the retry succeeds', async () => {
      await everythingEmpty();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await settle();
      await answerAll(3);
      expect(screen.queryByRole('button', { name: /try/i })).toBeNull();
      expect(active()).toBe(document.querySelector('.bs-hero'));
      expect(railTitles()).toEqual(TV_RAILS.map((s) => s.title));
    });

    it('offers Try again again when the retry fails too', async () => {
      await everythingEmpty();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await settle();
      for (const spec of TV_RAILS) {
        await act(async () => { railAnswers.get(spec.key)!.resolve(catalogRail(spec.key, 0)); });
      }
      expect(active()).toBe(screen.getByRole('button', { name: 'Try again' }));
    });

    it('with the lookahead, re-watches the rails instead of fetching them all', async () => {
      renderHome();
      await answer('trending', 0);
      for (const spec of TV_RAILS.slice(1)) {
        await observer().see(spec.key);
        await answer(spec.key, 0);
      }
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      fetchRailMock.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await settle();
      expect(fetchedKeys()).toEqual(['trending']);
      expect([...observer().observed].map((el) => el.getAttribute('data-rail'))).toEqual(
        TV_RAILS.slice(1).map((s) => s.key),
      );
    });
  });
});

describe('/bigscreen home: returning to where the viewer was', () => {
  const save = (row: number, col: number) => sessionStorage.setItem(SAVED_KEY, JSON.stringify({ row, col }));
  // Row 0 is the recovery row, 1 the hero, then the lineup: trending, continue watching,
  // my list, top-rated, new, action, drama, comedy, sci-fi.
  const ROW_OF = (index: number) => 2 + index;

  it('fetches a saved rail that is far below the lookahead, without scrolling to it first', () => {
    save(ROW_OF(6), 1); // genre-drama
    renderHome();
    expect(fetchedKeys()).toEqual(['trending', 'genre-drama']);
  });

  it('lands on the saved card once that rail fills', async () => {
    save(ROW_OF(6), 1);
    renderHome();
    await answer('trending');
    // Held, not given up on: the hero is only a stand-in until the saved row exists.
    expect(active()).toBe(document.querySelector('.bs-hero'));
    await answer('genre-drama', 3);
    expect(active()).toHaveTextContent('genre-drama 1');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('does not overwrite the saved position while it is waiting', async () => {
    vi.useFakeTimers();
    save(ROW_OF(6), 1);
    renderHome();
    await answer('trending');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(JSON.parse(sessionStorage.getItem(SAVED_KEY)!)).toEqual({ row: ROW_OF(6), col: 1 });
  });

  it('fetches nothing extra for a position on the hero or a profile slot', () => {
    save(1, 0);
    renderHome();
    expect(fetchedKeys()).toEqual(['trending']);
    FakeObserver.instances = [];
    document.body.innerHTML = '';
    save(ROW_OF(1), 0); // continue watching: the profile effect owns it
    renderHome();
    expect(fetchedKeys()).toEqual(['trending', 'trending']);
  });

  it('ignores a saved position past the end of the lineup, and one that is not a position', () => {
    save(99, 0);
    renderHome();
    expect(fetchedKeys()).toEqual(['trending']);
    document.body.innerHTML = '';
    sessionStorage.setItem(SAVED_KEY, '{"row":"x"}');
    renderHome();
    expect(fetchedKeys()).toEqual(['trending', 'trending']);
  });

  it('keeps a rail’s row the same whether or not the profile rails have anything', async () => {
    // A watch history appearing between visits must not slide the saved row onto a neighbour.
    save(ROW_OF(3), 0); // top-rated
    useProfile(BEN);
    renderHome();
    await answer('trending');
    await act(async () => { continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 2)); });
    await answer('top-rated', 2);
    expect(active()).toHaveTextContent('top-rated 0');
  });
});

describe('/bigscreen home: keeping the focused card in view', () => {
  // A skeleton is shorter than the rail that replaces it, so a rail landing above the focused
  // card pushes it down, and the focus hook only scrolls when focus moves. jsdom has no
  // layout, so the geometry is supplied.
  function layout(focusedBox: { top: number; bottom: number }) {
    const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('bs-shell__scroll') ? box(0, 1080) : box(focusedBox.top, focusedBox.bottom);
    });
  }
  const scrolledTo = () => vi.mocked(Element.prototype.scrollIntoView).mock.contexts as unknown as HTMLElement[];

  it('scrolls the focused card back into view when a rail fills in above it and pushes it off the screen', async () => {
    renderHome();
    await answer('trending');
    const focused = active();
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    const spy = layout({ top: 900, bottom: 1300 });
    await observer().see('top-rated');
    await answer('top-rated', 2);
    expect(scrolledTo()).toContain(focused);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    spy.mockRestore();
  });

  it('leaves the scroll alone when the focused card is still in view', async () => {
    renderHome();
    await answer('trending');
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    const spy = layout({ top: 200, bottom: 700 });
    await observer().see('top-rated');
    await answer('top-rated', 2);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('scrolls back up as well, for a card pushed above the screen', async () => {
    renderHome();
    await answer('trending');
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    const spy = layout({ top: -300, bottom: 100 });
    await observer().see('top-rated');
    await answer('top-rated', 2);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('/bigscreen home: no polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('makes no further service calls however long it stays open', async () => {
    useProfile(BEN);
    renderHome();
    await observer().see('top-rated');
    await answerAll(3);
    await act(async () => {
      continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 2));
      listAnswer.current.resolve(profileRail('my-list', 'My List', 2));
    });
    const before = [fetchRailMock, continueMock, listMock].map((m) => m.mock.calls.length);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect([fetchRailMock, continueMock, listMock].map((m) => m.mock.calls.length)).toEqual(before);
  });

  it('leaves no timer running once it has settled', async () => {
    renderHome();
    await answer('trending');
    // The focus hook's one-shot 200ms position write is the only timer there should ever be.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('repeats nothing: no interval, and no poll of the activity endpoint', () => {
    // Deliberately NOT a blanket ban on setTimeout: a one-shot timer is not a poll, and the
    // panel needs one to offer a retry when a request hangs (apiClient has no timeout). The
    // properties that matter are pinned above behaviourally — no service call after settle,
    // and no timer still pending. What is banned here is anything that REPEATS.
    const src = readFileSync(join(process.cwd(), 'src/app/(bigscreen)/bigscreen/page.tsx'), 'utf8');
    expect(src).not.toMatch(/\bsetInterval\s*\(/);
    expect(src).not.toMatch(/\brequestAnimationFrame\s*\(/);
    // The web's TopNav polls this every 15s, forever (spec §9 removes it from the TV).
    expect(src).not.toMatch(/activity\/count|activityService/);
  });

  it('offers a retry when the first rail hangs, rather than reading Loading for ever', async () => {
    // catalogSettled can never become true while a request hangs, so a retry gated only on
    // it would leave a screen the viewer cannot act on beyond the one link beside it.
    renderHome();
    // No `answer(...)`: the first rail is left hanging on purpose.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
