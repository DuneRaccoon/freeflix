'use client';

/**
 * PosterCard — 2:3 poster card with resting caption and hover-reveal overlay.
 *
 * Disney+-scale fluid width: clamp(184px, 15.5vw, 272px).
 * Mirrors the "Trending" card in the FRÈ browse mockup (browse-mockup-v5.html).
 *
 * Structure note: the hover-reveal overlay sits OUTSIDE the main <a> so we
 * avoid the invalid <a>-inside-<a> nesting. The whole article is positioned
 * relative; the overlay sits z-above the link art.
 */

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { CatalogItem } from '@/types';
import { useWatchlist } from '@/context/WatchlistContext';
import { buildContentId } from '@/lib/contentId';
import { toWatchlistCreate } from '@/lib/watchlist/toWatchlistCreate';

export interface PosterCardProps {
  item: CatalogItem;
  className?: string;
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.5 6.8L12 17.8 5.9 20.4 7.4 13.6 2.3 9l6.9-.7z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-4 h-4 ml-px">
      <path d="M7 5v14l11-7z" />
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
      className="w-[15px] h-[15px]"
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
      className="w-[15px] h-[15px]"
    >
      <path d="M4.5 12.5l5.5 5.5 9.5-10" />
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
      strokeLinecap="round"
      aria-hidden="true"
      className="w-[15px] h-[15px]"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.6v.01" strokeLinecap="round" />
    </svg>
  );
}

/** Fallback placeholder — a near-black 2:3 SVG data URI */
const POSTER_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3"%3E%3Crect width="2" height="3" fill="%230d0d0f"/%3E%3C/svg%3E';

