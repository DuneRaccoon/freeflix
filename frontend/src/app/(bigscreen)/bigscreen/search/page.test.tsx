import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { CatalogItem, CatalogPage } from '@/types';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { HEADER_CELLS } from '../../_components/Header';
import { KEYBOARD_ROW_COUNTS } from '../../_components/Keyboard';
import { TYPING_PAUSE_MS } from '../../_data/searchQuery';
import { RESULT_COLUMNS } from '../../_data/searchPaging';
import SearchPage from './page';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/bigscreen/search' }));
vi.mock('@/services/movies', () => ({ moviesService: { search: vi.fn() } }));
vi.mock('@/services/tv', () => ({ tvService: { search: vi.fn() } }));

// `@/lib/mergeCatalog` is deliberately NOT mocked: the merge/dedupe/sort rules are what the
// results assertions are about, and that module already has its own tests. A second copy of
// it on this surface is how the two would drift.

const movieSearch = vi.mocked(moviesService.search);
const tvSearch = vi.mocked(tvService.search);

// --- fixtures ---------------------------------------------------------------------

const item = (over: Partial<CatalogItem> & { tmdb_id: number; title: string }): CatalogItem => ({
  media_type: 'movie',
  year: 2020,
  overview: null,
  poster_url: null,
  backdrop_url: null,
  genre_ids: [],
  genres: [],
  vote_average: 0,
  vote_count: 0,
  popularity: 1,
  original_language: 'en',
  ...over,
});
const page = (results: CatalogItem[]): CatalogPage => ({
  page: 1,
  results,
  total_pages: 1,
  total_results: results.length,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// --- helpers ----------------------------------------------------------------------

/** Everything a remote, a Tab key or a magic-remote pointer could stop on. */
const FOCUS_STOPS = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';
const cells = () => Array.from(document.querySelectorAll('[tabindex]'));
const stops = () => Array.from(document.querySelectorAll(FOCUS_STOPS));
const KEY_CELLS = KEYBOARD_ROW_COUNTS.reduce((a, b) => a + b, 0);
/**
 * The top bar's own row, which every browsing screen now carries. Counted from the component
 * rather than written as a number, so adding an item to the menu moves these expectations
 * with it instead of reddening every count on the screen.
 */
const BAR_CELLS = HEADER_CELLS;
/**
 * The action row: the Search key, and nothing else, in every state.
 *
 * It was 2 when a permanent "Back to home" link sat beside it (that way home is in the bar
 * now), and 2-when-there-are-results when `Go to N results` was appended. With the split the
 * results are one Right press from the keyboard, so that cell bought nothing and is gone.
 */
const ACTION_CELLS = 1;

const arrow = (k: string) => fireEvent.keyDown(window, { key: k });
const back = () => fireEvent.keyDown(window, { key: 'Backspace' });
const key = (name: string) => screen.getByRole('button', { name });
const typeIn = (text: string) => {
  for (const ch of text) fireEvent.click(key(ch === ' ' ? 'Space' : ch));
};
/**
 * Press Right until the ring is in the results, and no further.
 *
 * A fixed count overshoots: the first keyboard row has 7 cells, so the 7th Right crosses
 * and the 8th and 9th walk ACROSS the results row. Every one of these assertions is about
 * where the crossing LANDS, so it has to stop on arrival.
 */
const crossIntoResults = () => {
  for (let i = 0; i < 14; i++) {
    if (document.activeElement?.classList.contains('bs-card')) return;
    arrow('ArrowRight');
  }
};
const searchKey = () => screen.getByRole('button', { name: 'Search' });
const pressSearch = async () => {
  await act(async () => {
    fireEvent.click(searchKey());
  });
};
const cards = () => Array.from(document.querySelectorAll<HTMLAnchorElement>('.bs-card'));
const cardTitles = () => cards().map((c) => c.querySelector('.bs-card__label')?.textContent);
const queryText = () => document.querySelector('.bs-search__query')?.textContent;

/**
 * Walk the WHOLE grid with the arrows, asserting the focus model's two load-bearing
 * invariants after every single press:
 *
 *  - exactly one rendered cell is in the tab order, and it is the one with DOM focus. A row
 *    whose declared count is one too HIGH leaves a phantom cell: the model focuses a
 *    (row, col) no element claims, so no rendered cell has `tabindex="0"` and the remote has
 *    no ring at all.
 *  - every rendered cell is reached. A row whose declared count is one too LOW makes the
 *    last cell unreachable: `move` clamps to the declared count, so the arrows can never
 *    put the ring on it.
 *
 * Returns the set of cells it reached, for the caller to compare against what is rendered.
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
  // More presses than either pane has rows, and than the widest row of either has cells.
  const ROWS = 12;
  const COLS = 12;

  /**
   * TWO SWEEPS, because the screen is two panes rather than one column.
   *
   * Sweep A is the original serpentine and covers the bar and the left pane: Right to the
   * end of a row, Left back to its start, Down. It also wanders into the first results row
   * and back, which is harmless.
   *
   * Sweep B covers the right pane, and the shape it has is forced by one fact: in the right
   * pane a Left press at column 0 CROSSES BACK to the keyboard, so a bounded left-walk
   * cannot be written without knowing each row's width (a short last row makes column 0 the
   * last column too). So it lets the cross happen and comes back: Left until it leaves,
   * Right until it has re-entered and reached the end of the row it left, then Down to the
   * next one. Each pass covers one results row in both directions and advances by one.
   *
   * The first version of this walk did Right/Left/Down once from the top left and reached 34
   * of 45 cells while asserting it had reached them all — it always ended a pass in the LEFT
   * pane, so every results row after the first was unreachable, and it got stuck on the
   * action row at the bottom.
   */
  for (let i = 0; i < ROWS; i++) arrow('ArrowUp');
  for (let i = 0; i < COLS; i++) arrow('ArrowLeft');
  record('at the top left');
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      arrow('ArrowRight');
      record(`A: row ${r}, right x${c + 1}`);
    }
    for (let c = 0; c < COLS; c++) {
      arrow('ArrowLeft');
      record(`A: row ${r}, left x${c + 1}`);
    }
    arrow('ArrowDown');
    record(`A: down x${r + 1}`);
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      arrow('ArrowLeft');
      record(`B: row ${r}, left x${c + 1}`);
    }
    for (let c = 0; c < COLS; c++) {
      arrow('ArrowRight');
      record(`B: row ${r}, right x${c + 1}`);
    }
    arrow('ArrowDown');
    record(`B: down x${r + 1}`);
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

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  // RECENT SEARCHES OUTLIVE THE SESSION on purpose (`_data/recentSearches` uses
  // localStorage, because typing a title on a D-pad is about fifty presses and a household
  // searches for the same handful of shows). So they outlive a TEST too: without this, a row
  // that searched for "A" leaves a recent-search button named "A" on every later row's
  // screen, colliding with the keyboard key of the same name.
  localStorage.clear();
  movieSearch.mockResolvedValue(page([]));
  tvSearch.mockResolvedValue(page([]));
});

