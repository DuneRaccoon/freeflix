'use client';

/**
 * SourcePicker — quality/source selector for the detail page.
 *
 * Renders an "Auto (best)" Pill plus one Pill per quality found in `hits`.
 * Each quality Pill shows the best hit's seeds + humanized file size.
 * When `hits` is empty, falls back to plain pills from `fallbackQualities`.
 *
 * Selected pill is gold (via the Pill `selected` prop).
 * Calling onChange(quality) lets the parent keep track of the chosen quality.
 *
 * 'auto' is the sentinel value for "pick best at streaming time".
 */

import React from 'react';
import Pill from '@/components/ui/fre/Pill';
import { cn } from '@/lib/cn';
import type { TorrentHit } from '@/types';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Convert raw byte count to a compact human-readable string, e.g. "2.1 GB". */
export function humanizeBytes(n: number): string {
  if (!n || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = n;
  let unit = 0;
  while (val >= 1024 && unit < units.length - 1) {
    val /= 1024;
    unit++;
  }
  // 1 decimal for GB+, no decimal for smaller
  const decimals = unit >= 3 ? 1 : 0;
  return `${val.toFixed(decimals)} ${units[unit]}`;
}

/**
 * Format seeds as a compact string, e.g. "1.2k" or "318".
 * Above 1000 → truncate to 1 decimal in "k" notation.
 */
function formatSeeds(seeds: number): string {
  if (seeds >= 1000) return `${(seeds / 1000).toFixed(1)}k`;
  return String(seeds);
}

/** A group of TorrentHits sharing the same quality label, plus the best hit. */
interface QualityGroup {
  quality: string;
  best: TorrentHit;
}

/**
 * Group hits by quality string, keeping only the hit with the most seeds per group.
 * Returns groups sorted by descending seed count (healthiest first).
 */
function groupByQuality(hits: TorrentHit[]): QualityGroup[] {
  const map = new Map<string, TorrentHit>();
  for (const hit of hits) {
    const q = hit.quality ?? 'Unknown';
    const existing = map.get(q);
    if (!existing || hit.seeds > existing.seeds) {
      map.set(q, hit);
    }
  }
  return Array.from(map.entries())
    .map(([quality, best]) => ({ quality, best }))
    .sort((a, b) => b.best.seeds - a.best.seeds);
}

// ── component ─────────────────────────────────────────────────────────────────

export interface SourcePickerProps {
  hits: TorrentHit[];
  value: string;
  onChange: (quality: string) => void;
  /** Used when hits is empty — render plain pills with no seed/size info. */
  fallbackQualities?: string[];
}

/**
 * A small seed-health dot: green when seeds ≥ 100, gold otherwise.
 */
function SeedDot({ seeds }: { seeds: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block w-[6px] h-[6px] rounded-full shrink-0',
        seeds >= 100
          ? 'bg-[#4caf6a] shadow-[0_0_6px_rgba(76,175,106,.7)]'
          : 'bg-gold shadow-[0_0_6px_rgba(201,168,106,.6)]',
      )}
    />
  );
}

const SourcePicker: React.FC<SourcePickerProps> = ({
  hits,
  value,
  onChange,
  fallbackQualities = [],
}) => {
  const groups = groupByQuality(hits);
  const hasHits = groups.length > 0;

  // Auto pill: sub-label shows info about the best overall hit (most seeds)
  const bestOverall = hasHits
    ? groups.reduce((a, b) => (a.best.seeds >= b.best.seeds ? a : b))
    : null;

  return (
    <div
      role="group"
      aria-label="Quality and source"
      className="flex flex-wrap gap-[10px]"
    >
      {/* ── Auto pill ── */}
      <Pill
        selected={value === 'auto'}
        onClick={() => onChange('auto')}
        data-testid="source-pill-auto"
        className={cn(
          // Override Pill's default rounded-full to match the card shape from mockup
          '!rounded-[12px] flex-col !items-start !h-auto py-[11px] px-[18px] gap-[3px]',
        )}
      >
        <span className="flex items-center gap-[7px] text-[14.5px] font-semibold">
          <span className="text-[10px] font-semibold tracking-[.1em] uppercase text-gold leading-none">
            Auto
          </span>
          <span className="font-normal text-[13px]">Best available</span>
        </span>
        {bestOverall && (
          <span
            className="text-[12px] text-muted flex items-center gap-[5px]"
            data-testid="source-pill-auto-meta"
          >
            {bestOverall.quality}
            {bestOverall.best.bytes > 0 && (
              <> · {humanizeBytes(bestOverall.best.bytes)}</>
            )}
            {bestOverall.best.seeds > 0 && (
              <>
                {' '}·{' '}
                <SeedDot seeds={bestOverall.best.seeds} />
                <span>{formatSeeds(bestOverall.best.seeds)} seeds</span>
              </>
            )}
          </span>
        )}
      </Pill>

      {/* ── Per-quality pills (from hits) ── */}
      {hasHits &&
        groups.map(({ quality, best }) => (
          <Pill
            key={quality}
            selected={value === quality}
            onClick={() => onChange(quality)}
            data-testid={`source-pill-${quality}`}
            className={cn(
              '!rounded-[12px] flex-col !items-start !h-auto py-[11px] px-[18px] gap-[3px]',
            )}
          >
            <span className="text-[14.5px] font-semibold">{quality}</span>
            <span
              className="text-[12px] text-muted flex items-center gap-[5px]"
              data-testid={`source-pill-${quality}-meta`}
            >
              {best.bytes > 0 && <>{humanizeBytes(best.bytes)} · </>}
              {best.seeds > 0 && (
                <>
                  <SeedDot seeds={best.seeds} />
                  <span>{formatSeeds(best.seeds)} seeds</span>
                </>
              )}
            </span>
          </Pill>
        ))}

      {/* ── Fallback plain pills (no hits) ── */}
      {!hasHits &&
        fallbackQualities.map((q) => (
          <Pill
            key={q}
            selected={value === q}
            onClick={() => onChange(q)}
            data-testid={`source-pill-${q}`}
            className="!rounded-[12px]"
          >
            {q}
          </Pill>
        ))}
    </div>
  );
};

export default SourcePicker;
