'use client';

/**
 * SeriesBrowse — Series/TV hub page content component.
 *
 * Fetches in parallel:
 *  - tvService.browse({ api: 'popular' })             → hero + featured + Trending Series row
 *  - tvService.browse({ api: 'top_rated' })           → Top Rated (ranked) row
 *  - tvService.browse({ api: 'on_the_air' })          → On The Air row
 *  - tvService.browse({ api: 'popular', genre: 10759 }) → Action & Adventure row
 *  - tvService.browse({ api: 'popular', genre: 10765 }) → Sci-Fi & Fantasy row
 *
 * Each call degrades gracefully to an empty result on error.
 * Shows a skeleton while loading, then renders <BrowseScreen/>.
 * showContinueWatching is false — the Home page owns that section.
 *
 * All CatalogItems from tvService have media_type:'tv', so PosterCards
 * automatically link to /tv/{tmdb_id}.
 */

import React, { useEffect, useState } from 'react';
import { CatalogItem, CatalogPage } from '@/types';
import { tvService } from '@/services/tv';
import BrowseScreen, { RowConfig } from '@/components/browse/BrowseScreen';

// ---------------------------------------------------------------------------
// Empty page fallback
// ---------------------------------------------------------------------------

const emptyPage: CatalogPage = { page: 1, results: [], total_pages: 0, total_results: 0 };

async function safeBrowse(
  params: Parameters<typeof tvService.browse>[0],
): Promise<CatalogPage> {
  try {
    return await tvService.browse(params);
  } catch {
    return emptyPage;
  }
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function SeriesSkeleton() {
  return (
    <div
      data-testid="series-skeleton"
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
        {Array.from({ length: 4 }).map((_, i) => (
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

export default function SeriesBrowse() {
  const [isLoading, setIsLoading] = useState(true);
  const [hero, setHero] = useState<CatalogItem | undefined>(undefined);
  const [featured, setFeatured] = useState<CatalogItem[]>([]);
  const [rows, setRows] = useState<RowConfig[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      setIsLoading(true);

      // Fetch all data sources in parallel; each degrades gracefully on error.
      const [popular, topRated, onTheAir, actionPage, sciFiPage] = await Promise.all([
        safeBrowse({ api: 'popular' }),
        safeBrowse({ api: 'top_rated' }),
        safeBrowse({ api: 'on_the_air' }),
        safeBrowse({ api: 'popular', genre: 10759 }), // Action & Adventure (TV genre id 10759)
        safeBrowse({ api: 'popular', genre: 10765 }), // Sci-Fi & Fantasy (TV genre id 10765)
      ]);

      if (cancelled) return;

      // Derive hero + featured from the popular results.
      const heroItem = popular.results[0] as CatalogItem | undefined;
      const featuredItems = popular.results.slice(1, 7);

      const newRows: RowConfig[] = [
        {
          key: 'trending',
          title: 'Trending Series',
          items: popular.results,
          seeAllHref: '/tv',
        },
        {
          key: 'top-rated',
          title: 'Top Rated Series',
          items: topRated.results.slice(0, 10),
          variant: 'ranked',
        },
        {
          key: 'on-the-air',
          title: 'On The Air',
          items: onTheAir.results,
        },
        {
          key: 'action',
          title: 'Action & Adventure',
          eyebrow: 'Genre',
          items: actionPage.results,
        },
        {
          key: 'scifi',
          title: 'Sci-Fi & Fantasy',
          eyebrow: 'Genre',
          items: sciFiPage.results,
        },
      ];

      setHero(heroItem);
      setFeatured(featuredItems);
      setRows(newRows);
      setIsLoading(false);
    }

    fetchAll();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return <SeriesSkeleton />;
  }

  return (
    <BrowseScreen
      hero={hero}
      featured={featured}
      rows={rows}
      showContinueWatching={false}
    />
  );
}
