import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StrictMode } from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { CatalogItem } from '@/types';
import type { CardItem } from '../_components/Card';
import { HEADER_CELLS } from '../_components/Header';
import { TV_RAILS, fetchRail, toRail, type CatalogRail } from '../_data/rails';
import { RAILS_ON_SCREEN } from '../_data/railLineup';
import { fetchContinueWatching, fetchMyList, type ProfileRail } from '../_data/continueWatching';
import { useTvProfile, type TvProfile } from '../_data/useTvProfile';
import HomePage from './page';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
// `usePathname` is read by the top bar, which every browsing screen mounts; it is what
// marks the current section.
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/bigscreen' }));

// Real TV_RAILS and toRail, so the lineup under test is the one that ships; only the
// network-touching fetch is replaced.
vi.mock('../_data/rails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../_data/rails')>()),
  fetchRail: vi.fn(),
}));
/**
 * THE LINEUP IS FIXED FOR THIS FILE, and that is a deliberate seam.
 *
 * `pickRails` draws a random RAILS_ON_SCREEN of the 31-rail pool per session, which is
 * exactly what this file must not depend on: it asserts what the SCREEN does with a lineup
 * ("trending is fetched first", "every other rail is watched", "the titles render in
 * order"), and a shuffled lineup would make a hundred assertions depend on a seed.
 *
 * So here the lineup is the head of the pool in pool order, and `withPages` is the
 * identity, which keeps `toHaveBeenCalledWith(LINEUP[0])` readable. The randomness itself
 * is covered by `_data/railLineup.test.ts`, and `page.lineup.test.tsx` runs this screen
 * with the REAL picker to prove it is wired to it at all — without that, a regression that
 * ignored the lineup entirely would pass every row in this file.
 */
vi.mock('../_data/railLineup', async (importOriginal) => {
  const real = await importOriginal<typeof import('../_data/railLineup')>();
  return {
    ...real,
    sessionSeed: () => 1,
    pickRails: (pool: readonly unknown[], count: number) => pool.slice(0, count),
    withPages: (specs: readonly unknown[]) => specs,
  };
});
vi.mock('../_data/continueWatching', () => ({ fetchContinueWatching: vi.fn(), fetchMyList: vi.fn() }));
vi.mock('../_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));

const fetchRailMock = vi.mocked(fetchRail);
const continueMock = vi.mocked(fetchContinueWatching);
const listMock = vi.mocked(fetchMyList);
const profileHook = vi.mocked(useTvProfile);

/** The rails this file's mocked picker puts on screen: the head of the pool, in order. */
const LINEUP = TV_RAILS.slice(0, RAILS_ON_SCREEN);

/** Everything a remote, a Tab key or a screen reader could stop on. */
const FOCUS_STOPS = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';
const SAVED_KEY = 'bs-focus:home:v3';
/** A key an older row layout used. Never read by this build. */
const LEGACY_KEY = 'bs-focus:home:v2';

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
  for (const spec of LINEUP) if (railAnswers.has(spec.key)) await answer(spec.key, n);
};
const arrow = (k: string) => fireEvent.keyDown(window, { key: k });

