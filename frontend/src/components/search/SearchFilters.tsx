'use client';

/**
 * SearchFilters — type toggle + genre/year/sort filter chips.
 *
 * Renders:
 *  - A type toggle with three FRÈ Pills: All / Movies / Series
 *  - Three compact dropdown chips: Genre, Year, Sort
 *
 * Each chip opens a small popover listbox. Uses controlled open state so
 * clicking outside (blur on the wrapping div) closes it.
 *
 * Props:
 *   type     — active type filter ('all' | 'movie' | 'tv')
 *   genre    — active genre id (0 = all)
 *   year     — active year (0 = all)
 *   sort     — active sort value ('' = default)
 *   onChange — called with a partial update when any filter changes
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/cn';
import { Pill } from '@/components/ui/fre';
import { GENRE_OPTIONS, SORT_OPTIONS, YEAR_OPTIONS, PROVIDER_OPTIONS, ORIGIN_OPTIONS, COMPANY_OPTIONS, COLLECTION_OPTIONS, BEST_OF_OPTIONS } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchFiltersProps {
  type: 'all' | 'movie' | 'tv';
  genre: number;
  year: number;
  sort: string;
  provider: number;
  origin: string;
  company: number;
  collection: number;
  api: string;
  onChange: (partial: Partial<{ type: 'all' | 'movie' | 'tv'; genre: number; year: number; sort: string; provider: number; origin: string; company: number; collection: number; api: string }>) => void;
}

// ---------------------------------------------------------------------------
// Caret icon
// ---------------------------------------------------------------------------

function CaretDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('w-3 h-3 transition-transform duration-200', className)}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Check icon (selected state in popover)
// ---------------------------------------------------------------------------

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-3.5 h-3.5 text-gold-lite flex-shrink-0"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// FilterChip — a chip button that opens a popover listbox
// ---------------------------------------------------------------------------

interface FilterChipProps<T> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onSelect: (value: T) => void;
  defaultLabel?: string;
  'aria-label'?: string;
}

function FilterChip<T extends string | number>({
  label,
  value,
  options,
  onSelect,
  defaultLabel,
  'aria-label': ariaLabel,
}: FilterChipProps<T>) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click / focus leaving the wrapper
  const handleBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) {
      setOpen(false);
    }
  }, []);

  // Also close on Escape
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
    }
  }, []);

  const selected = options.find((o) => o.value === value);
  const hasSelection = typeof value === 'number' ? value !== 0 : value !== '';
  const displayValue = selected?.label ?? defaultLabel ?? label;

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        data-selected={hasSelection}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-2 h-10 px-4',
          'border rounded-[11px] font-ui text-sm font-medium',
          'transition-[border-color,background] duration-200',
          'outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
          hasSelection
            ? 'border-gold/40 bg-gold/5 text-text'
            : 'border-hairline bg-surface-2/60 text-text hover:border-gold/40 hover:bg-gold/5',
          open && 'border-gold/60 bg-gold/6',
        )}
      >
        <span className="text-muted font-normal">{label}</span>
        {hasSelection && <span className="text-gold-lite">{displayValue}</span>}
        <CaretDownIcon className={cn(open && 'rotate-180')} />
      </button>

      {/* Popover */}
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel ?? label}
          className={cn(
            'absolute top-[calc(100%+8px)] left-0 z-30 min-w-[180px]',
            'p-1.5 border border-hairline rounded-[13px]',
            'bg-[rgba(17,17,19,0.97)] backdrop-blur-[14px]',
            'shadow-[0_24px_60px_-18px_rgba(0,0,0,0.7)]',
          )}
        >
          {options.map((opt) => {
            const isActive = opt.value === value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onSelect(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex items-center justify-between gap-3.5 w-full',
                  'text-left font-ui text-[13px] px-3 py-2.5 rounded-lg',
                  'transition-[background,color] duration-150',
                  'outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                  isActive ? 'text-gold-lite' : 'text-text hover:bg-white/[0.04]',
                )}
              >
                <span>{opt.label}</span>
                {isActive && <CheckIcon />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year options with labels
// ---------------------------------------------------------------------------

const YEAR_OPTION_ITEMS: { value: number; label: string }[] = YEAR_OPTIONS.map((y) => ({
  value: y,
  label: y === 0 ? 'Any Year' : String(y),
}));

// ---------------------------------------------------------------------------
// SearchFilters
// ---------------------------------------------------------------------------

const SearchFilters: React.FC<SearchFiltersProps> = ({
  type,
  genre,
  year,
  sort,
  provider,
  origin,
  company,
  collection,
  api,
  onChange,
}) => {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3.5',
        'pb-6 border-b border-hairline',
      )}
    >
      {/* ── Type toggle ── */}
      <div
        role="group"
        aria-label="Result type"
        className={cn(
          'inline-flex items-center gap-1 p-1',
          'border border-hairline rounded-full bg-white/[0.02]',
        )}
      >
        {(
          [
            { value: 'all' as const, label: 'All' },
            { value: 'movie' as const, label: 'Movies' },
            { value: 'tv' as const, label: 'Series' },
          ] as const
        ).map((opt) => (
          <Pill
            key={opt.value}
            selected={type === opt.value}
            aria-pressed={type === opt.value}
            aria-label={opt.label}
            onClick={() => onChange({ type: opt.value })}
            className="h-9 px-[18px] text-[13px]"
          >
            {opt.label}
          </Pill>
        ))}
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1" aria-hidden="true" />

      {/* ── Genre chip ── */}
      <FilterChip
        label="Genre"
        value={genre}
        options={GENRE_OPTIONS}
        onSelect={(v) => onChange({ genre: v })}
        aria-label="Genre filter"
      />

      {/* ── Year chip ── */}
      <FilterChip
        label="Year"
        value={year}
        options={YEAR_OPTION_ITEMS}
        onSelect={(v) => onChange({ year: v })}
        aria-label="Year filter"
      />

      {/* ── Sort chip ── */}
      <FilterChip
        label="Sort"
        value={sort}
        options={SORT_OPTIONS}
        onSelect={(v) => onChange({ sort: v })}
        defaultLabel="Popular"
        aria-label="Sort by"
      />

      {/* ── Streaming chip (provider/network) ── */}
      <FilterChip
        label="Streaming"
        value={provider}
        options={PROVIDER_OPTIONS}
        onSelect={(v) => onChange({ provider: v })}
        aria-label="Streaming filter"
      />

      {/* ── Origin chip (+ Anime) ── */}
      <FilterChip
        label="Origin"
        value={origin}
        options={ORIGIN_OPTIONS}
        onSelect={(v) => onChange({ origin: v })}
        defaultLabel="Anywhere"
        aria-label="Origin filter"
      />

      {/* ── Best of year chip (a feed; if combined with discover filters the backend currently lets discover win) ── */}
      <FilterChip
        label="Best of"
        value={api}
        options={BEST_OF_OPTIONS}
        onSelect={(v) => onChange({ api: v })}
        defaultLabel="Any Year"
        aria-label="Best of year filter"
      />

      {/* ── Studio + Collection (movie-only) ── */}
      {type === 'movie' && (
        <>
          <FilterChip
            label="Studio"
            value={company}
            options={COMPANY_OPTIONS}
            onSelect={(v) => onChange({ company: v })}
            aria-label="Studio filter"
          />
          <FilterChip
            label="Saga"
            value={collection}
            options={COLLECTION_OPTIONS}
            onSelect={(v) => onChange({ collection: v })}
            aria-label="Collection filter"
          />
        </>
      )}
    </div>
  );
};

export default SearchFilters;