describe('search screen', () => {
  it('opens with the keyboard focused and an empty query', () => {
    render(<SearchPage />);
    expect(document.activeElement).toBe(key('A'));
    expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(queryText()).toMatch(/Type a title/);
  });

  it('has no <input>: the keyboard is the only input path', () => {
    // A real input takes DOM focus and fights the roving-tabindex grid for it, and webOS
    // raises its own IME panel over the app when one is focused.
    render(<SearchPage />);
    expect(document.querySelector('input')).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector('[contenteditable]')).toBeNull();
  });

  it('builds the query from key presses, and Delete and Clear unbuild it', () => {
    render(<SearchPage />);
    typeIn('BAT');
    expect(queryText()).toBe('BAT');
    fireEvent.click(key('Delete'));
    expect(queryText()).toBe('BA');
    typeIn('T 2');
    expect(queryText()).toBe('BAT 2');
    fireEvent.click(key('Clear'));
    expect(queryText()).toMatch(/Type a title/);
  });

  it('does not search per keystroke: typing asks nothing until the viewer stops', async () => {
    // THE RULE THAT SURVIVED THE REWRITE. Nine requests for a nine-letter title is what a
    // television's network cannot afford, and that has not changed — what changed is that
    // the SEARCH no longer waits for a trip to a button six rows away. A pause is the same
    // intent, expressed by stopping.
    render(<SearchPage />);
    typeIn('BATMAN');
    expect(movieSearch, 'nothing while the keys are still coming').not.toHaveBeenCalled();
    expect(tvSearch).not.toHaveBeenCalled();
    await pressSearch();
    expect(movieSearch).toHaveBeenCalledTimes(1);
    expect(tvSearch).toHaveBeenCalledTimes(1);
  });

  describe('the typing pause', () => {
    // Fake timers only in here: every other row in this file drives the screen through
    // presses and `await`, and a fake clock would make those wait for something nobody
    // advances.
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const pause = async (ms = TYPING_PAUSE_MS) => {
      await act(async () => {
        vi.advanceTimersByTime(ms);
      });
    };

    it('searches once the keys stop, with no press at all', async () => {
      render(<SearchPage />);
      typeIn('BAT');
      expect(movieSearch).not.toHaveBeenCalled();
      await pause();
      expect(movieSearch.mock.calls).toEqual([['BAT', 1]]);
      expect(tvSearch.mock.calls).toEqual([['BAT', 1]]);
    });

    it('costs ONE request for a whole word, not one per letter', async () => {
      // The cleanup cancels the pending timer on every keystroke, which is the whole of the
      // debounce: a held key repeats many times a second and the grid has no `e.repeat`
      // guard.
      render(<SearchPage />);
      for (const ch of 'BATMAN') {
        fireEvent.click(key(ch));
        await pause(TYPING_PAUSE_MS - 50);
      }
      expect(movieSearch, 'nothing has gone out yet').not.toHaveBeenCalled();
      await pause();
      expect(movieSearch.mock.calls).toEqual([['BATMAN', 1]]);
    });

    it('waits for a query worth asking about', async () => {
      // Two characters match a large fraction of the catalog and the answer is useless.
      render(<SearchPage />);
      typeIn('BA');
      await pause(TYPING_PAUSE_MS * 4);
      expect(movieSearch).not.toHaveBeenCalled();
      // ...and a viewer who really wants it presses Search.
      await pressSearch();
      expect(movieSearch.mock.calls).toEqual([['BA', 1]]);
    });

    it('does not re-ask for a query it has already asked about', async () => {
      render(<SearchPage />);
      typeIn('BAT');
      await pause();
      expect(movieSearch).toHaveBeenCalledTimes(1);
      // A re-render for any other reason must not spend a second request.
      await pause(TYPING_PAUSE_MS * 4);
      expect(movieSearch).toHaveBeenCalledTimes(1);
    });

    it('does not retry a FAILED search for ever', async () => {
      // THE LOOP THIS ROW EXISTS FOR. A failure leaves the query unchanged, so the condition
      // that armed the timer is still true — without the record of what has already been
      // ASKED, the screen hammers a dead box until the viewer leaves. `lastAuto` is that
      // record, and it is set for an asked query whatever the answer turns out to be.
      movieSearch.mockRejectedValue(new Error('offline'));
      tvSearch.mockRejectedValue(new Error('offline'));
      render(<SearchPage />);
      typeIn('BAT');
      await pause();
      expect(movieSearch).toHaveBeenCalledTimes(1);
      await pause(TYPING_PAUSE_MS * 6);
      expect(movieSearch, 'asked once, answered once').toHaveBeenCalledTimes(1);
      // And the Search key still re-asks, which is what it is for now.
      await pressSearch();
      expect(movieSearch).toHaveBeenCalledTimes(2);
    });

    it('does not re-run a restored search on arrival', async () => {
      // Coming back from a result and finding the screen asking the box again would be a
      // request per visit for an answer already on the screen.
      sessionStorage.setItem('bs-search:q', 'BAT');
      sessionStorage.setItem(
        'bs-search:results',
        JSON.stringify({ q: 'BAT', items: [item({ tmdb_id: 1, title: 'First' })] }),
      );
      render(<SearchPage />);
      expect(cardTitles()).toEqual(['First']);
      await pause(TYPING_PAUSE_MS * 4);
      expect(movieSearch).not.toHaveBeenCalled();
    });
  });

  it('asks both halves once each, for page 1, with the query trimmed', async () => {
    render(<SearchPage />);
    typeIn('BAT ');
    await pressSearch();
    expect(movieSearch.mock.calls).toEqual([['BAT', 1]]);
    expect(tvSearch.mock.calls).toEqual([['BAT', 1]]);
  });

  it('caps the query, and says so rather than ignoring the press', () => {
    render(<SearchPage />);
    // Far more presses than the cap, held on one key. The cap itself is not asserted by
    // value: the point is that it exists, that it is well beyond any real title, and that
    // the press that meets it is answered.
    const a = key('A');
    for (let i = 0; i < 80; i++) fireEvent.click(a);
    const capped = queryText()!.length;
    expect(capped).toBeGreaterThan(20);
    expect(capped, 'the query must stop growing').toBeLessThan(80);
    expect(screen.getByText(/as long as the search can get/)).toBeInTheDocument();
    // And the cap is not a dead end: Delete makes room again.
    fireEvent.click(key('Delete'));
    expect(queryText()).toHaveLength(capped - 1);
  });

  it('refuses an empty query out loud, and asks nothing', async () => {
    render(<SearchPage />);
    await pressSearch();
    expect(movieSearch).not.toHaveBeenCalled();
    expect(tvSearch).not.toHaveBeenCalled();
    expect(screen.getByText(/Type a title first/)).toBeInTheDocument();
  });

  describe('Back', () => {
    it('deletes the last character when there is text, and does NOT navigate', () => {
      // `useBackKey` claims Backspace AND Escape and preventDefaults them, and it cannot be
      // narrowed by key: what this TV actually sends is unknown, which is why BACK_KEYS lists
      // six spellings. So the split is by STATE, which needs no such knowledge.
      render(<SearchPage />);
      typeIn('BATMAM');
      back();
      expect(queryText()).toBe('BATMA');
      expect(router.push).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
    });

    it('leaves for home when the query is empty', () => {
      render(<SearchPage />);
      back();
      expect(router.push).toHaveBeenCalledWith('/bigscreen');
    });

    it('empties the query one press at a time, then leaves on the next press', () => {
      render(<SearchPage />);
      typeIn('AB');
      back();
      back();
      expect(router.push).not.toHaveBeenCalled();
      expect(queryText()).toMatch(/Type a title/);
      back();
      expect(router.push).toHaveBeenCalledWith('/bigscreen');
    });

    it('keeps an on-screen way home, because Back with text can never leave', () => {
      // The remote's Back key identity on this device is unverified (see `useBackKey`), and
      // on this screen it deletes rather than leaves whenever anything is typed. Without a
      // control the viewer would have to guess that Clear comes first.
      //
      // THE CONTROL MOVED RATHER THAN WENT: it used to be a "Back to home" link in the
      // action row, and it is the top bar now — which answers the same need better, since it
      // offers everywhere else as well and sits at the top of every browsing screen.
      render(<SearchPage />);
      typeIn('BATMAN');
      const home = screen.getByRole('link', { name: 'Home' });
      expect(home).toHaveAttribute('href', '/bigscreen');
      expect(home.closest('header'), 'in the bar, not in the action row').not.toBeNull();
    });
  });

  describe('a repeat press for a search that is already out', () => {
    it('is refused out loud, not doubled', async () => {
      // Re-submitting the SAME query renders a byte-identical status line, so nothing on
      // screen would change while two more TMDB-backed requests went out — on the very
      // search the viewer is waiting for. The empty-query press already refuses out loud.
      const slow = deferred<CatalogPage>();
      movieSearch.mockReturnValueOnce(slow.promise);
      tvSearch.mockResolvedValueOnce(page([]));
      render(<SearchPage />);
      typeIn('AB');
      await pressSearch();
      expect(movieSearch).toHaveBeenCalledTimes(1);

      await pressSearch();
      expect(movieSearch).toHaveBeenCalledTimes(1);
      expect(tvSearch).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Still searching/)).toBeInTheDocument();

      // Once it has been answered, the same query may be asked again.
      await act(async () => {
        slow.resolve(page([]));
      });
      await pressSearch();
      expect(movieSearch).toHaveBeenCalledTimes(2);
    });

    it('still searches when the query has changed since that press', async () => {
      const slow = deferred<CatalogPage>();
      movieSearch.mockReturnValueOnce(slow.promise);
      tvSearch.mockResolvedValueOnce(page([]));
      render(<SearchPage />);
      typeIn('A');
      await pressSearch();
      typeIn('B');
      await pressSearch();
      expect(movieSearch.mock.calls.map((c) => c[0])).toEqual(['A', 'AB']);
      expect(screen.queryByText(/Still searching/)).toBeNull();
    });
  });

  describe('results', () => {
    it('merges both halves, dedupes them and sorts by popularity', async () => {
      movieSearch.mockResolvedValue(
        page([
          item({ tmdb_id: 1, title: 'Mid Movie', popularity: 50 }),
          item({ tmdb_id: 2, title: 'Dull Movie', popularity: 1 }),
        ]),
      );
      tvSearch.mockResolvedValue(
        page([
          item({ tmdb_id: 9, title: 'Hot Show', media_type: 'tv', popularity: 99 }),
          // Same media_type + tmdb_id as a movie row: a duplicate, collapsed to one card.
          item({ tmdb_id: 1, title: 'Mid Movie (again)', popularity: 50 }),
        ]),
      );
      render(<SearchPage />);
      typeIn('A');
      await pressSearch();
      expect(cardTitles()).toEqual(['Hot Show', 'Mid Movie', 'Dull Movie']);
      expect(screen.getByText(/^3 results for/)).toBeInTheDocument();
      // The merge lives in `_data/searchPaging`, not inline here and no longer the web's
      // `mergeDedupe`: a paged search must NOT re-sort what is already on screen, because
      // the ring is at a (row, col) and re-ordering moves it onto a different film. A second
      // copy of the rule is how the two drift apart, so this pins where it lives.
      const src = readFileSync('src/app/(bigscreen)/bigscreen/search/page.tsx', 'utf8');
      expect(src).toMatch(/appendResults[\s\S]*from '\.\.\/\.\.\/_data\/searchPaging'/);
      expect(src).not.toMatch(/mergeCatalog/);
    });

    it('links a movie to the movie screen and a show to the show screen', async () => {
      movieSearch.mockResolvedValue(page([item({ tmdb_id: 272, title: 'Batman Begins', popularity: 10 })]));
      tvSearch.mockResolvedValue(page([item({ tmdb_id: 1399, title: 'Thrones', media_type: 'tv', popularity: 20 })]));
      render(<SearchPage />);
      typeIn('B');
      await pressSearch();
      expect(cards().map((c) => c.getAttribute('href'))).toEqual([
        '/bigscreen/show/1399',
        '/bigscreen/movie/272',
      ]);
    });

    it('counts a single result in the singular', async () => {
      movieSearch.mockResolvedValue(page([item({ tmdb_id: 1, title: 'Only One' })]));
      render(<SearchPage />);
      typeIn('A');
      await pressSearch();
      expect(screen.getByText(/^1 result for/)).toBeInTheDocument();
    });

    it('drops a row whose media_type is neither movie nor tv, rather than routing it to /movie', async () => {
      // `catalogItemToCard` routes anything that is not 'tv' to /bigscreen/movie/{id}, so a
      // row of some other kind would become a card that dead-ends — the stage-4 Critical's
      // exact shape. The NaN/null test below does NOT cover this: those rows are caught by
      // the other clauses of the guard.
      movieSearch.mockResolvedValue(
        page([
          item({ tmdb_id: 300, title: 'Some Person', media_type: 'person' as CatalogItem['media_type'] }),
          item({ tmdb_id: 5, title: 'Fine', popularity: 3 }),
        ]),
      );
      render(<SearchPage />);
      typeIn('B');
      await pressSearch();
      expect(cardTitles()).toEqual(['Fine']);
      expect(cards().map((c) => c.getAttribute('href'))).toEqual(['/bigscreen/movie/5']);
    });

    it('drops a row that could not become a card, rather than linking to NaN', async () => {
      movieSearch.mockResolvedValue(
        page([
          item({ tmdb_id: Number('nope'), title: 'Broken' }),
          item({ tmdb_id: 5, title: 'Fine', popularity: 3 }),
          null as unknown as CatalogItem,
        ]),
      );
      render(<SearchPage />);
      typeIn('B');
      await pressSearch();
      expect(cardTitles()).toEqual(['Fine']);
      expect(cards().map((c) => c.getAttribute('href'))).toEqual(['/bigscreen/movie/5']);
    });

    it('reads as no results, with the keyboard still focusable', async () => {
      render(<SearchPage />);
      typeIn('ZZZ');
      await pressSearch();
      expect(screen.getByText(/No results/)).toBeInTheDocument();
      expect(cards()).toHaveLength(0);
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    });

    it('replaces the previous results when the viewer searches again', async () => {
      movieSearch.mockResolvedValueOnce(page([item({ tmdb_id: 1, title: 'First' })]));
      render(<SearchPage />);
      typeIn('A');
      await pressSearch();
      expect(cardTitles()).toEqual(['First']);
      movieSearch.mockResolvedValueOnce(page([item({ tmdb_id: 2, title: 'Second' })]));
      fireEvent.click(key('B'));
      await pressSearch();
      expect(cardTitles()).toEqual(['Second']);
      expect(cells()).toHaveLength(BAR_CELLS + KEY_CELLS + ACTION_CELLS + 1);
    });
  });

  describe('one dead half', () => {
    it('still shows the shows when the movie half rejects', async () => {
      movieSearch.mockRejectedValue(new Error('movies are down'));
      tvSearch.mockResolvedValue(page([item({ tmdb_id: 9, title: 'Live Show', media_type: 'tv' })]));
      render(<SearchPage />);
      typeIn('A');
      await pressSearch();
      expect(cardTitles()).toEqual(['Live Show']);
      expect(screen.queryByText(/Couldn’t search/)).toBeNull();
    });

    it('still shows the movies when the tv half rejects', async () => {
      movieSearch.mockResolvedValue(page([item({ tmdb_id: 7, title: 'Live Movie' })]));
      tvSearch.mockRejectedValue(new Error('tv is down'));
      render(<SearchPage />);
      typeIn('A');
      await pressSearch();
      expect(cardTitles()).toEqual(['Live Movie']);
      expect(screen.queryByText(/Couldn’t search/)).toBeNull();
    });

    it('survives a half that answers 200 with junk instead of a page', async () => {
      movieSearch.mockResolvedValue({ results: 'not an array' } as unknown as CatalogPage);
      tvSearch.mockResolvedValue(page([item({ tmdb_id: 9, title: 'Live Show', media_type: 'tv' })]));
      render(<SearchPage />);
      typeIn('A');
      await pressSearch();
      expect(cardTitles()).toEqual(['Live Show']);
    });

    it('reads as failed only when BOTH halves are dead, and stays retryable', async () => {
      movieSearch.mockRejectedValue(new Error('down'));
      tvSearch.mockRejectedValue(new Error('down'));
      render(<SearchPage />);
      typeIn('A');
      await pressSearch();
      expect(screen.getByRole('alert')).toHaveTextContent(/Couldn’t search/);
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      // The label never changed, so pressing it again is the honest retry.
      movieSearch.mockResolvedValue(page([item({ tmdb_id: 1, title: 'Back Up' })]));
      tvSearch.mockResolvedValue(page([]));
      await pressSearch();
      expect(cardTitles()).toEqual(['Back Up']);
      expect(screen.queryByText(/Couldn’t search/)).toBeNull();
    });
  });

  describe('a late answer for a query the viewer has moved on from', () => {
    it('does not replace the newer results', async () => {
      // Search BATMAN, then JOKER: batman's slow answer must not land on joker's screen.
      // `apiClient` sets no timeout, so the window is unbounded.
      const slow = deferred<CatalogPage>();
      movieSearch.mockReturnValueOnce(slow.promise);
      tvSearch.mockResolvedValueOnce(page([]));
      render(<SearchPage />);
      typeIn('BATMAN');
      await pressSearch();
      expect(screen.getByText(/Searching for/)).toBeInTheDocument();

      fireEvent.click(key('Clear'));
      typeIn('JOKER');
      movieSearch.mockResolvedValueOnce(page([item({ tmdb_id: 475557, title: 'Joker' })]));
      tvSearch.mockResolvedValueOnce(page([]));
      await pressSearch();
      expect(cardTitles()).toEqual(['Joker']);

      await act(async () => {
        slow.resolve(page([item({ tmdb_id: 272, title: 'Batman Begins', popularity: 99 })]));
      });
      expect(cardTitles()).toEqual(['Joker']);
    });

    it('does not blank them either — a late FAILURE is the dangerous one', async () => {
      // The stage-4 shape: `fetchRail` turned any failure into an empty rail, so a hung
      // request erroring AFTER a successful retry wiped the hero. Here a late failure would
      // blank a screen the viewer is reading.
      const slow = deferred<CatalogPage>();
      movieSearch.mockReturnValueOnce(slow.promise);
      tvSearch.mockRejectedValueOnce(new Error('dead'));
      render(<SearchPage />);
      typeIn('BATMAN');
      await pressSearch();

      fireEvent.click(key('Clear'));
      typeIn('JOKER');
      movieSearch.mockResolvedValueOnce(page([item({ tmdb_id: 475557, title: 'Joker' })]));
      tvSearch.mockResolvedValueOnce(page([]));
      await pressSearch();
      expect(cardTitles()).toEqual(['Joker']);

      await act(async () => {
        slow.reject(new Error('late failure'));
      });
      expect(cardTitles()).toEqual(['Joker']);
      expect(screen.queryByText(/Couldn’t search/)).toBeNull();
      expect(screen.queryByText(/Searching for/)).toBeNull();
    });

    it('survives an answer that lands after the viewer has left', async () => {
      const slow = deferred<CatalogPage>();
      movieSearch.mockReturnValueOnce(slow.promise);
      tvSearch.mockResolvedValueOnce(page([]));
      const view = render(<SearchPage />);
      typeIn('A');
      await pressSearch();
      view.unmount();
      await act(async () => {
        slow.resolve(page([item({ tmdb_id: 1, title: 'Too Late' })]));
      });
      expect(document.querySelector('.bs-card')).toBeNull();
    });
  });

  describe('coming back to the screen', () => {
    /**
     * Type, search, land the ring on a result, then leave. This is what a viewer does to
     * open a title: the detail screens' Back is `router.push('/bigscreen')`, so coming back
     * here is a fresh mount, and a 13-character title is about 30 D-pad presses to retype.
     */
    const SEVEN = Array.from({ length: 7 }, (_, i) =>
      item({ tmdb_id: i + 1, title: `Film ${i + 1}`, popularity: 100 - i }),
    );
    async function leaveFromAResult() {
      movieSearch.mockResolvedValue(page(SEVEN));
      const view = render(<SearchPage />);
      typeIn('BATMAN');
      await pressSearch();
      await waitFor(() => expect(cards()).toHaveLength(7));
      for (let i = 0; i < 10; i++) arrow('ArrowDown');
      arrow('ArrowRight');
      const ring = document.activeElement?.textContent ?? null;
      expect(ring, 'the ring must be on a result before we leave').toMatch(/Film/);
      view.unmount();
      vi.clearAllMocks();
      movieSearch.mockResolvedValue(page(SEVEN));
      tvSearch.mockResolvedValue(page([]));
      return ring;
    }

    it('brings the query back', async () => {
      await leaveFromAResult();
      render(<SearchPage />);
      expect(queryText()).toBe('BATMAN');
    });

    it('brings the results back without asking for them again', async () => {
      await leaveFromAResult();
      render(<SearchPage />);
      expect(cardTitles()).toEqual(SEVEN.map((i) => i.title));
      expect(movieSearch, 'restored, not refetched').not.toHaveBeenCalled();
      expect(tvSearch).not.toHaveBeenCalled();
      expect(screen.getByText(/7 results for/)).toBeInTheDocument();
    });

    it('clamps a stored results query to the same bound as the typed one', async () => {
      const long = 'x'.repeat(400);
      sessionStorage.setItem('bs-search:q', 'x');
      sessionStorage.setItem('bs-search:results', JSON.stringify({ q: long, items: SEVEN }));
      render(<SearchPage />);
      const line = await screen.findByText(/results for/);
      expect(line.textContent!.length).toBeLessThan(150);
    });

    it('brings the ring back to the cell it was left on', async () => {
      const ring = await leaveFromAResult();
      render(<SearchPage />);
      expect(document.activeElement?.textContent).toBe(ring);
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    });

    it('forgets the results once the viewer searches for something else', async () => {
      // The stored rows would otherwise describe a query the screen is no longer showing.
      await leaveFromAResult();
      const slow = deferred<CatalogPage>();
      movieSearch.mockReturnValueOnce(slow.promise);
      tvSearch.mockReturnValueOnce(new Promise(() => {}));
      const view = render(<SearchPage />);
      fireEvent.click(key('Clear'));
      typeIn('JOKER');
      await pressSearch();
      view.unmount();
      render(<SearchPage />);
      expect(queryText()).toBe('JOKER');
      expect(cards()).toHaveLength(0);
    });

    it('renders and searches when sessionStorage is unavailable', async () => {
      // It throws on access on a TV in a restricted mode, and comes back empty in a private
      // window. Every read and write is wrapped, so the screen must simply work without it.
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('denied');
      });
      try {
        movieSearch.mockResolvedValue(page([item({ tmdb_id: 1, title: 'Still Works' })]));
        render(<SearchPage />);
        expect(document.activeElement).toBe(key('A'));
        typeIn('AB');
        expect(queryText()).toBe('AB');
        await pressSearch();
        expect(cardTitles()).toEqual(['Still Works']);
      } finally {
        get.mockRestore();
        set.mockRestore();
      }
    });

    it('ignores a stored record that is not a search', async () => {
      sessionStorage.setItem('bs-search:results', '{{{not json');
      render(<SearchPage />);
      expect(cards()).toHaveLength(0);
      expect(document.activeElement).toBe(key('A'));
    });
  });

  describe('the focus grid', () => {
    it('declares exactly as many cells as it renders, with nothing searched yet', () => {
      render(<SearchPage />);
      expect(cells()).toHaveLength(BAR_CELLS + KEY_CELLS + ACTION_CELLS);
      expectEveryCellReachable('idle');
    });

    it('declares exactly as many cells as it renders while a search is in flight', async () => {
      const slow = deferred<CatalogPage>();
      movieSearch.mockReturnValueOnce(slow.promise);
      tvSearch.mockResolvedValueOnce(page([]));
      render(<SearchPage />);
      typeIn('A');
      await pressSearch();
      expect(cells()).toHaveLength(BAR_CELLS + KEY_CELLS + ACTION_CELLS);
      expectEveryCellReachable('in flight');
    });

    it('declares exactly as many cells as it renders with results on screen', async () => {
      // Seven results: two full rows of RESULT_COLUMNS and a short last row of one, so a
      // partial row is covered as well as full ones.
      movieSearch.mockResolvedValue(
        page(Array.from({ length: 7 }, (_, i) => item({ tmdb_id: i + 1, title: `Film ${i + 1}`, popularity: 100 - i }))),
      );
      render(<SearchPage />);
      typeIn('A');
      // Arrow down onto the Search key first, so the ring really is where a viewer's would
      // be when they press it (fireEvent.click moves no DOM focus of its own).
      for (let i = 0; i < KEYBOARD_ROW_COUNTS.length; i++) arrow('ArrowDown');
      expect(document.activeElement).toBe(searchKey());
      await pressSearch();
      await waitFor(() => expect(cards()).toHaveLength(7));
      expect(cells()).toHaveLength(BAR_CELLS + KEY_CELLS + ACTION_CELLS + 7);
      // Rows appearing BELOW the viewer must not pull the ring off the key they pressed.
      expect(document.activeElement).toBe(searchKey());
      expectEveryCellReachable('with results');
    });

    it('declares exactly as many cells as it renders with no results', async () => {
      render(<SearchPage />);
      typeIn('A');
      await pressSearch();
      expect(cells()).toHaveLength(BAR_CELLS + KEY_CELLS + ACTION_CELLS);
      expectEveryCellReachable('no results');
    });

    it('declares exactly as many cells as it renders after a failed search', async () => {
      movieSearch.mockRejectedValue(new Error('down'));
      tvSearch.mockRejectedValue(new Error('down'));
      render(<SearchPage />);
      typeIn('A');
      await pressSearch();
      expect(cells()).toHaveLength(BAR_CELLS + KEY_CELLS + ACTION_CELLS);
      expectEveryCellReachable('failed');
    });

    it('keeps the ring on a result card when Back deletes a character', async () => {
      movieSearch.mockResolvedValue(page([item({ tmdb_id: 1, title: 'Only One' })]));
      render(<SearchPage />);
      typeIn('AB');
      await pressSearch();
      await waitFor(() => expect(cards()).toHaveLength(1));
      // Right off the end of the keyboard's first row, which is what the split made of
      // "six Downs past the keys".
      crossIntoResults();
      expect(document.activeElement).toBe(cards()[0]);
      back();
      expect(queryText()).toBe('A');
      expect(document.activeElement).toBe(cards()[0]);
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    });
  });

  describe('recent searches', () => {
    const recents = () => [...document.querySelectorAll<HTMLElement>('.bs-search__recent')];

    it('offers nothing before anything has been searched for', () => {
      render(<SearchPage />);
      expect(recents()).toEqual([]);
    });

    it('remembers a search that FOUND something, and offers it next time', async () => {
      movieSearch.mockResolvedValue(page([item({ tmdb_id: 1, title: 'First' })]));
      const first = render(<SearchPage />);
      typeIn('BAT');
      await pressSearch();
      first.unmount();
      // A fresh arrival: the query is gone, so the row is on offer.
      sessionStorage.clear();
      render(<SearchPage />);
      expect(recents().map((r) => r.textContent)).toEqual(['BAT']);
    });

    it('does NOT remember a search that found nothing', async () => {
      // A list of a viewer's typos is worse than no list.
      const first = render(<SearchPage />);
      typeIn('ZZZ');
      await pressSearch();
      first.unmount();
      sessionStorage.clear();
      render(<SearchPage />);
      expect(recents()).toEqual([]);
    });

    it('runs the whole query at once when one is pressed', async () => {
      movieSearch.mockResolvedValue(page([item({ tmdb_id: 1, title: 'First' })]));
      const first = render(<SearchPage />);
      typeIn('BAT');
      await pressSearch();
      first.unmount();
      sessionStorage.clear();
      movieSearch.mockClear();
      render(<SearchPage />);
      await act(async () => {
        fireEvent.click(recents()[0]);
      });
      // No pause to wait through: the viewer picked a whole query, so there is nothing left
      // to wait for them to finish typing.
      expect(movieSearch.mock.calls).toEqual([['BAT', 1]]);
      expect(queryText()).toBe('BAT');
    });

    it('goes away once there is something else on the screen', async () => {
      movieSearch.mockResolvedValue(page([item({ tmdb_id: 1, title: 'First' })]));
      const first = render(<SearchPage />);
      typeIn('BAT');
      await pressSearch();
      first.unmount();
      sessionStorage.clear();
      render(<SearchPage />);
      expect(recents()).toHaveLength(1);
      // A row that stayed would sit between the keyboard and the results for the whole
      // visit; it is a way to START, not something to step over on the way to the answers.
      typeIn('X');
      expect(recents()).toEqual([]);
    });

    it('is counted in the grid: every cell it draws is reachable', async () => {
      movieSearch.mockResolvedValue(page([item({ tmdb_id: 1, title: 'First' })]));
      const first = render(<SearchPage />);
      typeIn('BAT');
      await pressSearch();
      first.unmount();
      sessionStorage.clear();
      render(<SearchPage />);
      expect(cells()).toHaveLength(BAR_CELLS + KEY_CELLS + ACTION_CELLS + 1);
      expectEveryCellReachable('with a recent search');
    });
  });

  describe('getting to the results: the split', () => {
    const results = (n: number) =>
      page(Array.from({ length: n }, (_, i) => item({ tmdb_id: i + 1, title: `Film ${i + 1}`, popularity: 100 - i })));
    const searched = async (n: number) => {
      movieSearch.mockResolvedValue(results(n));
      render(<SearchPage />);
      typeIn('BAT');
      await pressSearch();
      await waitFor(() => expect(cards()).toHaveLength(n));
    };

    it('offers no jump cell, because Right is the way across now', async () => {
      // `Go to N results` existed because the results sat under six rows of keyboard. The
      // split replaced the six Downs with one Right, so the cell is gone and the action row
      // is one cell wide in every state.
      await searched(3);
      expect(screen.queryByRole('button', { name: /^Go to \d+ result/ })).toBeNull();
      expect(cells()).toHaveLength(BAR_CELLS + KEY_CELLS + ACTION_CELLS + 3);
    });

    it('crosses from the end of a keyboard row into the first result', async () => {
      // THE ASK, in one assertion.
      await searched(3);
      expect(document.activeElement).toBe(key('A'));
      crossIntoResults();
      expect(document.activeElement).toBe(cards()[0]);
    });

    it('comes back to the keyboard on Left', async () => {
      await searched(3);
      crossIntoResults();
      expect(document.activeElement).toBe(cards()[0]);
      arrow('ArrowLeft');
      // The LAST key of the row it came from, so the ring keeps travelling the way it was
      // pushed rather than jumping to the start of the keyboard.
      expect(document.activeElement).toBe(key('G'));
    });

    it('does not fall into the results on Down from the bottom of the keyboard', async () => {
      // The results are BESIDE the keyboard, not below it. Plain `move` would go to the next
      // populated row, which is the first result.
      await searched(3);
      for (let i = 0; i < 12; i++) arrow('ArrowDown');
      expect(document.activeElement).toBe(searchKey());
      arrow('ArrowDown');
      expect(document.activeElement).toBe(searchKey());
    });

    it('reaches the bar with Up from the results, not the keyboard row beside them', async () => {
      await searched(3);
      crossIntoResults();
      expect(document.activeElement).toBe(cards()[0]);
      arrow('ArrowUp');
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Home' }));
    });

    it('remembers the row each pane was on when crossing back and forth', async () => {
      await searched(6);
      crossIntoResults();
      arrow('ArrowDown');
      expect(document.activeElement).toBe(cards()[3]);
      arrow('ArrowLeft');
      expect(document.activeElement).toBe(key('G'));
      // ...and Right returns to the SECOND results row, not to the first.
      arrow('ArrowRight');
      expect(document.activeElement).toBe(cards()[3]);
    });

    it('refuses to cross while there is nothing to cross to', async () => {
      render(<SearchPage />);
      for (let i = 0; i < 10; i++) arrow('ArrowRight');
      expect(document.activeElement).toBe(key('G'));
    });

    it('lays the results out RESULT_COLUMNS to a row', async () => {
      // The count the focus model is told and the count the stylesheet draws have to be the
      // same number, or a card lands where no cell is.
      await searched(7);
      const rows = [...document.querySelectorAll('.bs-search__row')];
      expect(rows.map((r) => r.querySelectorAll('.bs-card').length)).toEqual([
        RESULT_COLUMNS,
        RESULT_COLUMNS,
        1,
      ]);
    });
  });

  describe('the typing pause and the Search key together', () => {
    it('does not re-run the search the Search key already ran', async () => {
      // The pause timer is armed by the keystroke and captures "this query is worth asking
      // about". A press before it fires makes that false — and a timer that acted on its
      // captured answer sent a second, identical search half a second later.
      vi.useFakeTimers();
      try {
        movieSearch.mockResolvedValue(page([item({ tmdb_id: 1, title: 'Only' })]));
        render(<SearchPage />);
        typeIn('BAT');
        await act(async () => {
          fireEvent.click(searchKey());
        });
        expect(movieSearch).toHaveBeenCalledTimes(1);
        await act(async () => {
          vi.advanceTimersByTime(TYPING_PAUSE_MS * 3);
        });
        expect(movieSearch).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('infinite scroll', () => {
    const pageOf = (ids: number[], over: Partial<CatalogPage> = {}): CatalogPage => ({
      ...page(ids.map((i) => item({ tmdb_id: i, title: `Film ${i}`, popularity: 100 - i }))),
      ...over,
    });

    it('asks for the next page when the ring reaches the last row', async () => {
      movieSearch.mockResolvedValueOnce(pageOf([1, 2, 3], { page: 1, total_pages: 3 }));
      tvSearch.mockResolvedValue(pageOf([], { page: 1, total_pages: 0 }));
      render(<SearchPage />);
      typeIn('BAT');
      await pressSearch();
      await waitFor(() => expect(cards()).toHaveLength(3));
      movieSearch.mockResolvedValueOnce(pageOf([4, 5, 6], { page: 2, total_pages: 3 }));
      await act(async () => {
        crossIntoResults();
      });
      await waitFor(() => expect(cards()).toHaveLength(6));
      expect(movieSearch).toHaveBeenLastCalledWith('BAT', 2);
      // ...and it stops there. An early trigger cascades: with two rows on screen the first
      // is one-from-last, so appending leaves the ring still one-from-last and it asks
      // again — this walked to page 3 untouched before the trigger moved onto the last row.
      expect(movieSearch.mock.calls.map(([, n]) => n)).toEqual([1, 2]);
    });

    it('APPENDS, so the card under the ring does not move', async () => {
      // The ring is at a (row, col). A page that re-sorted the list would leave it on a
      // different film with no press behind the change.
      movieSearch.mockResolvedValueOnce(pageOf([1, 2, 3], { page: 1, total_pages: 3 }));
      tvSearch.mockResolvedValue(pageOf([], { page: 1, total_pages: 0 }));
      render(<SearchPage />);
      typeIn('BAT');
      await pressSearch();
      await waitFor(() => expect(cards()).toHaveLength(3));
      // A second page whose titles are MORE popular than the first's: a re-sort would put
      // them in front.
      movieSearch.mockResolvedValueOnce(
        page([item({ tmdb_id: 9, title: 'Blockbuster', popularity: 9999 })]),
      );
      await act(async () => {
        crossIntoResults();
      });
      await waitFor(() => expect(cards()).toHaveLength(4));
      expect(cardTitles()).toEqual(['Film 1', 'Film 2', 'Film 3', 'Blockbuster']);
      expect(document.activeElement).toBe(cards()[0]);
      expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    });

    it('asks once, not once per press', async () => {
      movieSearch.mockResolvedValueOnce(pageOf([1, 2, 3], { page: 1, total_pages: 9 }));
      tvSearch.mockResolvedValue(pageOf([], { page: 1, total_pages: 0 }));
      render(<SearchPage />);
      typeIn('BAT');
      await pressSearch();
      await waitFor(() => expect(cards()).toHaveLength(3));
      const slow = deferred<CatalogPage>();
      movieSearch.mockReturnValueOnce(slow.promise);
      await act(async () => {
        crossIntoResults();
        arrow('ArrowLeft');
        crossIntoResults();
      });
      expect(movieSearch.mock.calls.filter(([, p]) => p === 2)).toHaveLength(1);
      await act(async () => {
        slow.resolve(pageOf([4], { page: 2, total_pages: 9 }));
      });
    });

    it('does not ask when the search has no more pages', async () => {
      movieSearch.mockResolvedValue(pageOf([1, 2, 3], { page: 1, total_pages: 1 }));
      tvSearch.mockResolvedValue(pageOf([], { page: 1, total_pages: 0 }));
      render(<SearchPage />);
      typeIn('BAT');
      await pressSearch();
      await waitFor(() => expect(cards()).toHaveLength(3));
      movieSearch.mockClear();
      await act(async () => {
        crossIntoResults();
      });
      expect(movieSearch).not.toHaveBeenCalled();
      expect(screen.queryByText(/Keep pressing down/)).toBeNull();
    });

    it('stops asking after a page fails, and keeps what arrived', async () => {
      // An endless retry against a dead box would be the typing pause's loop again, one
      // layer down.
      movieSearch.mockResolvedValueOnce(pageOf([1, 2, 3], { page: 1, total_pages: 9 }));
      tvSearch.mockResolvedValue(pageOf([], { page: 1, total_pages: 0 }));
      render(<SearchPage />);
      typeIn('BAT');
      await pressSearch();
      await waitFor(() => expect(cards()).toHaveLength(3));
      movieSearch.mockRejectedValueOnce(new Error('down'));
      tvSearch.mockRejectedValueOnce(new Error('down'));
      await act(async () => {
        crossIntoResults();
      });
      await waitFor(() => expect(screen.queryByText(/Keep pressing down/)).toBeNull());
      expect(cards()).toHaveLength(3);
      movieSearch.mockClear();
      await act(async () => {
        arrow('ArrowLeft');
        crossIntoResults();
      });
      expect(movieSearch).not.toHaveBeenCalled();
    });
  });

  describe('the top bar', () => {
    it('marks Search as the section the viewer is in', () => {
      render(<SearchPage />);
      const current = [...document.querySelectorAll('.bs-head__item')].filter(
        (l) => l.getAttribute('aria-current') === 'page',
      );
      expect(current.map((l) => l.textContent)).toEqual(['Search']);
    });

    it('is one Up from the keyboard, and the ring does not start there', () => {
      render(<SearchPage />);
      expect(document.activeElement).toBe(key('A'));
      arrow('ArrowUp');
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Home' }));
    });
  });

});
