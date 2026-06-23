'use client';

/**
 * ContinueWatchingRow — FRÈ redesign of ContinueWatchingSection.
 *
 * Reads useProgress() + useUser(); builds display cards from progressData
 * (filter percentage>0, sort by last_watched_at desc, group TV by showId,
 * movies individual, cap ~6), mirroring Resume-vs-Up-next rules.
 *
 * Returns null when there are no in-progress items.
 *
 * 16:9 cards with a thin gold progress fill, a remove (✕) calling
 * streamingService.deleteProgress(currentUser.id, item.id) then
 * refreshProgress(), and a resume link resumeUrlFor(item).
 */

import React, { useMemo, useRef } from 'react';
import { cn } from '@/lib/cn';
import { useProgress } from '@/context/ProgressContext';
import { useUser } from '@/context/UserContext';
import { streamingService } from '@/services/streaming';
import { parseContentId, resumeUrlFor, showNameFromTitle } from '@/lib/contentId';
import { StreamingProgress } from '@/types';

// ---------------------------------------------------------------------------
// Internal display card types
// ---------------------------------------------------------------------------

interface MovieCard {
  kind: 'movie';
  item: StreamingProgress;
  displayTitle: string;
  resumeUrl: string;
}

interface TvCard {
  kind: 'tv';
  item: StreamingProgress;
  showId: number;
  season: number;
  episode: number;
  showName: string;
  subLabel: string;
  resumeUrl: string;
  upNextEpisode?: number;
}

