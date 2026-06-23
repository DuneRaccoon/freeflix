'use client';

/**
 * ResultsGrid — responsive PosterCard grid with skeleton, empty state, and Load More.
 *
 * Props:
 *   items       — array of CatalogItem to render as PosterCards
 *   isLoading   — when true and items is empty, shows a skeleton grid
 *   hasMore     — when true and onLoadMore is provided, shows "Load more" button
 *   onLoadMore  — callback for Load more
 *   emptyLabel  — message to show when not loading and no items
 *   showMediaType — mark each card with a movie/series pill (mixed results only)
 */

import React from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/fre';
import PosterCard from '@/components/browse/PosterCard';
import type { CatalogItem } from '@/types';

export interface ResultsGridProps {
  items: CatalogItem[];
  isLoading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  emptyLabel?: string;
  /** Mark each card with a movie/series pill — used when results are mixed. */
  showMediaType?: boolean;
}

/** Number of skeleton tiles shown while loading */
const SKELETON_COUNT = 12;

/** A single shimmer skeleton tile (2:3 aspect ratio poster shape) */
function SkeletonTile() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="aspect-[2/3] rounded-[11px] bg-surface-2 relative overflow-hidden">
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-surface-2 via-surface to-surface-2" />
      </div>
      <div className="h-4 rounded bg-surface-2 w-3/4 animate-pulse" />
      <div className="h-3 rounded bg-surface-2 w-1/2 animate-pulse" />
    </div>
  );
}

const ResultsGrid: React.FC<ResultsGridProps> = ({
  items,
  isLoading = false,
  hasMore = false,
  onLoadMore,
  emptyLabel = 'No results found.',
  showMediaType = false,
}) => {
  const showSkeleton = isLoading && items.length === 0;
  const showEmpty = !isLoading && items.length === 0;
  const showLoadMore = hasMore && !!onLoadMore;

  return (
    <div className="flex flex-col gap-8">
      {/* ── Skeleton state ── */}
      {showSkeleton && (
        <div
          role="status"
          aria-label="Loading results"
          className={cn(
            'grid gap-6',
            'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
          )}
        >
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <SkeletonTile key={i} />
          ))}
        </div>
      )}

      {/* ── Results grid ── */}
      {!showSkeleton && items.length > 0 && (
        <div
          className={cn(
            'grid gap-6',
            'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
          )}
        >
          {items.map((item) => (
            <PosterCard
              key={`${item.media_type}:${item.tmdb_id}`}
              item={item}
              showMediaType={showMediaType}
              // Override the fixed width from PosterCard so grid controls column sizing
              className="!w-auto"
            />
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {showEmpty && (
        <p
          role="status"
          className="text-center text-muted font-ui text-sm py-16"
        >
          {emptyLabel}
        </p>
      )}

      {/* ── Load more ── */}
      {showLoadMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="glass"
            size="md"
            onClick={onLoadMore}
            isLoading={isLoading}
            aria-label="Load more results"
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
};

export default ResultsGrid;
