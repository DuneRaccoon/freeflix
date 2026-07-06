'use client';

/**
 * useTitleImages — lazily resolve a landscape artwork URL for a set of titles.
 *
 * The Continue Watching row is built from streaming-progress rows, which carry
 * no artwork (only a content_id + title). This hook fetches each title's TMDB
 * detail once by tmdb id and returns its backdrop (falling back to poster),
 * keyed by a caller-supplied stable key. Results are memoised in a module-level
 * cache so navigating between browse screens doesn't refetch, and concurrent
 * requests for the same key are de-duped.
 *
 * Values: string = artwork URL, null = resolved with no artwork (or a failed
 * lookup — callers show their own placeholder), undefined = not yet loaded.
 */

import { useEffect, useState } from 'react';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';

export interface TitleImageRequest {
  /** Stable cache key, e.g. `movie:{id}` or `tv:{showId}`. */
  key: string;
  kind: 'movie' | 'tv';
  tmdbId: number;
}

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<void>>();

async function resolveOne(req: TitleImageRequest): Promise<void> {
  if (cache.has(req.key)) return;
  const existing = inflight.get(req.key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const detail =
        req.kind === 'movie'
          ? await moviesService.getDetail(req.tmdbId)
          : await tvService.getShow(req.tmdbId);
      cache.set(req.key, detail.backdrop_url ?? detail.poster_url ?? null);
    } catch {
      // Network/lookup failure → resolve to "no artwork"; the caller keeps its
      // own placeholder rather than surfacing an error for a cosmetic image.
      cache.set(req.key, null);
    } finally {
      inflight.delete(req.key);
    }
  })();

  inflight.set(req.key, p);
  return p;
}

export function useTitleImages(
  requests: TitleImageRequest[],
): Record<string, string | null | undefined> {
  const [, force] = useState(0);

  // Depend on a stable signature so the effect only re-runs when the set of
  // requested titles actually changes (not on every parent re-render).
  const signature = requests.map((r) => `${r.key}|${r.kind}|${r.tmdbId}`).join(',');

  useEffect(() => {
    let alive = true;
    const pending = requests.filter((r) => !cache.has(r.key));
    if (pending.length === 0) return;

    Promise.all(pending.map(resolveOne)).then(() => {
      if (alive) force((n) => n + 1);
    });

    return () => {
      alive = false;
    };
    // `signature` fully captures the meaningful contents of `requests`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const out: Record<string, string | null | undefined> = {};
  for (const r of requests) out[r.key] = cache.get(r.key);
  return out;
}

/** Test-only: clear the module-level cache between test cases. */
export function __resetTitleImageCache(): void {
  cache.clear();
  inflight.clear();
}
