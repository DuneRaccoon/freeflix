import React, { Suspense } from 'react';
import { cn } from '@/lib/cn';
import SearchView from '@/components/search/SearchView';

// ---------------------------------------------------------------------------
// SearchSkeleton — a FRÈ-themed fallback shown while useSearchParams resolves.
// Matches the general layout: hero bar + filters strip + grid of shimmer tiles.
// ---------------------------------------------------------------------------

function ShimmerTile({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-[11px] bg-surface-2 overflow-hidden',
        'relative before:absolute before:inset-0',
        'before:bg-[linear-gradient(90deg,transparent_25%,rgba(255,255,255,0.04)_50%,transparent_75%)]',
        'before:animate-[shimmer_1.8s_ease-in-out_infinite]',
        className,
      )}
      aria-hidden="true"
    />
  );
}

function SearchSkeleton() {
  return (
    <div
      className="relative min-h-screen bg-ink overflow-hidden"
      aria-label="Loading search…"
      role="status"
    >
      {/* Content layer */}
      <div className="relative z-10 pt-[72px]">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 lg:px-16 py-14">

          {/* ── Hero area ── */}
          <div className="max-w-[880px] mx-auto mb-10 text-center flex flex-col items-center gap-5">
            {/* Eyebrow shimmer */}
            <ShimmerTile className="h-3 w-40 rounded-full" />

            {/* Heading shimmer */}
            <ShimmerTile className="h-14 w-[480px] max-w-full rounded-[10px]" />

            {/* Search input shimmer */}
            <ShimmerTile className="h-[66px] w-full rounded-[18px] border border-hairline" />
          </div>

          {/* ── Filters strip shimmer ── */}
          <div className="flex flex-wrap gap-3 mb-8">
            {['w-16', 'w-20', 'w-20', 'w-28', 'w-24', 'w-24'].map((w, i) => (
              <ShimmerTile key={i} className={cn('h-9 rounded-full border border-hairline', w)} />
            ))}
          </div>

          {/* ── Grid shimmer ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                {/* Poster tile */}
                <ShimmerTile className="aspect-[2/3] w-full rounded-[11px] border border-hairline" />
                {/* Caption lines */}
                <ShimmerTile className="h-[15px] w-4/5 rounded-full" />
                <ShimmerTile className="h-[11px] w-1/2 rounded-full" />
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page — thin wrapper; Suspense required because SearchView uses useSearchParams
// ---------------------------------------------------------------------------

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchView />
    </Suspense>
  );
}
