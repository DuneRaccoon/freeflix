'use client';

/**
 * DetailHero — full-bleed cinematic backdrop hero shared by MovieDetailView and ShowDetailView.
 *
 * Bleeds under the fixed TopNav (negative top margin = -72px, then padding-top accounts
 * for the nav height so content sits below it). The backdrop uses ff-kenburns animation
 * (gated on prefers-reduced-motion). A layered AA scrim keeps text legible on any image.
 *
 * Prop surface
 * ────────────
 * title          — film/show title (rendered as an <h1> in Fraunces)
 * backdropUrl    — full TMDB backdrop URL (null → solid ink background, no broken img)
 * posterUrl      — full TMDB poster URL  (null → placeholder, no broken img)
 * year           — release year (null → omitted)
 * rating         — vote_average (shown as gold star + rating.toFixed(1))
 * genres         — string array; up to 3 shown
 * metaItems      — extra meta strings (e.g. "126m", "PG-13", "Returning Series")
 * tagline        — Fraunces italic tagline (null → omitted)
 * overview       — logline paragraph (null → omitted)
 * eyebrow        — small gold label above the title (e.g. "Feature Film")
 * children       — actions / source-picker slot rendered below the logline
 */

import React from 'react';
import { cn } from '@/lib/cn';

/** Near-black 2:3 SVG placeholder for missing poster */
const POSTER_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3"%3E%3Crect width="2" height="3" fill="%230d0d0f"/%3E%3C/svg%3E';

/** 16:9 SVG placeholder for missing backdrop */
const BACKDROP_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"%3E%3Crect width="16" height="9" fill="%230A0A0B"/%3E%3C/svg%3E';

function StarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="w-[15px] h-[15px] shrink-0"
    >
      <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" />
    </svg>
  );
}

/** Dot separator used in the meta row */
function MetaDot() {
  return (
    <span
      className="w-[3px] h-[3px] rounded-full bg-muted/60 shrink-0 inline-block"
      aria-hidden="true"
    />
  );
}

export interface DetailHeroProps {
  title: string;
  backdropUrl: string | null;
  posterUrl: string | null;
  year: number | null;
  rating: number;
  genres: string[];
  /** Extra meta strings, e.g. ['126m', 'PG-13'] or ['3 Seasons', 'Returning Series'] */
  metaItems?: string[];
  tagline?: string | null;
  overview: string | null;
  /** Small gold eyebrow label above the title */
  eyebrow?: string;
  /** Actions slot: SourcePicker + Play/Download buttons */
  children?: React.ReactNode;
}

