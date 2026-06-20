'use client';

/**
 * MovieDetailView — client island for the movie detail page.
 *
 * Composes DetailHero + SourcePicker + Play/Download flow + CastRow +
 * "More Like This" row. Server page (app/movies/[id]/page.tsx) fetches
 * MovieDetail SSR and passes it in via props; this component owns all
 * interactivity.
 *
 * Play flow (load-bearing — do not modify):
 *   quality = resolve('auto' → highest-seed hit)
 *   status  = await handleCatalogStreamingStart({ tmdb_id, quality })
 *   router.push('/streaming/' + status.id)
 *
 * Download flow:
 *   await torrentsService.downloadCatalogMovie({ tmdb_id, quality }) + toast
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';

import { MovieDetail, TorrentHit, CatalogItem } from '@/types';
import { moviesService } from '@/services/movies';
import { torrentsService } from '@/services/torrents';
import { handleCatalogStreamingStart } from '@/utils/streaming';
import { useWatchlist } from '@/context/WatchlistContext';
import { buildContentId } from '@/lib/contentId';

import DetailHero from '@/components/detail/DetailHero';
import SourcePicker from '@/components/detail/SourcePicker';
import CastRow from '@/components/detail/CastRow';
import { Button } from '@/components/ui/fre';
import Row from '@/components/browse/Row';
import PosterCard from '@/components/browse/PosterCard';
import { cn } from '@/lib/cn';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the 'auto' quality sentinel to an actual quality string.
 *
 * Rule: pick the quality whose best hit has the most seeds; on tie, prefer
 * higher resolution (2160p > 1080p > 720p). If no hits exist, fall back to
 * the highest quality in `available_qualities`.
 */
type ValidQuality = '720p' | '1080p' | '2160p';
const VALID_QUALITIES: ValidQuality[] = ['720p', '1080p', '2160p'];

function normalizeQuality(q: string): ValidQuality {
  return (VALID_QUALITIES as string[]).includes(q) ? (q as ValidQuality) : '1080p';
}

