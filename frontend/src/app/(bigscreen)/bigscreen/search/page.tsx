'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { CatalogItem, CatalogPage } from '@/types';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { mergeDedupe } from '@/lib/mergeCatalog';
import { Card } from '../../_components/Card';
import { HEADER_CELLS, Header } from '../../_components/Header';
import { Keyboard, KEYBOARD_ROW_COUNTS, type KeyAction } from '../../_components/Keyboard';
import { chunk } from '../../_data/chunk';
import { catalogItemToCard, usableCatalogRow } from '../../_data/rails';
import { readRecent, rememberSearch } from '../../_data/recentSearches';
import { MAX_QUERY, TYPING_PAUSE_MS, autoSearchQuery } from '../../_data/searchQuery';
import { useFocusGrid } from '../../_focus/useFocusGrid';
import { useBackKey } from '../../_focus/useBackKey';

/**
 * /bigscreen/search — the first text entry on the television.
 *
 * ONE SCREEN, ONE FOCUS GRID. The keyboard rows and the result rows are rows of the SAME
 * grid, so `Keyboard` takes focus props instead of owning a `useFocusGrid` of its own: the
 * hook listens on `window` and whichever instance registered first claims an arrow, which
 * would leave one of two grids inert. `rowCounts` is
 * `[...KEYBOARD_ROW_COUNTS, ACTION_CELLS, ...one per result row]`, and every count is taken
 * from what is actually rendered — a count one too high leaves a phantom cell that takes the
 * ring and hands it to no element, which a remote cannot recover from.
 *
 * BACK IS SCOPED BY STATE, NOT BY KEY. `useBackKey` claims `Backspace` AND `Escape` and
 * `preventDefault`s them, and it cannot be narrowed by key: the reason `BACK_KEYS` lists six
 * spellings is that what this set actually sends is unknown, so "Backspace deletes, 461
 * leaves" would be a bet with no evidence behind it. So a Back press with text deletes the
 * last character and a Back press with an empty query leaves — which needs no knowledge of
 * the key, and is the convention on every TV search surface. A viewer who types BATMAM,
 * presses Back to fix it and lands on the home screen has lost their query.
 *
 * Because of that, Back can never leave while anything is typed, so the action row carries
 * an on-screen way home as well. The remote's Back identity on this device is unverified
 * anyway (see `useBackKey`), which is the same reason the passcode keypad keeps its own
 * Back key.
 *
 * NO `<input>`. The query is React state rendered into a read-only display node: a real
 * input would take DOM focus and fight the roving-tabindex grid for it, and webOS raises its
 * own IME panel over the app when one is focused. The keyboard is the only input path.
 *
 * ONE SEARCH PER PRESS, AND NOT TWO. A TV's network is the slow part, so there is no
 * per-keystroke search (nine requests for a nine-letter title), and a second press for a
 * query whose search is already out is refused out loud instead of doubling it.
 *
 * THE QUERY, THE RESULTS AND THE RING SURVIVE LEAVING. See the storage block below: without
 * it, opening a result and pressing Back costs the viewer every press they spent typing.
 */

const HOME = '/bigscreen';

/** The top bar. Row 0 on every browsing screen, so Up from the content always reaches it. */
const HEADER_ROW = 0;
/** The keyboard starts straight under the bar, which is where the ring lands on arrival. */
const FIRST_KEY_ROW = 1;
/** Grid row of the action row: straight after the keyboard's own rows. */
const ACTION_ROW = FIRST_KEY_ROW + KEYBOARD_ROW_COUNTS.length;
/** Recent searches, when there is nothing else to show. Empty — and absent — otherwise. */
const RECENT_ROW = ACTION_ROW + 1;
const FIRST_RESULT_ROW = RECENT_ROW + 1;

/**
 * What the action row holds. `Search` is ALWAYS column 0 and `Jump to results` is APPENDED,
 * never inserted — the focus model tolerates growth at the END of a row (the grid calls `go`
 * only when the clamped target CHANGES) and nothing else. A cell added at or before the
 * focused column would leave DOM focus on the element that had just become the next column
 * while the model still pointed at the old one, and the next press would appear to do
 * nothing. The transport row's `RETRY_CELL` is the same rule.
 *
 * Derived from the state rather than written as a literal, because this row now varies.
 */
const actionCells = (hasResults: boolean): number => (hasResults ? 2 : 1);

/**
 * The typing pause, the floor under it and the query cap all live in `_data/searchQuery`:
 * a page module cannot export a constant (Next rejects anything but its own known fields),
 * and a test that re-typed the numbers beside these would be two copies to keep in step.
 * The in-flight guard and the generation counter below are unchanged and are what keep a
 * slow answer from landing on a newer query.
 */

