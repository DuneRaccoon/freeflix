'use client';

/**
 * FeaturedRail — Large 16:9 featured tiles that overlap the Hero billboard.
 *
 * Props:
 *  - items: CatalogItem[]   Content items to show as featured tiles
 *
 * Each tile shows the item's backdrop image, a gold "Featured" pill badge,
 * a Fraunces title overlay, and a hover play affordance. The whole card links
 * to the item's detail page. The rail is pulled UP over the hero bottom edge
 * via a negative margin-top so featured tiles overlap the hero, matching the
 * Disney+-inspired treatment in the FRÈ browse mockup (browse-mockup-v5.html).
 *
 * Returns null when items is empty — so the hero is not left with a dead gap.
 */

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { CatalogItem } from '@/types';
import MediaTypeBadge from './MediaTypeBadge';

export interface FeaturedRailProps {
  items: CatalogItem[];
  /** Show a movie/series corner pill on each tile — mixed home page only. */
  showMediaType?: boolean;
}

/** Fallback backdrop — near-black 16:9 SVG data URI */
const BACKDROP_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"%3E%3Crect width="16" height="9" fill="%230d0d0f"/%3E%3C/svg%3E';

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="w-[18px] h-[18px] ml-px"
    >
      <path d="M7 5v14l11-7z" />
    </svg>
  );
}

const FeaturedRail: React.FC<FeaturedRailProps> = ({ items, showMediaType }) => {
  if (!items || items.length === 0) return null;

  return (
    <section
      aria-label="Featured collection"
      className="relative z-[5] px-14 max-sm:px-[18px]"
      style={{
        // extra -10px keeps the same hero overlap after the track gained
        // vertical padding (py-4) below.
        marginTop: 'clamp(-178px, calc(-11vh - 10px), -114px)',
        marginBottom: '10px',
      }}
    >
      {/* Horizontal scroll-snap track */}
      <div
        role="list"
        aria-label="Featured"
        tabIndex={0}
        className={cn(
          'flex gap-[22px] overflow-x-auto',
          '[scroll-snap-type:x_proximity]',
          'scroll-smooth',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          // vertical room so the hover scale-up isn't clipped by overflow-x-auto
          'py-4 px-2',
          'focus:outline-none',
        )}
      >
        {items.map((item) => {
          const href =
            item.media_type === 'tv'
              ? `/tv/${item.tmdb_id}`
              : `/movies/${item.tmdb_id}`;

          const backdropSrc = item.backdrop_url ?? BACKDROP_PLACEHOLDER;

          return (
            <Link
              key={`${item.media_type}-${item.tmdb_id}`}
              href={href}
              aria-label={item.title}
              className={cn(
                'group relative flex-none overflow-hidden rounded-[14px]',
                'aspect-[16/9] border border-hairline',
                'bg-surface no-underline text-text',
                '[scroll-snap-align:start]',
                // Depth shadow
                'shadow-[0_24px_60px_rgba(0,0,0,.5)]',
                // Smooth scale-up + gold glow + border warm-up.
                // No upward lift → the card never grows into the overlapped
                // hero where overflow-x-auto would clip its top (the "jagged" look).
                'transition-[transform,box-shadow,border-color] duration-[360ms] ease-card will-change-transform',
                'origin-center hover:scale-[1.035] hover:z-10',
                'hover:border-gold/50',
                'hover:shadow-[0_26px_64px_rgba(0,0,0,.6),0_0_40px_rgba(201,168,106,.22)]',
                // Focus ring
                'focus:outline-none',
                'focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
              )}
              style={{ width: 'clamp(360px, 30vw, 520px)' }}
            >
              {/* Backdrop image */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={backdropSrc}
                alt=""
                aria-hidden="true"
                className={cn(
                  'absolute inset-0 w-full h-full object-cover',
                  'transition-transform duration-500 ease-[ease]',
                  'group-hover:scale-[1.06]',
                )}
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = BACKDROP_PLACEHOLDER;
                }}
              />

              {/* Gradient scrims for text legibility */}
              <div
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: [
                    'linear-gradient(0deg, rgba(7,7,9,.88) 0%, rgba(7,7,9,.2) 40%, transparent 66%)',
                    'linear-gradient(90deg, rgba(7,7,9,.5), transparent 58%)',
                  ].join(', '),
                }}
              />

              {/* Gold "Featured" badge */}
              <span
                className={cn(
                  'absolute top-3.5 left-3.5 z-[2]',
                  'font-ui text-[10px] tracking-[.22em] uppercase text-ink font-semibold',
                  'bg-gradient-to-r from-gold-lite to-gold',
                  'px-[11px] py-[5px] rounded-full',
                )}
              >
                Featured
              </span>

              {/* Media-type pill (home page only) — top-right, opposite "Featured" */}
              {showMediaType && (
                <MediaTypeBadge
                  mediaType={item.media_type}
                  revealOnHover
                  className="absolute top-3.5 right-3.5 z-[2] pointer-events-none"
                />
              )}

              {/* Title overlay (bottom-left) */}
              <span
                className={cn(
                  'absolute left-[22px] bottom-5 right-[70px] z-[2]',
                  'font-display font-medium leading-[1.04] tracking-[-0.01em] text-white',
                  '[text-shadow:0_2px_22px_rgba(0,0,0,.6)]',
                )}
                style={{ fontSize: 'clamp(22px, 1.9vw, 30px)' }}
              >
                {item.title}
              </span>

              {/* Play affordance (bottom-right, visible on hover) */}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute right-[18px] bottom-[18px] z-[2]',
                  'w-[46px] h-[46px] rounded-full',
                  'grid place-items-center',
                  'bg-white/12 border border-white/25 text-white',
                  'backdrop-blur-sm',
                  'transition-[background,border-color,transform,color] duration-[250ms]',
                  'group-hover:bg-gradient-to-r group-hover:from-gold-lite group-hover:to-gold',
                  'group-hover:border-transparent group-hover:text-ink group-hover:scale-[1.08]',
                )}
              >
                <PlayIcon />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
};

export default FeaturedRail;