function resolveQuality(
  quality: string,
  hits: TorrentHit[],
  available: string[],
): ValidQuality {
  if (quality !== 'auto') return normalizeQuality(quality);

  if (hits.length > 0) {
    // Group by quality, keep the best (most seeds) per group
    const map = new Map<string, TorrentHit>();
    for (const hit of hits) {
      const q = hit.quality ?? 'Unknown';
      const existing = map.get(q);
      if (!existing || hit.seeds > existing.seeds) map.set(q, hit);
    }
    // Sort by seeds desc, then by resolution desc on tie
    const RES_ORDER: Record<string, number> = {
      '2160p': 3,
      '1080p': 2,
      '720p': 1,
    };
    const groups = Array.from(map.entries()).sort(([qa, ba], [qb, bb]) => {
      if (bb.seeds !== ba.seeds) return bb.seeds - ba.seeds;
      return (RES_ORDER[qb] ?? 0) - (RES_ORDER[qa] ?? 0);
    });
    return normalizeQuality(groups[0][0]);
  }

  if (available.length > 0) {
    // Return the highest resolution available
    const order: ValidQuality[] = ['2160p', '1080p', '720p'];
    for (const q of order) {
      if (available.includes(q)) return q;
    }
    return normalizeQuality(available[0]);
  }

  return '1080p'; // final fallback
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="w-[18px] h-[18px] ml-px"
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
      className="w-[17px] h-[17px]"
    >
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
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

// ── component ─────────────────────────────────────────────────────────────────

export interface MovieDetailViewProps {
  movie: MovieDetail;
}

const MovieDetailView: React.FC<MovieDetailViewProps> = ({ movie }) => {
  const router = useRouter();

  // ── state ──────────────────────────────────────────────────────────────────
  const [hits, setHits] = useState<TorrentHit[]>([]);
  const [quality, setQuality] = useState<string>('auto');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [moreLikeThis, setMoreLikeThis] = useState<CatalogItem[]>([]);

  // ── watchlist ──────────────────────────────────────────────────────────────
  const { isSaved, toggle } = useWatchlist();
  const contentId = buildContentId({ kind: 'movie', tmdbId: movie.tmdb_id });
  const saved = isSaved(contentId);

  function handleMyList() {
    toggle({
      content_id: contentId,
      tmdb_id: String(movie.tmdb_id),
      media_type: 'movie',
      title: movie.title,
    });
  }

  // ── on mount: fetch torrents + "more like this" ────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadTorrents() {
      try {
        const data = await moviesService.getTorrents(movie.tmdb_id);
        if (!cancelled) setHits(data ?? []);
      } catch {
        if (!cancelled) setHits([]);
      }
    }

    async function loadMoreLikeThis() {
      try {
        const genreId = movie.genre_ids?.[0];
        const params = genreId ? { genre: genreId } : {};
        const page = await moviesService.browse(params);
        if (!cancelled) {
          const others = (page.results ?? []).filter(
            (item) => item.tmdb_id !== movie.tmdb_id,
          );
          setMoreLikeThis(others.slice(0, 20));
        }
      } catch {
        if (!cancelled) setMoreLikeThis([]);
      }
    }

    loadTorrents();
    loadMoreLikeThis();

    return () => {
      cancelled = true;
    };
  }, [movie.tmdb_id, movie.genre_ids]);

  // ── action handlers ────────────────────────────────────────────────────────

  async function handlePlay() {
    setIsPlaying(true);
    try {
      const resolved = resolveQuality(
        quality,
        hits,
        movie.available_qualities,
      );
      const status = await handleCatalogStreamingStart({
        tmdb_id: movie.tmdb_id,
        quality: resolved,
      });
      if (status?.id) {
        router.push(`/streaming/${status.id}`);
      }
    } catch {
      toast.error('Failed to start streaming. Please try again.');
    } finally {
      setIsPlaying(false);
    }
  }

  async function handleDownload() {
    setIsDownloading(true);
    try {
      const resolved = resolveQuality(
        quality,
        hits,
        movie.available_qualities,
      );
      await torrentsService.downloadCatalogMovie({
        tmdb_id: movie.tmdb_id,
        quality: resolved,
      });
      toast.success(
        `Added ${movie.title} (${resolved}) to download queue`,
      );
    } catch {
      toast.error('Failed to add to download queue. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }

  // ── derived values ─────────────────────────────────────────────────────────

  const year = movie.year ?? null;
  const runtimeMeta = movie.runtime ? `${movie.runtime}m` : null;
  const metaItems = [runtimeMeta].filter(Boolean) as string[];

  return (
    <div className="relative w-full bg-ink text-text min-h-screen" data-testid="movie-detail-view">
      {/* ── DetailHero ── */}
      <DetailHero
        title={movie.title}
        backdropUrl={movie.backdrop_url}
        posterUrl={movie.poster_url}
        year={year}
        rating={movie.vote_average}
        genres={movie.genres}
        metaItems={metaItems}
        tagline={movie.tagline}
        overview={movie.overview}
        eyebrow="Feature Film"
      >
        {/* ── Source picker ── */}
        <SourcePicker
          hits={hits}
          value={quality}
          onChange={setQuality}
          fallbackQualities={movie.available_qualities}
        />

        {/* ── Actions row ── */}
        <div className="flex flex-wrap items-center gap-[14px] mt-[22px]">
          {/* Play — champagne/primary */}
          <Button
            variant="primary"
            size="lg"
            leftIcon={<PlayIcon />}
            onClick={handlePlay}
            isLoading={isPlaying}
            disabled={isPlaying || isDownloading}
            data-testid="movie-play-button"
            className={cn(
              '!rounded-[12px] !h-[54px] !px-[34px] !text-[16.5px] font-semibold',
              'shadow-[0_14px_34px_-12px_rgba(201,168,106,.7)]',
              'hover:shadow-[0_18px_42px_-12px_rgba(201,168,106,.85)] hover:-translate-y-[2px]',
              'transition-[transform,box-shadow] duration-200',
            )}
          >
            Play
          </Button>

          {/* Download — glass */}
          <Button
            variant="glass"
            size="lg"
            leftIcon={<DownloadIcon />}
            onClick={handleDownload}
            isLoading={isDownloading}
            disabled={isPlaying || isDownloading}
            data-testid="movie-download-button"
            className="!rounded-[12px] !h-[54px] !px-[24px] !text-[15.5px] backdrop-blur-[8px]"
          >
            Download
          </Button>

          {/* My List — icon circle, wired to WatchlistContext */}
          <button
            type="button"
            aria-label={saved ? 'Remove from My List' : 'Add to My List'}
            title={saved ? 'Remove from My List' : 'Add to My List'}
            data-testid="movie-mylist-button"
            onClick={handleMyList}
            className={cn(
              'w-[54px] h-[54px] rounded-full grid place-items-center cursor-pointer',
              'border',
              'transition-[border-color,color,transform,background-color] duration-200',
              'hover:-translate-y-[2px]',
              'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
              saved
                ? 'bg-gold/20 text-gold border-gold/60 hover:bg-gold/30'
                : 'bg-surface-2/50 text-text border-hairline hover:border-gold hover:text-gold-lite',
            )}
          >
            {saved ? <CheckIcon /> : <PlusIcon />}
          </button>

          {/* Streams instantly caption */}
          <span className="ml-auto flex items-center gap-2 text-[13px] text-muted max-sm:hidden">
            <span
              className="w-2 h-2 rounded-full bg-gold animate-[ff-pulse_2s_infinite]"
              aria-hidden="true"
            />
            <span className="text-gold-lite font-medium">Streams instantly</span>
            &nbsp;while it downloads.
          </span>
        </div>
      </DetailHero>

      {/* ── Below-hero body ── */}
      <div
        className={cn(
          'relative z-[2]',
          'grid grid-cols-1',
          'px-[clamp(28px,5vw,56px)]',
          'pt-[clamp(46px,5vw,80px)] pb-[30px]',
        )}
      >
        {/* Overview block */}
        <section aria-label="Overview" className="max-w-[720px]">
          {/* Tagline-style kick in italic display */}
          <p
            className={cn(
              'font-display italic text-[14px] tracking-[.1em] uppercase',
              'text-gold mb-[14px]',
            )}
          >
            Overview
          </p>

          {movie.overview && (
            <p
              className="text-[17px] leading-[1.72] text-text/86 max-w-[680px] mb-[40px]"
              data-testid="movie-detail-overview"
            >
              {movie.overview}
            </p>
          )}

          {/* Director credit */}
          {movie.director && (
            <div className="mb-[22px]">
              <h2
                className={cn(
                  'font-display font-semibold text-[22px] tracking-[-0.01em] m-0 mb-[4px]',
                )}
              >
                Director
              </h2>
              <p className="text-[14px] text-muted">
                <strong className="text-text font-medium">{movie.director}</strong>
              </p>
            </div>
          )}
        </section>

        {/* Cast row */}
        <CastRow cast={movie.cast ?? []} />
      </div>

      {/* ── More Like This row ── */}
      {moreLikeThis.length > 0 && (
        <Row title="More Like This" eyebrow="You might also like" data-testid="more-like-this-row">
          {moreLikeThis.map((item) => (
            <div key={item.tmdb_id} role="listitem">
              <PosterCard item={item} data-testid={`more-like-this-card-${item.tmdb_id}`} />
            </div>
          ))}
        </Row>
      )}
    </div>
  );
};

export default MovieDetailView;