const fetchedKeys = () => fetchRailMock.mock.calls.map(([spec]) => spec.key);
const wrapperOf = (key: string) => document.querySelector(`[data-rail="${key}"]`) as HTMLElement;
const railTitles = () => [...document.querySelectorAll('.bs-rail__title')].map((h) => h.textContent);
const stopsIn = (el: Element) => el.querySelectorAll(FOCUS_STOPS);
/** The recovery panel's link; the nav row has one of the same name, so scope to the panel. */
// Scoped to the panel deliberately. The nav row's equivalent is labelled "Switch profile"
// so the two no longer collide by name, but scoping keeps this helper honest if either
// label changes again.
const panelWho = () => within(document.querySelector('.bs-controls') as HTMLElement).getByRole('link', { name: 'Who’s watching?' });
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
    expect(fetchRailMock).toHaveBeenCalledWith(LINEUP[0]);
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
    for (const spec of LINEUP.slice(1)) {
      const wrapper = wrapperOf(spec.key);
      expect(wrapper.querySelectorAll('.bs-skel').length, spec.key).toBeGreaterThan(0);
      expect(stopsIn(wrapper), spec.key).toHaveLength(0);
      expect(wrapper.querySelector('section')).toHaveAttribute('aria-busy', 'true');
    }
    // The hero, the bar's links and the three trending cards are the only stops on the
    // screen. Counted from the component, so adding a menu item moves this with it.
    expect(stopsIn(document.body)).toHaveLength(1 + HEADER_CELLS + 3);
  });

  it('keeps every rail’s title on screen while it is a skeleton, in lineup order', async () => {
    renderHome();
    await answer('trending');
    expect(railTitles()).toEqual(LINEUP.map((s) => s.title));
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
      expect(watched).toEqual(LINEUP.slice(1).map((s) => s.key));
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
      expect(fetchedKeys()).toEqual(LINEUP.map((s) => s.key));
    });

    it('fetches every rail at once when the observer cannot be constructed', () => {
      vi.stubGlobal('IntersectionObserver', function Broken() { throw new TypeError('bad options'); });
      renderHome();
      expect(fetchedKeys()).toEqual(LINEUP.map((s) => s.key));
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
    arrow('ArrowDown'); // the nav row is the next stop below the panel
    arrow('ArrowDown');
    expect(active().closest('[data-rail]')).toBe(wrapperOf('new'));
  });

  it('keeps focus at the top when a lower rail beats the first rail to the screen', async () => {
    // Left alone, the grid focuses the first populated row, which is whichever rail won the
    // race, and the page scrolls down to it before the hero has been drawn.
    renderHome();
    const link = panelWho();
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
    const link = panelWho();
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
    arrow('ArrowDown'); // nav
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
    arrow('ArrowDown'); // hero -> nav
    arrow('ArrowDown'); // nav -> trending
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
      ...LINEUP.slice(1).map((s) => s.title),
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
    expect(railTitles()).toEqual(LINEUP.map((s) => s.title));
    expect(clear).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('makes their cards focusable and reachable', async () => {
    useProfile(BEN);
    renderHome();
    await answer('trending');
    await act(async () => { continueAnswer.current.resolve(profileRail('continue-watching', 'Continue Watching', 3)); });
    arrow('ArrowDown'); // hero -> nav
    arrow('ArrowDown'); // nav -> trending
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
    const link = panelWho();
    expect(link).toHaveAttribute('href', '/bigscreen/profiles');
    expect(active()).toBe(link);
    expect(drawn()).toContain('Loading…');
  });

  it('keeps that stop for as long as the first rail is out', async () => {
    renderHome();
    await settle();
    await settle();
    expect(active()).toBe(panelWho());
  });

  it('has it with no profile selected, and with one', () => {
    renderHome();
    expect(panelWho()).toBeInTheDocument();
    useProfile(BEN);
    document.body.innerHTML = '';
    renderHome();
    expect(panelWho()).toBeInTheDocument();
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
    expect(active()).toBe(panelWho());
    await answer('trending');
    expect(document.querySelector('.bs-controls')).toBeNull();
    expect(active()).not.toBe(document.body);
    expect(active()).toBe(document.querySelector('.bs-hero'));
    expect(drawn()).not.toContain('Loading…');
  });

  it('hands focus to the first rail that HAS something, never to the bar above it', async () => {
    // The fall-back's whole job (`model.firstTarget`'s `from`): with no hero and an empty
    // first rail there is nothing at rows 1 or 2, and the ring must find the rail that did
    // load rather than the menu — which is row 0 and would otherwise always win.
    renderHome();
    await observer().see('top-rated');
    await answer('trending', 0);
    await answer('top-rated', 3);
    expect(document.querySelector('.bs-hero')).toBeNull();
    expect(active().closest('[data-rail]')).toBe(wrapperOf('top-rated'));
    expect(drawn()).not.toContain('Nothing to show');
    // ...and the menu is one Up press away, which is where a viewer reaches for it.
    arrow('ArrowUp');
    expect(active()).toBe(screen.getByRole('link', { name: 'Home' }));
  });

  describe('when nothing loads', () => {
    async function everythingEmpty() {
      vi.stubGlobal('IntersectionObserver', undefined);
      const view = renderHome();
      for (const spec of LINEUP) {
        await act(async () => { railAnswers.get(spec.key)!.resolve(catalogRail(spec.key, 0)); });
      }
      return view;
    }

    it('says so, and offers Try again and Who’s watching?, with focus on Try again', async () => {
      await everythingEmpty();
      expect(screen.getByRole('heading', { name: 'Nothing to show right now' })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(/could not load any titles/i);
      expect(active()).toBe(screen.getByRole('button', { name: 'Try again' }));
      expect(stopsIn(document.querySelector('.bs-controls')!)).toHaveLength(2);
    });

    it('moves between the two with Left and Right', async () => {
      await everythingEmpty();
      arrow('ArrowRight');
      expect(active()).toBe(panelWho());
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
      expect(fetchedKeys()).toEqual(LINEUP.map((s) => s.key));
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
      expect(railTitles()).toEqual(LINEUP.map((s) => s.title));
    });

    it('offers Try again again when the retry fails too', async () => {
      await everythingEmpty();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await settle();
      for (const spec of LINEUP) {
        await act(async () => { railAnswers.get(spec.key)!.resolve(catalogRail(spec.key, 0)); });
      }
      expect(active()).toBe(screen.getByRole('button', { name: 'Try again' }));
    });

    it('with the lookahead, re-watches the rails instead of fetching them all', async () => {
      renderHome();
      await answer('trending', 0);
      for (const spec of LINEUP.slice(1)) {
        await observer().see(spec.key);
        await answer(spec.key, 0);
      }
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      fetchRailMock.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await settle();
      expect(fetchedKeys()).toEqual(['trending']);
      expect([...observer().observed].map((el) => el.getAttribute('data-rail'))).toEqual(
        LINEUP.slice(1).map((s) => s.key),
      );
    });
  });
});

describe('/bigscreen home: returning to where the viewer was', () => {
  const save = (row: number, col: number) => sessionStorage.setItem(SAVED_KEY, JSON.stringify({ row, col }));
  // Row 0 is the top bar, 1 the recovery row, 2 the hero, then the lineup: trending,
  // continue watching, my list, top-rated, new, action, drama, comedy, sci-fi.
  const ROW_OF = (index: number) => 3 + index;

  it('returns to the menu item the viewer left from, without waiting for a rail', () => {
    // The bar is always populated, so a saved row-0 position is adopted on the first effect
    // run rather than held pending. That is what makes coming back from Search or
    // Diagnostics land where you were, and nothing pinned it.
    save(0, 2); // "My List"
    renderHome();
    expect(active()).toHaveTextContent('My List');
    // And it does not pull a rail in on the way: nav is not part of the lineup.
    expect(fetchedKeys()).toEqual(['trending']);
  });

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

  it('discards a position saved under the old row layout instead of misreading it', async () => {
    // The previous build's rows: 0 recovery, 1 hero, 2.. rails. {row: 8} was genre-drama
    // there (lineup index 6). Read under this layout it would be lineup index 5 (action).
    sessionStorage.setItem(LEGACY_KEY, JSON.stringify({ row: 8, col: 1 }));
    renderHome();
    expect(fetchedKeys()).toEqual(['trending']); // neither rail was fetched on its behalf
    await answer('trending');
    await observer().see('genre-action');
    await answer('genre-action', 3);
    await observer().see('genre-drama');
    await answer('genre-drama', 3);
    expect(active()).toBe(document.querySelector('.bs-hero'));
    expect(JSON.parse(sessionStorage.getItem(LEGACY_KEY)!)).toEqual({ row: 8, col: 1 });
  });

  it('does not let the old key’s row index fetch the wrong rail', () => {
    sessionStorage.setItem(LEGACY_KEY, JSON.stringify({ row: 8, col: 0 }));
    renderHome();
    expect(fetchedKeys()).not.toContain('genre-action');
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
  // A rail landing above the focused card pushes it down (Continue Watching lands from nothing,
  // ~650px, above every catalog rail but trending), and the focus hook only scrolls when focus
  // moves, not when layout does. jsdom has no layout, so the geometry is supplied.
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
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'center' });
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
    // Asserted at full settle, not after the first rail: by then the panel is long gone, so
    // the patience timer is not pending either way, and what this is for is a timer that a
    // LATER landing installs (a retry, a lookahead rail, a profile rail), which a check made
    // after trending alone would never see. The 1s covers the focus hook's one-shot 200ms
    // position write.
    useProfile(BEN);
    renderHome();
    await answer('trending');
    for (const spec of LINEUP) if (spec !== LINEUP[0]) await observer().see(spec.key);
    await answerAll();
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

  it('actually refetches the hung rail when the patience retry is pressed', async () => {
    // The original guard was `if (!nothingToShow) return`, and nothingToShow requires every
    // catalog rail to have ANSWERED — impossible while one hangs, i.e. precisely this state.
    // The button rendered, took focus, and swallowed every press. The shipped test only
    // asserted that it appeared, which is why that got through.
    renderHome();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    fetchRailMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(fetchedKeys()).toContain('trending');
    expect(screen.getByRole('button', { name: 'Trying again…' })).toBeInTheDocument();
  });

  it('does not steal focus from a rail the viewer has moved to', async () => {
    // autoFocus was written for the nothing-to-show panel, where no rail can hold focus. On
    // the patience path other rails have usually landed: top-rated sits inside the 600px
    // lookahead at scrollTop 0. Stealing focus there jumps the page to the top AND cancels
    // a pending restore AND overwrites the saved position with the recovery row.
    renderHome();
    await observer().see('top-rated');
    await answer('top-rated');
    arrow('ArrowDown'); // nav
    arrow('ArrowDown');
    const parked = active();
    expect(parked.className).toContain('bs-card');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(active()).toBe(parked);
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

describe('/bigscreen home: the retry', () => {
  // One value, three states. idle: nothing to offer. offered: Try again is on the panel.
  // inflight: it was pressed and the first rail has not answered. idle becomes offered when
  // the panel has been up for LOAD_PATIENCE_MS or every catalog rail has answered with no
  // cards; offered becomes inflight on a press; inflight becomes idle when the CURRENT request
  // for the first rail lands with cards, becomes offered when it lands empty, and becomes
  // offered again after another LOAD_PATIENCE_MS, so a retry that hangs can be retried.
  const PATIENCE = 10_000;
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const tryAgain = () => screen.getByRole('button', { name: 'Try again' });
  const trying = () => screen.getByRole('button', { name: 'Trying again…' });
  const press = async (button: HTMLElement) => { fireEvent.click(button); await settle(); };
  const trendingRequests = () => fetchedKeys().filter((k) => k === 'trending').length;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('being offered', () => {
    it('offers nothing while the first rail is merely slow, and offers Try again once patience runs out', async () => {
      renderHome();
      await advance(PATIENCE - 1);
      expect(screen.queryByRole('button', { name: /try/i })).toBeNull();
      await advance(1);
      expect(tryAgain()).toBeInTheDocument();
    });

    it('moves focus onto the button when it arrives beside the link the viewer is on', async () => {
      // The link slides from column 0 to 1 as the button takes column 0, and the grid's
      // target (0, 0) does not change, so nothing but autoFocus puts DOM focus on the new cell.
      renderHome();
      const link = panelWho();
      expect(active()).toBe(link);
      await advance(PATIENCE);
      expect(active()).toBe(tryAgain());
      expect(active()).not.toBe(link);
      arrow('ArrowRight');
      expect(active()).toBe(link);
    });

    it('is offered at once, without waiting out the patience, when every rail has answered with no cards', async () => {
      vi.stubGlobal('IntersectionObserver', undefined);
      renderHome();
      for (const spec of LINEUP) await act(async () => { railAnswers.get(spec.key)!.resolve(catalogRail(spec.key, 0)); });
      expect(tryAgain()).toBeInTheDocument();
      expect(active()).toBe(tryAgain());
    });

    it('is offered after the patience when the first rail answered with no cards but the others are still out', async () => {
      renderHome();
      await answer('trending', 0);
      expect(screen.queryByRole('button', { name: /try/i })).toBeNull();
      await advance(PATIENCE);
      expect(tryAgain()).toBeInTheDocument();
    });

    it('is not offered at all once there is something to show', async () => {
      renderHome();
      await answer('trending');
      await advance(PATIENCE * 3);
      expect(screen.queryByRole('button', { name: /try/i })).toBeNull();
    });
  });

  describe('pressing it', () => {
    it('asks for the first rail again, keeps the same focused button, and says so', async () => {
      renderHome();
      await advance(PATIENCE);
      const button = tryAgain();
      expect(trendingRequests()).toBe(1);
      await press(button);
      expect(trendingRequests()).toBe(2);
      expect(trying()).toBe(button);
      expect(active()).toBe(button);
    });

    it('ignores a second press while the retry is out', async () => {
      renderHome();
      await advance(PATIENCE);
      await press(tryAgain());
      await press(trying());
      await press(trying());
      expect(trendingRequests()).toBe(2);
    });
  });

  describe('a retry that comes back', () => {
    async function retried() {
      renderHome();
      await advance(PATIENCE);
      const stale = railAnswers.get('trending')!;
      await press(tryAgain());
      return { stale, fresh: railAnswers.get('trending')! };
    }

    it('with cards shows the hero, with focus on it and no button, and leaves no timer behind', async () => {
      const { fresh } = await retried();
      await act(async () => { fresh.resolve(catalogRail('trending', 3)); });
      expect(document.querySelector('.bs-hero')).toHaveAttribute('href', '/bigscreen/movie/100');
      expect(active()).toBe(document.querySelector('.bs-hero'));
      expect(screen.queryByRole('button', { name: /try/i })).toBeNull();
      await advance(PATIENCE * 3);
      expect(trendingRequests()).toBe(2);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('empty offers Try again straight away, on the same button, and a second press is admitted', async () => {
      const { fresh } = await retried();
      const button = trying();
      await act(async () => { fresh.resolve(catalogRail('trending', 0)); });
      expect(tryAgain()).toBe(button);
      expect(active()).toBe(button);
      await press(button);
      expect(trendingRequests()).toBe(3);
      expect(trying()).toBe(button);
    });
  });

  describe('a retry that hangs', () => {
    it('can be retried again after another patience, rather than leaving the button dead', async () => {
      renderHome();
      await advance(PATIENCE);
      await press(tryAgain());
      expect(trendingRequests()).toBe(2);
      // Just short of the patience it is still in flight: the label and the guard agree.
      await advance(PATIENCE - 1);
      await press(trying());
      expect(trendingRequests()).toBe(2);
      await advance(1);
      expect(screen.queryByRole('button', { name: 'Trying again…' })).toBeNull();
      await press(tryAgain());
      expect(trendingRequests()).toBe(3);
      // And once more, so it is a cycle and not a single extra life.
      await advance(PATIENCE);
      await press(tryAgain());
      expect(trendingRequests()).toBe(4);
    });

    it('lands whichever request answers first, and the earlier ones change nothing', async () => {
      renderHome();
      await advance(PATIENCE);
      const first = railAnswers.get('trending')!;
      await press(tryAgain());
      const second = railAnswers.get('trending')!;
      await advance(PATIENCE);
      await press(tryAgain());
      const third = railAnswers.get('trending')!;
      await act(async () => { third.resolve(catalogRail('trending', 3)); });
      expect(wrapperOf('trending').querySelectorAll('a.bs-card')).toHaveLength(3);
      await act(async () => {
        first.resolve(catalogRail('trending', 0));
        second.reject(new Error('socket hang up'));
      });
      expect(wrapperOf('trending').querySelectorAll('a.bs-card')).toHaveLength(3);
      expect(document.querySelector('.bs-hero')).toHaveAttribute('href', '/bigscreen/movie/100');
    });
  });

  describe('a superseded request', () => {
    // fetchRail turns ANY failure into an empty rail, so an old hung request that finally
    // errors (a half-open socket after the TV comes out of standby) would otherwise land as
    // "empty" on top of a retry that succeeded, and take the hero and the rail with it.
    async function retried() {
      renderHome();
      await advance(PATIENCE);
      const stale = railAnswers.get('trending')!;
      await press(tryAgain());
      return { stale, fresh: railAnswers.get('trending')! };
    }

    it('landing empty after a successful retry changes nothing on screen', async () => {
      const { stale, fresh } = await retried();
      await act(async () => { fresh.resolve(catalogRail('trending', 3)); });
      const focused = active();
      const before = document.body.innerHTML;
      await act(async () => { stale.resolve(catalogRail('trending', 0)); });
      expect(document.body.innerHTML).toBe(before);
      expect(active()).toBe(focused);
      expect(document.querySelector('.bs-hero')).toHaveAttribute('href', '/bigscreen/movie/100');
      expect(wrapperOf('trending').querySelectorAll('a.bs-card')).toHaveLength(3);
    });

    it('rejecting after a successful retry changes nothing either', async () => {
      const { stale, fresh } = await retried();
      await act(async () => { fresh.resolve(catalogRail('trending', 3)); });
      const before = document.body.innerHTML;
      await act(async () => { stale.reject(new Error('socket hang up')); });
      expect(document.body.innerHTML).toBe(before);
    });

    it('landing empty mid-retry does not flip the label back or admit another press', async () => {
      const { stale } = await retried();
      await act(async () => { stale.resolve(catalogRail('trending', 0)); });
      expect(trying()).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Loading…');
      await press(trying());
      expect(trendingRequests()).toBe(2);
    });

    it('landing with cards mid-retry is dropped too: only the current request counts', async () => {
      const { stale, fresh } = await retried();
      await act(async () => { stale.resolve(catalogRail('trending', 5)); });
      expect(wrapperOf('trending').querySelectorAll('a.bs-card')).toHaveLength(0);
      expect(trying()).toBeInTheDocument();
      await act(async () => { fresh.resolve(catalogRail('trending', 3)); });
      expect(wrapperOf('trending').querySelectorAll('a.bs-card')).toHaveLength(3);
    });

    it('also holds for a lazy rail that the retry reset while its request was out', async () => {
      renderHome();
      await observer().see('top-rated');
      const stale = railAnswers.get('top-rated')!;
      await advance(PATIENCE);
      await press(tryAgain());
      // The retry put top-rated back to watching. A late answer from before it must not
      // stand in for the request it replaced.
      await act(async () => { stale.resolve(catalogRail('top-rated', 4)); });
      expect(wrapperOf('top-rated').querySelectorAll('a.bs-card')).toHaveLength(0);
      expect(wrapperOf('top-rated').querySelector('.bs-skel')).not.toBeNull();
      await observer().see('top-rated');
      await answer('top-rated', 2);
      expect(wrapperOf('top-rated').querySelectorAll('a.bs-card')).toHaveLength(2);
    });
  });
});

describe('/bigscreen home: Back', () => {
  // Home is the root of this surface, so Back has nowhere to go. It is still claimed: handed
  // to the browser it would walk history, and the picker replaces itself with home.
  it.each([
    ['a remote that sends only a code', { key: 'Unidentified', keyCode: 461 }],
    ['Escape', { key: 'Escape' }],
    ['Backspace', { key: 'Backspace' }],
    ['XF86Back', { key: 'XF86Back' }],
  ])('does nothing visible, and claims the press: %s', async (_name, init) => {
    useProfile(BEN);
    renderHome();
    await answer('trending');
    const parked = active();
    // fireEvent returns false when the event was cancelled.
    expect(fireEvent.keyDown(window, init)).toBe(false);
    await settle();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(active()).toBe(parked);
  });

  it('claims no other key', async () => {
    renderHome();
    await answer('trending');
    expect(fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 })).toBe(true);
    expect(fireEvent.keyDown(window, { key: 'a', keyCode: 65 })).toBe(true);
  });

  describe('inside the webOS app', () => {
    // `bs:shell` is what the layout captured from the shell's `?from=app`. The global
    // beforeEach clears sessionStorage, so every row ABOVE this block is the browser case.
    const enterApp = () => sessionStorage.setItem('bs:shell', '1');
    /**
     * One macrotask, which is what the handler's `setTimeout(…, 0)` is waiting on.
     *
     * NOT `waitFor`. RTL's `waitFor` disables the React act environment for its duration, which
     * is this repository's recorded flake mechanism; and a poll would pass here even if the
     * note never arrived on the tick the production code actually uses.
     */
    const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 1)); });

    it('asks the window to close, which the browser case must never do', async () => {
      const close = vi.spyOn(window, 'close').mockImplementation(() => {});
      enterApp();
      useProfile(BEN);
      renderHome();
      await answer('trending');
      expect(fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 461 })).toBe(false);
      await settle();
      expect.soft(close).toHaveBeenCalledTimes(1);
      // Still a root: closing is leaving the app, never navigating inside it.
      expect.soft(router.push).not.toHaveBeenCalled();
      expect.soft(router.replace).not.toHaveBeenCalled();
      close.mockRestore();
    });

    it('tells the viewer which button works when the close is refused', async () => {
      // THE ROW THAT MATTERS, and the reason the handler is not just `window.close()`.
      // `close()` on a document the script did not open is refused outright in standard
      // Chromium, and whether webOS permits it for an app's own window is NOT KNOWN on this
      // set — device reading 39. This row renders what a viewer sees when the API does
      // nothing: a press that did nothing and said nothing is the state the browser case
      // already refuses, and it must not come back for the app case on the strength of an
      // untested API.
      //
      // EVERY ROW IN THIS BLOCK SPIES ON `close`, INCLUDING THE ONES THAT ASSERT IT IS NOT
      // CALLED. jsdom's `window.close()` is NOT a no-op — it tears the window down, and an
      // unspied call takes `document.body` away from every test that follows in the file
      // (measured: four cascading "Cannot read properties of undefined" failures).
      const close = vi.spyOn(window, 'close').mockImplementation(() => {});
      enterApp();
      useProfile(BEN);
      renderHome();
      await answer('trending');
      fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 461 });
      await tick();
      expect(screen.getByText('Press Home to leave Freeflix.')).toBeInTheDocument();
      close.mockRestore();
    });

    it('still says it under StrictMode, which is how the app runs in development', async () => {
      // `reactStrictMode: true` makes React mount, unmount and remount every component in dev.
      // A `mounted` ref that is only cleared on unmount is left false by that first simulated
      // unmount, and the note is dead for the whole dev session with every other row here
      // green — RTL does not use StrictMode unless asked. This row is the asking.
      const close = vi.spyOn(window, 'close').mockImplementation(() => {});
      enterApp();
      useProfile(BEN);
      render(
        <StrictMode>
          <HomePage />
        </StrictMode>,
      );
      await answer('trending');
      fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 461 });
      await tick();
      expect(screen.getByText('Press Home to leave Freeflix.')).toBeInTheDocument();
      close.mockRestore();
    });

    it('says nothing when the close works', async () => {
      // Non-vacuity for the row above: with a `close` that actually tears the document down,
      // the note must not flash on the way out. Modelled by unmounting inside the spy, which
      // is the closest jsdom has to a document being taken away.
      let unmountFn: (() => void) | null = null;
      const close = vi.spyOn(window, 'close').mockImplementation(() => { unmountFn?.(); });
      enterApp();
      useProfile(BEN);
      const view = renderHome();
      unmountFn = view.unmount;
      await answer('trending');
      fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 461 });
      await tick();
      expect.soft(close).toHaveBeenCalled();
      expect.soft(screen.queryByText('Press Home to leave Freeflix.')).toBeNull();
      close.mockRestore();
    });

    it('leaves the browser case exactly as it was', async () => {
      // The flag is absent (the global beforeEach cleared it). No close, no note, and the
      // press is still CLAIMED — handing it to the browser would walk history out of
      // (bigscreen), which a remote cannot recover from.
      const close = vi.spyOn(window, 'close').mockImplementation(() => {});
      useProfile(BEN);
      renderHome();
      await answer('trending');
      expect(fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 461 })).toBe(false);
      await tick();
      expect.soft(close, 'an ordinary tab must not try to close itself').not.toHaveBeenCalled();
      expect.soft(screen.queryByText('Press Home to leave Freeflix.')).toBeNull();
      close.mockRestore();
    });

    it('does not inherit the flag from the device store', async () => {
      // The decision in one row: shell-ness is a TAB fact. A desktop browser opened later at
      // the same address must not believe it is the app.
      const close = vi.spyOn(window, 'close').mockImplementation(() => {});
      localStorage.setItem('bs:shell', '1');
      useProfile(BEN);
      renderHome();
      await answer('trending');
      fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 461 });
      await tick();
      expect(close).not.toHaveBeenCalled();
      close.mockRestore();
    });
  });

  it('stops claiming Back once the screen is gone', async () => {
    const { unmount } = renderHome();
    await answer('trending');
    unmount();
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(true);
  });
});

