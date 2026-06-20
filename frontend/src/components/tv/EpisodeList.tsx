'use client';

/**
 * EpisodeList — vertical list of episodes for a single TV season.
 *
 * Props:
 *  - showId: number            TMDB show ID (used for streaming/download requests)
 *  - seasonNumber: number      Current season number (used for S·E label + requests)
 *  - episodes: Episode[]       Episodes to render (from tvService.getSeason)
 *
 * Per-episode row:
 *  - 16:9 still (null-safe with placeholder)
 *  - S{seasonNumber}·E{episode_number} label + name (Fraunces)
 *  - Meta: runtime · air_date · gold vote_average
 *  - Expandable overview (click to toggle)
 *  - Quality pill selector ['Auto', '720p', '1080p', '2160p']
 *  - Play button  → handleCatalogStreamingStart + router.push('/streaming/<id>')
 *  - Download btn → torrentsService.downloadCatalogMovie + toast
 *
 * Play flow (load-bearing — do not modify):
 *   resolved_quality = quality === 'Auto' ? '1080p' : quality
 *   s = await handleCatalogStreamingStart({ tmdb_id: showId, quality, media_type:'tv', season, episode })
 *   router.push('/streaming/' + s.id)
 *
 * Download flow:
 *   await torrentsService.downloadCatalogMovie({ tmdb_id: showId, quality, media_type:'tv', season, episode })
 *   toast.success(...)
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';

import type { Episode } from '@/types';
import { torrentsService } from '@/services/torrents';
import { handleCatalogStreamingStart } from '@/utils/streaming';
import { cn } from '@/lib/cn';

// ── constants ──────────────────────────────────────────────────────────────────

const QUALITY_OPTIONS = ['Auto', '720p', '1080p', '2160p'] as const;
type QualityOption = (typeof QUALITY_OPTIONS)[number];

/** Sentinel value → resolve to 1080p (or best) at request time */
const AUTO_QUALITY = 'Auto';

/** Resolve the quality sentinel before making the API request */
function resolveQuality(q: QualityOption): '720p' | '1080p' | '2160p' {
  return q === AUTO_QUALITY ? '1080p' : (q as '720p' | '1080p' | '2160p');
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Format an ISO date string (e.g. "2022-02-18") into a human-friendly
 * short date, e.g. "Feb 18, 2022".  Returns the raw string on parse error.
 */
function formatAirDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return dateStr;
  }
}

// ── 16:9 still placeholder ────────────────────────────────────────────────────

const STILL_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"%3E%3Crect width="16" height="9" fill="%2316161A"/%3E%3C/svg%3E';

// ── SVG icons ─────────────────────────────────────────────────────────────────

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="w-[14px] h-[14px] ml-[1px] shrink-0"
    >
      <path d="M7 5.5v13l11-6.5z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-[13px] h-[13px] shrink-0"
    >
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        'w-[14px] h-[14px] shrink-0 transition-transform duration-200',
        open && 'rotate-180',
      )}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="w-[12px] h-[12px] text-gold shrink-0"
    >
      <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" />
    </svg>
  );
}

// ── EpisodeRow ────────────────────────────────────────────────────────────────

interface EpisodeRowProps {
  showId: number;
  seasonNumber: number;
  episode: Episode;
}

