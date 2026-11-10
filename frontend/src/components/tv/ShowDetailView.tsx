'use client';

/**
 * ShowDetailView — client island for the TV show detail page.
 *
 * Composes DetailHero + season selector + EpisodeList + "More Like This" row.
 * Server page (app/(web)/tv/[id]/page.tsx) fetches ShowDetail SSR and passes it
 * in via props; this component owns all interactivity.
 *
 * The asked episode (a Continue Watching show card opens this page, not the
 * player, so the way back into the episode lives here):
 *   the server page reads `?season=&episode=` with `episodeAskFrom` and passes
 *   them as `initialSeason` / `initialEpisode`, keyed on both so a search-only
 *   navigation remounts this component rather than keeping its state
 *   tab   = the asked season when it is one of the regular seasons, else the
 *           first; season 0 never is (Specials, and the backend's `s0` fallback)
 *   focus = the asked season + episode, when both are there; otherwise none,
 *           and the page is exactly what it was without a query
 *   row   = useProgress().progressData['tv:{tmdb_id}:s{S}:e{E}'] for the focus
 *   next  = findNextEpisode(focus), asked only once that row is finished
 *           (in-season or cross-season); `none` and `unknown` are both null
 *
 * Hero flow (the order is `showHeroAction`'s, in @/lib/showHero):
 *   Resume S01·E03 → router.push(resumeUrlFor(row))
 *     — an unfinished row past 0% that still has its torrent; the row's own
 *       torrent and file (`?file=N` for a season pack, file 0 included); it
 *       never starts a download. The player then applies its own "Resume
 *       playback?" rule, as it does after the movie page's Resume.
 *   Play S01·E04   → the next episode, when the asked one is finished
 *   Play S01·E03   → the asked episode, when there is no usable row
 *   Play S01·E01   → no asked episode, or none found after a finished one
 *   Play, loading and disabled → progress, or the next-episode lookup, is still
 *     out; a press then could start a download that Resume would have avoided.
 *     Without a query the hero never waits: there is no row to wait for.
 *   The episode the hero is about is highlighted in EpisodeList whenever its
 *   season is the open tab. Nothing scrolls to it; the hero carries the action.
 *
 * Play flow (the hero's Play, for the episode it names):
 *   quality = '1080p' (default for shows)
 *   status  = await handleCatalogStreamingStart({ tmdb_id, quality:'1080p', media_type:'tv', season, episode })
 *   router.push(streamingHref(status))   // /streaming/<id>[?file=<file_index>]
 *
 * Download Season flow:
 *   await torrentsService.downloadCatalogMovie({ tmdb_id, quality, media_type:'tv', season }) + toast
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { streamingHref } from '@/lib/streamingHref';
import { toast } from 'react-hot-toast';

import { ShowDetail, SeasonDetail, CatalogItem, GENRE_OPTIONS } from '@/types';
import { tvService } from '@/services/tv';
import { torrentsService } from '@/services/torrents';
import { handleCatalogStreamingStart } from '@/utils/streaming';
import { useWatchlist } from '@/context/WatchlistContext';
import { useProgress } from '@/context/ProgressContext';
import { buildContentId } from '@/lib/contentId';
import { findNextEpisode } from '@/lib/nextEpisode';
import { episodeCode, showHeroAction, type EpisodeAt } from '@/lib/showHero';
import { toWatchlistCreate } from '@/lib/watchlist/toWatchlistCreate';

import DetailHero from '@/components/detail/DetailHero';
import EpisodeList from '@/components/tv/EpisodeList';
import { Button, Pill } from '@/components/ui/fre';
import Row from '@/components/browse/Row';
import PosterCard from '@/components/browse/PosterCard';
import { cn } from '@/lib/cn';

// ── default quality for shows ─────────────────────────────────────────────────

const DEFAULT_QUALITY = '1080p' as const;

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

function PackageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-[14px] h-[14px] text-gold shrink-0"
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export interface ShowDetailViewProps {
  show: ShowDetail;
  /** `?season=`: the tab to open on, honoured only when it is a regular season. */
  initialSeason?: number;
  /** `?episode=`: the episode in that season the hero is about. */
  initialEpisode?: number;
}

