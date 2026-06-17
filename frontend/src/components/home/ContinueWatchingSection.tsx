"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { useProgress } from '@/context/ProgressContext';
import { useUser } from '@/context/UserContext';
import { ArrowRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { PlayIcon } from '@heroicons/react/24/solid';
import Image from 'next/image';
import WatchProgressBar from '@/components/ui/WatchProgressBar';
import { StreamingProgress } from '@/types';
import { streamingService } from '@/services/streaming';
import { formatTime } from '@/utils/format';

// ---------------------------------------------------------------------------
// Helper: parse a content_id string into its component parts
// ---------------------------------------------------------------------------
interface ParsedContentId {
  kind: 'movie' | 'tv';
  showId?: number;
  season?: number;
  episode?: number;
}

function parseContentId(movieId: string): ParsedContentId {
  if (movieId.startsWith('tv:')) {
    // format: tv:{showId}:s{n}:e{m}
    const match = movieId.match(/^tv:(\d+):s(\d+):e(\d+)$/i);
    if (match) {
      return {
        kind: 'tv',
        showId: parseInt(match[1], 10),
        season: parseInt(match[2], 10),
        episode: parseInt(match[3], 10),
      };
    }
    // Fallback: still classify as tv even if parse fails
    return { kind: 'tv' };
  }
  return { kind: 'movie' };
}

// ---------------------------------------------------------------------------
// Helper: derive a show name from an episode title like "The Boys S01E03"
// ---------------------------------------------------------------------------
function showNameFromTitle(title: string | null | undefined, showId: number | undefined): string {
  if (title) {
    const stripped = title.replace(/\s+S\d+(E\d+)?.*$/i, '').trim();
    if (stripped) return stripped;
    return title;
  }
  if (showId !== undefined) return `Show ${showId}`;
  return 'Unknown Show';
}

// ---------------------------------------------------------------------------
// Card display types
// ---------------------------------------------------------------------------
interface MovieCard {
  kind: 'movie';
  item: StreamingProgress;
  displayTitle: string;
  resumeUrl: string;
}

interface TvCard {
  kind: 'tv';
  item: StreamingProgress; // the latest-watched episode for this show
  showId: number;
  season: number;
  episode: number;
  showName: string;
  subLabel: string;
  resumeUrl: string;
  upNextEpisode?: number; // set only when the latest episode is completed
}

type DisplayCard = MovieCard | TvCard;

// ---------------------------------------------------------------------------
// Build the resume URL for a progress entry
// ---------------------------------------------------------------------------
function resumeUrlFor(item: StreamingProgress): string {
  const base = `/streaming/${item.torrent_id}`;
  return item.file_index != null ? `${base}?file=${item.file_index}` : base;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const ContinueWatchingSection: React.FC = () => {
  const { currentUser } = useUser();
  const { progressData, refreshProgress } = useProgress();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [movieImages, setMovieImages] = useState<Record<string, string>>({});

  // Build the list of display cards (movies individual, TV grouped by show)
  const displayCards = useMemo((): DisplayCard[] => {
    // Work with all entries that have any progress (incl. completed for Up next)
    const allItems = Object.values(progressData)
      .filter(item => item.percentage > 0)
      .sort(
        (a, b) =>
          new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime()
      );

    const cards: DisplayCard[] = [];
    const seenShows = new Set<number>();

    for (const item of allItems) {
      if (cards.length >= 6) break;

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
          resumeUrl: resumeUrlFor(item),
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
          resumeUrl: resumeUrlFor(item),
        });
      }
    }

    return cards;
  }, [progressData]);

  // Fetch placeholder images (keyed by movie_id / showId)
  useEffect(() => {
    if (displayCards.length === 0) {
      if (Object.keys(movieImages).length > 0) {
        setMovieImages({});
      }
      return;
    }

    const nextKeys = displayCards.map(c => c.item.movie_id).sort();
    const currentKeys = Object.keys(movieImages).sort();
    const keysUnchanged =
      nextKeys.length === currentKeys.length && nextKeys.every((k, i) => k === currentKeys[i]);
    if (keysUnchanged) return;

    const fetchImages = async () => {
      setIsLoading(true);
      const newImages: Record<string, string> = {};
      for (const card of displayCards) {
        newImages[card.item.movie_id] = `/api/placeholder/400/600`;
      }
      setMovieImages(newImages);
      setIsLoading(false);
    };

    fetchImages();
  }, [displayCards, movieImages]);

  // Remove a specific progress entry
  const handleRemove = async (item: StreamingProgress) => {
    if (!currentUser) return;
    try {
      await streamingService.deleteProgress(currentUser.id, item.id);
      refreshProgress();
    } catch (error) {
      console.error('Failed to remove from continue watching:', error);
    }
  };

  if (displayCards.length === 0) return null;

  return (
    <Card className="mb-8">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Continue Watching</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          rightIcon={<ArrowRightIcon className="w-4 h-4" />}
          onClick={() => router.push('/my-movies')}
        >
          See All
        </Button>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {displayCards.map((card) => {
            const { item } = card;
            const imageKey = item.movie_id;
            const cardKey =
              card.kind === 'tv' ? `tv-${card.showId}` : `movie-${item.id}`;

            return (
              <div key={cardKey} className="relative group">
                <div
                  className="rounded-lg overflow-hidden cursor-pointer"
                  onClick={() => router.push(card.resumeUrl)}
                >
                  <div className="aspect-[2/3] relative bg-gray-800">
                    {movieImages[imageKey] && (
                      <Image
                        src={movieImages[imageKey]}
                        alt={card.kind === 'tv' ? card.showName : card.displayTitle}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 50vw, 33vw"
                      />
                    )}

                    {/* Hover overlay with play button */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="bg-primary-600 rounded-full p-3">
                        <PlayIcon className="w-8 h-8 text-white" />
                      </div>
                    </div>

                    {/* Remove button */}
                    <button
                      className="absolute top-2 right-2 bg-black/70 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(item);
                      }}
                    >
                      <XMarkIcon className="w-5 h-5 text-white" />
                    </button>
                  </div>

                  {/* Progress information */}
                  <div className="p-2">
                    {card.kind === 'tv' ? (
                      <>
                        <h3 className="text-sm font-medium line-clamp-1">{card.showName}</h3>
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{card.subLabel}</p>
                        {card.upNextEpisode !== undefined && (
                          <button
                            className="mt-1 text-xs text-primary-400 hover:text-primary-300 underline truncate w-full text-left"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/tv/${card.showId}`);
                            }}
                          >
                            Up next S{String(card.season).padStart(2, '0')}E{String(card.upNextEpisode).padStart(2, '0')}
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <h3 className="text-sm font-medium line-clamp-1">{card.displayTitle}</h3>
                        <div className="flex justify-between text-xs text-gray-400 mt-1 mb-2">
                          <span>
                            {item.duration
                              ? `${formatTime(item.current_time)} / ${formatTime(item.duration)}`
                              : formatTime(item.current_time)}
                          </span>
                          <span>{Math.round(item.percentage)}%</span>
                        </div>
                      </>
                    )}
                    <WatchProgressBar progress={item.percentage} height="h-1" showTooltip={false} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default ContinueWatchingSection;