type DisplayCard = MovieCard | TvCard;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 5v14l11-7z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Card width constant for scroll
// ---------------------------------------------------------------------------
const CARD_WIDTH_PX = 328;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const ContinueWatchingRow: React.FC = () => {
  const { currentUser } = useUser();
  const { progressData, refreshProgress } = useProgress();
  const trackRef = useRef<HTMLDivElement>(null);

  // Build the list of display cards (movies individual, TV grouped by show)
  const displayCards = useMemo((): DisplayCard[] => {
    const allItems = Object.values(progressData)
      .filter((item) => item.percentage > 0)
      .sort(
        (a, b) =>
          new Date(b.last_watched_at).getTime() -
          new Date(a.last_watched_at).getTime(),
      );

    const cards: DisplayCard[] = [];
    const seenShows = new Set<number>();

    for (const item of allItems) {
      if (cards.length >= 6) break;

      // A removed torrent (torrent_id NULL via FK ON DELETE SET NULL) has nothing
      // to stream — keep the history row but don't offer it as a resumable card.
      if (!item.torrent_id) continue;

      const parsed = parseContentId(item.movie_id);

      if (parsed.kind === 'tv') {
        const { showId, season, episode } = parsed;
        if (showId === undefined || season === undefined || episode === undefined) continue;
        if (seenShows.has(showId)) continue;
        seenShows.add(showId);

        const showName = showNameFromTitle(item.title, showId);
        const subLabel = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')} · ${Math.round(item.percentage)}%`;

        const card: TvCard = {
          kind: 'tv',
          item,
          showId,
          season,
          episode,
          showName,
          subLabel,
          resumeUrl: resumeUrlFor({ torrent_id: item.torrent_id, file_index: item.file_index }),
          upNextEpisode: item.completed ? episode + 1 : undefined,
        };
        cards.push(card);
      } else {
        // Movie: only show if in-progress (not completed)
        if (item.completed) continue;
        const displayTitle = item.title ?? item.movie_id;
        cards.push({
          kind: 'movie',
          item,
          displayTitle,
          resumeUrl: resumeUrlFor({ torrent_id: item.torrent_id, file_index: item.file_index }),
        });
      }
    }

    return cards;
  }, [progressData]);

  const handleRemove = async (e: React.MouseEvent, item: StreamingProgress) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentUser) return;
    try {
      await streamingService.deleteProgress(currentUser.id, item.id);
      refreshProgress();
    } catch (err) {
      console.error('Failed to remove from Continue Watching:', err);
    }
  };

  function scrollPrev() {
    trackRef.current?.scrollBy({ left: -CARD_WIDTH_PX, behavior: 'smooth' });
  }

  function scrollNext() {
    trackRef.current?.scrollBy({ left: CARD_WIDTH_PX, behavior: 'smooth' });
  }

  if (displayCards.length === 0) return null;

  return (
    <section
      className="relative z-[2] px-14 max-sm:px-[18px]"
      aria-labelledby="cw-heading"
    >
      {/* ── Row header ── */}
      <div className="flex items-end justify-between gap-6 pt-[54px] pb-[22px] max-sm:pt-10 max-sm:pb-[18px]">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] tracking-[.32em] uppercase text-gold font-semibold">
            Pick up where you left off
          </span>
          <h2
            id="cw-heading"
            className="font-display font-normal text-[30px] leading-none tracking-[-0.02em] text-text m-0 max-sm:text-[25px]"
          >
            Continue Watching
          </h2>
        </div>

        <div className="flex items-center gap-3.5 max-sm:gap-2">
          <a
            href="/my-list"
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

          <div
            className="inline-flex items-center gap-2 max-sm:hidden"
            role="group"
            aria-label="Scroll Continue Watching"
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

      {/* ── Scroll track ── */}
      <div
        ref={trackRef}
        role="list"
        tabIndex={0}
        aria-labelledby="cw-heading"
        className={cn(
          'flex gap-[18px] overflow-x-auto',
          '[scroll-snap-type:x_proximity]',
          'scroll-smooth',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          'pb-2 pt-[2px] px-1',
          'focus:outline-none',
        )}
      >
        {displayCards.map((card) => {
          const { item } = card;
          const cardKey =
            card.kind === 'tv' ? `tv-${card.showId}` : `movie-${item.id}`;

          const isUpNext = card.kind === 'tv' && card.upNextEpisode !== undefined;
          const epLabel = card.kind === 'tv' ? 'Series' : 'Film';
          const name = card.kind === 'tv' ? card.showName : card.displayTitle;
          const sub =
            card.kind === 'tv'
              ? isUpNext
                ? `S${String(card.season).padStart(2, '0')} · E${String(card.upNextEpisode).padStart(2, '0')}`
                : card.subLabel
              : `${Math.round(item.percentage)}% watched`;

          const progressPct = isUpNext ? 0 : item.percentage;

          return (
            <article
              key={cardKey}
              role="listitem"
              className={cn(
                'group relative flex-none',
                '[scroll-snap-align:start]',
                '[width:clamp(280px,21vw,312px)]',
              )}
            >
              {/* Card link wraps art + meta */}
              <a
                href={card.resumeUrl}
                className={cn(
                  'block no-underline text-text rounded-[11px]',
                  'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                  'focus-visible:rounded-[11px]',
                )}
                aria-label={
                  isUpNext
                    ? `Up next: ${name}, Season ${(card as TvCard).season} Episode ${(card as TvCard).upNextEpisode}`
                    : `Resume ${name}`
                }
              >
                {/* 16:9 art frame */}
                <div
                  className={cn(
                    'relative aspect-video rounded-[11px] overflow-hidden',
                    'border border-hairline bg-surface-2',
                  )}
                >
                  {/* Title-card branded placeholder — intentional art, not a void */}
                  <div
                    className="absolute inset-0 bg-gradient-to-br from-surface-2 to-ink"
                    aria-hidden="true"
                  />
                  {/* Faint gold radial bloom */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    aria-hidden="true"
                    style={{
                      background:
                        'radial-gradient(ellipse 90% 70% at 50% 60%, rgba(201,168,106,.11), transparent 70%)',
                    }}
                  />
                  {/* Large display title at low opacity — the "title-card" look */}
                  <div
                    className="absolute inset-0 flex items-center justify-center px-5 z-[1]"
                    aria-hidden="true"
                  >
                    <span
                      className={cn(
                        'font-display font-light text-center leading-[1.05] tracking-[-0.025em]',
                        'text-text/[0.18] select-none',
                        '[word-break:break-word] hyphens-auto',
                      )}
                      style={{ fontSize: 'clamp(22px, 4.5vw, 36px)' }}
                    >
                      {name}
                    </span>
                  </div>

                  {/* Bottom gradient for legibility */}
                  <div
                    className="absolute inset-0 bg-gradient-to-t from-ink/85 via-transparent to-transparent z-[1]"
                    aria-hidden="true"
                  />

                  {/* Up Next badge */}
                  {isUpNext && (
                    <span
                      className={cn(
                        'absolute top-[9px] left-[9px] z-[3]',
                        'text-[10px] tracking-[.16em] uppercase',
                        'text-gold-lite bg-ink/62 border border-gold/40',
                        'px-2 py-[3px] rounded-[5px] font-semibold',
                        'backdrop-blur-sm',
                      )}
                    >
                      Up next
                    </span>
                  )}

                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={(e) => handleRemove(e, item)}
                    title={`Remove ${name} from Continue Watching`}
                    aria-label={`Remove ${name} from Continue Watching`}
                    className={cn(
                      'absolute top-[9px] right-[9px] z-[4]',
                      'w-[26px] h-[26px] rounded-full grid place-items-center',
                      'bg-ink/70 border border-hairline text-text cursor-pointer',
                      'opacity-0 scale-[0.8] transition-[opacity,transform,border-color] duration-200',
                      'group-hover:opacity-100 group-hover:scale-100',
                      'hover:border-gold/60 hover:text-gold-lite',
                      'focus:outline-none focus-visible:opacity-100 focus-visible:scale-100',
                      'focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                    )}
                  >
                    <span className="w-[12px] h-[12px]">
                      <XIcon />
                    </span>
                  </button>

                  {/* Play affordance — appears on hover */}
                  <div
                    className={cn(
                      'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[3]',
                      'w-12 h-12 rounded-full grid place-items-center',
                      'bg-gradient-to-br from-white to-gold-lite text-ink',
                      'opacity-0 scale-[0.85] transition-[opacity,transform] duration-[250ms]',
                      'group-hover:opacity-100 group-hover:scale-100',
                    )}
                    aria-hidden="true"
                  >
                    <span className="w-5 h-5 ml-[2px]">
                      <PlayIcon />
                    </span>
                  </div>

                  {/* Gold progress bar */}
                  <div
                    className="absolute left-0 right-0 bottom-0 z-[3] h-[3px] bg-text/15"
                    role="progressbar"
                    aria-valuenow={Math.round(progressPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${Math.round(progressPct)}% watched`}
                  >
                    <div
                      data-testid="cw-progress-fill"
                      className="h-full bg-gradient-to-r from-gold to-gold-lite shadow-[0_0_8px_rgba(201,168,106,.5)]"
                      style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
                    />
                  </div>
                </div>

                {/* Meta row below the art */}
                <div className="pt-[11px] px-[2px]">
                  <div className="text-[10.5px] tracking-[.06em] uppercase text-gold font-semibold mb-1">
                    {epLabel}
                  </div>
                  <h3 className="font-display font-normal text-[16px] leading-[1.15] tracking-[-0.01em] m-0 text-text">
                    {name}
                  </h3>
                  <div className="text-[12px] text-muted mt-1">
                    {card.kind === 'tv' && !isUpNext ? (
                      <span>
                        <span className="text-gold-lite font-semibold">
                          Resume S{String(card.season).padStart(2, '0')}·E{String(card.episode).padStart(2, '0')}
                        </span>
                      </span>
                    ) : (
                      <span>{sub}</span>
                    )}
                  </div>
                </div>
              </a>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default ContinueWatchingRow;
