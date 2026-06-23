'use client';

/**
 * Hero — full-bleed cinematic billboard from a CatalogItem.
 *
 * Props:
 *  - item: CatalogItem   The featured content item to showcase
 *
 * Structure:
 *  - Full-viewport-height backdrop image with ff-kenburns slow Ken-Burns drift
 *  - AA-contrast left + bottom gradient scrims
 *  - Gold "FEATURED" eyebrow
 *  - HUGE Fraunces title
 *  - Meta row: year · gold star · up to 3 genres
 *  - 2-line overview logline
 *  - Actions: primary Play (links to detail), glass More Info (links to detail),
 *    + My List icon button (toggles watchlist via WatchlistContext)
 *
 * Height: clamp(620px, 85vh, 1040px)
 * Content lifted to bottom: clamp(150px, 19vh, 250px) to leave room for the
 * FeaturedRail overlay. Bleeds to top edge under the transparent TopNav via
 * negative top margin.
 *
 * Matches the hero section in browse-mockup-v5.html.
 */

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { CatalogItem } from '@/types';
import { useWatchlist } from '@/context/WatchlistContext';
import { buildContentId } from '@/lib/contentId';
import { toWatchlistCreate } from '@/lib/watchlist/toWatchlistCreate';

export interface HeroProps {
  item: CatalogItem;
  /** Show a "Series"/"Film" label in the meta row — mixed home page only. */
  showMediaType?: boolean;
}

/** Near-black 16:9 SVG placeholder when backdrop_url is null */
const BACKDROP_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"%3E%3Crect width="16" height="9" fill="%230d0d0f"/%3E%3C/svg%3E';

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-[18px] h-[18px]">
      <path d="M7 5v14l11-7z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      className="w-[18px] h-[18px]"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.6v.01" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      className="w-[20px] h-[20px]"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-[20px] h-[20px]"
    >
      <path d="M4.5 12.5l5.5 5.5 9.5-10" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-[14px] h-[14px] text-gold">
      <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.5 6.8L12 17.8 5.9 20.4 7.4 13.6 2.3 9l6.9-.7z" />
    </svg>
  );
}

