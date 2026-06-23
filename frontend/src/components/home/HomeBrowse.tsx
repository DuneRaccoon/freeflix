'use client';

/**
 * HomeBrowse — Home page content component.
 *
 * Uses buildRailsScreen to fetch planner-driven carousels.
 * Shows a skeleton while loading, then renders <BrowseScreen/>.
 */

import React, { useEffect, useState } from 'react';
import { CatalogItem } from '@/types';
import { useUser } from '@/context/UserContext';
import { useWatchlist } from '@/context/WatchlistContext';
import { buildMixedRailsScreen } from '@/lib/buildMixedRailsScreen';
import { buildWatchlistRow, insertWatchlistRow } from '@/lib/watchlist/watchlistRow';
import BrowseScreen, { RowConfig } from '@/components/browse/BrowseScreen';

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function HomeSkeleton() {
  return (
    <div
      data-testid="home-skeleton"
      className="relative bg-ink text-text animate-pulse"
    >
      {/* Hero placeholder */}
      <div
        className="w-full bg-surface"
        style={{ height: 'clamp(620px,85vh,1040px)' }}
      />

      {/* Featured rail placeholder */}
      <div className="relative z-10 flex gap-4 px-6 py-6 -mt-16 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex-none bg-surface-2 rounded-card"
            style={{ width: 'clamp(360px,30vw,520px)', aspectRatio: '16/9' }}
          />
        ))}
      </div>

      {/* Row placeholders */}
      <div className="px-6 space-y-10 py-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="h-7 bg-surface-2 rounded w-48" />
            <div className="flex gap-4">
              {Array.from({ length: 5 }).map((_, j) => (
                <div
                  key={j}
                  className="flex-none bg-surface-2 rounded-card"
                  style={{ width: 'clamp(184px,15.5vw,272px)', aspectRatio: '2/3' }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HomeBrowse() {
  const { currentUser } = useUser();
  const { items: watchlistItems } = useWatchlist();
  const [isLoading, setIsLoading] = useState(true);
  const [hero, setHero] = useState<CatalogItem | undefined>(undefined);
  const [featured, setFeatured] = useState<CatalogItem[]>([]);
  const [rows, setRows] = useState<RowConfig[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const screen = await buildMixedRailsScreen();
      if (cancelled) return;
      setHero(screen.hero);
      setFeatured(screen.featured);
      setRows(screen.rows);
      setIsLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  if (isLoading) return <HomeSkeleton />;

  const displayRows = insertWatchlistRow(rows, buildWatchlistRow(watchlistItems, 'all'));

  return (
    <BrowseScreen hero={hero} featured={featured} rows={displayRows} showContinueWatching />
  );
}