/** Six 240px posters and their 24px gaps are 1560px, inside the 1728px the safe area leaves. */
const PER_ROW = 6;

type Phase =
  | { kind: 'idle' }
  | { kind: 'searching'; q: string }
  | { kind: 'results'; q: string; items: CatalogItem[] }
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
 * for the same reason; this screen additionally has text worth keeping. (The architecturally
 * right answer is Back popping a stack the app owns, with home as its floor; that belongs to
 * the stage that gives this surface a real exit. This is the cheap, correct fix at this
 * layer, and it restores the ring on any re-entry within the session as a side effect.)
 *
 * TWO KEYS, not one record: the query is rewritten on every keystroke and the results are up
 * to ~40 rows, and re-serialising those per keystroke is synchronous work on a surface with
 * a frame budget — the focus hook debounces its own writes for exactly that reason.
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
      const parsed = JSON.parse(raw) as { q?: unknown; items?: unknown };
      if (typeof parsed?.q === 'string' && parsed.q && Array.isArray(parsed.items)) {
        return { query, phase: { kind: 'results', q: parsed.q.slice(0, MAX_QUERY), items: (parsed.items as CatalogItem[]).filter(usableCatalogRow) } };
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
  // Filtered BEFORE the merge, with the surface's one row guard (`_data/rails`): `mergeDedupe`
  // reads `media_type` and `tmdb_id` off every row, and `catalogItemToCard` turns a bad one
  // into a card that dead-ends. SEARCH IS WHY THAT GUARD CHECKS `media_type`: it is the only
  // place on this surface where the movie half and the tv half merge into one list, so it is
  // the only place a wrong-kind row can be seen to be routed by its own field rather than by
  // the endpoint it came from. The clause's full rationale, and the backend reason it is
  // latent everywhere else, are on `usableCardIdentity`.
  return { ...value, results: value.results.filter(usableCatalogRow) };
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
        writeStored(RESULTS_KEY, JSON.stringify({ q: phase.q, items: phase.items }));
      } catch {
        /* unserialisable rows are not worth taking a screen down for */
      }
      return;
    }
    // A search still out, or one that failed, leaves nothing worth coming back to: the
    // stored rows would describe a query the screen is no longer showing. (Reached only after
    // mount: a restored mount starts as `results` and returns above, and nothing ever sets
    // `idle` again, so no condition is needed here.)
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
   * Run a search for `q`. The one path to the network, shared by the typing pause, the
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
      // out — slowing the very search the viewer is waiting for. Refused out loud, the same
      // way the empty-query press is.
      setNote(`Still searching for “${q}”. Give it a moment.`);
      return;
    }
    const mine = ++generation.current;
    inFlight.current = q;
    setNote(null);
    setPhase({ kind: 'searching', q });

    let next: Phase;
    try {
      // Both halves in flight together; there is no combined search endpoint. Called
      // directly: both service methods are `async`, so neither can throw synchronously into
      // this array, and the try/catch around it is the backstop if that ever changes.
      const settled = await Promise.allSettled([moviesService.search(q, 1), tvService.search(q, 1)]);
      const pages = settled.map(pageOf).filter((p): p is CatalogPage => p !== null);
      next = pages.length === 0 ? { kind: 'failed', q } : { kind: 'results', q, items: mergeDedupe(pages) };
    } catch {
      // Nothing above should reject, and a screen stuck on "Searching…" would have no way out.
      next = { kind: 'failed', q };
    }
    // The viewer has left, or has already searched for something else. Either way this
    // answer is not theirs any more — and `inFlight` is deliberately NOT cleared here,
    // because by now it names the newer search, which is still out.
    if (!alive.current || mine !== generation.current) return;
    inFlight.current = null;
    setPhase(next);
    // Only a search that FOUND something is worth offering back: a list of a viewer's typos
    // is worse than no list.
    if (next.kind === 'results' && next.items.length > 0) setRecent(rememberSearch(q));
  }, []);

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
    const timer = setTimeout(() => void run(q), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  /** The Search key: the same search, asked for explicitly. Its value is the retry. */
  const submit = () => {
    const q = queryRef.current.trim();
    // A press on a query that already failed must actually re-ask, so the auto guard is
    // dropped first — the in-flight guard below is the one that still refuses a double.
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
  const rows = chunk(items, PER_ROW);
  /**
   * Recent searches are offered only when there is nothing else on the screen — an empty
   * query and no results. They are a way to START, not a thing to step over on the way to
   * the answers, and a row that stayed would sit between the keyboard and the results for
   * the whole visit.
   */
  const showRecent = query.trim() === '' && rows.length === 0 && recent.length > 0;
  const recentCells = showRecent ? recent.length : 0;
  // Declared from what is rendered: the same arrays and conditions the render below uses.
  const grid = useFocusGrid({
    rowCounts: [
      HEADER_CELLS,
      ...KEYBOARD_ROW_COUNTS,
      actionCells(rows.length > 0),
      recentCells,
      ...rows.map((r) => r.length),
    ],
    storageKey: FOCUS_KEY,
    // The keyboard, not the bar above it: this screen exists to be typed on.
    initialRow: FIRST_KEY_ROW,
  });

  let status: string | null = null;
  if (phase.kind === 'searching') status = `Searching for “${phase.q}”…`;
  else if (phase.kind === 'results') {
    const n = phase.items.length;
    status = n === 0 ? `No results for “${phase.q}”.` : `${n} result${n === 1 ? '' : 's'} for “${phase.q}”`;
  }

  return (
    // .bs-shell, not .bs-page: every group below carries its own safe inset, and html and
    // body cannot scroll, so this needs its own scroller.
    <main className="bs-shell">
      <Header row={HEADER_ROW} focusPropsFor={grid.focusProps} pathname={pathname} />
      <div className="bs-shell__scroll">
        {/* NO `<h1>Search</h1>` HERE, deliberately. The bar above already marks which section
            the viewer is in, and the field below says what to do in it — a heading between
            them is a third way of saying the same word, and ~90px of the screen that the
            keyboard and the results both want. (My List keeps its heading: a wall of posters
            has nothing else labelling it.) */}
        {/* THE FIELD, drawn where a search field goes and shaped like one, but still NOT an
            `<input>`: a real one would take DOM focus from the roving-tabindex grid and
            webOS raises its own IME panel over the app when one is focused. The keyboard
            below is the only input path. `aria-live` so the viewer's own typing is
            announced, since there is no caret to watch. */}
        <div className="bs-search__field">
          <p className="bs-search__query" aria-live="polite">
            {query || <span className="bs-search__hint">Type a title with the keyboard below</span>}
          </p>
          {/* The status rides INSIDE the field, so "Searching…" and the result count appear
              where the viewer is already looking instead of under six rows of keyboard. */}
          <p role="status" className="bs-search__state">
            {note ?? status ?? ''}
          </p>
        </div>
        <Keyboard rowOffset={FIRST_KEY_ROW} focusProps={grid.focusProps} onPress={press} />
        <div className="bs-search__actions">
          {/* The label stays "Search" because that is what the control does, in every state;
              the status line below carries the progress. A press for a query whose search is
              ALREADY OUT is refused out loud (`inFlight`) rather than quietly doubled. A
              press for a DIFFERENT query is a new search, and the generation counter drops
              the older answer. */}
          <button type="button" className="bs-btn" {...grid.focusProps(ACTION_ROW, 0)} onClick={submit}>
            Search
          </button>
          {/* APPENDED, never inserted — see `actionCells`. It exists because the results sit
              under six rows of keyboard: without it, reaching what the viewer just searched
              for is six Downs. With it, one press. The count is in the label so pressing it
              is a decision rather than a leap. (The way home it replaced is in the bar at
              the top of the screen now, along with everywhere else.) */}
          {rows.length > 0 && (
            <button
              type="button"
              className="bs-btn bs-btn--ghost"
              {...grid.focusProps(ACTION_ROW, 1)}
              onClick={() => grid.setFocus({ row: FIRST_RESULT_ROW, col: 0 })}
            >
              {`Go to ${items.length} result${items.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
        {showRecent && (
          <div className="bs-search__recents">
            <p className="bs-search__recents-title">Recent searches</p>
            <div className="bs-search__recents-row">
              {recent.map((q, c) => (
                <button
                  key={q}
                  type="button"
                  className="bs-search__recent"
                  {...grid.focusProps(RECENT_ROW, c)}
                  onClick={() => {
                    setNote(null);
                    setQ(q);
                    // Searched at once rather than after the pause: the viewer picked a whole
                    // query, so there is nothing to wait for them to finish typing.
                    lastAuto.current = '';
                    void run(q);
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {phase.kind === 'failed' && (
          <p role="alert" className="bs-search__alert">
            Couldn’t search. Check that the box is reachable, then press Search again.
          </p>
        )}
        <div className="bs-search__results">
          {rows.map((row, r) => (
            // One container per row, no wrap: the rows the focus model counts are the rows
            // the viewer sees. Cells are keyed by INDEX, never by item id — a new search that
            // re-keyed the focused card would unmount it and drop DOM focus to <body>.
            <div key={r} className="bs-search__row">
              {row.map((item, c) => (
                <Card
                  key={c}
                  item={catalogItemToCard(item, 'poster')}
                  shape="poster"
                  focusProps={grid.focusProps(FIRST_RESULT_ROW + r, c)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
