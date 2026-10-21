'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { CatalogItem, CatalogPage } from '@/types';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { Card } from '../../_components/Card';
import { HEADER_CELLS, Header } from '../../_components/Header';
import { Keyboard, KEYBOARD_ROW_COUNTS, type KeyAction } from '../../_components/Keyboard';
import { chunk } from '../../_data/chunk';
import { catalogItemToCard, usableCatalogRow } from '../../_data/rails';
import { readRecent, rememberSearch } from '../../_data/recentSearches';
import { MAX_QUERY, TYPING_PAUSE_MS, autoSearchQuery } from '../../_data/searchQuery';
import { RESULT_COLUMNS, appendResults, morePages } from '../../_data/searchPaging';
import type { Direction, FocusTarget, RowCounts } from '../../_focus/model';
import { type PaneLayout, type PaneMemory, paneMove, paneOf } from '../../_focus/panes';
import { useFocusGrid } from '../../_focus/useFocusGrid';
import { useBackKey } from '../../_focus/useBackKey';

/**
 * /bigscreen/search — a keyboard on the left, the results on the right.
 *
 * THE SPLIT, AND WHY IT TOOK A FOCUS-MODEL CHANGE. This screen used to be a keyboard with
 * the results somewhere underneath it: reaching what you had just searched for was six
 * Downs past the keys. The round that built it wrote the split off on the grounds that "it
 * needs spatial focus navigation and this surface's grid is row-indexed", and shipped a
 * `Go to N results` jump cell instead. That jump cell is gone, because Right now does the
 * job — the spatial half is `_focus/panes.paneMove`, which the grid takes as its
 * `resolveMove`. Everything else about the grid (the roving tabindex, the saved position,
 * the pending restore, the column memory) is untouched.
 *
 * THE TWO PANES AS ROWS. One grid, as always, and the panes are disjoint ranges of its rows:
 * rows 1..ACTION_ROW are the left, everything after is the right. `paneMove` keeps Up and
 * Down inside the range they started in and crosses only on a Left or Right that has run out
 * of row. Up off the top of EITHER pane reaches the bar, which is above both.
 *
 * WHAT THE RIGHT PANE HOLDS WHEN THERE ARE NO RESULTS: the recent searches, one per row.
 * They used to be a horizontal row under the keyboard, which in a split would have been six
 * pills in a 988px column. A vertical list is what the space wants and is fewer presses to
 * read. They are still offered only with an empty query and nothing found — a way to START,
 * not something to step over on the way to the answers.
 *
 * INFINITE SCROLL, DRIVEN BY FOCUS AND NOT BY A SCROLL EVENT. There is no pointer here: the
 * viewer moves the ring, and the scroller follows it. So the next page is asked for when the
 * ring reaches the last row of results, which is the same gesture as scrolling to the bottom
 * and the only one this surface has. `appendResults` never re-orders what is already on
 * screen, which is what keeps the ring on the card it was on.
 *
 * ONE SCREEN, ONE FOCUS GRID. `Keyboard` takes focus props instead of owning a
 * `useFocusGrid` of its own: the hook listens on `window` and whichever instance registered
 * first claims an arrow, which would leave one of two grids inert. Every count in `rowCounts`
 * is taken from what is actually rendered — a count one too high leaves a phantom cell that
 * takes the ring and hands it to no element, which a remote cannot recover from.
 *
 * BACK IS SCOPED BY STATE, NOT BY KEY. `useBackKey` claims `Backspace` AND `Escape` and
 * `preventDefault`s them, and it cannot be narrowed by key: the reason `BACK_KEYS` lists six
 * spellings is that what this set actually sends is unknown. So a Back press with text
 * deletes the last character and a Back press with an empty query leaves — which needs no
 * knowledge of the key, and is the convention on every TV search surface. A viewer who types
 * BATMAM, presses Back to fix it and lands on the home screen has lost their query. The way
 * home is in the bar at the top.
 *
 * NO `<input>`. The query is React state rendered into a read-only display node: a real
 * input would take DOM focus and fight the roving-tabindex grid for it, and webOS raises its
 * own IME panel over the app when one is focused. The keyboard is the only input path.
 *
 * ONE SEARCH PER PRESS, AND NOT TWO. A TV's network is the slow part, so there is no
 * per-keystroke search (nine requests for a nine-letter title), and a second press for a
 * query whose search is already out is refused out loud instead of doubling it.
 *
 * THE QUERY, THE RESULTS AND THE RING SURVIVE LEAVING. See the storage block below.
 */

