'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@/context/UserContext';
import { watchlistService, WatchlistItem, WatchlistItemCreate, WatchlistItemUpdate } from '@/services/watchlist';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';

type WatchlistContextType = {
  /** Ordered list of saved items (newest first). */
  items: WatchlistItem[];
  /** Set of saved content_ids for O(1) membership checks. */
  savedIds: Set<string>;
  /** True while the initial load is in flight. */
  isLoading: boolean;
  /** Returns true if the given content_id is in the user's watchlist. */
  isSaved: (contentId: string) => boolean;
  /**
   * Toggle: if already saved → remove; otherwise → add.
   * item.title is optional metadata for display purposes.
   */
  toggle: (item: WatchlistItemCreate) => Promise<void>;
  /** Force a full refresh from the API. */
  refresh: () => Promise<void>;
};

const WatchlistContext = createContext<WatchlistContextType | undefined>(undefined);

export const WatchlistProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useUser();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const savedIds = React.useMemo(
    () => new Set(items.map((i) => i.content_id)),
    [items],
  );

  const refresh = useCallback(async () => {
    if (!currentUser) {
      setItems([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const data = await watchlistService.list(currentUser.id);
      setItems(data);
    } catch (err) {
      console.error('WatchlistContext: failed to fetch watchlist', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  // Reload whenever the active user changes.
  useEffect(() => {
    if (currentUser) {
      refresh();
    } else {
      setItems([]);
      setIsLoading(false);
    }
  }, [currentUser, refresh]);

  const isSaved = useCallback(
    (contentId: string) => savedIds.has(contentId),
    [savedIds],
  );

  const toggle = useCallback(
    async (item: WatchlistItemCreate) => {
      if (!currentUser) return;

      if (savedIds.has(item.content_id)) {
        // Optimistic remove
        setItems((prev) => prev.filter((i) => i.content_id !== item.content_id));
        try {
          await watchlistService.remove(currentUser.id, item.content_id);
        } catch (err) {
          console.error('WatchlistContext: failed to remove item', err);
          // Roll back on failure
          await refresh();
        }
      } else {
        // Optimistic add: create a fake local record so the UI updates instantly.
        const optimistic: WatchlistItem = {
          id: `optimistic-${item.content_id}`,
          user_id: currentUser.id,
          content_id: item.content_id,
          tmdb_id: item.tmdb_id,
          media_type: item.media_type,
          title: item.title ?? null,
          poster_url: item.poster_url ?? null,
          year: item.year ?? null,
          vote_average: item.vote_average ?? null,
          added_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        setItems((prev) => [optimistic, ...prev]);
        try {
          const saved = await watchlistService.add(currentUser.id, item);
          // Replace the optimistic record with the real one.
          setItems((prev) =>
            prev.map((i) => (i.id === optimistic.id ? saved : i)),
          );
        } catch (err: any) {
          // 409 = already saved; just refresh so state is accurate.
          if (err?.response?.status === 409) {
            await refresh();
          } else {
            console.error('WatchlistContext: failed to add item', err);
            // Roll back
            setItems((prev) => prev.filter((i) => i.id !== optimistic.id));
          }
        }
      }
    },
    [currentUser, savedIds, refresh],
  );

  // Lazy backfill: older saved rows (and any save predating metadata retention)
  // have no poster_url. Hydrate them from the catalog API once, patch them in
  // memory for an immediate correct render, and persist the result so future
  // loads — and the Home/Movies/Series carousels — are correct.
  const healedRef = useRef<Set<string>>(new Set());

  async function hydrateItem(userId: string, item: WatchlistItem) {
    try {
      const tmdbId = Number(item.tmdb_id);
      let patch: WatchlistItemUpdate;
      if (item.media_type === 'tv') {
        const show = await tvService.getShow(tmdbId);
        patch = {
          poster_url: show.poster_url,
          year: show.year,
          vote_average: show.vote_average,
          title: item.title ?? show.name,
        };
      } else {
        const movie = await moviesService.getDetail(tmdbId);
        patch = {
          poster_url: movie.poster_url,
          year: movie.year,
          vote_average: movie.vote_average,
          title: item.title ?? movie.title,
        };
      }
      setItems((prev) =>
        prev.map((i) => (i.content_id === item.content_id ? { ...i, ...patch } : i)),
      );
      await watchlistService.update(userId, item.content_id, patch);
    } catch (err) {
      console.error('WatchlistContext: failed to hydrate item', item.content_id, err);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    const userId = currentUser.id;
    const needsHeal = items.filter(
      (i) =>
        !i.poster_url &&
        !i.id.startsWith('optimistic-') &&
        !healedRef.current.has(i.content_id),
    );
    if (needsHeal.length === 0) return;
    needsHeal.forEach((item) => {
      healedRef.current.add(item.content_id);
      hydrateItem(userId, item);
    });
    // hydrateItem is recreated each render but the effect intentionally depends
    // only on items + currentUser; healedRef prevents duplicate hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, currentUser]);

  return (
    <WatchlistContext.Provider
      value={{ items, savedIds, isLoading, isSaved, toggle, refresh }}
    >
      {children}
    </WatchlistContext.Provider>
  );
};

export const useWatchlist = () => {
  const context = useContext(WatchlistContext);
  if (context === undefined) {
    throw new Error('useWatchlist must be used within a WatchlistProvider');
  }
  return context;
};
