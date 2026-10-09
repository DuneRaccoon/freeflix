import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { watchlistService, type WatchlistItem } from '@/services/watchlist';
import { useTvProfile } from '../../_data/useTvProfile';
import MyListPage from './page';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../../_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));
vi.mock('@/services/watchlist', () => ({
  watchlistService: { list: vi.fn(), remove: vi.fn(), add: vi.fn(), update: vi.fn() },
}));

// `_data/watchlistRow` and `_data/rails` are deliberately NOT mocked: which rows become
// cards, and the route each card points at, are what most of these assertions are about,
// and a second copy of those rules on this screen is how the two would drift.

const list = vi.mocked(watchlistService.list);
const removeItem = vi.mocked(watchlistService.remove);
const profileHook = vi.mocked(useTvProfile);
const clear = vi.fn();

// --- fixtures ---------------------------------------------------------------------

const entry = (over: Partial<WatchlistItem> = {}): WatchlistItem => ({
  id: 'w1',
  user_id: 'p1',
  content_id: 'movie:603',
  tmdb_id: '603',
  media_type: 'movie',
  title: 'The Matrix',
  poster_url: 'https://img.test/p.jpg',
  year: 1999,
  vote_average: 8.2,
  added_at: '2026-10-01T00:00:00',
  created_at: '2026-10-01T00:00:00',
  ...over,
});

/** `n` distinct rows. Titles are distinct because focus assertions read them. */
const manyRows = (n: number): WatchlistItem[] =>
  Array.from({ length: n }, (_, i) =>
    entry({
      id: `w${i + 1}`,
      tmdb_id: String(i + 1),
      content_id: `movie:${i + 1}`,
      title: `Film ${i + 1}`,
    }),
  );

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

// --- helpers ----------------------------------------------------------------------

/** Everything a remote, a Tab key or a magic-remote pointer could stop on. */
const FOCUS_STOPS = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';
const cells = () => Array.from(document.querySelectorAll('[tabindex]'));
const stops = () => Array.from(document.querySelectorAll(FOCUS_STOPS));
const cards = () => Array.from(document.querySelectorAll<HTMLAnchorElement>('.bs-card'));
const cardTitles = () => cards().map((c) => c.querySelector('.bs-card__label')?.textContent);
const badges = () => cards().map((c) => c.querySelector('.bs-card__badge')?.textContent ?? null);
const rowContainers = () => Array.from(document.querySelectorAll('.bs-list__row'));

const arrow = (k: string) => fireEvent.keyDown(window, { key: k });
const back = () => fireEvent.keyDown(window, { key: 'Backspace' });
const modeToggle = () => screen.getByRole('button', { name: /^(Remove items|Done)$/ });
const ringText = () => document.activeElement?.textContent ?? null;

/** Press a card the way a remote does: a discrete OK, then the activation it produces. */
async function pressCard(el: Element, { repeat = false } = {}) {
  fireEvent.keyDown(el, { key: 'Enter', repeat });
  await act(async () => {
    fireEvent.click(el);
  });
}

async function mount(rows: WatchlistItem[] = manyRows(3)) {
  list.mockResolvedValue(rows);
  const view = render(<MyListPage />);
  await screen.findByRole('heading', { level: 1, name: 'My List' });
  // The ring is placed by a PASSIVE effect (`useFocusGrid`'s reconciliation), which React
  // schedules rather than running in the commit — so it can land a tick after the heading
  // does. Waiting only for the markup made every ring assertion below a race that failed
  // about once in twenty runs, and only under load. Settling it here instead of per test
  // also means every mount in this file asserts the screen's one invariant on arrival.
  await waitFor(() => expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1));
  return view;
}

async function enterRemoveMode() {
  await act(async () => {
    fireEvent.click(modeToggle());
  });
}

/**
 * Walk the WHOLE grid with the arrows, asserting the focus model's two load-bearing
 * invariants after every single press:
 *
 *  - exactly one rendered cell is in the tab order, and it is the one with DOM focus. A row
 *    whose declared count is one too HIGH leaves a phantom cell: the model focuses a
 *    (row, col) no element claims, so no rendered cell carries the ring and a remote — with
 *    no Tab key and no pointer — cannot recover.
 *  - every rendered cell is reached. A count one too LOW makes the last cell unreachable:
 *    `move` clamps to the declared count, so the arrows can never put the ring on it.
 *
 * Returns the cells it reached, for the caller to compare against what is rendered. A
 * future layout that outgrows ROWS/COLS fails that comparison rather than passing vacuously.
 */
