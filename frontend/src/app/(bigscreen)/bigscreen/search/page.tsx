'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CatalogItem, CatalogPage } from '@/types';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { mergeDedupe } from '@/lib/mergeCatalog';
import { Card } from '../../_components/Card';
import { Keyboard, KEYBOARD_ROW_COUNTS, type KeyAction } from '../../_components/Keyboard';
import { catalogItemToCard } from '../../_data/rails';
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
 * ONE SEARCH PER PRESS. A TV's network is the slow part, and a per-keystroke search would
 * queue nine requests for a nine-letter title.
 */

const HOME = '/bigscreen';

/** The Search key and the way home. One row, and the grid is told exactly this many. */
const ACTION_CELLS = 2;
/** Grid row of the action row: straight after the keyboard's own rows. */
const ACTION_ROW = KEYBOARD_ROW_COUNTS.length;
const FIRST_RESULT_ROW = ACTION_ROW + 1;

/** Six 240px posters and their 24px gaps are 1560px, inside the 1728px the safe area leaves. */
const PER_ROW = 6;

/**
 * Far beyond any real title, and bounded only so a stuck key cannot grow the query without
 * limit. The press that hits it says so rather than being silently ignored.
 */
const MAX_QUERY = 60;

type Phase =
  | { kind: 'idle' }
  | { kind: 'searching'; q: string }
  | { kind: 'results'; q: string; items: CatalogItem[] }
  | { kind: 'failed'; q: string };

function assertNever(x: never): never {
  throw new Error(`Unhandled key action: ${JSON.stringify(x)}`);
}

const chunk = <T,>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/**
 * A row that can become a card that goes somewhere. The arrays come off the wire, so a null
 * element or an id that is not a number is possible at runtime whatever the types say, and
 * `catalogItemToCard` would turn one into a link to `/bigscreen/movie/NaN`. `media_type` is
 * checked too, because that is what picks the route. Same rule as `_data/rails`' own guard;
 * this is three lines rather than an export, because the rail version also caps and
 * interleaves.
 */
function isUsable(item: CatalogItem | null | undefined): item is CatalogItem {
  return !!item && Number.isInteger(item.tmdb_id) && (item.media_type === 'movie' || item.media_type === 'tv');
}

/**
 * One half's answer, or null when that half is dead. A rejection, a synchronous throw and a
 * 200 whose body is not a page all count as dead; only BOTH halves being dead is a failed
 * search (`Promise.allSettled`, never `Promise.all`).
 */
function pageOf(settled: PromiseSettledResult<CatalogPage>): CatalogPage | null {
  if (settled.status !== 'fulfilled') return null;
  const value = settled.value;
  if (!Array.isArray(value?.results)) return null;
  // Filtered BEFORE the merge: `mergeDedupe` reads `media_type` and `tmdb_id` off every row.
  return { ...value, results: value.results.filter(isUsable) };
}

/** Wrapper so a service that throws synchronously rejects instead of taking both halves down. */
async function ask(call: () => Promise<CatalogPage>): Promise<CatalogPage> {
  return call();
}

export default function SearchPage() {
  const router = useRouter();

  // The query lives in a ref as well as in state, for the reason the passcode keypad gives:
  // a held key (and the Back listener, which is registered once) can act twice before a
  // re-render, which state read through a closure would drop.
  const queryRef = useRef('');
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  /** A transient answer to a press this screen declined. Cleared by the next key press. */
  const [note, setNote] = useState<string | null>(null);

  /**
   * Which search is current. A stale answer — success OR failure — must not land on a newer
   * query's results: `apiClient` sets no timeout, so the window is unbounded, and this
   * project has already shipped the other shape once (stage 4's `fetchRail` turned any
   * failure into an empty rail, so a hung request erroring after a successful retry wiped
   * the hero). The web's `SearchView` guards it with the same counter.
   */
  const generation = useRef(0);
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

  const submit = async () => {
    const q = queryRef.current.trim();
    if (!q) {
      setNote('Type a title first, then press Search.');
      return;
    }
    const mine = ++generation.current;
    setNote(null);
    setPhase({ kind: 'searching', q });

    let next: Phase;
    try {
      // Both halves in flight together; there is no combined search endpoint.
      const settled = await Promise.allSettled([
        ask(() => moviesService.search(q, 1)),
        ask(() => tvService.search(q, 1)),
      ]);
      const pages = settled.map(pageOf).filter((p): p is CatalogPage => p !== null);
      next = pages.length === 0 ? { kind: 'failed', q } : { kind: 'results', q, items: mergeDedupe(pages) };
    } catch {
      // Nothing above should reject, and a screen stuck on "Searching…" would have no way out.
      next = { kind: 'failed', q };
    }
    // The viewer has left, or has already searched for something else. Either way this
    // answer is not theirs any more.
    if (!alive.current || mine !== generation.current) return;
    setPhase(next);
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
  // Declared from what is rendered: the same arrays the render below maps over.
  const grid = useFocusGrid({
    rowCounts: [...KEYBOARD_ROW_COUNTS, ACTION_CELLS, ...rows.map((r) => r.length)],
  });

  let status: string | null = null;
  if (phase.kind === 'searching') status = `Searching for “${phase.q}”…`;
  else if (phase.kind === 'results') {
    status = phase.items.length === 0 ? `No results for “${phase.q}”.` : `${phase.items.length} results for “${phase.q}”`;
  }

  return (
    // .bs-shell, not .bs-page: every group below carries its own safe inset, and html and
    // body cannot scroll, so this needs its own scroller.
    <main className="bs-shell">
      <header className="bs-shell__head">
        <h1>Search</h1>
        {/* Read-only, and in the head so it stays on screen while focus moves into the
            results. aria-live so the viewer's own typing is announced, since there is no
            caret to watch. */}
        <p className="bs-search__query" aria-live="polite">
          {query || <span className="bs-search__hint">Type a title with the keyboard below</span>}
        </p>
      </header>
      <div className="bs-shell__scroll">
        <Keyboard rowOffset={0} focusProps={grid.focusProps} onPress={press} />
        <div className="bs-search__actions">
          {/* The label NEVER changes. A press while a search is out starts a newer one (the
              generation counter drops the older answer), so "Searching…" on the control
              would be a lie about what pressing it does; the status line below says what is
              happening instead. */}
          <button type="button" className="bs-btn" {...grid.focusProps(ACTION_ROW, 0)} onClick={() => void submit()}>
            Search
          </button>
          <Link
            href={HOME}
            className="bs-btn bs-btn--ghost"
            draggable={false}
            {...grid.focusProps(ACTION_ROW, 1)}
          >
            Back to home
          </Link>
        </div>
        {phase.kind === 'failed' && (
          <p role="alert" className="bs-search__alert">
            Couldn’t search. Check that the box is reachable, then press Search again.
          </p>
        )}
        {status && (
          <p role="status" className="bs-search__status">
            {status}
          </p>
        )}
        {note && (
          <p role="status" className="bs-search__status">
            {note}
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