const ShowDetailView: React.FC<ShowDetailViewProps> = ({
  show,
  initialSeason,
  initialEpisode,
}) => {
  const router = useRouter();

  // Determine available seasons (filter out season 0 / specials)
  const regularSeasons = show.seasons.filter((s) => s.season_number > 0);
  const firstSeason = regularSeasons[0]?.season_number ?? 1;
  // The asked season, only when it is one of those tabs: a season the show
  // does not list is not an ask, and the page opens on the first as before.
  const askedSeason = regularSeasons.some((s) => s.season_number === initialSeason)
    ? initialSeason
    : undefined;

  // ── state ──────────────────────────────────────────────────────────────────
  // Seeded with the asked season, not switched to it after mount, so the
  // first season is never fetched on the way.
  const [selectedSeason, setSelectedSeason] = useState<number>(askedSeason ?? firstSeason);
  const [seasonDetail, setSeasonDetail] = useState<SeasonDetail | null>(null);
  const [seasonLoading, setSeasonLoading] = useState(false);
  // Use a ref for the season cache so fetchSeason doesn't need it in its deps
  // (avoids an infinite re-creation loop when the cache is updated).
  const seasonCacheRef = useRef<Record<number, SeasonDetail>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [moreLikeThis, setMoreLikeThis] = useState<CatalogItem[]>([]);
  // The episode after a finished focus, kept with the content id it was asked
  // for so that it is never read as another episode's answer.
  const [nextFound, setNextFound] = useState<{ asked: string; at: EpisodeAt | null } | null>(null);

  // ── the asked episode ──────────────────────────────────────────────────────
  // See the header. `focusId` is the profile's progress key for the focus.
  const { progressData, isLoading: progressLoading } = useProgress();
  const focus: EpisodeAt | null =
    askedSeason !== undefined && initialEpisode !== undefined
      ? { season: askedSeason, episode: initialEpisode }
      : null;
  const focusId = focus ? buildContentId({ kind: 'tv', tmdbId: show.tmdb_id, ...focus }) : null;
  const row = focusId !== null ? progressData[focusId] ?? null : null;
  const finished = row?.completed === true;

  // Asked only for a finished row: the hero reads `next` for nothing else.
  // `ready` is the next episode and anything else is null; an answer that lands
  // after unmount, or for a focus no longer on screen, is dropped. The answer is
  // filed under `focusId` itself, the key `next` below reads it back by.
  // `finished` is a dep because the row usually lands after mount (a fresh load
  // of an "Up next" card): the lookup starts on that render, not at mount.
  useEffect(() => {
    // `focusId` is null exactly when either half of the ask is; the other two
    // tests are there to narrow them for the call.
    if (focusId === null || askedSeason === undefined || initialEpisode === undefined || !finished) {
      return;
    }
    const asked = focusId;
    let cancelled = false;

    (async () => {
      let at: EpisodeAt | null = null;
      try {
        const { verdict } = await findNextEpisode({
          tmdbId: show.tmdb_id,
          season: askedSeason,
          episode: initialEpisode,
        });
        if (verdict.k === 'ready') {
          at = { season: verdict.next.season, episode: verdict.next.episode };
        }
      } catch {
        // findNextEpisode never rejects; were it to, that is `unknown` — not a
        // hero left pending for good.
      }
      if (!cancelled) setNextFound({ asked, at });
    })();

    return () => {
      cancelled = true;
    };
  }, [focusId, show.tmdb_id, askedSeason, initialEpisode, finished]);

  const next = focusId !== null && nextFound?.asked === focusId ? nextFound.at : undefined;
  const heroAction = showHeroAction({ focus, row, next, progressLoading });
  const heroLabel =
    heroAction.kind === 'resume'
      ? `Resume ${episodeCode(heroAction.at)}`
      : heroAction.kind === 'play'
        ? `Play ${episodeCode(heroAction.at)}`
        : 'Play';
  // The episode the hero is about, when its season is the open tab. Without a
  // query nothing is highlighted, though the hero still names S01·E01.
  const highlightEpisode =
    focus !== null && heroAction.kind !== 'pending' && heroAction.at.season === selectedSeason
      ? heroAction.at.episode
      : undefined;

  // ── watchlist ──────────────────────────────────────────────────────────────
  const { isSaved, toggle } = useWatchlist();
  // Show-level content_id uses tv:{tmdb_id} (no season/episode for hub level)
  const contentId = buildContentId({ kind: 'tv', tmdbId: show.tmdb_id });
  const saved = isSaved(contentId);

  function handleMyList() {
    toggle(toWatchlistCreate({ ...show, title: show.name }));
  }

  // ── on mount: fetch "more like this" ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadMoreLikeThis() {
      try {
        // ShowDetail has genres[] (string labels). Map first genre label to a
        // numeric ID via GENRE_OPTIONS; skip if unmappable.
        const firstGenreLabel = show.genres?.[0];
        let genreId: number | undefined;
        if (firstGenreLabel) {
          const match = GENRE_OPTIONS.find(
            (o) =>
              o.label.toLowerCase() === firstGenreLabel.toLowerCase(),
          );
          if (match && match.value !== 0) {
            genreId = match.value;
          }
        }

        const params = genreId ? { genre: genreId } : {};
        const page = await tvService.browse(params);
        if (!cancelled) {
          const others = (page.results ?? []).filter(
            (item) => item.tmdb_id !== show.tmdb_id,
          );
          setMoreLikeThis(others.slice(0, 20));
        }
      } catch {
        if (!cancelled) setMoreLikeThis([]);
      }
    }

    loadMoreLikeThis();
    return () => {
      cancelled = true;
    };
  }, [show.tmdb_id, show.genres]);

  // ── fetch season when selectedSeason changes ───────────────────────────────
  const fetchSeason = useCallback(
    async (season: number) => {
      if (seasonCacheRef.current[season]) {
        setSeasonDetail(seasonCacheRef.current[season]);
        return;
      }
      setSeasonLoading(true);
      try {
        const detail = await tvService.getSeason(show.tmdb_id, season);
        seasonCacheRef.current = { ...seasonCacheRef.current, [season]: detail };
        setSeasonDetail(detail);
      } catch {
        setSeasonDetail(null);
      } finally {
        setSeasonLoading(false);
      }
    },
    [show.tmdb_id],
  );

  useEffect(() => {
    fetchSeason(selectedSeason);
  }, [selectedSeason, fetchSeason]);

  // ── action handlers ────────────────────────────────────────────────────────

  function handleHero() {
    if (heroAction.kind === 'resume') router.push(heroAction.href);
    else if (heroAction.kind === 'play') handlePlay(heroAction.at.season, heroAction.at.episode);
  }

  async function handlePlay(season: number, episode: number) {
    setIsPlaying(true);
    try {
      const status = await handleCatalogStreamingStart({
        tmdb_id: show.tmdb_id,
        quality: DEFAULT_QUALITY,
        media_type: 'tv',
        season,
        episode,
      });
      if (status?.id) {
        router.push(streamingHref(status));
      }
    } catch {
      toast.error('Failed to start streaming. Please try again.');
    } finally {
      setIsPlaying(false);
    }
  }

  async function handleDownloadSeason() {
    setIsDownloading(true);
    try {
      await torrentsService.downloadCatalogMovie({
        tmdb_id: show.tmdb_id,
        quality: DEFAULT_QUALITY,
        media_type: 'tv',
        season: selectedSeason,
      });
      toast.success(
        `Added ${show.name} Season ${selectedSeason} (${DEFAULT_QUALITY}) to download queue`,
      );
    } catch {
      toast.error('Failed to add to download queue. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }

  function handleSeasonSelect(season: number) {
    setSelectedSeason(season);
  }

  // ── derived values ─────────────────────────────────────────────────────────

  const year = show.year ?? null;
  const metaItems: string[] = [
    `${show.number_of_seasons} Season${show.number_of_seasons !== 1 ? 's' : ''}`,
    ...(show.status ? [show.status] : []),
  ];

  return (
    <div
      className="relative w-full bg-ink text-text min-h-screen"
      data-testid="show-detail-view"
    >
      {/* ── DetailHero ── */}
      <DetailHero
        title={show.name}
        backdropUrl={show.backdrop_url}
        posterUrl={show.poster_url}
        year={year}
        rating={show.vote_average}
        genres={show.genres}
        metaItems={metaItems}
        tagline={null}
        overview={show.overview}
        eyebrow="Series"
      >
        {/* ── Actions row ── */}
        <div className="flex flex-wrap items-center gap-[14px] mt-[8px]">
          {/* Hero — Resume or Play the episode it names; champagne/primary */}
          <Button
            variant="primary"
            size="lg"
            leftIcon={<PlayIcon />}
            onClick={handleHero}
            isLoading={isPlaying || heroAction.kind === 'pending'}
            disabled={isPlaying || isDownloading}
            data-testid="show-play-button"
            className={cn(
              '!rounded-[12px] !h-[54px] !px-[34px] !text-[16.5px] font-semibold',
              'shadow-[0_14px_34px_-12px_rgba(201,168,106,.7)]',
              'hover:shadow-[0_18px_42px_-12px_rgba(201,168,106,.85)] hover:-translate-y-[2px]',
              'transition-[transform,box-shadow] duration-200',
            )}
          >
            {heroLabel}
          </Button>

          {/* Download Season — glass */}
          <Button
            variant="glass"
            size="lg"
            leftIcon={<DownloadIcon />}
            onClick={handleDownloadSeason}
            isLoading={isDownloading}
            disabled={isPlaying || isDownloading}
            data-testid="show-download-season-button"
            className="!rounded-[12px] !h-[54px] !px-[24px] !text-[15.5px] backdrop-blur-[8px]"
          >
            Download Season
          </Button>

          {/* My List — icon circle, wired to WatchlistContext */}
          <button
            type="button"
            aria-label={saved ? 'Remove from My List' : 'Add to My List'}
            title={saved ? 'Remove from My List' : 'Add to My List'}
            data-testid="show-mylist-button"
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
        </div>
      </DetailHero>

      {/* ── Body ── */}
      <div
        className={cn(
          'relative z-[2]',
          'px-[clamp(28px,5vw,56px)]',
          'pt-[clamp(40px,4vw,64px)] pb-[30px]',
        )}
      >
        {/* ── Season selector bar ── */}
        <div
          className={cn(
            'flex flex-wrap items-center gap-[18px]',
          )}
          data-testid="season-selector-bar"
        >
          {/* Season tabs */}
          <div
            className="flex flex-wrap gap-[8px]"
            role="tablist"
            aria-label="Select season"
            data-testid="season-tabs"
          >
            {regularSeasons.map((season) => (
              <Pill
                key={season.season_number}
                selected={selectedSeason === season.season_number}
                onClick={() => handleSeasonSelect(season.season_number)}
                role="tab"
                aria-selected={selectedSeason === season.season_number}
                data-testid={`season-tab-${season.season_number}`}
              >
                Season {season.season_number}
              </Pill>
            ))}
          </div>

          {/* Pack note */}
          <span
            className="ml-auto inline-flex items-center gap-[8px] font-ui text-[12.5px] text-muted"
            data-testid="season-pack-note"
          >
            <PackageIcon />
            <b className="text-gold-lite font-semibold">Season pack</b>
            &nbsp;· streams the selected episode
          </span>
        </div>

        {/* ── Episode list ── */}
        {seasonLoading ? (
          <div
            className="flex items-center justify-center py-[48px] gap-[12px] font-ui text-[14px] text-muted"
            data-testid="season-loading"
          >
            <svg
              className="h-5 w-5 animate-spin text-gold"
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
            Loading episodes…
          </div>
        ) : seasonDetail ? (
          <EpisodeList
            showId={show.tmdb_id}
            seasonNumber={selectedSeason}
            episodes={seasonDetail.episodes}
            highlightEpisode={highlightEpisode}
          />
        ) : (
          <p
            className="font-ui text-[14px] text-muted py-[24px]"
            data-testid="season-error"
          >
            Could not load episodes for this season.
          </p>
        )}
      </div>

      {/* ── More Like This row ── */}
      {moreLikeThis.length > 0 && (
        <Row
          title="More Like This"
          eyebrow="You might also like"
          data-testid="more-like-this-row"
        >
          {moreLikeThis.map((item) => (
            <div key={item.tmdb_id} role="listitem">
              <PosterCard
                item={item}
                data-testid={`more-like-this-card-${item.tmdb_id}`}
              />
            </div>
          ))}
        </Row>
      )}
    </div>
  );
};

export default ShowDetailView;