function walkTheGrid(label: string): Set<Element> {
  const visited = new Set<Element>();
  const record = (where: string) => {
    const inTabOrder = document.querySelectorAll('[tabindex="0"]');
    expect(inTabOrder, `${label}: ${where}`).toHaveLength(1);
    expect(inTabOrder[0], `${label}: ${where} — the ring is on the focused element`).toBe(
      document.activeElement,
    );
    visited.add(inTabOrder[0]);
  };
  record('on arrival');
  // More presses than the screen has rows and columns: the action row plus at most a few
  // card rows, and six cards in a full row.
  const ROWS = 8;
  const COLS = 10;
  for (let i = 0; i < ROWS; i++) arrow('ArrowUp');
  record('at the top');
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      arrow('ArrowRight');
      record(`row ${r}, right x${c + 1}`);
    }
    for (let c = 0; c < COLS; c++) {
      arrow('ArrowLeft');
      record(`row ${r}, left x${c + 1}`);
    }
    arrow('ArrowDown');
    record(`down x${r + 1}`);
  }
  return visited;
}

function expectEveryCellReachable(label: string) {
  const visited = walkTheGrid(label);
  const rendered = cells();
  // No focus stop may sit outside the grid: one added without focus props would be
  // reachable by a magic-remote pointer and invisible to the arrows.
  expect(stops(), `${label}: every stop has focus props`).toHaveLength(rendered.length);
  expect(visited.size, `${label}: cells reached vs cells rendered`).toBe(rendered.length);
  for (const el of rendered) {
    expect(visited.has(el), `${label}: unreachable cell "${el.textContent}"`).toBe(true);
  }
}

/**
 * A card in normal mode is an ordinary `<a href>`, and jsdom answers an unprevented click on
 * one with `Error: Not implemented: navigation` on a timer — which lands in whichever test
 * happens to be running by then and buries a real failure in noise. Swallowed on `window`,
 * i.e. in the bubble phase after React's root handler, so every handler under test has
 * already run. It is not asserted on: `Card.test.tsx` is where the preventDefault contract
 * lives.
 */
const swallowNavigation = (e: MouseEvent) => e.preventDefault();

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.addEventListener('click', swallowNavigation);
  profileHook.mockReturnValue({
    profile: { id: 'p1', display_name: 'Ben', avatar: null },
    loading: false,
    select: vi.fn(),
    clear,
  });
  list.mockResolvedValue([]);
  removeItem.mockResolvedValue(undefined);
});

afterEach(() => {
  window.removeEventListener('click', swallowNavigation);
  vi.useRealTimers();
});

