import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { fadeIn, slideUp, staggerContainer } from '@/components/ui/Motion';
import { useRouter } from 'next/navigation';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import {
  XMarkIcon,
  StarIcon,
  ClockIcon,
  CalendarIcon,
  ArrowTopRightOnSquareIcon,
  ArrowDownTrayIcon,
  PlayIcon,
  LinkIcon,
} from '@heroicons/react/24/solid';
import {
  QuestionMarkCircleIcon,
  UserGroupIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import { moviesService } from '@/services/movies';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { torrentsService } from '@/services/torrents';
import { toast } from 'react-hot-toast';
import { MovieDetail } from '@/types';
import { handleCatalogStreamingStart } from '@/utils/streaming';

interface MovieDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  movieId: string | null; // tmdb_id as string
  onDownload?: (movieId: string, quality: string) => void;
}

const MovieDetailsModal: React.FC<MovieDetailsModalProps> = ({
  isOpen,
  onClose,
  movieId,
  onDownload
}) => {
  const router = useRouter();
  const [streamingQuality, setStreamingQuality] = useState<string | null>(null);
  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'cast'>('overview');
  const [downloadQuality, setDownloadQuality] = useState<string | null>(null);

  // Fetch movie details when modal opens
  useEffect(() => {
    const fetchMovieDetails = async () => {
      if (!movieId || !isOpen) return;

      try {
        setIsLoading(true);
        setError(null);

        const data = await moviesService.getDetail(Number(movieId));
        setMovie(data);
      } catch (err) {
        console.error('Error fetching movie details:', err);
        setError('Failed to load movie details. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchMovieDetails();
  }, [movieId, isOpen]);

  // Handle download button click
  const handleDownload = async (quality: string) => {
    if (!movie) return;

    try {
      setDownloadQuality(quality);

      await torrentsService.downloadCatalogMovie({
        tmdb_id: movie.tmdb_id,
        quality: quality as '720p' | '1080p' | '2160p',
      });

      toast.success(`Added ${movie.title} (${quality}) to download queue`);

      if (onDownload) {
        onDownload(movie.tmdb_id.toString(), quality);
      }
    } catch (error) {
      console.error('Error downloading movie:', error);
      toast.error('Failed to add movie to download queue');
    } finally {
      setTimeout(() => {
        setDownloadQuality(null);
      }, 2000);
    }
  };

  const handleStream = async (quality: string) => {
    if (!movie) return;

    try {
      setStreamingQuality(quality);

      const torrentStatus = await handleCatalogStreamingStart({
        tmdb_id: movie.tmdb_id,
        quality: quality as '720p' | '1080p' | '2160p'
      });

      if (torrentStatus?.id) {
        onClose();
        router.push(`/streaming/${torrentStatus.id}`);
      }
    } catch (error) {
      console.error('Error starting stream:', error);
      toast.error('Failed to start streaming. Please try again.');
    } finally {
      setStreamingQuality(null);
    }
  };

  // Format runtime
  const runtimeDisplay = movie?.runtime ? `${movie.runtime}m` : null;

  // Loading skeleton
  if (isLoading) {
    return (
      <Dialog
        open={isOpen}
        onClose={onClose}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/70" aria-hidden="true" />

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="mx-auto rounded-lg bg-gray-900 shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="animate-pulse">
              <div className="h-64 bg-gray-800 w-full"></div>
              <div className="p-6">
                <div className="h-8 bg-gray-800 w-3/4 mb-4"></div>
                <div className="h-4 bg-gray-800 w-1/2 mb-8"></div>
                <div className="h-4 bg-gray-800 w-full mb-2"></div>
                <div className="h-4 bg-gray-800 w-full mb-2"></div>
                <div className="h-4 bg-gray-800 w-3/4 mb-6"></div>

                <div className="flex space-x-2 mb-6">
                  <div className="h-10 bg-gray-800 w-24 rounded-md"></div>
                  <div className="h-10 bg-gray-800 w-24 rounded-md"></div>
                  <div className="h-10 bg-gray-800 w-24 rounded-md"></div>
                </div>
              </div>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    );
  }

  // Error state
  if (error) {
    return (
      <Dialog
        open={isOpen}
        onClose={onClose}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/70" aria-hidden="true" />

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="mx-auto rounded-lg bg-gray-900 shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="text-center">
                <QuestionMarkCircleIcon className="h-16 w-16 text-red-500 mx-auto mb-4" />
                <DialogTitle as="h3" className="text-xl font-semibold mb-2">
                  Error Loading Movie
                </DialogTitle>
                <p className="text-gray-400 mb-6">{error}</p>
                <Button onClick={onClose}>Close</Button>
              </div>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    );
  }

  // No movie data yet
  if (!movie) return null;

  // Determine backdrop image
  const backdropImage = movie.backdrop_url || movie.poster_url;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      className="relative z-50"
    >
      {/* Backdrop overlay */}
      <div className="fixed inset-0 bg-black/80" aria-hidden="true" />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto rounded-lg bg-gray-900 shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden glass-card">
          {/* Header with backdrop */}
          <div
            className="relative h-72 w-full bg-cover bg-center"
            style={{
              backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.2), rgba(23, 23, 23, 0.8)), url(${backdropImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center top'
            }}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-full bg-black/50 hover:bg-black/80 text-white transition-colors z-10"
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>

            {/* Movie title and metadata */}
            <motion.div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-gray-900 to-transparent"
              variants={staggerContainer(0.06, 0.1)} initial="hidden" animate="visible">
              <div className="flex items-end gap-6">
                {/* Poster thumbnail */}
                {movie.poster_url && (
                  <motion.div className="hidden sm:block w-32 h-48 rounded-md overflow-hidden shadow-lg flex-shrink-0 border border-gray-700 transform -translate-y-6" variants={slideUp}>
                    <img src={movie.poster_url} alt={movie.title} className="w-full h-full object-cover" />
                  </motion.div>
                )}

                {/* Title and metadata */}
                <div className="flex-1">
                  <motion.h2 className="text-2xl md:text-3xl font-bold text-white drop-shadow-lg mb-2" variants={slideUp}>
                    {movie.title} <span className="text-gray-300">({movie.year ?? 'N/A'})</span>
                  </motion.h2>
                  <motion.div className="flex flex-wrap gap-2 mb-3" variants={fadeIn}>
                    {movie.genres.map((genre) => (
                      <Badge key={genre} variant="secondary" size="md">
                        {genre}
                      </Badge>
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
                      <StarIcon className="h-4 w-4 text-yellow-500" />
                      <span className="text-white">{movie.vote_average.toFixed(1)}</span>
                      <span className="text-gray-400 text-sm">/ 10</span>
                    </div>
                  </motion.div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-800">
            <nav className="flex overflow-x-auto scrollbar-hide">
              <button
                onClick={() => setActiveTab('overview')}
                className={`py-3 px-4 font-medium text-sm border-b-2 whitespace-nowrap ${
                  activeTab === 'overview'
                    ? 'border-primary-500 text-primary-500'
                    : 'border-transparent text-gray-400 hover:text-gray-300'
                }`}
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
              >
                <UserGroupIcon className="w-4 h-4 inline mr-1" />
                Cast & Crew
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 22rem)' }}>
            <div className="flex flex-col md:flex-row gap-6">
              {/* Sidebar (visible on all tabs) */}
              <div className="w-full md:w-1/3 flex-shrink-0">
                {/* Download buttons */}
                <div className="bg-gray-800/70 rounded-lg p-4 mb-6">
                  <h3 className="text-lg font-semibold mb-3">Watch Options</h3>
                  <div className="space-y-3">
                    {movie.available_qualities.length > 0 ? (
                      movie.available_qualities.map((quality: string) => (
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
                  </div>
                </div>

                {/* Info Card */}
                <div className="bg-gray-800/70 rounded-lg p-4 mb-6">
                  <h3 className="text-lg font-semibold mb-3">Movie Info</h3>
                  <div className="space-y-2 text-sm">
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
                </div>
              </div>

              {/* Main content area */}
              <div className="w-full md:w-2/3">
                {/* Overview tab */}
                {activeTab === 'overview' && (
                  <div>
                    <h3 className="text-xl font-semibold mb-3">Synopsis</h3>
                    <p className="text-gray-300 mb-4">
                      {movie.overview || 'No synopsis available.'}
                    </p>

                    {movie.director && (
                      <div className="mb-4">
                        <h4 className="text-lg font-medium mb-2">Director</h4>
                        <div className="bg-gray-800/50 p-3 rounded-lg">
                          <p className="font-semibold">{movie.director}</p>
                        </div>
                      </div>
                    )}

                    {movie.tagline && (
                      <div className="mb-4">
                        <blockquote className="italic text-gray-400 border-l-4 border-primary-500 pl-3">
                          &ldquo;{movie.tagline}&rdquo;
                        </blockquote>
                      </div>
                    )}
                  </div>
                )}

                {/* Cast tab */}
                {activeTab === 'cast' && (
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Cast & Crew</h3>

                    {movie.director && (
                      <div className="mb-6">
                        <h4 className="text-lg font-medium mb-2">Director</h4>
                        <div className="flex items-center bg-gray-800/50 p-3 rounded-lg">
                          <div className="bg-gray-700 rounded-full h-12 w-12 flex items-center justify-center mr-3">
                            <svg className="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </div>
                          <div>
                            <p className="font-semibold">{movie.director}</p>
                            <p className="text-sm text-gray-400">Director</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {movie.cast && movie.cast.length > 0 ? (
                      <div>
                        <h4 className="text-lg font-medium mb-2">Cast</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {movie.cast.map((person, index) => (
                            <div
                              key={`${person.name}-${index}`}
                              className="flex items-center bg-gray-800/50 p-3 rounded-lg"
                            >
                              {person.image ? (
                                <img
                                  src={person.image}
                                  alt={person.name}
                                  className="h-16 w-16 object-cover rounded-full mr-3"
                                />
                              ) : (
                                <div className="bg-gray-700 rounded-full h-16 w-16 flex items-center justify-center mr-3">
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
        </DialogPanel>
      </div>
    </Dialog>
  );
};

export default MovieDetailsModal;
