'use client';

/**
 * MoviesBrowse — Movies hub page content component.
 *
 * Fetches in parallel:
 *  - moviesService.browse({ api: 'popular' })                             → hero + featured + Trending row
 *  - moviesService.browse({ api: 'top_rated' })                           → Top Rated (ranked) row
 *  - moviesService.browse({ api: 'popular', sort: 'primary_release_date.desc' }) → Latest row
 *  - moviesService.browse({ api: 'popular', genre: 28 })                 → Action & Adventure row
 *  - moviesService.browse({ api: 'popular', genre: 18 })                 → Drama row
 *
 * Each call degrades gracefully to an empty result on error.
 * Shows a skeleton while loading, then renders <BrowseScreen/>.
 * showContinueWatching is false — the Home page owns that section.
 */

import React, { useEffect, useState } from 'react';
import { CatalogItem, CatalogPage } from '@/types';
import { moviesService } from '@/services/movies';
import BrowseScreen, { RowConfig } from '@/components/browse/BrowseScreen';

// ---------------------------------------------------------------------------
// Empty page fallback
// ---------------------------------------------------------------------------

const emptyPage: CatalogPage = { page: 1, results: [], total_pages: 0, total_results: 0 };

async function safeBrowse(
  params: Parameters<typeof moviesService.browse>[0],
): Promise<CatalogPage> {
  try {
    return await moviesService.browse(params);
  } catch {
    return emptyPage;
  }
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function MoviesSkeleton() {
  return (
    <div
      data-testid="movies-skeleton"
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

export default function MoviesBrowse() {
  const [isLoading, setIsLoading] = useState(true);
  const [hero, setHero] = useState<CatalogItem | undefined>(undefined);
  const [featured, setFeatured] = useState<CatalogItem[]>([]);
  const [rows, setRows] = useState<RowConfig[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      setIsLoading(true);

      // Fetch all data sources in parallel; each degrades gracefully on error.
      const [popular, topRated, latest, actionPage, dramaPage] = await Promise.all([
        safeBrowse({ api: 'popular' }),
        safeBrowse({ api: 'top_rated' }),
        safeBrowse({ api: 'popular', sort: 'primary_release_date.desc' }),
        safeBrowse({ api: 'popular', genre: 28 }), // Action (movie genre id 28)
        safeBrowse({ api: 'popular', genre: 18 }), // Drama (movie genre id 18)
      ]);

      if (cancelled) return;

      // Derive hero + featured from the popular results.
      const heroItem = popular.results[0] as CatalogItem | undefined;
      const featuredItems = popular.results.slice(1, 7);

      const newRows: RowConfig[] = [
        {
          key: 'trending',
          title: 'Trending Movies',
          items: popular.results,
          seeAllHref: '/movies',
        },
        {
          key: 'top-rated',
          title: 'Top Rated Movies',
          items: topRated.results.slice(0, 10),
          variant: 'ranked',
        },
        {
          key: 'latest',
          title: 'New Releases',
          items: latest.results,
        },
        {
          key: 'action',
          title: 'Action & Adventure',
          eyebrow: 'Genre',
          items: actionPage.results,
        },
        {
          key: 'drama',
          title: 'Drama',
          eyebrow: 'Genre',
          items: dramaPage.results,
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
    return <MoviesSkeleton />;
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
