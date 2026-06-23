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
 *  - showMediaType?: boolean
 *      When true, marks each card (and the hero) with a movie/series cue.
 *      Used by the mixed home page; off on the single-type Movies/Series hubs.
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
import { FeedIdentity, resolveFeedTheme } from '@/lib/feedThemes';

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
  /** Curated-feed identity used to resolve a per-feed theme. */
  feed?: FeedIdentity;
}

export interface BrowseScreenProps {
  hero?: CatalogItem;
  featured?: CatalogItem[];
  rows: RowConfig[];
  showContinueWatching?: boolean;
  /** Mark each card + the hero with a movie/series cue (mixed home page only). */
  showMediaType?: boolean;
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
  showMediaType = false,
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
      {hero && <Hero item={hero} showMediaType={showMediaType} />}

      {/* ── 2. FeaturedRail (overlaps the hero's bottom edge) ── */}
      {hasFeatured && <FeaturedRail items={featured!} showMediaType={showMediaType} />}

      {/* ── 3. Continue Watching row ── */}
      {showContinueWatching && <ContinueWatchingRow />}

      {/* ── 4. Content rows ── */}
      {visibleRows.map((row) => {
        const theme = resolveFeedTheme(row.feed);

        if (row.variant === 'ranked') {
          return (
            <RankedRow
              key={row.key}
              title={row.title}
              eyebrow={row.eyebrow}
              items={row.items}
              seeAllHref={row.seeAllHref}
              theme={theme}
              showMediaType={showMediaType}
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
            theme={theme}
          >
            {row.items.map((item) => (
              <PosterCard
                key={`${item.media_type}-${item.tmdb_id}`}
                item={item}
                showMediaType={showMediaType}
              />
            ))}
          </Row>
        );
      })}
    </div>
  );
};

export default BrowseScreen;