const HOME = '/bigscreen';

/** The top bar. Row 0 on every browsing screen, so Up from the content always reaches it. */
const HEADER_ROW = 0;
/** The keyboard starts straight under the bar, which is where the ring lands on arrival. */
const FIRST_KEY_ROW = 1;
/** Grid row of the action row: straight after the keyboard's own rows. */
const ACTION_ROW = FIRST_KEY_ROW + KEYBOARD_ROW_COUNTS.length;
/**
 * The right pane's first row. Results when there are any, recent searches when there are
 * not — never both, because recents are offered only when nothing was found, so one row
 * index can serve either without the two ever disagreeing about what is at it.
 */
const RIGHT_FIRST_ROW = ACTION_ROW + 1;

/**
 * The left pane: every keyboard row plus the action row.
 *
 * A CONSTANT, where the right pane's range is computed per render — the keyboard cannot
 * change shape and the results can.
 */
const LEFT_PANE: readonly [number, number] = [FIRST_KEY_ROW, ACTION_ROW];

/**
 * The action row holds Search, and only Search.
 *
 * `Go to N results` used to be appended here. It existed because the results sat under six
 * rows of keyboard; with the split they are one Right press away, so it is a cell that costs
 * a press to skip past and buys nothing. (The rule it was written for still stands and is
 * still worth knowing: the focus model tolerates growth at the END of a row and nothing
 * else, which is why the results grid may grow a page at a time.)
 */
const ACTION_CELLS = 1;

type Phase =
  | { kind: 'idle' }
  | { kind: 'searching'; q: string }
  /** `page` is the last page asked for; `more` is whether either half has another. */
  | { kind: 'results'; q: string; items: CatalogItem[]; page: number; more: boolean }
  | { kind: 'failed'; q: string };

function assertNever(x: never): never {
  throw new Error(`Unhandled key action: ${JSON.stringify(x)}`);
}

/**
 * WHAT SURVIVES LEAVING THE SCREEN, and why any of it does.
 *
 * The detail screens' Back is `router.push('/bigscreen')`, so a viewer who types a
 * 13-character title (about 30 D-pad presses), searches, opens a result and presses Back
 * arrives at home — and without this, comes back to an empty keyboard. Home
 * (`bigscreen/page.tsx`) and the profile picker both pass a `storageKey` to `useFocusGrid`
 * for the same reason; this screen additionally has text worth keeping.
 *
 * TWO KEYS, not one record: the query is rewritten on every keystroke and the results are up
 * to many rows, and re-serialising those per keystroke is synchronous work on a surface with
 * a frame budget — the focus hook debounces its own writes for exactly that reason.
 *
 * ONLY THE FIRST PAGE IS KEPT. A viewer who paged deep into a search and then opened a
 * result comes back to the search they ran rather than to every page they walked, which is
 * one short serialisation instead of a growing one and the same screen they would get by
 * searching again. The page cursor is restored with it so paging can carry on.
 *
 * EVERY read and write is wrapped. `sessionStorage` throws on access in a restricted mode,
 * comes back empty in a private window, and dies with the browsing context; losing a
 * remembered query is harmless, and a screen that will not render is not.
 */
const QUERY_KEY = 'bs-search:q';
const RESULTS_KEY = 'bs-search:results';
/** `useFocusGrid`'s key, which it namespaces itself (`bs-focus:search`). */
const FOCUS_KEY = 'search';

interface Restored {
  query: string;
  phase: Phase;
}

function readStored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* nothing to do: losing the remembered query is harmless */
  }
}

function removeStored(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* as above */
  }
}

/**
 * The query and the last completed search, as far as they can be trusted. What comes back
 * out of storage is no more trustworthy than what came off the wire in the first place —
 * another build may have written it, or a viewer's browser may hand back a truncated
 * string — so the rows are re-validated with the same guard the network path uses.
 */
function readSaved(): Restored {
  const query = (readStored(QUERY_KEY) ?? '').slice(0, MAX_QUERY);
  try {
    const raw = readStored(RESULTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { q?: unknown; items?: unknown; page?: unknown; more?: unknown };
      if (typeof parsed?.q === 'string' && parsed.q && Array.isArray(parsed.items)) {
        const page = Number.isInteger(parsed.page) && (parsed.page as number) > 0 ? (parsed.page as number) : 1;
        return {
          query,
          phase: {
            kind: 'results',
            q: parsed.q.slice(0, MAX_QUERY),
            items: (parsed.items as CatalogItem[]).filter(usableCatalogRow),
            page,
            more: parsed.more === true,
          },
        };
      }
    }
  } catch {
    /* malformed or unreadable: start with no results, which is always a valid screen */
  }
  return { query, phase: { kind: 'idle' } };
}

