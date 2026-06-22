'use client';
import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchState {
  q: string;
  type: 'all' | 'movie' | 'tv';
  genre: number;
  year: number;
  sort: string;
  provider: number;
  origin: string;
  company: number;
  collection: number;
  api: string;          // best_YYYY feed (mutually exclusive with discover filters)
}

export interface UseSearchUrlStateReturn {
  state: SearchState;
  setState: (partial: Partial<SearchState>) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULTS: SearchState = {
  q: '', type: 'all', genre: 0, year: 0, sort: '',
  provider: 0, origin: '', company: 0, collection: 0, api: '',
};

function parseType(raw: string | null): 'all' | 'movie' | 'tv' {
  if (raw === 'movie' || raw === 'tv') return raw;
  return 'all';
}

function parseNum(raw: string | null): number {
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function toQueryString(state: SearchState): string {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.type !== 'all') params.set('type', state.type);
  if (state.genre !== 0) params.set('genre', String(state.genre));
  if (state.year !== 0) params.set('year', String(state.year));
  if (state.sort) params.set('sort', state.sort);
  if (state.provider !== 0) params.set('provider', String(state.provider));
  if (state.origin) params.set('origin', state.origin);
  if (state.company !== 0) params.set('company', String(state.company));
  if (state.collection !== 0) params.set('collection', String(state.collection));
  if (state.api) params.set('api', state.api);
  return params.toString();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * URL-synced search state hook.
 *
 * Returns `{ state, setState }` where `setState(partial)` merges into local
 * state and synchronises the URL via `router.replace('/search?...')`, omitting
 * empty / default values from the querystring.
 *
 * SSR-safe: `useSearchParams()` returns an empty ReadonlyURLSearchParams on the
 * server, so the initial state falls back to defaults there.
 */
export function useSearchUrlState(): UseSearchUrlStateReturn {
  const params = useSearchParams();
  const router = useRouter();

  // Initialise once from URL params.
  const [state, setLocalState] = useState<SearchState>(() => ({
    q: params?.get('q') ?? DEFAULTS.q,
    type: parseType(params?.get('type')),
    genre: parseNum(params?.get('genre')),
    year: parseNum(params?.get('year')),
    sort: params?.get('sort') ?? DEFAULTS.sort,
    provider: parseNum(params?.get('provider')),
    origin: params?.get('origin') ?? DEFAULTS.origin,
    company: parseNum(params?.get('company')),
    collection: parseNum(params?.get('collection')),
    api: params?.get('api') ?? DEFAULTS.api,
  }));

  const setState = useCallback(
    (partial: Partial<SearchState>) => {
      setLocalState((prev) => {
        const next: SearchState = { ...prev, ...partial };
        const qs = toQueryString(next);
        router.replace('/search' + (qs ? '?' + qs : ''));
        return next;
      });
    },
    [router],
  );

  return { state, setState };
}