function EpisodeRow({ showId, seasonNumber, episode }: EpisodeRowProps) {
  const router = useRouter();

  const [quality, setQuality] = useState<QualityOption>('Auto');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);

  // ── Play handler ──────────────────────────────────────────────────────────

  async function handlePlay() {
    setIsPlaying(true);
    try {
      const resolved = resolveQuality(quality);
      const s = await handleCatalogStreamingStart({
        tmdb_id: showId,
        quality: resolved,
        media_type: 'tv',
        season: seasonNumber,
        episode: episode.episode_number,
      });
      if (s?.id) {
        router.push(`/streaming/${s.id}`);
      }
    } catch {
      toast.error('Failed to start streaming. Please try again.');
    } finally {
      setIsPlaying(false);
    }
  }

  // ── Download handler ──────────────────────────────────────────────────────

  async function handleDownload() {
    setIsDownloading(true);
    try {
      const resolved = resolveQuality(quality);
      await torrentsService.downloadCatalogMovie({
        tmdb_id: showId,
        quality: resolved,
        media_type: 'tv',
        season: seasonNumber,
        episode: episode.episode_number,
      });
      toast.success(
        `Added S${seasonNumber}·E${episode.episode_number} "${episode.name}" (${resolved}) to download queue`,
      );
    } catch {
      toast.error('Failed to add to download queue. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }

  // ── derived ───────────────────────────────────────────────────────────────

  const epLabel = `S${seasonNumber}·E${episode.episode_number}`;
  const airDate = formatAirDate(episode.air_date);
  const rating =
    episode.vote_average > 0 ? episode.vote_average.toFixed(1) : null;

  return (
    <article
      className={cn(
        'grid grid-cols-[300px_1fr_164px] gap-6 items-stretch',
        'p-[14px] rounded-[14px]',
        'border border-transparent bg-white/[.012]',
        'transition-[background,border-color] duration-[250ms]',
        'hover:bg-white/[.04] hover:border-hairline',
        'max-[1100px]:grid-cols-[240px_1fr] max-[820px]:grid-cols-1',
      )}
      data-testid={`episode-row-${episode.episode_number}`}
    >
      {/* ── Still ── */}
      <div
        className={cn(
          'relative aspect-video rounded-[10px] overflow-hidden bg-surface-2 flex-none',
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={episode.still_url ?? STILL_PLACEHOLDER}
          alt={`${episode.name} still`}
          data-testid={`episode-still-${episode.episode_number}`}
          className="w-full h-full object-cover transition-[transform,filter] duration-500 hover:scale-[1.04] filter saturate-[.92] brightness-[.92] hover:saturate-100 hover:brightness-100"
          onError={(e) => {
            (e.target as HTMLImageElement).src = STILL_PLACEHOLDER;
          }}
        />

        {/* Bottom gradient overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              'linear-gradient(0deg, rgba(0,0,0,.45), transparent 55%)',
          }}
        />

        {/* Play orb */}
        <button
          type="button"
          aria-label={`Play ${epLabel} — ${episode.name}`}
          onClick={handlePlay}
          disabled={isPlaying || isDownloading}
          data-testid={`episode-play-orb-${episode.episode_number}`}
          className={cn(
            'absolute inset-0 z-[4] grid place-items-center',
            'border-none bg-transparent cursor-pointer p-0',
            'opacity-[.62] hover:opacity-100 focus-visible:opacity-100',
            'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
            'transition-opacity duration-[250ms]',
            'disabled:pointer-events-none',
          )}
        >
          <span
            className={cn(
              'w-[52px] h-[52px] rounded-full grid place-items-center',
              'bg-ink/55 border border-[1.5px] border-gold-lite',
              'backdrop-blur-[6px]',
              'transition-[transform,background,border-color] duration-[250ms]',
              'hover:scale-[1.08] hover:bg-ink/70',
            )}
          >
            {isPlaying ? (
              <svg
                className="h-4 w-4 animate-spin text-gold-lite"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                className="w-[18px] h-[18px] text-gold-lite ml-[2px]"
              >
                <path d="M7 5.5v13l11-6.5z" />
              </svg>
            )}
          </span>
        </button>
      </div>

      {/* ── Episode main info ── */}
      <div className="flex flex-col py-[2px] min-w-0">
        {/* Episode number + name */}
        <div className="flex items-baseline gap-[10px] flex-wrap">
          <span
            className="font-display font-semibold text-[15px] text-gold tracking-[.02em] shrink-0"
            data-testid={`episode-label-${episode.episode_number}`}
          >
            {epLabel}
          </span>
          <h3
            className="font-display font-medium text-[20px] tracking-[-0.015em] text-text m-0 mr-auto"
            data-testid={`episode-name-${episode.episode_number}`}
          >
            {episode.name}
          </h3>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-[9px] font-ui text-[12.5px] text-muted mt-[7px] mb-[9px] flex-wrap">
          {episode.runtime != null && (
            <>
              <span>{episode.runtime}m</span>
              <span
                className="w-[3px] h-[3px] rounded-full bg-muted/60 shrink-0"
                aria-hidden="true"
              />
            </>
          )}
          {airDate && (
            <>
              <span>{airDate}</span>
              {rating && (
                <span
                  className="w-[3px] h-[3px] rounded-full bg-muted/60 shrink-0"
                  aria-hidden="true"
                />
              )}
            </>
          )}
          {rating && (
            <span
              className="inline-flex items-center gap-[4px] text-gold font-semibold"
              data-testid={`episode-rating-${episode.episode_number}`}
            >
              <StarIcon />
              {rating}
            </span>
          )}
        </div>

        {/* Overview — expandable */}
        {episode.overview && (
          <div>
            <p
              className={cn(
                'font-ui text-[13.5px] leading-[1.55] text-[#B9B4AB] m-0',
                !overviewOpen && 'line-clamp-2',
              )}
              data-testid={`episode-overview-${episode.episode_number}`}
            >
              {episode.overview}
            </p>
            <button
              type="button"
              onClick={() => setOverviewOpen((v) => !v)}
              className={cn(
                'mt-[6px] inline-flex items-center gap-[4px]',
                'font-ui text-[12px] text-muted hover:text-text',
                'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                'transition-colors duration-150',
              )}
              aria-expanded={overviewOpen}
              data-testid={`episode-toggle-${episode.episode_number}`}
            >
              {overviewOpen ? 'Less' : 'More'}
              <ChevronIcon open={overviewOpen} />
            </button>
          </div>
        )}
      </div>

      {/* ── Action rail ── */}
      <div
        className={cn(
          'flex flex-col justify-center gap-[10px]',
          'pl-[6px] border-l border-hairline',
          'max-[1100px]:col-span-full max-[1100px]:flex-row max-[1100px]:flex-wrap',
          'max-[1100px]:border-l-0 max-[1100px]:border-t max-[1100px]:border-hairline',
          'max-[1100px]:pt-[12px] max-[1100px]:pl-0',
        )}
      >
        {/* Play button */}
        <button
          type="button"
          onClick={handlePlay}
          disabled={isPlaying || isDownloading}
          data-testid={`episode-play-btn-${episode.episode_number}`}
          className={cn(
            'inline-flex items-center justify-center gap-[7px]',
            'w-full font-ui text-[13px] font-semibold',
            'rounded-full py-[9px] px-[16px]',
            'text-ink border-transparent',
            'bg-gradient-to-r from-gold-lite to-gold',
            'transition-[box-shadow,transform] duration-200',
            'hover:shadow-[0_6px_20px_rgba(201,168,106,.35)] hover:-translate-y-[1px]',
            'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
            'disabled:opacity-50 disabled:pointer-events-none',
          )}
          aria-label={`Play ${epLabel} — ${episode.name}`}
        >
          {isPlaying ? (
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <PlayIcon />
          )}
          Play
        </button>

        {/* Download button */}
        <button
          type="button"
          onClick={handleDownload}
          disabled={isPlaying || isDownloading}
          data-testid={`episode-download-btn-${episode.episode_number}`}
          className={cn(
            'inline-flex items-center justify-center gap-[7px]',
            'w-full font-ui text-[13px] font-semibold',
            'rounded-full py-[9px] px-[16px]',
            'border border-hairline bg-white/[.04] text-text',
            'transition-[border-color,background,transform] duration-200',
            'hover:border-gold/45 hover:bg-white/[.07] hover:-translate-y-[1px]',
            'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
            'disabled:opacity-50 disabled:pointer-events-none',
          )}
          aria-label={`Download ${epLabel} — ${episode.name}`}
        >
          {isDownloading ? (
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <DownloadIcon />
          )}
          Download
        </button>

        {/* Quality selector */}
        <div className="flex flex-wrap gap-[6px]">
          {QUALITY_OPTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuality(q)}
              aria-pressed={quality === q}
              data-testid={`episode-quality-${episode.episode_number}-${q}`}
              className={cn(
                'font-ui text-[12px] font-medium',
                'rounded-full py-[6px] px-[12px]',
                'border transition-[border-color,background,color] duration-150',
                'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                quality === q
                  ? 'border-gold/60 bg-gold/15 text-gold-lite'
                  : 'border-hairline bg-transparent text-muted hover:text-text hover:border-gold/35',
              )}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

// ── EpisodeList ────────────────────────────────────────────────────────────────

export interface EpisodeListProps {
  showId: number;
  seasonNumber: number;
  episodes: Episode[];
}

const EpisodeList: React.FC<EpisodeListProps> = ({
  showId,
  seasonNumber,
  episodes,
}) => {
  if (!episodes || episodes.length === 0) {
    return (
      <p className="font-ui text-[14px] text-muted py-[24px]">
        No episodes available.
      </p>
    );
  }

  return (
    <div
      className="flex flex-col gap-[14px] mt-[24px]"
      data-testid="episode-list"
    >
      {episodes.map((ep) => (
        <EpisodeRow
          key={ep.episode_number}
          showId={showId}
          seasonNumber={seasonNumber}
          episode={ep}
        />
      ))}
    </div>
  );
};

export default EpisodeList;