/**
 * One half's answer, or null when that half is dead. A rejection and a 200 whose body is not
 * a page both count as dead; only BOTH halves being dead is a failed search
 * (`Promise.allSettled`, never `Promise.all`). A SYNCHRONOUS throw would not reach here at
 * all — it escapes the `allSettled` call itself and lands in the try/catch around it, which
 * is also "failed", so neither half can be lost silently either way.
 */
function pageOf(settled: PromiseSettledResult<CatalogPage>): CatalogPage | null {
  if (settled.status !== 'fulfilled') return null;
  const value = settled.value;
  if (!Array.isArray(value?.results)) return null;
  // Filtered BEFORE the merge, with the surface's one row guard (`_data/rails`):
  // `catalogItemToCard` turns a bad one into a card that dead-ends. SEARCH IS WHY THAT GUARD
  // CHECKS `media_type`: it is the only place on this surface where the movie half and the
  // tv half merge into one list, so it is the only place a wrong-kind row can be seen to be
  // routed by its own field rather than by the endpoint it came from.
  return { ...value, results: value.results.filter(usableCatalogRow) };
}

/** Both halves of one page, as the pages that came back. */
async function searchPage(q: string, page: number): Promise<CatalogPage[] | null> {
  try {
    // Both halves in flight together; there is no combined search endpoint. Called
    // directly: both service methods are `async`, so neither can throw synchronously into
    // this array, and the try/catch is the backstop if that ever changes.
    const settled = await Promise.allSettled([moviesService.search(q, page), tvService.search(q, page)]);
    const pages = settled.map(pageOf).filter((p): p is CatalogPage => p !== null);
    return pages.length === 0 ? null : pages;
  } catch {
    return null;
  }
}