const DetailHero: React.FC<DetailHeroProps> = ({
  title,
  backdropUrl,
  posterUrl,
  year,
  rating,
  genres,
  metaItems = [],
  tagline,
  overview,
  eyebrow,
  children,
}) => {
  const visibleGenres = genres.slice(0, 3);
  const ratingStr = rating > 0 ? rating.toFixed(1) : null;

  // Build the meta row items — year first, then metaItems, then genres
  const metaSegments: React.ReactNode[] = [];

  if (year) {
    metaSegments.push(
      <strong key="year" className="text-text font-medium">
        {year}
      </strong>,
    );
  }

  metaItems.forEach((item, i) => {
    metaSegments.push(<span key={`meta-${i}`}>{item}</span>);
  });

  if (visibleGenres.length > 0) {
    metaSegments.push(
      <span key="genres">{visibleGenres.join(', ')}</span>,
    );
  }

  return (
    <section
      className={cn(
        // Bleed under the fixed nav (nav is 72px tall)
        '-mt-[72px] relative w-full min-h-[92vh] flex items-end',
        'pb-[clamp(40px,6vw,80px)] px-[clamp(28px,5vw,56px)]',
      )}
      aria-label={`${title} hero`}
    >
      {/* ── Backdrop ── */}
      <div
        className="absolute inset-0 -z-20 bg-ink overflow-hidden"
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={backdropUrl ?? BACKDROP_PLACEHOLDER}
          alt=""
          data-testid="detail-hero-backdrop"
          loading="eager"
          decoding="async"
          onError={(e) => {
            (e.target as HTMLImageElement).src = BACKDROP_PLACEHOLDER;
          }}
          className={cn(
            'w-full h-full object-cover object-[center_28%]',
            // Ken Burns — gated on prefers-reduced-motion
            'motion-safe:animate-[ff-kenburns_20s_ease-in-out_infinite_alternate]',
          )}
        />
      </div>

      {/* ── AA scrims — horizontal + vertical ── */}
      <div
        className="absolute inset-0 -z-10 pointer-events-none"
        aria-hidden="true"
        style={{
          background: [
            'linear-gradient(90deg,rgba(10,10,11,.96) 0%,rgba(10,10,11,.72) 38%,rgba(10,10,11,.25) 70%,rgba(10,10,11,.4) 100%)',
            'linear-gradient(0deg,var(--color-ink) 2%,rgba(10,10,11,.55) 30%,rgba(10,10,11,0) 62%)',
          ].join(','),
        }}
      />

      {/* ── Hero inner ── */}
      <div className="flex gap-[clamp(28px,4vw,60px)] items-end w-full">
        {/* Poster inset — hidden on mobile */}
        <div
          className={cn(
            'hidden sm:block flex-none',
            'w-[clamp(180px,17vw,260px)] aspect-[2/3] rounded-[10px] overflow-hidden',
            'shadow-[0_30px_70px_-20px_rgba(0,0,0,.85),0_0_0_1px_var(--color-hairline)]',
          )}
          aria-hidden="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={posterUrl ?? POSTER_PLACEHOLDER}
            alt={`${title} poster`}
            data-testid="detail-hero-poster"
            className="w-full h-full object-cover block"
            onError={(e) => {
              (e.target as HTMLImageElement).src = POSTER_PLACEHOLDER;
            }}
          />
        </div>

        {/* Text + actions */}
        <div className="flex-1 max-w-[760px] pb-[6px]">
          {/* Eyebrow */}
          {eyebrow && (
            <p
              className={cn(
                'font-display italic font-medium text-[15px]',
                'tracking-[.14em] uppercase text-gold mb-[14px]',
              )}
            >
              {eyebrow}
            </p>
          )}

          {/* Title */}
          <h1
            className={cn(
              'font-display font-semibold tracking-[-0.03em] leading-[0.92]',
              'text-[clamp(54px,8.5vw,128px)] m-0 mb-[18px]',
              'text-shadow-[0_4px_40px_rgba(0,0,0,.6)]',
            )}
          >
            {title}
          </h1>

          {/* Meta row */}
          <div
            className={cn(
              'flex flex-wrap items-center gap-3 font-ui text-[14.5px]',
              'text-muted mb-[18px]',
            )}
          >
            {/* Rating — always first if available */}
            {ratingStr && (
              <>
                <span className="inline-flex items-center gap-[5px] text-gold font-semibold">
                  <StarIcon />
                  <span data-testid="detail-hero-rating">{ratingStr}</span>
                </span>
                {metaSegments.length > 0 && <MetaDot />}
              </>
            )}
            {metaSegments.map((seg, i) => (
              <React.Fragment key={i}>
                {seg}
                {i < metaSegments.length - 1 && <MetaDot />}
              </React.Fragment>
            ))}
          </div>

          {/* Tagline */}
          {tagline && (
            <p
              className={cn(
                'font-display italic font-normal m-0 mb-[12px]',
                'text-[clamp(20px,2.2vw,27px)] text-gold-lite leading-[1.25]',
              )}
            >
              &ldquo;{tagline}&rdquo;
            </p>
          )}

          {/* Logline / overview */}
          {overview && (
            <p
              className="font-ui text-[16px] text-text/80 max-w-[620px] leading-[1.6] m-0 mb-[20px]"
              data-testid="detail-hero-overview"
            >
              {overview}
            </p>
          )}

          {/* Actions / SourcePicker slot */}
          {children && <div className="mt-[8px]">{children}</div>}
        </div>
      </div>
    </section>
  );
};

export default DetailHero;
