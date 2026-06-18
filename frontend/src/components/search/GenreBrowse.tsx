'use client';

/**
 * GenreBrowse — "Browse by genre" empty-state section.
 *
 * Renders a heading and a responsive grid of genre tiles for each
 * GENRE_OPTIONS entry except value 0 ("All Genres"). Each tile is a
 * <button> that calls onPick(value) when clicked, styled with FRÈ tokens:
 * gold-on-hover, dark background, hairline border.
 *
 * Shown when there is no active search query or filter.
 */

import React from 'react';
import { cn } from '@/lib/cn';
import { GENRE_OPTIONS } from '@/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GenreBrowseProps {
  /** Called with the genre id when a tile is clicked. */
  onPick: (genreId: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const GenreBrowse: React.FC<GenreBrowseProps> = ({ onPick }) => {
  // Exclude the "All Genres" sentinel (value 0)
  const genres = GENRE_OPTIONS.filter((g) => g.value !== 0);

  return (
    <section aria-label="Browse by genre">
      {/* Section heading */}
      <div className="mb-8">
        <p className="font-ui text-[11px] tracking-[0.34em] uppercase text-gold mb-3">
          Discover
        </p>
        <h2 className="font-display font-light text-[clamp(28px,3.5vw,42px)] leading-[1.05] tracking-[-0.02em] text-text">
          Browse by <em className="italic text-gold-lite not-italic">genre</em>
        </h2>
      </div>

      {/* Genre tiles grid */}
      <div
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
        role="list"
      >
        {genres.map((genre) => (
          <div key={genre.value} role="listitem">
            <button
              type="button"
              onClick={() => onPick(genre.value)}
              className={cn(
                // Base layout
                'relative w-full aspect-[3/2] rounded-[13px] overflow-hidden',
                'flex items-end p-4',
                // Background & border
                'bg-surface-2 border border-hairline',
                // Text
                'font-ui text-[13px] font-medium text-muted',
                // Transitions
                'transition-[border-color,background,color,transform,box-shadow] duration-250 ease-[ease]',
                // Hover: gold glow
                'hover:border-gold/50 hover:bg-surface hover:text-gold-lite',
                'hover:shadow-[0_8px_32px_rgba(201,168,106,0.12)] hover:-translate-y-0.5',
                // Gold focus ring (FRÈ standard)
                'focus:outline-none',
                'focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                'focus-visible:text-gold-lite focus-visible:border-gold/50',
              )}
              aria-label={genre.label}
            >
              {/* Subtle decorative gradient overlay */}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-0 pointer-events-none',
                  'bg-[radial-gradient(ellipse_at_top_right,rgba(201,168,106,0.06),transparent_65%)]',
                  'opacity-0 transition-opacity duration-250',
                  'group-hover:opacity-100',
                )}
              />

              {/* Genre label */}
              <span className="relative z-10 text-left leading-tight">
                {genre.label}
              </span>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};

export default GenreBrowse;
