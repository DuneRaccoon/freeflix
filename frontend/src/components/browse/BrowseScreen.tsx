'use client';

/**
 * BrowseScreen — composes the full browse page from hero + featured + continue
 * watching + content rows.
 *
 * Props:
 *  - hero?: CatalogItem
 *      Full-bleed Hero billboard. Skipped when not provided.
 *  - featured?: CatalogItem[]
 *      Tiles shown in the FeaturedRail (overlaps the Hero). Skipped when empty.
 *  - rows: Array<RowConfig>
 *      Content rows. Each may be 'poster' (default, uses Row + PosterCard) or
 *      'ranked' (uses RankedRow). Rows with zero items are skipped silently.
 *  - showContinueWatching?: boolean
 *      When true, renders <ContinueWatchingRow/> below the FeaturedRail.
 *
 * Render order:
 *  1. Hero
 *  2. FeaturedRail (overlaps Hero bottom edge)
 *  3. ContinueWatchingRow (when showContinueWatching is true)
 *  4. Content rows (poster / ranked)
 *
 * This is the shared page body used by Home, Movies, and Series pages.
 */

import React from 'react';
import { cn } from '@/lib/cn';
import { CatalogItem } from '@/types';
import Hero from './Hero';
import FeaturedRail from './FeaturedRail';
import ContinueWatchingRow from './ContinueWatchingRow';
import Row from './Row';
import RankedRow from './RankedRow';
import PosterCard from './PosterCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RowConfig {
  /** Stable React key */
  key: string;
  /** Fraunces section title */
  title: string;
  /** Optional gold uppercase eyebrow (poster rows only) */
  eyebrow?: string;
  /** Optional "See all ›" href */
  seeAllHref?: string;
  /** Content items */
  items: CatalogItem[];
  /** 'poster' = Row + PosterCard grid; 'ranked' = RankedRow with numerals */
  variant?: 'poster' | 'ranked';
}

export interface BrowseScreenProps {
  hero?: CatalogItem;
  featured?: CatalogItem[];
  rows: RowConfig[];
  showContinueWatching?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const BrowseScreen: React.FC<BrowseScreenProps> = ({
  hero,
  featured,
  rows,
  showContinueWatching = false,
  className,
}) => {
  const hasFeatured = (featured ?? []).length > 0;

  // Filter out rows with no items so we don't render empty section headers.
  const visibleRows = rows.filter((r) => r.items.length > 0);

  return (
    <div
      data-testid="browse-screen"
      className={cn('relative bg-ink text-text', className)}
    >
      {/* ── 1. Hero billboard ── */}
      {hero && <Hero item={hero} />}

      {/* ── 2. FeaturedRail (overlaps the hero's bottom edge) ── */}
      {hasFeatured && <FeaturedRail items={featured!} />}

      {/* ── 3. Continue Watching row ── */}
      {showContinueWatching && <ContinueWatchingRow />}

      {/* ── 4. Content rows ── */}
      {visibleRows.map((row) => {
        if (row.variant === 'ranked') {
          return (
            <RankedRow
              key={row.key}
              title={row.title}
              eyebrow={row.eyebrow}
              items={row.items}
              seeAllHref={row.seeAllHref}
            />
          );
        }

        // Default: poster row
        return (
          <Row
            key={row.key}
            title={row.title}
            eyebrow={row.eyebrow}
            seeAllHref={row.seeAllHref}
          >
            {row.items.map((item) => (
              <PosterCard key={item.tmdb_id} item={item} />
            ))}
          </Row>
        );
      })}
    </div>
  );
};

export default BrowseScreen;
