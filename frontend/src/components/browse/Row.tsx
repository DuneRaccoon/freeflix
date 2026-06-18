'use client';

/**
 * Row — labelled horizontal scroll-snap carousel for browse pages.
 *
 * Props:
 *  - title: string           Fraunces section title
 *  - eyebrow?: string        Optional gold uppercase eyebrow above title
 *  - seeAllHref?: string     Renders "See all ›" link when provided
 *  - children: ReactNode     Scroll items (PosterCards, etc.)
 *  - className?: string
 *
 * Features:
 *  - Prev/next circular arrow buttons → scrollBy ±~one card width (smooth)
 *  - scroll-snap-type:x proximity on the track
 *  - ff-spotlight-row class for spotlight-on-hover atmosphere effect
 *  - Keyboard-accessible: track has tabIndex/role="list"
 *  - Gold focus rings on interactive elements
 */

import React, { useRef } from 'react';
import { cn } from '@/lib/cn';

export interface RowProps {
  title: string;
  eyebrow?: string;
  seeAllHref?: string;
  children: React.ReactNode;
  className?: string;
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

/** Approximate one card width (clamp midpoint) for a single arrow press */
const ONE_CARD_PX = 220;

const Row: React.FC<RowProps> = ({
  title,
  eyebrow,
  seeAllHref,
  children,
  className,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);

  function scrollPrev() {
    trackRef.current?.scrollBy({ left: -ONE_CARD_PX, behavior: 'smooth' });
  }

  function scrollNext() {
    trackRef.current?.scrollBy({ left: ONE_CARD_PX, behavior: 'smooth' });
  }

  return (
    <section
      className={cn('relative z-[2] px-14 max-sm:px-[18px]', className)}
      aria-labelledby={`row-heading-${title.replace(/\s+/g, '-').toLowerCase()}`}
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
            id={`row-heading-${title.replace(/\s+/g, '-').toLowerCase()}`}
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
                className="w-[13px] h-[13px] transition-transform duration-[250ms] group-hover:translate-x-[3px]"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </a>
          )}

          {/* Prev / Next arrow buttons — hidden on mobile (max-sm) */}
          <div
            className="inline-flex items-center gap-2 max-sm:hidden"
            role="group"
            aria-label="Scroll controls"
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

      {/* ── Scroll-snap track ── */}
      <div
        ref={trackRef}
        role="list"
        tabIndex={0}
        aria-label={`${title} items`}
        className={cn(
          'ff-spotlight-row',
          'flex gap-[18px] overflow-x-auto',
          '[scroll-snap-type:x_proximity] [scroll-padding-left:4px]',
          'scroll-smooth',
          // Hide scrollbar across browsers
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          'pb-2 pt-[2px] px-1',
          'focus:outline-none',
        )}
      >
        {children}
      </div>
    </section>
  );
};

export default Row;