describe('My List screen', () => {
  describe('loading the list', () => {
    it('asks the watchlist endpoint for the selected profile', async () => {
      await mount(manyRows(1));
      expect(list.mock.calls).toEqual([['p1']]);
    });

    it('shows every row, uncapped — the full list is the point of this screen', async () => {
      // Home's rail stops at RAIL_CAP = 20 because 150 anchors in one horizontal track is
      // unusable on a remote. This screen is where the rest of them live, so the cap must
      // NOT be applied here; the endpoint answers at most 200 rows with no paging.
      await mount(manyRows(25));
      expect(cards()).toHaveLength(25);
      expect(cardTitles()[24]).toBe('Film 25');
    });

    it('lays the cards out six to a row, with a short last row', async () => {
      // The focus model's rows ARE these containers: a row that wrapped would put Right on
      // a card the viewer sees on the next line and make Down skip a visual line.
      await mount(manyRows(7));
      expect(rowContainers().map((r) => r.querySelectorAll('.bs-card').length)).toEqual([6, 1]);
    });

    it('routes a movie to the movie screen and a show to the show screen', async () => {
      await mount([
        entry({ tmdb_id: '603', media_type: 'movie', title: 'The Matrix' }),
        entry({ id: 'w2', tmdb_id: '1399', media_type: 'tv', content_id: 'tv:1399', title: 'Thrones' }),
      ]);
      expect(cards().map((c) => c.getAttribute('href'))).toEqual([
        '/bigscreen/movie/603',
        '/bigscreen/show/1399',
      ]);
    });

    it('drops a row whose media_type is neither movie nor tv, rather than routing it to /movie', async () => {
      // Nothing upstream constrains it: the backend field is a bare `str` and
      // `@/lib/watchlist/toCatalogItem` CASTS rather than validates (`??` catches only null
      // and undefined). `catalogItemToCard` sends anything that is not 'tv' to
      // /bigscreen/movie/{id}, whose getDetail then 404s — a card the viewer pressed that
      // dead-ends, which is the stage-4 Critical's exact shape. This screen is the most
      // exposed consumer because it shows all ~200 rows. The NaN test below does NOT cover
      // it: those rows fail a different clause of the guard.
      await mount([
        entry({ id: 'w1', tmdb_id: '300', media_type: 'person', title: 'Some Person' }),
        entry({ id: 'w2', tmdb_id: '5', media_type: 'movie', title: 'Fine' }),
      ]);
      expect(cardTitles()).toEqual(['Fine']);
      expect(cards().map((c) => c.getAttribute('href'))).toEqual(['/bigscreen/movie/5']);
    });

    it('drops a row whose tmdb_id is not a number, rather than linking to /NaN', async () => {
      await mount([
        entry({ id: 'w1', tmdb_id: 'abc', title: 'Broken' }),
        entry({ id: 'w2', tmdb_id: '5', title: 'Fine' }),
        null as unknown as WatchlistItem,
      ]);
      expect(cardTitles()).toEqual(['Fine']);
    });

    it('keeps a focus target while it is loading', async () => {
      list.mockReturnValue(new Promise(() => {}));
      render(<MyListPage />);
      await waitFor(() => expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1));
      expect(document.activeElement).toBe(document.querySelector('[tabindex="0"]'));
      expect(cards()).toHaveLength(0);
    });

    it('keeps a focus target, and a retry, when the load fails', async () => {
      list.mockRejectedValue(httpError(500));
      render(<MyListPage />);
      await screen.findByRole('heading', { level: 1, name: /Couldn’t load this list/ });
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      const retry = screen.getByRole('button', { name: 'Try again' });
      list.mockResolvedValue(manyRows(1));
      await act(async () => {
        fireEvent.click(retry);
      });
      expect(cardTitles()).toEqual(['Film 1']);
    });

    it('reads a junk 200 as a failure, not as an empty list', async () => {
      // "Your list is empty" is a claim about the viewer's data; a response this screen
      // could not read is not evidence for it.
      list.mockResolvedValue('not an array' as unknown as WatchlistItem[]);
      render(<MyListPage />);
      await screen.findByRole('heading', { level: 1, name: /Couldn’t load this list/ });
      expect(screen.queryByText(/Nothing in My List yet/)).toBeNull();
    });
  });

  describe('a locked profile', () => {
    it('clears the profile and replaces to the picker on a 423', async () => {
      list.mockRejectedValue(httpError(423));
      render(<MyListPage />);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/bigscreen/profiles'));
      expect(clear).toHaveBeenCalled();
    });

    it('never reads as an empty list — 423 means locked, not empty', async () => {
      // Review Focus 4. Telling someone their list is empty when it is merely locked is a
      // lie about their data, and they would have no reason to go and unlock it.
      list.mockRejectedValue(httpError(423));
      render(<MyListPage />);
      await waitFor(() => expect(router.replace).toHaveBeenCalled());
      expect(screen.queryByText(/Nothing in My List yet/)).toBeNull();
      expect(screen.queryByRole('heading', { level: 1, name: 'My List' })).toBeNull();
      // And whatever it is showing while the replace lands still has a ring.
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    });

    it('sends the viewer to the picker when a REMOVAL answers 423', async () => {
      await mount(manyRows(2));
      await enterRemoveMode();
      removeItem.mockRejectedValue(httpError(423));
      await pressCard(cards()[0]);
      expect(clear).toHaveBeenCalled();
      expect(router.replace).toHaveBeenCalledWith('/bigscreen/profiles');
    });
  });

  describe('no profile selected', () => {
    it('says so, offers the picker, and asks the watchlist for nothing', async () => {
      profileHook.mockReturnValue({ profile: null, loading: false, select: vi.fn(), clear });
      render(<MyListPage />);
      const picker = await screen.findByRole('link', { name: /Who’s watching/ });
      expect(picker).toHaveAttribute('href', '/bigscreen/profiles');
      expect(list).not.toHaveBeenCalled();
      expect(screen.queryByText(/Nothing in My List yet/)).toBeNull();
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      expect(document.activeElement).toBe(picker);
    });

    it('waits for the stored profile rather than asking as nobody', async () => {
      profileHook.mockReturnValue({ profile: null, loading: true, select: vi.fn(), clear });
      render(<MyListPage />);
      await waitFor(() => expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1));
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe('an empty list', () => {
    it('reads as empty, keeps a focus target, and offers no remove mode', async () => {
      // A toggle with nothing to remove would be a focus stop whose press does nothing,
      // which this surface's rules forbid.
      await mount([]);
      expect(screen.getByText(/Nothing in My List yet/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove items' })).toBeNull();
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/bigscreen');
    });
  });

  describe('remove mode', () => {
    it('is off on arrival: a card press removes nothing', async () => {
      await mount(manyRows(2));
      expect(modeToggle()).toHaveTextContent('Remove items');
      await pressCard(cards()[0]);
      expect(removeItem).not.toHaveBeenCalled();
      expect(cards()).toHaveLength(2);
      // Still an ordinary link to the detail screen.
      expect(cards()[0]).toHaveAttribute('href', '/bigscreen/movie/1');
    });

    it('marks EVERY card, not just the toggle', async () => {
      // The viewer's eye is on the card they are about to press, not on the action row. A
      // press that deletes when they expected it to open is the worst thing this screen
      // can do.
      await mount(manyRows(3));
      expect(badges()).toEqual([null, null, null]);
      await enterRemoveMode();
      expect(modeToggle()).toHaveTextContent('Done');
      expect(badges()).toEqual(['Remove', 'Remove', 'Remove']);
      expect(screen.getByRole('status')).toHaveTextContent(/Press a title to remove it/);
    });

    it('is left again by pressing Done, and the marks go with it', async () => {
      await mount(manyRows(2));
      await enterRemoveMode();
      await act(async () => {
        fireEvent.click(modeToggle());
      });
      expect(modeToggle()).toHaveTextContent('Remove items');
      expect(badges()).toEqual([null, null]);
      await pressCard(cards()[0]);
      expect(removeItem).not.toHaveBeenCalled();
    });

    it('does not survive leaving the screen', async () => {
      // Arriving in a mode where OK deletes, because of something done on a previous
      // visit, is the ambush this guards against. Nothing about the mode is persisted.
      const view = await mount(manyRows(2));
      await enterRemoveMode();
      expect(badges()).toEqual(['Remove', 'Remove']);
      view.unmount();
      await mount(manyRows(2));
      expect(badges()).toEqual([null, null]);
      expect(modeToggle()).toHaveTextContent('Remove items');
    });
  });

  describe('removing a title', () => {
    it('takes it off the list before the request answers, and asks once', async () => {
      const slow = deferred<void>();
      removeItem.mockReturnValue(slow.promise);
      await mount(manyRows(3));
      await enterRemoveMode();
      await pressCard(cards()[1]);
      expect(cardTitles()).toEqual(['Film 1', 'Film 3']);
      expect(removeItem.mock.calls).toEqual([['p1', 'movie:2']]);
      await act(async () => {
        slow.resolve();
      });
      expect(cardTitles()).toEqual(['Film 1', 'Film 3']);
      expect(removeItem).toHaveBeenCalledTimes(1);
    });

    it('puts it back where it was, and says so, when the request fails', async () => {
      removeItem.mockRejectedValue(httpError(500));
      await mount(manyRows(3));
      await enterRemoveMode();
      await pressCard(cards()[1]);
      expect(cardTitles()).toEqual(['Film 1', 'Film 2', 'Film 3']);
      expect(screen.getByRole('status')).toHaveTextContent(/Couldn’t remove “Film 2”/);
      expect(router.replace).not.toHaveBeenCalled();
    });

    it('treats a 404 as success: the title is already gone, which is what was asked for', async () => {
      // Settled by `bigscreen/movie/[id]/page.tsx`, which treats 409-on-add and
      // 404-on-remove the same way: the list is what the viewer asked for.
      removeItem.mockRejectedValue(httpError(404));
      await mount(manyRows(2));
      await enterRemoveMode();
      await pressCard(cards()[0]);
      expect(cardTitles()).toEqual(['Film 2']);
      expect(screen.queryByText(/Couldn’t remove/)).toBeNull();
    });

    it('drops the repeats from a held OK button', async () => {
      // A held key auto-repeats, and in remove mode every repeat would take another title
      // off the list — each a DIFFERENT one, because the cards shift up under the ring.
      // `useBackKey` refuses a repeat for the same reason (Back is an escalation).
      await mount(manyRows(3));
      await enterRemoveMode();
      await pressCard(cards()[0], { repeat: true });
      expect(removeItem).not.toHaveBeenCalled();
      expect(cardTitles()).toEqual(['Film 1', 'Film 2', 'Film 3']);
      // And the next discrete press works.
      await pressCard(cards()[0]);
      expect(removeItem).toHaveBeenCalledTimes(1);
    });

    it('removes the title that is under the ring after the list has shifted', async () => {
      await mount(manyRows(3));
      await enterRemoveMode();
      await pressCard(cards()[1]);
      expect(cardTitles()).toEqual(['Film 1', 'Film 3']);
      // The second cell now holds Film 3; pressing it must remove Film 3, not Film 2 again.
      await pressCard(cards()[1]);
      expect(removeItem.mock.calls).toEqual([
        ['p1', 'movie:2'],
        ['p1', 'movie:3'],
      ]);
      expect(cardTitles()).toEqual(['Film 1']);
    });
  });

  describe('focus when the list shrinks under the ring', () => {
    /** Put the ring on the card at `flat`, in remove mode. */
    async function ringOn(flat: number, count: number) {
      await mount(manyRows(count));
      await enterRemoveMode();
      arrow('ArrowDown');
      for (let i = 0; i < Math.floor(flat / 6); i++) arrow('ArrowDown');
      for (let i = 0; i < flat % 6; i++) arrow('ArrowRight');
      expect(ringText(), 'the ring must start on the card we are about to press').toContain(
        `Film ${flat + 1}`,
      );
    }

    it('from the middle: the ring lands on the title that took its place', async () => {
      await ringOn(1, 4);
      await pressCard(document.activeElement!);
      expect(cardTitles()).toEqual(['Film 1', 'Film 3', 'Film 4']);
      expect(ringText()).toContain('Film 3');
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      expect(document.activeElement).toBe(document.querySelector('[tabindex="0"]'));
    });

    it('the last card of the last row: the ring lands on the new last card', async () => {
      // Seven cards are a full row of six and a second row of one. Removing that one
      // removes the whole second row, so the ring's row stops existing.
      await ringOn(6, 7);
      expect(rowContainers()).toHaveLength(2);
      await pressCard(document.activeElement!);
      expect(cards()).toHaveLength(6);
      expect(rowContainers()).toHaveLength(1);
      expect(ringText()).toContain('Film 6');
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      expect(document.activeElement).toBe(document.querySelector('[tabindex="0"]'));
      expectEveryCellReachable('after the last row went');
    });

    it('the last card in the list: the ring lands on the empty state', async () => {
      // There is no card left to hold it, and the toggle itself unmounts, so the empty
      // state has to carry a focus target of its own.
      await ringOn(0, 1);
      await pressCard(document.activeElement!);
      expect(cards()).toHaveLength(0);
      expect(screen.getByText(/Nothing in My List yet/)).toBeInTheDocument();
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Back to home' }));
      expectEveryCellReachable('empty after the last removal');
    });

    it('puts the ring back on the restored card when the removal fails', async () => {
      removeItem.mockRejectedValue(httpError(500));
      await ringOn(1, 3);
      await pressCard(document.activeElement!);
      expect(cardTitles()).toEqual(['Film 1', 'Film 2', 'Film 3']);
      // Cells are keyed by index, so the ring never left this slot — and the slot holds the
      // restored title again, which is the one the viewer was looking at.
      expect(ringText()).toContain('Film 2');
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      expect(document.activeElement).toBe(document.querySelector('[tabindex="0"]'));
    });
  });

  describe('the focus grid', () => {
    it('declares exactly as many cells as it renders, with a full list', async () => {
      await mount(manyRows(7));
      // One action row of two, then six cards and one.
      expect(cells()).toHaveLength(2 + 7);
      expectEveryCellReachable('loaded');
    });

    it('declares exactly as many cells as it renders with an empty list', async () => {
      await mount([]);
      expect(cells()).toHaveLength(1);
      expectEveryCellReachable('empty');
    });

    it('declares exactly as many cells as it renders in remove mode', async () => {
      await mount(manyRows(7));
      await enterRemoveMode();
      expect(cells()).toHaveLength(2 + 7);
      expectEveryCellReachable('remove mode');
    });

    it('declares exactly as many cells as it renders after a removal', async () => {
      await mount(manyRows(7));
      await enterRemoveMode();
      await pressCard(cards()[0]);
      expect(cards()).toHaveLength(6);
      expect(cells()).toHaveLength(2 + 6);
      expectEveryCellReachable('after a removal');
    });

    it('opens with the ring on the first action, not on a card', async () => {
      await mount(manyRows(3));
      expect(document.activeElement).toBe(modeToggle());
    });
  });

  describe('coming back to the screen', () => {
    it('brings the ring back to the cell it was left on', async () => {
      // Back on a detail screen is `router.push('/bigscreen')`, so coming back here is a
      // fresh mount — and dumping the viewer at the first cell of a 200-item grid is the
      // retrofit search has just had to make.
      const view = await mount(manyRows(7));
      arrow('ArrowDown');
      arrow('ArrowRight');
      arrow('ArrowRight');
      const left = ringText();
      expect(left).toContain('Film 3');
      view.unmount();
      await mount(manyRows(7));
      expect(ringText()).toBe(left);
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    });

    it('renders when sessionStorage is unavailable', async () => {
      // It throws on access on a TV in a restricted mode and comes back empty in a private
      // window. Losing a remembered ring position is harmless; a screen that will not
      // render is not.
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('denied');
      });
      try {
        await mount(manyRows(3));
        expect(cardTitles()).toEqual(['Film 1', 'Film 2', 'Film 3']);
        expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
        await enterRemoveMode();
        await pressCard(cards()[0]);
        expect(cardTitles()).toEqual(['Film 2', 'Film 3']);
      } finally {
        get.mockRestore();
        set.mockRestore();
      }
    });
  });

  describe('Back', () => {
    it('goes home', async () => {
      await mount(manyRows(2));
      back();
      expect(router.push).toHaveBeenCalledWith('/bigscreen');
    });

    it('goes home from the empty list and from a failure too', async () => {
      await mount([]);
      back();
      expect(router.push).toHaveBeenCalledWith('/bigscreen');
      vi.clearAllMocks();
      list.mockRejectedValue(httpError(500));
      render(<MyListPage />);
      await screen.findByRole('heading', { level: 1, name: /Couldn’t load this list/ });
      back();
      expect(router.push).toHaveBeenCalledWith('/bigscreen');
    });
  });

  describe('an answer that is no longer current', () => {
    it('does not let a slow load replace a newer one', async () => {
      // `apiClient` sets no timeout, so the window between a request and its answer is
      // unbounded. The stage-4 shape was the other direction: a hung request erroring
      // after a successful retry wiped what was on screen.
      vi.useFakeTimers();
      const first = deferred<WatchlistItem[]>();
      const second = deferred<WatchlistItem[]>();
      list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      render(<MyListPage />);
      // The patience timer offers a retry for a load that is taking too long.
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      });
      await act(async () => {
        second.resolve(manyRows(1));
      });
      expect(cardTitles()).toEqual(['Film 1']);
      await act(async () => {
        first.resolve([entry({ id: 'stale', tmdb_id: '99', content_id: 'movie:99', title: 'Stale' })]);
      });
      expect(cardTitles()).toEqual(['Film 1']);
    });

    it('survives a removal that fails after the viewer has left', async () => {
      // Disclosed: this one proves nothing about the mounted latch. React 19 neither warns
      // nor throws on a setState after unmount, so removing the latch changes nothing
      // observable here. It is a regression test for "it does not throw", no more.
      const slow = deferred<void>();
      removeItem.mockReturnValue(slow.promise);
      const view = await mount(manyRows(2));
      await enterRemoveMode();
      await pressCard(cards()[0]);
      view.unmount();
      await act(async () => {
        slow.reject(httpError(500));
      });
      expect(document.querySelector('.bs-card')).toBeNull();
    });

    it('does not forget the profile for a 423 that lands after the viewer has left', async () => {
      // This is the half of the latch that IS observable, and it is the one that matters:
      // a late lock would clear the stored profile and pull the viewer off whatever screen
      // they went to — worse than a stray navigation, because it silently loses something
      // they chose.
      const slow = deferred<void>();
      removeItem.mockReturnValue(slow.promise);
      const view = await mount(manyRows(2));
      await enterRemoveMode();
      await pressCard(cards()[0]);
      view.unmount();
      await act(async () => {
        slow.reject(httpError(423));
      });
      expect(clear).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
    });
  });
});