describe('/bigscreen home: the top bar', () => {
  // It replaced a nav row that sat BETWEEN the hero and the first rail, on this screen and
  // on no other: everything except Home was two Downs and a Right away. The bar is row 0 on
  // every browsing screen, outside the scroller, and the ring still starts on the content.
  const barLinks = () => [...document.querySelectorAll<HTMLElement>('.bs-head__item')];

  it('is rendered with every target once home is up', async () => {
    renderHome();
    await answer('trending');
    expect(barLinks().map((l) => l.textContent)).toEqual([
      'Home',
      'Search',
      'My List',
      'Switch profile',
      'Diagnostics',
    ]);
  });

  it('marks the section the viewer is in, and marks exactly one', async () => {
    renderHome();
    await answer('trending');
    const current = barLinks().filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current.map((l) => l.textContent)).toEqual(['Home']);
  });

  it('leaves the hero with focus on mount: the bar is chrome, not the destination', async () => {
    renderHome();
    await answer('trending');
    expect(active()).toBe(document.querySelector('.bs-hero'));
  });

  it('is one UP from the hero, walkable left to right, and one Down is back to content', async () => {
    renderHome();
    await answer('trending');
    arrow('ArrowUp');
    expect(active()).toBe(barLinks()[0]);
    for (let i = 1; i < barLinks().length; i++) arrow('ArrowRight');
    expect(active()).toBe(barLinks().at(-1));
    arrow('ArrowRight'); // the end of the row: stays
    expect(active()).toBe(barLinks().at(-1));
    arrow('ArrowDown');
    expect(active()).toBe(document.querySelector('.bs-hero'));
  });

  it('is counted in the grid: every cell it draws is reachable and none is a dead press', async () => {
    renderHome();
    await answer('trending');
    arrow('ArrowUp');
    for (let i = 0; i < barLinks().length; i++) {
      expect(active()).toBe(barLinks()[i]);
      arrow('ArrowRight');
    }
  });

  it('is NOT where the ring lands while the first rail is still out', () => {
    // The recovery panel is the first content row and the fall-back prefers it, so the
    // viewer lands on something they can act on rather than on the menu.
    renderHome();
    expect(active()).toBe(panelWho());
    expect(barLinks().includes(active())).toBe(false);
  });

  it('sits outside the scroller, so it does not move with the rails', async () => {
    renderHome();
    await answer('trending');
    const bar = barLinks()[0].closest('header');
    expect(bar).not.toBeNull();
    expect(bar!.closest('.bs-shell__scroll'), 'in the shell head, not in the scroller').toBeNull();
  });

  it('saves its position under the new key', async () => {
    vi.useFakeTimers();
    renderHome();
    await answer('trending');
    arrow('ArrowUp');
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(JSON.parse(sessionStorage.getItem(SAVED_KEY)!)).toEqual({ row: 0, col: 0 });
    expect(sessionStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});