export default function SearchPage() {
  const router = useRouter();
  const pathname = usePathname();

  // Read once, on the first render, so the restored results are part of the grid's FIRST
  // shape: `useFocusGrid` holds a saved position as a pending restore until its row has
  // items, and a results row that only appeared an effect later would make the ring land on
  // the keyboard first and jump afterwards.
  const [restored] = useState(readSaved);
  // The query lives in a ref as well as in state, for the reason the passcode keypad gives:
  // a held key (and the Back listener, which is registered once) can act twice before a
  // re-render, which state read through a closure would drop.
  const queryRef = useRef(restored.query);
  const [query, setQuery] = useState(restored.query);
  const [phase, setPhase] = useState<Phase>(restored.phase);
  /** A transient answer to a press this screen declined. Cleared by the next key press. */
  const [note, setNote] = useState<string | null>(null);
  /** The last few searches that found something. Read once; rewritten by `run`. */
  const [recent, setRecent] = useState<string[]>(readRecent);
  /** A page after the first is on its way. Separate from `phase` so the grid does not move. */
  const [paging, setPaging] = useState(false);
  /**
   * The query already ASKED. Seeded from a restored search so arriving back on this screen
   * does not re-run the search whose results are already on it.
   */
  const lastAuto = useRef(restored.phase.kind === 'results' ? restored.phase.q : '');

  useEffect(() => {
    writeStored(QUERY_KEY, query);
  }, [query]);

  useEffect(() => {
    if (phase.kind === 'results') {
      try {
        writeStored(RESULTS_KEY, JSON.stringify({ q: phase.q, items: phase.items, page: phase.page, more: phase.more }));
      } catch {
        /* unserialisable rows are not worth taking a screen down for */
      }
      return;
    }
    // A search still out, or one that failed, leaves nothing worth coming back to: the
    // stored rows would describe a query the screen is no longer showing.
    removeStored(RESULTS_KEY);
  }, [phase]);

  /**
   * Which search is current. A stale answer — success OR failure — must not land on a newer
   * query's results: `apiClient` sets no timeout, so the window is unbounded, and this
   * project has already shipped the other shape once (stage 4's `fetchRail` turned any
   * failure into an empty rail, so a hung request erroring after a successful retry wiped
   * the hero). The web's `SearchView` guards it with the same counter.
   */
  const generation = useRef(0);
  /**
   * The query whose search is still out. A ref, not `phase`: two presses in the same frame
   * both read the render's `phase`, which is exactly the hazard the query ref exists for.
   */
  const inFlight = useRef<string | null>(null);
  // Set in an effect, not at declaration: StrictMode runs the cleanup once on mount, and a
  // ref initialised to true would then stay false for the real mount.
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setQ = useCallback((next: string) => {
    queryRef.current = next;
    setQuery(next);
  }, []);

  const press = (action: KeyAction) => {
    setNote(null);
    switch (action.kind) {
      case 'char':
        if (queryRef.current.length >= MAX_QUERY) {
          setNote('That is as long as the search can get. Press Delete or Clear.');
          return;
        }
        setQ(queryRef.current + action.char);
        return;
      case 'delete':
        setQ(queryRef.current.slice(0, -1));
        return;
      case 'clear':
        setQ('');
        return;
      default:
        return assertNever(action);
    }
  };

  /**
   * Run a search for `q`. The one path to the FIRST page, shared by the typing pause, the
   * Search key and a recent-search press, so the in-flight guard and the generation counter
   * cannot be bypassed by any of them.
   */
  const run = useCallback(async (q: string) => {
    if (!q) {
      setNote('Type a title first, then press Search.');
      return;
    }
    // Claimed here, not only in the effect: a manual press and a pause that lands in the
    // same frame would otherwise both go out.
    lastAuto.current = q;
    if (inFlight.current === q) {
      // The one press on this surface that would otherwise be neither acted on nor refused:
      // `setPhase({ kind: 'searching', q })` with the same `q` renders a byte-identical
      // status line, so NOTHING on screen changes while two more TMDB-backed requests go
      // out — slowing the very search the viewer is waiting for.
      setNote(`Still searching for “${q}”. Give it a moment.`);
      return;
    }
    const mine = ++generation.current;
    inFlight.current = q;
    setNote(null);
    setPaging(false);
    setPhase({ kind: 'searching', q });

    const pages = await searchPage(q, 1);
    // The viewer has left, or has already searched for something else. Either way this
    // answer is not theirs any more — and `inFlight` is deliberately NOT cleared here,
    // because by now it names the newer search, which is still out.
    if (!alive.current || mine !== generation.current) return;
    inFlight.current = null;
    const next: Phase =
      pages === null
        ? { kind: 'failed', q }
        : { kind: 'results', q, items: appendResults([], pages), page: 1, more: morePages(pages) };
    setPhase(next);
    // Only a search that FOUND something is worth offering back: a list of a viewer's typos
    // is worse than no list.
    if (next.kind === 'results' && next.items.length > 0) setRecent(rememberSearch(q));
  }, []);

  /**
   * The next page, appended.
   *
   * Guarded on `paging` as well as on the generation counter: the ring can cross the trigger
   * row twice before a page lands (Down then Up then Down), and two requests for page 2
   * would append the same rows twice were it not for `appendResults`' dedupe — which would
   * still have cost the request. A failure leaves the results alone and clears `more`, so a
   * dead half-open socket cannot make the screen ask for ever; the viewer still has
   * everything that did arrive.
   */
  const loadMore = useCallback(async () => {
    const current = phase;
    if (current.kind !== 'results' || !current.more || paging) return;
    const mine = generation.current;
    const want = current.page + 1;
    setPaging(true);
    const pages = await searchPage(current.q, want);
    if (!alive.current || mine !== generation.current) return;
    setPaging(false);
    setPhase((prev) => {
      // Re-read from the updater: a new search may have replaced the phase while this was
      // out, and appending this answer to THAT would mix two queries' results.
      if (prev.kind !== 'results' || prev.q !== current.q) return prev;
      if (pages === null) return { ...prev, more: false };
      return { ...prev, items: appendResults(prev.items, pages), page: want, more: morePages(pages) };
    });
  }, [phase, paging]);

  /**
   * THE TYPING PAUSE. A search goes out when the viewer stops, not when they press.
   *
   * `lastAuto` IS WHAT STOPS IT LOOPING. Without it a FAILED search re-arms the timer on the
   * next render — the query has not changed, so the condition that fired it is still true —
   * and the screen retries a dead box for ever. It records the query that has already been
   * ASKED, which is not the same as the query being shown: a failure is asked and answered.
   *
   * The cleanup cancels the pending timer on every keystroke, so holding a key down costs
   * one request at the end rather than one per repeat.
   */
  useEffect(() => {
    const q = autoSearchQuery(query, lastAuto.current);
    if (q === null) return;
    const timer = setTimeout(() => {
      // RE-ASKED AT FIRE TIME, not only at arm time. A viewer who types BAT and presses
      // Search without waiting leaves this timer armed behind them: it captured "BAT is
      // worth asking about", which was true when it was armed and is false by the time it
      // fires, because the press has already asked. Running it anyway sent a second,
      // identical search 500ms after the first — found by a row asserting what the LAST
      // request was.
      if (autoSearchQuery(queryRef.current, lastAuto.current) === null) return;
      void run(q);
    }, TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  /** The Search key: the same search, asked for explicitly. Its value is the retry. */
  const submit = () => {
    const q = queryRef.current.trim();
    // A press on a query that already failed must actually re-ask, so the auto guard is
    // dropped first — the in-flight guard is the one that still refuses a double.
    lastAuto.current = '';
    void run(q);
  };

  // Scoped by state: text deletes, empty leaves. `push`, as the detail screens do.
  useBackKey(
    useCallback(() => {
      if (queryRef.current.length > 0) {
        setNote(null);
        setQ(queryRef.current.slice(0, -1));
        return;
      }
      router.push(HOME);
    }, [router, setQ]),
  );

  const items = phase.kind === 'results' ? phase.items : [];
  const rows = chunk(items, RESULT_COLUMNS);
  /**
   * Recent searches fill the right pane when there is nothing else to put in it — an empty
   * query and no results. One per row, because the right pane is a column: six pills across
   * a 988px gutter was the old horizontal row's shape and does not survive the split.
   */
  const showRecent = query.trim() === '' && rows.length === 0 && recent.length > 0;
  /** The right pane's rows, whichever of the two things it is showing. */
  const rightCounts = showRecent ? recent.map(() => 1) : rows.map((r) => r.length);

  const layout = useMemo<PaneLayout>(
    () => ({
      left: LEFT_PANE,
      // An empty right pane is an EMPTY RANGE (first > last), which `paneOf` reports as
      // "neither pane" for every row and `paneMove` refuses to cross into. That is the
      // honest answer before a search: there is nothing to the right yet.
      right: [RIGHT_FIRST_ROW, RIGHT_FIRST_ROW + rightCounts.length - 1],
    }),
    [rightCounts.length],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  /**
   * The row each pane was last on, so crossing returns the ring to where the viewer left it
   * rather than to the top. A ref: it is read inside the key handler, and a state update per
   * press would re-render the screen for a value nothing renders.
   */
  const paneMemory = useRef<PaneMemory>({ left: null, right: null });

  /**
   * The split, as the grid's move resolver. Reads both refs at CALL time rather than closing
   * over this render's values: the hook registers its `window` listener once, so a resolver
   * that captured a stale layout would send the ring into a pane that had since changed
   * shape.
   */
  const resolveMove = useCallback(
    (counts: RowCounts, from: FocusTarget, dir: Direction, columnMemory: readonly number[]) =>
      paneMove(layoutRef.current, paneMemory.current, counts, from, dir, columnMemory),
    [],
  );

  // Declared from what is rendered: the same arrays and conditions the render below uses.
  const grid = useFocusGrid({
    rowCounts: [HEADER_CELLS, ...KEYBOARD_ROW_COUNTS, ACTION_CELLS, ...rightCounts],
    storageKey: FOCUS_KEY,
    // The keyboard, not the bar above it: this screen exists to be typed on.
    initialRow: FIRST_KEY_ROW,
    resolveMove,
  });

  const focusedRow = grid.focused.row;
  useEffect(() => {
    const pane = paneOf(layoutRef.current, focusedRow);
    if (pane) paneMemory.current[pane] = focusedRow;
  }, [focusedRow]);

  /**
   * INFINITE SCROLL. The ring reaching the last row of results is this surface's "scrolled
   * to the bottom": there is no pointer, the viewer moves focus and the scroller follows.
   *
   * ON the last row, not one row early, and that is not a detail. Firing early CASCADES: a
   * two-row grid has its first row one-from-last, so appending a page leaves the ring still
   * one-from-last and it asks again, and again — measured, it walked to page 3 of a search
   * without the viewer pressing anything after the first crossing. Loading a page per
   * arrival at the bottom costs one wait and spends what the viewer asked for.
   */
  const lastRightRow = RIGHT_FIRST_ROW + rightCounts.length - 1;
  useEffect(() => {
    if (showRecent || focusedRow < RIGHT_FIRST_ROW) return;
    if (focusedRow >= lastRightRow) void loadMore();
  }, [focusedRow, lastRightRow, showRecent, loadMore]);

  let status: string | null = null;
  if (phase.kind === 'searching') status = `Searching for “${phase.q}”…`;
  else if (phase.kind === 'results') {
    const n = phase.items.length;
    status =
      n === 0
        ? `No results for “${phase.q}”.`
        : `${n} result${n === 1 ? '' : 's'} for “${phase.q}”${phase.more ? ' so far' : ''}`;
  }

  return (
    // .bs-shell, not .bs-page: every group below carries its own safe inset, and html and
    // body cannot scroll, so this needs its own scroller.
    <main className="bs-shell">
      <Header row={HEADER_ROW} focusPropsFor={grid.focusProps} pathname={pathname} />
      <div className="bs-shell__scroll">
        {/* THE SPLIT. Two columns in one grid: the keyboard decides the width of the left
            (its widest row is the ten digits) and the results take the rest. No `<h1>`
            deliberately — the bar marks the section and the field says what to do in it. */}
        <div className="bs-search">
          <div className="bs-search__pane bs-search__pane--input">
            {/* THE FIELD, drawn where a search field goes and shaped like one, but still NOT
                an `<input>`: a real one would take DOM focus from the roving-tabindex grid
                and webOS raises its own IME panel over the app when one is focused.
                `aria-live` so the viewer's own typing is announced, since there is no caret
                to watch. */}
            <div className="bs-search__field">
              <p className="bs-search__query" aria-live="polite">
                {query || <span className="bs-search__hint">Type a title with the keyboard below</span>}
              </p>
              {/* The status rides INSIDE the field, so "Searching…" and the result count
                  appear where the viewer is already looking. */}
              <p role="status" className="bs-search__state">
                {note ?? status ?? ''}
              </p>
            </div>
            <Keyboard rowOffset={FIRST_KEY_ROW} focusProps={grid.focusProps} onPress={press} />
            <div className="bs-search__actions">
              {/* The label stays "Search" because that is what the control does, in every
                  state; the status line carries the progress. A press for a query whose
                  search is ALREADY OUT is refused out loud (`inFlight`) rather than quietly
                  doubled. A press for a DIFFERENT query is a new search, and the generation
                  counter drops the older answer. It is also the way to ask about a one- or
                  two-character query, which the typing pause does not act on. */}
              <button type="button" className="bs-btn" {...grid.focusProps(ACTION_ROW, 0)} onClick={submit}>
                Search
              </button>
            </div>
          </div>

          <div className="bs-search__pane bs-search__pane--results">
            {showRecent && (
              <div className="bs-search__recents">
                <p className="bs-search__recents-title">Recent searches</p>
                {recent.map((q, r) => (
                  <button
                    key={q}
                    type="button"
                    className="bs-search__recent"
                    {...grid.focusProps(RIGHT_FIRST_ROW + r, 0)}
                    onClick={() => {
                      setNote(null);
                      setQ(q);
                      // Searched at once rather than after the pause: the viewer picked a
                      // whole query, so there is nothing to wait for them to finish typing.
                      lastAuto.current = '';
                      void run(q);
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            {phase.kind === 'failed' && (
              <p role="alert" className="bs-search__alert">
                Couldn’t search. Check that the box is reachable, then press Search again.
              </p>
            )}
            {!showRecent && phase.kind !== 'failed' && rows.length === 0 && (
              // Never a focus stop: there is nothing here to press. The field's own status
              // line already says which of the three states this is.
              <p className="bs-search__empty">
                {phase.kind === 'searching' ? 'Searching…' : 'Results will appear here.'}
              </p>
            )}
            <div className="bs-search__results">
              {rows.map((row, r) => (
                // One container per row: the rows the focus model counts are the rows the
                // viewer sees. Cells are keyed by INDEX, never by item id — a new search
                // that re-keyed the focused card would unmount it and drop DOM focus to
                // <body>.
                <div key={r} className="bs-search__row">
                  {row.map((item, c) => (
                    <Card
                      key={c}
                      item={catalogItemToCard(item, 'poster')}
                      shape="poster"
                      focusProps={grid.focusProps(RIGHT_FIRST_ROW + r, c)}
                    />
                  ))}
                </div>
              ))}
              {/* Always mounted while there is more, and never a focus stop: the ring is
                  what triggers the load, so a control to press would be a second way to do
                  what Down already did. */}
              {phase.kind === 'results' && phase.more && (
                <p className="bs-search__more" role="status">
                  {paging ? 'Loading more…' : 'Keep pressing down for more'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
