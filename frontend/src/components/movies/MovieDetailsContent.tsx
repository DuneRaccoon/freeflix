// src/components/movies/MovieDetailsContent.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { fadeIn, slideUp, staggerContainer } from '@/components/ui/Motion';
import { useRouter } from 'next/navigation';
import { MovieDetail } from '@/types';
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
  ArrowTopRightOnSquareIcon,
  LinkIcon,
} from '@heroicons/react/24/solid';
import {
  UserGroupIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';

interface MovieDetailsContentProps {
  movie: MovieDetail;
}

export default function MovieDetailsContent({ movie }: MovieDetailsContentProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'overview' | 'cast'>('overview');
  const [downloadQuality, setDownloadQuality] = useState<string | null>(null);
  const [paletteApplied, setPaletteApplied] = useState(false);
  const [palette, setPalette] = useState<{ primary: string; secondary: string; background: string; muted: string; accent: string } | null>(null);
  const [streamingQuality, setStreamingQuality] = useState<string | null>(null);

  // Extract and apply dynamic palette from backdrop/poster (scoped to container)
  useEffect(() => {
    if (!movie || paletteApplied) return;
    const img = movie.backdrop_url || movie.poster_url;
    if (!img) return;
    extractPaletteFromImage(img).then((pal) => {
      if (pal) {
        const el = document.getElementById('movie-details-root');
        if (el) {
          el.style.setProperty('--color-primary', pal.primary);
          el.style.setProperty('--color-secondary', pal.secondary);
          el.style.setProperty('--color-background', pal.background);
          el.style.setProperty('--color-muted', pal.muted);
          const card = pal.background;
          const border = pal.muted;
          el.style.setProperty('--color-card', card);
          el.style.setProperty('--color-border', border);
        }
        setPalette(pal);
        setPaletteApplied(true);
      }
    });
  }, [movie, paletteApplied]);

  // Handle download button click
  const handleDownload = async (quality: string) => {
    try {
      setDownloadQuality(quality);

      await torrentsService.downloadCatalogMovie({
        tmdb_id: movie.tmdb_id,
        quality: quality as '720p' | '1080p' | '2160p',
      });

      toast.success(`Added ${movie.title} (${quality}) to download queue`);
    } catch (error) {
      console.error('Error downloading movie:', error);
      toast.error('Failed to add movie to download queue');
    } finally {
      setTimeout(() => {
        setDownloadQuality(null);
      }, 2000);
    }
  };

  // Handle stream button click
  const handleStream = async (quality: string) => {
    try {
      setStreamingQuality(quality);

      const torrentStatus = await handleCatalogStreamingStart({
        tmdb_id: movie.tmdb_id,
        quality: quality as '720p' | '1080p' | '2160p'
      });

      if (torrentStatus?.id) {
        router.push(`/streaming/${torrentStatus.id}`);
      }
    } catch (error) {
      console.error('Error starting stream:', error);
      toast.error('Failed to start streaming. Please try again.');
    } finally {
      setStreamingQuality(null);
    }
  };

  // Determine backdrop image
  const backdropImage = movie.backdrop_url || movie.poster_url;

  // Format runtime
  const runtimeDisplay = movie.runtime ? `${movie.runtime}m` : null;

  return (
    <div className="w-screen pb-16 bg-background text-foreground" id="movie-details-root">
      {/* Movie Hero Section - Header with backdrop */}
      <div
        className="relative h-[70vh] md:h-[85vh] w-screen bg-cover bg-center overflow-hidden mb-0"
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.65)), url(${backdropImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center top'
        }}
      >
        {/* Dynamic overlay tint from palette */}
        <div
          className="absolute inset-0"
          style={{ background: palette ? `radial-gradient(1000px 400px at 10% 10%, ${palette.primary}22, transparent 60%), radial-gradient(1000px 400px at 90% 20%, ${palette.secondary}22, transparent 60%)` : undefined }}
        />
        {/* Top gradient for nav readability */}
        <div className="absolute inset-x-0 top-0 h-24" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)' }} />
        <motion.div className="absolute bottom-0 left-0 right-0 p-6"
          variants={staggerContainer(0.06, 0.1)} initial="hidden" animate="visible">
          <div className="absolute inset-x-0 bottom-0 h-40" style={{ background: palette ? `linear-gradient(to top, ${palette.background}F2, transparent)` : undefined }} />
          <div className="max-w-7xl mx-auto px-6 flex items-end gap-6">
            {/* Poster thumbnail */}
            <motion.div className="hidden sm:block w-32 h-48 md:w-48 md:h-72 rounded-md overflow-hidden shadow-lg flex-shrink-0 border border-gray-700 transform -translate-y-6" variants={slideUp}>
              {movie.poster_url && (
                <img src={movie.poster_url} alt={movie.title} className="w-full h-full object-cover" />
              )}
            </motion.div>

            {/* Title and metadata */}
            <div className="flex-1">
              <motion.h1 className="text-3xl md:text-5xl font-bold text-white drop-shadow-lg mb-3" variants={slideUp}>
                {movie.title} <span className="text-gray-300">({movie.year ?? 'N/A'})</span>
              </motion.h1>
              <motion.div className="flex flex-wrap gap-2 mb-4" variants={fadeIn}>
                {movie.genres.map((genre) => (
                  <span
                    key={genre}
                    className="border rounded px-2 py-0.5 text-xs"
                    style={{ borderColor: palette?.secondary, backgroundColor: palette ? `${palette.secondary}22` : undefined }}
                  >
                    {genre}
                  </span>
                ))}
                {runtimeDisplay && (
                  <Badge variant="default" size="md" className="flex items-center">
                    <ClockIcon className="w-3 h-3 mr-1" />
                    {runtimeDisplay}
                  </Badge>
                )}
              </motion.div>

              {/* Vote average */}
              <motion.div className="flex flex-wrap gap-4" variants={fadeIn}>
                <div className="flex items-center gap-1">
                  <StarIcon className="h-5 w-5 text-yellow-500" />
                  <span className="text-white font-semibold">{movie.vote_average.toFixed(1)}</span>
                  <span className="text-gray-400 text-sm">/ 10</span>
                  {movie.vote_count > 0 && (
                    <span className="text-gray-400 text-xs">({movie.vote_count.toLocaleString()} votes)</span>
                  )}
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-gray-800 mb-6">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-3 px-4 font-medium text-sm border-b-2 whitespace-nowrap ${
                activeTab === 'overview'
                  ? 'border-primary-500 text-primary-500'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
              style={activeTab === 'overview' ? { borderColor: palette?.primary, color: palette?.primary } : undefined}
            >
              <InformationCircleIcon className="w-4 h-4 inline mr-1" />
              Overview
            </button>
            <button
              onClick={() => setActiveTab('cast')}
              className={`py-3 px-4 font-medium text-sm border-b-2 whitespace-nowrap ${
                activeTab === 'cast'
                  ? 'border-primary-500 text-primary-500'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
              style={activeTab === 'cast' ? { borderColor: palette?.primary, color: palette?.primary } : undefined}
            >
              <UserGroupIcon className="w-4 h-4 inline mr-1" />
              Cast & Crew
            </button>
          </nav>
        </div>
      </div>

      {/* Main Content with Sidebar */}
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar */}
          <div className="w-full md:w-1/3 lg:w-1/4 space-y-6">
            {/* Download buttons */}
            <Card>
              <CardHeader>
                <CardTitle>Watch Options</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {movie.available_qualities.length > 0 ? (
                  movie.available_qualities.map((quality) => (
                    <div key={quality} className="flex gap-2">
                      <Button
                        variant={quality === '1080p' ? 'primary' : quality === '2160p' ? 'secondary' : 'outline'}
                        size="sm"
                        className="flex-1"
                        leftIcon={<ArrowDownTrayIcon className="w-4 h-4" />}
                        onClick={() => handleDownload(quality)}
                        isLoading={downloadQuality === quality}
                      >
                        Download {quality}
                      </Button>
                      <Button
                        variant={quality === '1080p' ? 'primary' : quality === '2160p' ? 'secondary' : 'outline'}
                        size="sm"
                        className="flex-1"
                        leftIcon={<PlayIcon className="w-4 h-4" />}
                        onClick={() => handleStream(quality)}
                        isLoading={streamingQuality === quality}
                      >
                        Stream {quality}
                      </Button>
                    </div>
                  ))
                ) : (
                  /* No specific qualities — show generic buttons */
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      leftIcon={<ArrowDownTrayIcon className="w-4 h-4" />}
                      onClick={() => handleDownload('1080p')}
                      isLoading={downloadQuality === '1080p'}
                    >
                      Download
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      leftIcon={<PlayIcon className="w-4 h-4" />}
                      onClick={() => handleStream('1080p')}
                      isLoading={streamingQuality === '1080p'}
                    >
                      Stream
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Info Card */}
            <Card>
              <CardHeader>
                <CardTitle>Movie Info</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm">
                  {runtimeDisplay && (
                    <div className="flex items-start">
                      <ClockIcon className="w-4 h-4 mt-0.5 mr-2 text-gray-400" />
                      <div>
                        <span className="text-gray-400">Runtime:</span>
                        <span className="block text-white">{runtimeDisplay}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start">
                    <CalendarIcon className="w-4 h-4 mt-0.5 mr-2 text-gray-400" />
                    <div>
                      <span className="text-gray-400">Year:</span>
                      <span className="block text-white">{movie.year ?? 'N/A'}</span>
                    </div>
                  </div>

                  {movie.imdb_id && (
                    <div className="flex items-start">
                      <LinkIcon className="w-4 h-4 mt-0.5 mr-2 text-gray-400" />
                      <div>
                        <span className="text-gray-400">External Links:</span>
                        <a
                          href={`https://www.imdb.com/title/${movie.imdb_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-400 hover:text-primary-300 flex items-center"
                        >
                          IMDB
                          <ArrowTopRightOnSquareIcon className="h-3 w-3 ml-1" />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content Area */}
          <div className="w-full md:w-2/3 lg:w-3/4">
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div>
                <h2 className="text-2xl font-semibold mb-4">Synopsis</h2>
                <p className="text-gray-300 mb-6 text-lg leading-relaxed">
                  {movie.overview || 'No synopsis available.'}
                </p>

                {/* Director */}
                {movie.director && (
                  <div className="mb-6">
                    <h3 className="text-xl font-medium mb-3">Director</h3>
                    <div className="bg-gray-800/50 p-4 rounded-lg">
                      <p className="font-semibold">{movie.director}</p>
                    </div>
                  </div>
                )}

                {/* Tagline */}
                {movie.tagline && (
                  <div className="mb-6">
                    <blockquote className="italic text-gray-400 border-l-4 border-primary-500 pl-4">
                      &ldquo;{movie.tagline}&rdquo;
                    </blockquote>
                  </div>
                )}
              </div>
            )}

            {/* Cast Tab */}
            {activeTab === 'cast' && (
              <div>
                <h2 className="text-2xl font-semibold mb-6">Cast & Crew</h2>

                {movie.director && (
                  <div className="mb-8">
                    <h3 className="text-xl font-medium mb-4">Director</h3>
                    <div className="flex items-center bg-gray-800/50 p-4 rounded-lg">
                      <div className="bg-gray-700 rounded-full h-16 w-16 flex items-center justify-center mr-4">
                        <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-lg">{movie.director}</p>
                        <p className="text-sm text-gray-400">Director</p>
                      </div>
                    </div>
                  </div>
                )}

                {movie.cast && movie.cast.length > 0 ? (
                  <div>
                    <h3 className="text-xl font-medium mb-4">Cast</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {movie.cast.map((person, index) => (
                        <div
                          key={`${person.name}-${index}`}
                          className="flex items-center bg-gray-800/50 p-4 rounded-lg"
                        >
                          {person.image ? (
                            <img
                              src={person.image}
                              alt={person.name}
                              className="h-16 w-16 object-cover rounded-full mr-4"
                            />
                          ) : (
                            <div className="bg-gray-700 rounded-full h-16 w-16 flex items-center justify-center mr-4">
                              <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                            </div>
                          )}
                          <div>
                            <p className="font-semibold">{person.name}</p>
                            {person.character && (
                              <p className="text-sm text-gray-400">{person.character}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-400">No cast information available.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
