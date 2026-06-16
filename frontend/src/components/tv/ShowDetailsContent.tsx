// src/components/tv/ShowDetailsContent.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { fadeIn, slideUp, staggerContainer } from '@/components/ui/Motion';
import { useRouter } from 'next/navigation';
import { ShowDetail, SeasonDetail, Episode, SeasonSummary } from '@/types';
import { tvService } from '@/services/tv';
import { torrentsService } from '@/services/torrents';
import { toast } from 'react-hot-toast';
import { handleCatalogStreamingStart } from '@/utils/streaming';
import Button from '@/components/ui/Button';
import { extractPaletteFromImage } from '@/utils/palette';
import Badge from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import {
  StarIcon,
  PlayIcon,
  ArrowDownTrayIcon,
  ClockIcon,
  CalendarIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/solid';

interface ShowDetailsContentProps {
  show: ShowDetail;
}

function EpisodeRow({
  episode,
  seasonNumber,
  showId,
  palette,
}: {
  episode: Episode;
  seasonNumber: number;
  showId: number;
  palette: { primary: string; secondary: string; background: string; muted: string; accent: string } | null;
}) {
  const router = useRouter();
  const [selectedQuality, setSelectedQuality] = useState<'720p' | '1080p' | '2160p'>('1080p');
  const [downloading, setDownloading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const episodeLabel = `S${String(seasonNumber).padStart(2, '0')}E${String(episode.episode_number).padStart(2, '0')}`;

  const handleDownload = async () => {
    try {
      setDownloading(true);
      await torrentsService.downloadCatalogMovie({
        tmdb_id: showId,
        quality: selectedQuality,
        media_type: 'tv',
        season: seasonNumber,
        episode: episode.episode_number,
      });
      toast.success(`Added ${episodeLabel} "${episode.name}" (${selectedQuality}) to download queue`);
    } catch (error: any) {
      console.error('Error downloading episode:', error);
      const status = error?.response?.status;
      const detail = error?.response?.data?.detail;
      if (status === 422 && detail) {
        toast.error(`No release found: ${detail}`);
      } else {
        toast.error('Failed to add episode to download queue');
      }
    } finally {
      setTimeout(() => setDownloading(false), 2000);
    }
  };

  const handleStream = async () => {
    try {
      setStreaming(true);
      const torrentStatus = await handleCatalogStreamingStart({
        tmdb_id: showId,
        quality: selectedQuality,
        media_type: 'tv',
        season: seasonNumber,
        episode: episode.episode_number,
      });
      if (torrentStatus?.id) {
        router.push(`/streaming/${torrentStatus.id}`);
      }
    } catch (error) {
      // handleCatalogStreamingStart surfaces its own error toast; this is a
      // defensive fallback for unexpected throws.
      console.error('Error starting stream:', error);
      toast.error('Failed to start streaming. Please try again.');
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div
      className="bg-gray-800/40 rounded-lg border border-gray-700/50 overflow-hidden"
      style={{ borderColor: palette ? `${palette.muted}44` : undefined }}
    >
      <div className="flex items-start gap-3 p-3">
        {/* Episode still / thumbnail */}
        <div className="flex-shrink-0 w-28 h-16 sm:w-36 sm:h-20 rounded-md overflow-hidden bg-gray-700">
          {episode.still_url ? (
            <img
              src={episode.still_url}
              alt={episode.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <PlayIcon className="w-8 h-8 text-gray-500" />
            </div>
          )}
        </div>

        {/* Info column */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-xs font-mono text-gray-400">{episodeLabel}</span>
              <h4 className="text-sm font-semibold text-white truncate">{episode.name}</h4>
              <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-400">
                {episode.runtime && (
                  <span className="flex items-center gap-0.5">
                    <ClockIcon className="w-3 h-3" />
                    {episode.runtime}m
                  </span>
                )}
                {episode.air_date && (
                  <span className="flex items-center gap-0.5">
                    <CalendarIcon className="w-3 h-3" />
                    {episode.air_date}
                  </span>
                )}
                {episode.vote_average > 0 && (
                  <span className="flex items-center gap-0.5">
                    <StarIcon className="w-3 h-3 text-yellow-500" />
                    {episode.vote_average.toFixed(1)}
                  </span>
                )}
              </div>
            </div>

            {/* Expand toggle */}
            <button
              onClick={() => setExpanded((prev) => !prev)}
              className="flex-shrink-0 text-gray-400 hover:text-gray-200 transition-colors"
              aria-label="Toggle details"
            >
              <ChevronDownIcon
                className={`w-4 h-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          </div>

          {/* Action controls — always visible on larger screens */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {/* Quality selector */}
            <select
              value={selectedQuality}
              onChange={(e) => setSelectedQuality(e.target.value as '720p' | '1080p' | '2160p')}
              className="text-xs bg-gray-700 border border-gray-600 rounded px-1.5 py-0.5 text-gray-200"
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="2160p">2160p</option>
            </select>

            <Button
              variant="outline"
              size="sm"
              leftIcon={<ArrowDownTrayIcon className="w-3 h-3" />}
              onClick={handleDownload}
              isLoading={downloading}
              className="text-xs px-2 py-1 h-auto"
            >
              Download
            </Button>

            <Button
              variant="primary"
              size="sm"
              leftIcon={<PlayIcon className="w-3 h-3" />}
              onClick={handleStream}
              isLoading={streaming}
              className="text-xs px-2 py-1 h-auto"
            >
              Stream
            </Button>
          </div>
        </div>
      </div>

      {/* Expandable overview */}
      {expanded && episode.overview && (
        <div className="px-3 pb-3">
          <p className="text-xs text-gray-400 leading-relaxed border-t border-gray-700/50 pt-2">
            {episode.overview}
          </p>
        </div>
      )}
    </div>
  );
}

export default function ShowDetailsContent({ show }: ShowDetailsContentProps) {
  const router = useRouter();
  const [paletteApplied, setPaletteApplied] = useState(false);
  const [palette, setPalette] = useState<{ primary: string; secondary: string; background: string; muted: string; accent: string } | null>(null);
  const [seasonDownloadQuality, setSeasonDownloadQuality] = useState<'720p' | '1080p' | '2160p'>('1080p');
  const [seasonDownloading, setSeasonDownloading] = useState(false);

  // Find default season: first with season_number >= 1
  const defaultSeason = show.seasons.find((s) => s.season_number >= 1) ?? show.seasons[0] ?? null;

  const [selectedSeason, setSelectedSeason] = useState<SeasonSummary | null>(defaultSeason);
  const [seasonDetail, setSeasonDetail] = useState<SeasonDetail | null>(null);
  const [seasonLoading, setSeasonLoading] = useState(false);

  // Extract palette from backdrop/poster
  useEffect(() => {
    if (!show || paletteApplied) return;
    const img = show.backdrop_url || show.poster_url;
    if (!img) return;
    extractPaletteFromImage(img).then((pal) => {
      if (pal) {
        const el = document.getElementById('show-details-root');
        if (el) {
          el.style.setProperty('--color-primary', pal.primary);
          el.style.setProperty('--color-secondary', pal.secondary);
          el.style.setProperty('--color-background', pal.background);
          el.style.setProperty('--color-muted', pal.muted);
          el.style.setProperty('--color-card', pal.background);
          el.style.setProperty('--color-border', pal.muted);
        }
        setPalette(pal);
        setPaletteApplied(true);
      }
    });
  }, [show, paletteApplied]);

  // Load season detail when selectedSeason changes
  const loadSeason = useCallback(
    async (season: SeasonSummary) => {
      setSeasonLoading(true);
      setSeasonDetail(null);
      try {
        const detail = await tvService.getSeason(show.tmdb_id, season.season_number);
        setSeasonDetail(detail);
      } catch (error) {
        console.error('Error loading season:', error);
        toast.error('Failed to load season episodes');
      } finally {
        setSeasonLoading(false);
      }
    },
    [show.tmdb_id]
  );

  useEffect(() => {
    if (selectedSeason) {
      loadSeason(selectedSeason);
    }
  }, [selectedSeason, loadSeason]);

  const handleSeasonDownload = async () => {
    if (!selectedSeason) return;
    const seasonNumber = selectedSeason.season_number;
    try {
      setSeasonDownloading(true);
      const torrentStatus = await torrentsService.downloadCatalogMovie({
        tmdb_id: show.tmdb_id,
        quality: seasonDownloadQuality,
        media_type: 'tv',
        season: seasonNumber,
      });
      toast.success(
        `Season ${seasonNumber} download started (${seasonDownloadQuality})`,
        {
          duration: 6000,
        }
      );
      if (torrentStatus?.id) {
        toast(
          (t) => (
            <span>
              Season pack queued.{' '}
              <button
                className="underline font-semibold"
                onClick={() => {
                  toast.dismiss(t.id);
                  router.push(`/streaming/${torrentStatus.id}`);
                }}
              >
                Open
              </button>
            </span>
          ),
          { duration: 8000 }
        );
      }
    } catch (error: any) {
      console.error('Error downloading season:', error);
      const status = error?.response?.status;
      const detail = error?.response?.data?.detail;
      if (status === 422 && detail) {
        toast.error(`No season pack found: ${detail}`);
      } else {
        toast.error('Failed to start season download');
      }
    } finally {
      setTimeout(() => setSeasonDownloading(false), 2000);
    }
  };

  const backdropImage = show.backdrop_url || show.poster_url;

  return (
    <div className="w-screen pb-16 bg-background text-foreground" id="show-details-root">
      {/* Hero Section */}
      <div
        className="relative h-[70vh] md:h-[85vh] w-screen bg-cover bg-center overflow-hidden mb-0"
        style={{
          backgroundImage: backdropImage
            ? `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.65)), url(${backdropImage})`
            : 'linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.9))',
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
        }}
      >
        {/* Dynamic palette overlay */}
        <div
          className="absolute inset-0"
          style={{
            background: palette
              ? `radial-gradient(1000px 400px at 10% 10%, ${palette.primary}22, transparent 60%), radial-gradient(1000px 400px at 90% 20%, ${palette.secondary}22, transparent 60%)`
              : undefined,
          }}
        />
        {/* Nav readability gradient */}
        <div
          className="absolute inset-x-0 top-0 h-24"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)' }}
        />

        <motion.div
          className="absolute bottom-0 left-0 right-0 p-6"
          variants={staggerContainer(0.06, 0.1)}
          initial="hidden"
          animate="visible"
        >
          <div
            className="absolute inset-x-0 bottom-0 h-40"
            style={{
              background: palette
                ? `linear-gradient(to top, ${palette.background}F2, transparent)`
                : undefined,
            }}
          />
          <div className="max-w-7xl mx-auto px-6 flex items-end gap-6">
            {/* Poster thumbnail */}
            <motion.div
              className="hidden sm:block w-32 h-48 md:w-48 md:h-72 rounded-md overflow-hidden shadow-lg flex-shrink-0 border border-gray-700 transform -translate-y-6"
              variants={slideUp}
            >
              {show.poster_url ? (
                <img src={show.poster_url} alt={show.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                  <PlayIcon className="w-12 h-12 text-gray-500" />
                </div>
              )}
            </motion.div>

            {/* Title and metadata */}
            <div className="flex-1">
              <motion.h1
                className="text-3xl md:text-5xl font-bold text-white drop-shadow-lg mb-3"
                variants={slideUp}
              >
                {show.name}{' '}
                <span className="text-gray-300">({show.year ?? 'N/A'})</span>
              </motion.h1>

              <motion.div className="flex flex-wrap gap-2 mb-4" variants={fadeIn}>
                {/* Status badge */}
                {show.status && (
                  <Badge variant="default" size="md">
                    {show.status}
                  </Badge>
                )}
                {/* Season count */}
                <Badge variant="default" size="md">
                  {show.number_of_seasons} Season{show.number_of_seasons !== 1 ? 's' : ''}
                </Badge>
                {/* Genres */}
                {show.genres.map((genre) => (
                  <span
                    key={genre}
                    className="border rounded px-2 py-0.5 text-xs"
                    style={{
                      borderColor: palette?.secondary,
                      backgroundColor: palette ? `${palette.secondary}22` : undefined,
                    }}
                  >
                    {genre}
                  </span>
                ))}
              </motion.div>

              <motion.div className="flex flex-wrap gap-4" variants={fadeIn}>
                <div className="flex items-center gap-1">
                  <StarIcon className="h-5 w-5 text-yellow-500" />
                  <span className="text-white font-semibold">{show.vote_average.toFixed(1)}</span>
                  <span className="text-gray-400 text-sm">/ 10</span>
                  {show.vote_count > 0 && (
                    <span className="text-gray-400 text-xs">
                      ({show.vote_count.toLocaleString()} votes)
                    </span>
                  )}
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 mt-8">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar */}
          <div className="w-full md:w-1/3 lg:w-1/4 space-y-6">
            {/* Show Info Card */}
            <Card>
              <CardHeader>
                <CardTitle>Show Info</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm">
                  {show.status && (
                    <div className="flex items-start">
                      <div>
                        <span className="text-gray-400">Status:</span>
                        <span className="block text-white">{show.status}</span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start">
                    <CalendarIcon className="w-4 h-4 mt-0.5 mr-2 text-gray-400 flex-shrink-0" />
                    <div>
                      <span className="text-gray-400">First Aired:</span>
                      <span className="block text-white">{show.first_air_date ?? 'N/A'}</span>
                    </div>
                  </div>
                  {show.last_air_date && (
                    <div className="flex items-start">
                      <CalendarIcon className="w-4 h-4 mt-0.5 mr-2 text-gray-400 flex-shrink-0" />
                      <div>
                        <span className="text-gray-400">Last Aired:</span>
                        <span className="block text-white">{show.last_air_date}</span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start">
                    <div>
                      <span className="text-gray-400">Seasons:</span>
                      <span className="block text-white">{show.number_of_seasons}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Overview Card */}
            {show.overview && (
              <Card>
                <CardHeader>
                  <CardTitle>Overview</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-300 text-sm leading-relaxed">{show.overview}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Episodes Section */}
          <div className="w-full md:w-2/3 lg:w-3/4">
            <h2 className="text-2xl font-semibold mb-4">Episodes</h2>

            {/* Season selector */}
            {show.seasons.length > 0 && (
              <div className="mb-6">
                <div className="flex flex-wrap gap-2">
                  {show.seasons.map((season) => (
                    <button
                      key={season.season_number}
                      onClick={() => setSelectedSeason(season)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        selectedSeason?.season_number === season.season_number
                          ? 'text-white border-transparent'
                          : 'text-gray-400 border-gray-700 hover:text-gray-200 hover:border-gray-500'
                      }`}
                      style={
                        selectedSeason?.season_number === season.season_number
                          ? {
                              backgroundColor: palette?.primary ?? '#6366f1',
                              borderColor: palette?.primary ?? '#6366f1',
                            }
                          : undefined
                      }
                    >
                      {season.season_number === 0 ? 'Specials' : `Season ${season.season_number}`}
                      {season.episode_count > 0 && (
                        <span className="ml-1 text-xs opacity-70">({season.episode_count})</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Download whole season */}
            {selectedSeason && (
              <div
                className="flex flex-wrap items-center gap-3 mb-6 p-3 rounded-lg border border-gray-700/50 bg-gray-800/30"
                style={{ borderColor: palette ? `${palette.muted}44` : undefined }}
              >
                <span className="text-sm font-medium text-gray-300 mr-1">
                  Download season pack:
                </span>
                <select
                  value={seasonDownloadQuality}
                  onChange={(e) =>
                    setSeasonDownloadQuality(e.target.value as '720p' | '1080p' | '2160p')
                  }
                  className="text-xs bg-gray-700 border border-gray-600 rounded px-1.5 py-0.5 text-gray-200"
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                  <option value="2160p">2160p</option>
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<ArrowDownTrayIcon className="w-3.5 h-3.5" />}
                  onClick={handleSeasonDownload}
                  isLoading={seasonDownloading}
                  className="text-xs px-3 py-1 h-auto"
                >
                  Download whole season
                </Button>
              </div>
            )}

            {/* Episode list */}
            {seasonLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="animate-pulse bg-gray-800/40 rounded-lg h-24 border border-gray-700/50" />
                ))}
              </div>
            ) : seasonDetail ? (
              <div className="space-y-3">
                {seasonDetail.episodes.length === 0 ? (
                  <p className="text-gray-400">No episodes available for this season.</p>
                ) : (
                  seasonDetail.episodes.map((episode) => (
                    <EpisodeRow
                      key={episode.episode_number}
                      episode={episode}
                      seasonNumber={selectedSeason?.season_number ?? seasonDetail.season_number}
                      showId={show.tmdb_id}
                      palette={palette}
                    />
                  ))
                )}
              </div>
            ) : (
              <p className="text-gray-400">Select a season to view episodes.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