const PosterCard: React.FC<PosterCardProps> = ({ item, className }) => {
  const href =
    item.media_type === 'tv' ? `/tv/${item.tmdb_id}` : `/movies/${item.tmdb_id}`;

  const rating = typeof item.vote_average === 'number' ? item.vote_average.toFixed(1) : null;

  // Limit genres to 3 chips
  const genreChips = (item.genres ?? []).slice(0, 3);

  // Limit overview to ~180 chars for the overlay snippet
  const overviewSnippet = item.overview
    ? item.overview.length > 180
      ? item.overview.slice(0, 177) + '…'
      : item.overview
    : null;

  // Watchlist wiring
  const { isSaved, toggle } = useWatchlist();
  const contentId = buildContentId({
    kind: item.media_type === 'tv' ? 'tv' : 'movie',
    tmdbId: item.tmdb_id,
  });
  const saved = isSaved(contentId);

  function handleMyList(e: React.MouseEvent) {
    // Prevent the card link from firing when the button is clicked
    e.preventDefault();
    e.stopPropagation();
    toggle(toWatchlistCreate(item));
  }

  return (
    <article
      className={cn('relative group', className)}
      style={{ width: 'clamp(184px, 15.5vw, 272px)', flexShrink: 0 }}
    >
      {/* ── Card visual: poster art + hover overlay scale & lift TOGETHER ── */}
      <div
        className={cn(
          'relative aspect-[2/3] rounded-[11px]',
          'transition-[transform,box-shadow] duration-[360ms] ease-card will-change-transform',
          'group-hover:scale-[1.06] group-hover:-translate-y-1 group-hover:z-20',
          'group-focus-within:scale-[1.06] group-focus-within:-translate-y-1 group-focus-within:z-20',
          'group-hover:shadow-[0_20px_46px_rgba(0,0,0,.62),0_0_34px_var(--rail-card-glow)] group-focus-within:shadow-[0_20px_46px_rgba(0,0,0,.62),0_0_34px_var(--rail-card-glow)]',
        )}
      >
        {/* Poster art + main card link (focus ring lives here, NOT clipped) */}
        <Link
          href={href}
          className={cn(
            'absolute inset-0 block rounded-[11px] border border-hairline bg-surface',
            'text-inherit no-underline transition-[border-color] duration-300',
            'group-hover:border-[color:color-mix(in_srgb,var(--rail-accent)_35%,transparent)]',
            'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
          )}
          aria-label={`${item.title}${item.year ? ` (${item.year})` : ''}`}
        >
          <div className="absolute inset-0 rounded-[11px] overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.poster_url ?? POSTER_PLACEHOLDER}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).src = POSTER_PLACEHOLDER;
              }}
            />
          </div>
        </Link>

        {/*
          Hover/focus-within reveal overlay — sibling of the Link (no nested <a>).
          The gradient stays pointer-events:none so clicking the poster body still
          navigates via the Link beneath; only the action buttons opt back in.
        */}
        <div className="absolute inset-0 rounded-[11px] overflow-hidden z-10">
          <div
            className={cn(
              'absolute inset-0 flex flex-col justify-end p-3.5 pointer-events-none',
              'bg-[linear-gradient(0deg,rgba(10,10,11,.96)_12%,rgba(10,10,11,.4)_54%,transparent_82%)]',
              'opacity-0 transition-opacity duration-300',
              'group-hover:opacity-100 group-focus-within:opacity-100',
            )}
          >
            {/* Action row */}
            <div className="flex items-center gap-2 mb-2.5 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto">
              {/* Play — navigates to detail page */}
              <a
                href={href}
                aria-label={`Play ${item.title}`}
                className={cn(
                  'w-[34px] h-[34px] rounded-full flex-none grid place-items-center',
                  'bg-gradient-to-br from-white to-gold-lite text-ink no-underline',
                  'transition-[transform,filter] duration-200 hover:scale-[1.08]',
                  'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                )}
              >
                <PlayIcon />
              </a>

              {/* + My List — wired to WatchlistContext */}
              <button
                type="button"
                aria-label={saved ? `Remove ${item.title} from My List` : `Add ${item.title} to My List`}
                data-testid="postercard-mylist-button"
                onClick={handleMyList}
                className={cn(
                  'w-[34px] h-[34px] rounded-full flex-none grid place-items-center cursor-pointer',
                  'border backdrop-blur',
                  'transition-[border-color,color,transform,background-color] duration-200',
                  'hover:scale-[1.08]',
                  'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                  saved
                    ? 'bg-gold/20 text-gold border-gold/60 hover:bg-gold/30'
                    : 'bg-surface-2/70 text-text border-hairline hover:border-gold/50 hover:text-gold-lite',
                )}
              >
                {saved ? <CheckIcon /> : <PlusIcon />}
              </button>

              {/* Info link */}
              <a
                href={href}
                aria-label={`More info about ${item.title}`}
                className={cn(
                  'w-[34px] h-[34px] rounded-full flex-none grid place-items-center',
                  'border border-hairline bg-surface-2/70 text-text no-underline backdrop-blur',
                  'transition-[border-color,color,transform] duration-200',
                  'hover:border-gold/50 hover:text-gold-lite hover:scale-[1.08]',
                  'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                )}
              >
                <InfoIcon />
              </a>
            </div>

            {/* Title in overlay */}
            <p className="font-display font-normal text-[17px] leading-[1.05] tracking-[-0.01em] text-text mb-1.5">
              {item.title}
            </p>

            {/* Overview snippet */}
            {overviewSnippet && (
              <p
                className="text-[11.5px] leading-[1.5] text-[#C9C4BA] mb-2"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {overviewSnippet}
              </p>
            )}

            {/* Genre chips */}
            {genreChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {genreChips.map((g) => (
                  <span
                    key={g}
                    className="text-[9.5px] tracking-[.08em] uppercase text-[var(--rail-accent-soft)] border border-[color:color-mix(in_srgb,var(--rail-accent)_32%,transparent)] rounded px-1.5 py-0.5"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Year · rating in overlay */}
            {(item.year || rating) && (
              <div className="flex items-center gap-1.5 text-[11px] text-[#C9C4BA]">
                {item.year && <span>{item.year}</span>}
                {item.year && rating && (
                  <span
                    className="w-[3px] h-[3px] rounded-full bg-muted inline-block"
                    aria-hidden="true"
                  />
                )}
                {rating && (
                  <span className="inline-flex items-center gap-[3px] text-gold-lite font-semibold">
                    <StarIcon className="w-[11px] h-[11px] text-gold" />
                    {rating}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Resting caption — hidden while overlay is visible ── */}
      <div
        className={cn(
          'mt-[11px] transition-opacity duration-[250ms]',
          'group-hover:opacity-0 group-focus-within:opacity-0',
        )}
      >
        <p className="font-display font-normal text-[15px] tracking-[-0.01em] leading-[1.1] text-text">
          {item.title}
        </p>
        <div className="flex items-center gap-[7px] text-[11.5px] text-muted mt-[3px]">
          {item.year && <span>{item.year}</span>}
          {item.year && rating && (
            <span
              className="w-[3px] h-[3px] rounded-full bg-muted inline-block"
              aria-hidden="true"
            />
          )}
          {rating && (
            <span className="inline-flex items-center gap-[3px] text-gold-lite font-semibold">
              <StarIcon className="w-[11px] h-[11px] text-gold" />
              {rating}
            </span>
          )}
        </div>
      </div>
    </article>
  );
};

export default PosterCard;
