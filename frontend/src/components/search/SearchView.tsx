'use client';

/**
 * SearchView — the whole FRÈ search experience.
 *
 * Composes:
 *  - A cinematic search hero with an eyebrow, Fraunces heading, large search
 *    input (debounced 300ms), clear button, and result-count line.
 *  - <SearchFilters> wired to useSearchUrlState.
 *  - <ResultsGrid> when a query / filter is active.
 *  - <GenreBrowse> when the search surface is truly empty.
 *
 * Fetching strategy:
 *  - With a query → moviesService.search / tvService.search
 *  - Without query → moviesService.browse / tvService.browse
 *  - type:'all' → fetch both movie + tv and mergeDedupe
 *  - type:'movie'|'tv' → fetch only that type
 *  - Pages accumulate for "Load more"; any query/filter change resets.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import CinematicAtmosphere from '@/components/fx/CinematicAtmosphere';
import SearchFilters from './SearchFilters';
import ResultsGrid from './ResultsGrid';
import GenreBrowse from './GenreBrowse';
import { useSearchUrlState } from '@/lib/useSearchUrlState';
import { mergeDedupe, hasMoreResults } from '@/lib/mergeCatalog';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { cn } from '@/lib/cn';
import type { CatalogItem, CatalogPage } from '@/types';

// ---------------------------------------------------------------------------
// Search icon
// ---------------------------------------------------------------------------

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('w-5 h-5', className)}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// X / Clear icon
// ---------------------------------------------------------------------------

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden="true"
      className={cn('w-3.5 h-3.5', className)}
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SearchView
// ---------------------------------------------------------------------------

const SearchView: React.FC = () => {
  const { state, setState } = useSearchUrlState();

  // ── Local input value (debounced to state.q) ──────────────────────────────
  const [inputValue, setInputValue] = useState(state.q);

  // Sync input if state.q changes externally (e.g. back navigation)
  const prevStateQ = useRef(state.q);
  useEffect(() => {
    if (state.q !== prevStateQ.current) {
      setInputValue(state.q);
      prevStateQ.current = state.q;
    }
  }, [state.q]);

  // Debounce input → state.q
  useEffect(() => {
    const id = setTimeout(() => {
      if (inputValue !== state.q) {
        setState({ q: inputValue });
      }
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue]);

  // ── Fetch state ────────────────────────────────────────────────────────────
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [pages, setPages] = useState<CatalogPage[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  // ── Whether anything is "active" (query or filter set) ────────────────────
  const isActive =
    state.q.trim() !== '' ||
    state.genre !== 0 ||
    state.year !== 0 ||
    state.sort !== '' ||
    state.type !== 'all';

  // ── Generation counter (stale-response guard) ─────────────────────────────
  // Incremented each time the query/filter key changes. fetchPage captures the
  // generation at call time; after the await it bails if a newer generation
  // started, preventing superseded responses from clobbering newer results.
  const fetchSeqRef = useRef(0);

  // ── Reset when query/type/filter changes ──────────────────────────────────
  const fetchKey = `${state.q}|${state.type}|${state.genre}|${state.year}|${state.sort}`;
  const prevFetchKey = useRef<string>('');
  useEffect(() => {
    if (fetchKey !== prevFetchKey.current) {
      prevFetchKey.current = fetchKey;
      // Bump the generation so any in-flight fetch from the previous key is
      // treated as stale and its setState calls are dropped.
      fetchSeqRef.current += 1;
      setItems([]);
      setPages([]);
      setCurrentPage(1);
    }
  }, [fetchKey]);

  // ── Fetch function ─────────────────────────────────────────────────────────
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchPage = useCallback(
    async (page: number) => {
      if (!isActive) return;

      // Capture the generation that is current when this call is made.
      const myGen = fetchSeqRef.current;

      setIsLoading(true);

      try {
        const q = state.q.trim();
        const { type, genre, year, sort } = state;

        const fetchMovies = async (): Promise<CatalogPage> => {
          if (q) {
            return moviesService.search(q, page);
          }
          return moviesService.browse({ sort: sort || undefined, genre: genre || undefined, year: year || undefined, page });
        };

        const fetchTv = async (): Promise<CatalogPage> => {
          if (q) {
            return tvService.search(q, page);
          }
          return tvService.browse({ sort: sort || undefined, genre: genre || undefined, year: year || undefined, page });
        };

        let newPages: CatalogPage[];

        if (type === 'all') {
          const [moviesPage, tvPage] = await Promise.all([
            fetchMovies().catch(() => ({ page, results: [], total_pages: 1, total_results: 0 } as CatalogPage)),
            fetchTv().catch(() => ({ page, results: [], total_pages: 1, total_results: 0 } as CatalogPage)),
          ]);
          newPages = [moviesPage, tvPage];
        } else if (type === 'movie') {
          const moviesPage = await fetchMovies().catch(() => ({ page, results: [], total_pages: 1, total_results: 0 } as CatalogPage));
          newPages = [moviesPage];
        } else {
          const tvPage = await fetchTv().catch(() => ({ page, results: [], total_pages: 1, total_results: 0 } as CatalogPage));
          newPages = [tvPage];
        }

        // Bail if unmounted OR if a newer generation superseded this one.
        if (!mountedRef.current || myGen !== fetchSeqRef.current) return;

        setPages((prev) => {
          const merged = page === 1 ? newPages : [...prev, ...newPages];
          const dedupedItems = mergeDedupe(merged);
          setItems(dedupedItems);
          return merged;
        });
      } catch {
        // Degrade to empty on error — grid shows empty state
      } finally {
        if (mountedRef.current && myGen === fetchSeqRef.current) {
          setIsLoading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.q, state.type, state.genre, state.year, state.sort, isActive],
  );

  // Run on mount + when state changes
  useEffect(() => {
    if (isActive) {
      fetchPage(1);
    } else {
      setItems([]);
      setPages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, isActive]);

  // ── Load more ──────────────────────────────────────────────────────────────
  const canLoadMore = hasMoreResults(pages);

  const handleLoadMore = useCallback(() => {
    const nextPage = currentPage + 1;
    setCurrentPage(nextPage);
    fetchPage(nextPage);
  }, [currentPage, fetchPage]);

  // ── Result count ───────────────────────────────────────────────────────────
  const resultCount = items.length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen bg-ink overflow-hidden">
      {/* Cinematic atmosphere behind content */}
      <CinematicAtmosphere className="fixed inset-0 pointer-events-none z-0" />

      {/* Content layer */}
      <main
        className={cn(
          'relative z-10',
          'pt-[72px]', // below fixed TopNav
        )}
      >
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 lg:px-16 py-14">
          {/* ── Search hero ── */}
          <header className="max-w-[880px] mx-auto mb-2 text-center">
            {/* Eyebrow */}
            <p className="font-ui text-[11px] tracking-[0.34em] uppercase text-gold mb-[18px]">
              Find something to watch
            </p>

            {/* Heading */}
            <h1 className="font-display font-light text-[clamp(40px,5.4vw,68px)] leading-[1.02] tracking-[-0.02em] mb-7">
              Search the{' '}
              <em className="italic text-gold-lite not-italic">collection</em>
            </h1>

            {/* Search input box */}
            <div
              className={cn(
                'relative flex items-center gap-3.5 h-[66px] px-[22px]',
                'border border-hairline rounded-[18px]',
                'bg-gradient-to-b from-surface-2 to-surface',
                'shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
                'transition-[border-color,box-shadow] duration-300',
                'focus-within:border-gold/60',
                'focus-within:shadow-[0_0_0_4px_rgba(201,168,106,0.14),inset_0_1px_0_rgba(255,255,255,0.04)]',
              )}
            >
              <SearchIcon className="text-gold flex-shrink-0 w-[22px] h-[22px]" />

              <input
                type="search"
                role="searchbox"
                aria-label="Search the collection"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Title, actor, director…"
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  'flex-1 min-w-0 bg-transparent border-0 outline-none',
                  'font-display font-light text-2xl tracking-[-0.01em] text-text',
                  'placeholder:text-muted',
                  // Remove browser search input default styling
                  '[&::-webkit-search-cancel-button]:hidden',
                )}
              />

              {/* Clear button */}
              {inputValue && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setInputValue('');
                    setState({ q: '' });
                  }}
                  className={cn(
                    'flex-shrink-0 w-[30px] h-[30px] rounded-full grid place-items-center',
                    'border border-hairline bg-transparent text-muted',
                    'transition-[color,border-color] duration-200',
                    'hover:text-text hover:border-gold',
                    'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                  )}
                >
                  <XIcon />
                </button>
              )}
            </div>

            {/* Result count line */}
            {isActive && (
              <p className="mt-4 font-ui text-[13.5px] text-muted" aria-live="polite">
                {isLoading && resultCount === 0 ? (
                  'Searching…'
                ) : state.q.trim() ? (
                  <>
                    <b className="text-gold-lite font-semibold">{resultCount}</b>{' '}
                    {resultCount === 1 ? 'result' : 'results'} for &lsquo;
                    <b className="text-gold-lite font-semibold">{state.q}</b>&rsquo;
                  </>
                ) : (
                  <>
                    <b className="text-gold-lite font-semibold">{resultCount}</b>{' '}
                    {resultCount === 1 ? 'result' : 'results'}
                  </>
                )}
              </p>
            )}
          </header>

          {/* ── Filters bar ── */}
          <div className="mt-10">
            <SearchFilters
              type={state.type}
              genre={state.genre}
              year={state.year}
              sort={state.sort}
              onChange={(partial) => setState(partial)}
            />
          </div>

          {/* ── Body: Results or GenreBrowse ── */}
          <div className="mt-6">
            {isActive ? (
              <ResultsGrid
                items={items}
                isLoading={isLoading}
                hasMore={canLoadMore}
                onLoadMore={handleLoadMore}
                emptyLabel={
                  isLoading
                    ? undefined
                    : state.q.trim()
                    ? `No results for "${state.q}" — try a different search.`
                    : 'No results for the selected filters.'
                }
              />
            ) : (
              <GenreBrowse onPick={(genreId) => setState({ genre: genreId })} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default SearchView;