const Hero: React.FC<HeroProps> = ({ item, showMediaType }) => {
  const href =
    item.media_type === 'tv' ? `/tv/${item.tmdb_id}` : `/movies/${item.tmdb_id}`;

  const rating =
    typeof item.vote_average === 'number' ? item.vote_average.toFixed(1) : null;

  // Up to 3 genres in the meta row
  const metaGenres = (item.genres ?? []).slice(0, 3);

  const backdropSrc = item.backdrop_url ?? BACKDROP_PLACEHOLDER;

  // Watchlist wiring
  const { isSaved, toggle } = useWatchlist();
  const contentId = buildContentId({
    kind: item.media_type === 'tv' ? 'tv' : 'movie',
    tmdbId: item.tmdb_id,
  });
  const saved = isSaved(contentId);

  function handleMyList() {
    toggle(toWatchlistCreate(item));
  }

  return (
    <div
      className="relative z-[1] overflow-hidden"
      style={{
        height: 'clamp(620px, 85vh, 1040px)',
        // Bleed under the transparent fixed TopNav (which is ~72px tall)
        marginTop: '-72px',
      }}
    >
      {/* ── Backdrop image with Ken-Burns drift ── */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={backdropSrc}
        alt=""
        aria-hidden="true"
        className={cn(
          'ff-kenburns',
          'absolute inset-0 w-full h-full object-cover object-top',
        )}
        style={{ transformOrigin: '58% 42%' }}
        loading="eager"
        onError={(e) => {
          (e.target as HTMLImageElement).src = BACKDROP_PLACEHOLDER;
        }}
        data-testid="hero-backdrop"
      />

      {/* ── Left-side scrim (AA contrast for copy) ── */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, rgba(10,10,11,.94) 0%, rgba(10,10,11,.74) 30%, rgba(10,10,11,.25) 58%, transparent 80%)',
        }}
      />

      {/* ── Bottom scrim (fades into the page bg) ── */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(0deg, var(--color-ink) 0%, rgba(10,10,11,.86) 16%, rgba(10,10,11,.40) 44%, transparent 72%)',
        }}
      />

      {/* ── Footlight bloom at the base ── */}
      <div
        aria-hidden="true"
        className="absolute left-0 right-0 bottom-0 pointer-events-none"
        style={{
          height: '34%',
          zIndex: 2,
          background:
            'radial-gradient(140% 150% at 26% 116%, rgba(201,168,106,.16), transparent 56%)',
        }}
      />

      {/* ── Top letterbox edge ── */}
      <div
        aria-hidden="true"
        className="absolute left-0 right-0 top-0 pointer-events-none"
        style={{
          height: '10%',
          zIndex: 2,
          background:
            'linear-gradient(180deg, rgba(4,4,6,.5) 0%, transparent 100%)',
        }}
      />

      {/* ── Hero content (left-aligned, lifted from bottom) ── */}
      <div
        className={cn(
          'absolute left-14 right-[40%] z-[3]',
          'max-sm:left-[18px] max-sm:right-[18px]',
        )}
        style={{ bottom: 'clamp(150px, 19vh, 250px)' }}
      >
        {/* Gold eyebrow */}
        <p className="text-[11px] tracking-[.4em] uppercase text-gold font-semibold mb-[18px]">
          Featured
        </p>

        {/* Giant Fraunces title */}
        <h1
          className={cn(
            'font-display font-light leading-[.92] tracking-[-0.035em] text-text m-0 mb-[18px]',
            '[text-shadow:0_2px_44px_rgba(0,0,0,.66),0_0_70px_rgba(201,168,106,.10)]',
          )}
          style={{ fontSize: 'clamp(44px, 7vw, 80px)' }}
        >
          {item.title}
        </h1>

        {/* Meta row: year · star rating · genres */}
        <div className="flex items-center flex-wrap gap-[11px] text-[13px] text-text mb-4">
          {showMediaType && (
            <span className="font-ui text-[11px] font-semibold uppercase tracking-[.18em]">
              {item.media_type === 'tv' ? 'Series' : 'Film'}
            </span>
          )}

          {showMediaType && (item.year || rating || metaGenres.length > 0) && (
            <span
              className="w-[3px] h-[3px] rounded-full bg-muted inline-block"
              aria-hidden="true"
            />
          )}

          {item.year && <span>{item.year}</span>}

          {item.year && rating && (
            <span
              className="w-[3px] h-[3px] rounded-full bg-muted inline-block"
              aria-hidden="true"
            />
          )}

          {rating && (
            <span className="inline-flex items-center gap-[5px] text-gold-lite font-semibold">
              <StarIcon />
              {rating}
            </span>
          )}

          {metaGenres.length > 0 && (rating || item.year) && (
            <span
              className="w-[3px] h-[3px] rounded-full bg-muted inline-block"
              aria-hidden="true"
            />
          )}

          {metaGenres.length > 0 && (
            <span className="text-text">{metaGenres.join(', ')}</span>
          )}
        </div>

        {/* Overview logline (2 lines max) */}
        {item.overview && (
          <p
            className="text-[15.5px] leading-[1.62] text-[#D8D3C8] max-w-[520px] mb-7"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {item.overview}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-[13px] flex-wrap">
          {/* Primary Play — links to detail */}
          <Link
            href={href}
            className={cn(
              'relative inline-flex items-center justify-center gap-[9px] overflow-hidden',
              'h-[50px] px-[26px] rounded-[8px]',
              'font-ui text-[14.5px] font-semibold tracking-[.01em] no-underline',
              'bg-gradient-to-br from-white to-gold-lite text-ink',
              'shadow-[0_8px_28px_rgba(0,0,0,.4),0_0_22px_rgba(201,168,106,.16)]',
              'transition-[transform,filter] duration-200',
              'hover:-translate-y-0.5 hover:brightness-105',
              'focus:outline-none',
              'focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
              // Premiere shine sweep on the CTA (ff-shine class handles bg-position animation)
              'after:content-[""] after:absolute after:inset-0 after:pointer-events-none',
              'after:bg-[linear-gradient(105deg,transparent_40%,rgba(255,255,255,.5)_50%,transparent_60%)]',
              'after:-translate-x-[120%]',
              'after:[animation:ff-ctashine_6.5s_ease-in-out_infinite]',
              'max-sm:h-[46px] max-sm:px-5',
            )}
            aria-label={`Play ${item.title}`}
            data-testid="hero-play"
          >
            <PlayIcon />
            Play
          </Link>

          {/* Glass More Info — links to detail */}
          <Link
            href={href}
            className={cn(
              'inline-flex items-center justify-center gap-[9px]',
              'h-[50px] px-[26px] rounded-[8px]',
              'font-ui text-[14.5px] font-semibold tracking-[.01em] no-underline',
              'bg-surface-2/50 text-text border border-hairline backdrop-blur-sm',
              'transition-[transform,border-color] duration-200',
              'hover:-translate-y-0.5 hover:border-gold/60',
              'focus:outline-none',
              'focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
              'max-sm:h-[46px] max-sm:px-5',
            )}
            data-testid="hero-more-info"
          >
            <InfoIcon />
            More Info
          </Link>

          {/* + My List icon button — wired to WatchlistContext */}
          <button
            type="button"
            aria-label={saved ? 'Remove from My List' : 'Add to My List'}
            title={saved ? 'Remove from My List' : 'Add to My List'}
            data-testid="hero-mylist-button"
            onClick={handleMyList}
            className={cn(
              'inline-flex items-center justify-center',
              'w-[50px] h-[50px] rounded-full p-0',
              'border backdrop-blur-sm',
              'transition-[transform,border-color,color] duration-200',
              'hover:-translate-y-0.5',
              'focus:outline-none',
              'focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
              'max-sm:w-[46px] max-sm:h-[46px]',
              saved
                ? 'bg-gold/20 text-gold border-gold/60 hover:bg-gold/30'
                : 'bg-surface-2/50 text-text border-hairline hover:border-gold/60 hover:text-gold-lite',
            )}
          >
            {saved ? <CheckIcon /> : <PlusIcon />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Hero;
