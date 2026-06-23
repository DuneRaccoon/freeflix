'use client';

/**
 * MyListView — FRÈ "My List" page body.
 *
 * Reads the current user's watchlist via WatchlistContext and renders
 * FRÈ PosterCards in a responsive masonry-style grid.  While loading,
 * a skeleton is shown.  When the list is empty an empty state guides the
 * user toward browsing.
 *
 * Removing an item is handled entirely by PosterCard's overlay "My List"
 * toggle button — no extra wiring needed here.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useWatchlist } from '@/context/WatchlistContext';
import PosterCard from '@/components/browse/PosterCard';
import { cn } from '@/lib/cn';
import { watchlistItemToCatalogItem } from '@/lib/watchlist/toCatalogItem';

// ---------------------------------------------------------------------------
// Skeleton placeholder
// ---------------------------------------------------------------------------

function MyListSkeleton() {
  return (
    <div
      className="grid gap-x-5 gap-y-10"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, clamp(184px, 15.5vw, 272px))',
      }}
      aria-busy="true"
      aria-label="Loading your list"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div
            className="rounded-[11px] bg-surface aspect-[2/3]"
            style={{ width: 'clamp(184px, 15.5vw, 272px)' }}
          />
          <div className="mt-[11px] space-y-[6px]">
            <div className="h-[15px] w-4/5 rounded bg-surface" />
            <div className="h-[12px] w-1/3 rounded bg-surface" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function BookmarkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-14 h-14 text-muted"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-28 text-center">
      <BookmarkIcon />
      <div className="space-y-2">
        <p className="font-display font-normal text-[26px] leading-none tracking-[-0.02em] text-text">
          Your list is empty
        </p>
        <p className="text-[14px] leading-[1.6] text-muted max-w-[360px]">
          Add movies and series with the{' '}
          <span className="text-gold-lite font-semibold">+</span> button on any
          poster, or from a title&apos;s detail page.
        </p>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <Link
          href="/movies"
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-5 py-2.5',
            'font-ui text-[13px] font-medium tracking-[0.01em]',
            'bg-gold text-ink',
            'transition-[filter,transform] duration-200 hover:brightness-110 hover:scale-[1.03]',
            'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
          )}
        >
          Browse Movies
        </Link>
        <Link
          href="/tv"
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-5 py-2.5',
            'font-ui text-[13px] font-medium tracking-[0.01em]',
            'border border-hairline text-text',
            'transition-[border-color,color,transform] duration-200',
            'hover:border-gold/50 hover:text-gold-lite hover:scale-[1.03]',
            'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
          )}
        >
          Browse Series
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

type ListFilter = 'all' | 'movie' | 'tv';

const TABS: { id: ListFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv', label: 'Series' },
];

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

const MyListView: React.FC = () => {
  const { items, isLoading } = useWatchlist();
  const [filter, setFilter] = useState<ListFilter>('all');

  const visibleItems =
    filter === 'all' ? items : items.filter((i) => i.media_type === filter);

  return (
    <div
      data-testid="my-list-view"
      className="min-h-screen bg-ink text-text px-14 max-sm:px-[18px] pt-10 pb-20"
    >
      {/* ── Page header ── */}
      <header className="mb-10">
        <p className="text-[11px] tracking-[.32em] uppercase text-gold font-semibold mb-2">
          Your Collection
        </p>
        <h1 className="font-display font-normal text-[40px] leading-none tracking-[-0.025em] text-text m-0 max-sm:text-[30px]">
          My List
        </h1>
        {!isLoading && visibleItems.length > 0 && (
          <p className="mt-3 text-[13px] text-muted">
            {visibleItems.length} {visibleItems.length === 1 ? 'title' : 'titles'} saved
          </p>
        )}
      </header>

      {/* ── Type filter tabs ── */}
      {!isLoading && items.length > 0 && (
        <div
          role="tablist"
          aria-label="Filter saved titles"
          data-testid="my-list-tabs"
          className="mb-8 inline-flex gap-1 rounded-full border border-hairline bg-surface/60 p-1"
        >
          {TABS.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`my-list-tab-${tab.id}`}
                onClick={() => setFilter(tab.id)}
                className={cn(
                  'rounded-full px-4 py-1.5 font-ui text-[13px] font-medium tracking-[0.01em]',
                  'transition-[background-color,color] duration-200',
                  'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                  active ? 'bg-gold text-ink' : 'text-muted hover:text-text',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Content ── */}
      {isLoading ? (
        <MyListSkeleton />
      ) : items.length === 0 || visibleItems.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          data-testid="my-list-grid"
          className="flex flex-wrap gap-x-5 gap-y-10"
        >
          {visibleItems.map((item) => (
            <PosterCard
              key={item.content_id}
              item={watchlistItemToCatalogItem(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default MyListView;
