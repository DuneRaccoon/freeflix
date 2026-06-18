'use client';

/**
 * RankedRow — Top-10 editorial ranked row for browse pages.
 *
 * Props:
 *  - title: string           Fraunces section title (e.g. "Top 10 Movies This Week")
 *  - items: CatalogItem[]    Content items; capped at 10
 *  - seeAllHref?: string     Optional "See all ›" link
 *
 * Each item pairs a LARGE outlined editorial numeral (Fraunces, gold
 * -webkit-text-stroke) with the item's 2:3 poster, linking to its detail page.
 *
 * Mirrors the "Top 10" row in browse-mockup-v5.html.
 */

import React, { useRef } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { CatalogItem } from '@/types';

export interface RankedRowProps {
  title: string;
  eyebrow?: string;
  items: CatalogItem[];
  seeAllHref?: string;
}

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-[15px] h-[15px]"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-[15px] h-[15px]"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

/** Approximate one ranked card width for arrow scrolling */
const ONE_CARD_PX = 300;

/** Fallback placeholder — near-black 2:3 SVG data URI */
const POSTER_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3"%3E%3Crect width="2" height="3" fill="%230d0d0f"/%3E%3C/svg%3E';

const RankedRow: React.FC<RankedRowProps> = ({ title, eyebrow, items, seeAllHref }) => {
  const trackRef = useRef<HTMLDivElement>(null);

  // Cap at 10 items
  const capped = items.slice(0, 10);

  const headingId = `ranked-row-heading-${title.replace(/\s+/g, '-').toLowerCase()}`;

  function scrollPrev() {
    trackRef.current?.scrollBy({ left: -ONE_CARD_PX, behavior: 'smooth' });
  }

  function scrollNext() {
    trackRef.current?.scrollBy({ left: ONE_CARD_PX, behavior: 'smooth' });
  }

  return (
    <section
      className="relative z-[2] px-14 max-sm:px-[18px]"
      aria-labelledby={headingId}
    >
      {/* ── Row header ── */}
      <div className="flex items-end justify-between gap-6 pt-[54px] pb-[22px] max-sm:pt-10 max-sm:pb-[18px]">
        {/* Left: eyebrow + title */}
        <div className="flex flex-col gap-1.5">
          {eyebrow && (
            <span className="text-[11px] tracking-[.32em] uppercase text-gold font-semibold">
              {eyebrow}
            </span>
          )}
          <h2
            id={headingId}
            className="font-display font-normal text-[30px] leading-none tracking-[-0.02em] text-text m-0 max-sm:text-[25px]"
          >
            {title}
          </h2>
        </div>

        {/* Right: See all link + prev/next arrows */}
        <div className="flex items-center gap-3.5 max-sm:gap-2">
          {seeAllHref && (
            <a
              href={seeAllHref}
              className={cn(
                'text-[12px] tracking-[.04em] text-muted no-underline',
                'inline-flex items-center gap-1.5 whitespace-nowrap',
                'pb-[3px] border-b border-transparent',
                'transition-[color,border-color] duration-[250ms]',
                'hover:text-gold-lite hover:border-hairline',
                'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)] focus-visible:rounded',
              )}
            >
              See all
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="w-[13px] h-[13px]"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </a>
          )}

          {/* Prev / Next arrow buttons — hidden on mobile */}
          <div
            className="inline-flex items-center gap-2 max-sm:hidden"
            role="group"
            aria-label={`Scroll ${title}`}
          >
            <button
              type="button"
              onClick={scrollPrev}
              aria-label="Scroll left"
              className={cn(
                'w-8 h-8 flex-none rounded-full grid place-items-center cursor-pointer',
                'border border-hairline bg-surface-2/60 text-text',
                'transition-[border-color,color,background] duration-200',
                'hover:border-gold/55 hover:text-gold-lite hover:bg-surface-2/85',
                'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
              )}
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              onClick={scrollNext}
              aria-label="Scroll right"
              className={cn(
                'w-8 h-8 flex-none rounded-full grid place-items-center cursor-pointer',
                'border border-hairline bg-surface-2/60 text-text',
                'transition-[border-color,color,background] duration-200',
                'hover:border-gold/55 hover:text-gold-lite hover:bg-surface-2/85',
                'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
              )}
            >
              <ChevronRightIcon />
            </button>
          </div>
        </div>
      </div>

      {/* ── Horizontal scroll-snap track ── */}
      <div
        ref={trackRef}
        role="list"
        tabIndex={0}
        aria-labelledby={headingId}
        className={cn(
          'flex gap-[18px] overflow-x-auto',
          '[scroll-snap-type:x_proximity] [scroll-padding-left:4px]',
          'scroll-smooth',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          'pb-2 pt-[2px] px-1',
          'focus:outline-none',
        )}
      >
        {capped.map((item, index) => {
          const rank = index + 1;
          const href =
            item.media_type === 'tv' ? `/tv/${item.tmdb_id}` : `/movies/${item.tmdb_id}`;

          return (
            <article
              key={item.tmdb_id}
              role="listitem"
              className="relative flex items-end flex-none [scroll-snap-align:start]"
              style={{ width: 'clamp(264px, 22vw, 348px)', paddingLeft: '8px' }}
            >
              <Link
                href={href}
                aria-label={`Number ${rank}: ${item.title}`}
                className={cn(
                  'group flex items-end no-underline text-inherit rounded-[10px]',
                  'focus:outline-none',
                  'focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                  'focus-visible:rounded-[10px]',
                )}
              >
                {/* Editorial rank numeral */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'font-display font-light leading-[.7] tracking-[-0.04em]',
                    'select-none z-[1] transition-[text-shadow] duration-300',
                    // Text shadow glow — static (no keyframe = GPU-compositable)
                    '[text-shadow:0_0_18px_rgba(201,168,106,.22),0_0_40px_rgba(201,168,106,.1)]',
                    'group-hover:[text-shadow:0_0_26px_rgba(201,168,106,.35)]',
                    // Outlined gold numerals via CSS text stroke
                    '[color:transparent] [-webkit-text-stroke:1.6px_rgba(201,168,106,.72)]',
                    'group-hover:[-webkit-text-stroke-color:var(--color-gold)]',
                  )}
                  style={{
                    fontSize: 'clamp(160px, 15vw, 212px)',
                    marginRight: '-22px',
                    marginBottom: '-6px',
                  }}
                >
                  {rank}
                </span>

                {/* 2:3 poster art */}
                <div
                  className={cn(
                    'relative z-[2] flex-none aspect-[2/3] rounded-[10px] overflow-hidden border border-hairline',
                    'bg-surface',
                    'transition-[transform,box-shadow] duration-300',
                    'group-hover:-translate-y-1.5 group-hover:shadow-[0_18px_44px_rgba(0,0,0,.6)]',
                    // Sheen pseudo-element effect via ::after — applied via a wrapper
                  )}
                  style={{ width: 'clamp(152px, 13vw, 200px)' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.poster_url ?? POSTER_PLACEHOLDER}
                    alt={item.title}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = POSTER_PLACEHOLDER;
                    }}
                  />
                </div>
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default RankedRow;
