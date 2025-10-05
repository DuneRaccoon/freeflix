import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Movie } from '@/types';
import { Card, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import WatchProgressBar from '@/components/ui/WatchProgressBar';
import { useProgress } from '@/context/ProgressContext';
import { StarIcon, EyeIcon, ArrowDownTrayIcon, PlayIcon } from '@heroicons/react/24/solid';
import { ClockIcon } from '@heroicons/react/24/outline';
import { torrentsService } from '@/services/torrents';
import { toast } from 'react-hot-toast';
import MovieDetailsModal from './MovieDetailsModal';
import { handleStreamingStart } from '@/utils/streaming';
import { motion, AnimatePresence } from 'framer-motion';
import { hoverLiftVariants, slideUp, fadeIn, revealOnHover, expandIn } from '@/components/ui/Motion';

interface MovieCardProps {
  movie: Movie;
  onDownload?: (movieId: string, quality: string) => void;
}

const MovieCard: React.FC<MovieCardProps> = ({ movie, onDownload }) => {
  const router = useRouter();
  const { getProgressForMovie } = useProgress();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const movieProgress = getProgressForMovie(movie);
  const hasProgress = !!movieProgress && movieProgress.percentage > 0;
  const isCompleted = movieProgress?.completed || false;

  // Handle download button click
  const handleDownload = async (quality: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation when clicking download
    try {
      setLoading(`download-${quality}`);
      
      // Call the API to download the movie
      await torrentsService.downloadMovie({
        movie_id: movie.link,
        quality: quality as '720p' | '1080p' | '2160p',
      });
      
      toast.success(`Added ${movie.title} (${quality}) to download queue`);
      
      // Call the onDownload callback if provided
      if (onDownload) {
        onDownload(movie.link, quality);
      }
    } catch (error) {
      console.error('Error downloading movie:', error);
      toast.error('Failed to add movie to download queue');
    } finally {
      setTimeout(() => {
        setLoading(null);
      }, 2000);
    }
  };

  // Handle stream button click
  const handleStream = async (quality: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation when clicking stream
    try {
      setLoading(`stream-${quality}`);
      // Start the download and navigate to streaming page
      const torrentStatus = await handleStreamingStart({
        movie_id: movie.link,
        quality: quality as '720p' | '1080p' | '2160p'
      });
      
      if (torrentStatus?.id) {
        router.push(`/streaming/${torrentStatus.id}`);
      }
    } catch (error) {
      console.error('Error starting stream:', error);
      toast.error('Failed to start streaming. Please try again.');
    } finally {
      setLoading(null);
    }
  };

  // Get available qualities
  const availableQualities = movie.torrents.map(t => t.quality);
  
  // Encode movie ID for URL
  const movieId = encodeURIComponent(movie.link);
  
  const handleQuickViewClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowDetailsModal(true);
  };

  const handleContinueWatching = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (movieProgress?.torrent_id) {
      router.push(`/streaming/${movieProgress.torrent_id}`);
    }
  };

  return (
    <>
      <Link href={`/movies/${movieId}`} prefetch={false}>
        <motion.div
          variants={hoverLiftVariants}
          initial="initial"
          whileHover="hover"
          className="h-full cursor-pointer group"
        >
        <Card className="h-full flex flex-col glass-card transition-all duration-300 hover:shadow-xl theater-shadow">
          <div className="relative pb-[150%] overflow-hidden">
            {/* Quick view button overlay */}
            <motion.div 
              className="absolute top-2 right-2 z-20"
              onClick={handleQuickViewClick}
              variants={revealOnHover}
              initial="hidden"
              whileHover="hover"
              animate="hidden"
            >
              <div className="bg-black/70 hover:bg-primary-600 rounded-full p-2 transition-colors duration-300">
                <EyeIcon className="h-5 w-5 text-white" />
              </div>
            </motion.div>
            
            {/* Continue watching button for movies in progress */}
            {hasProgress && !isCompleted && (
              <motion.div 
                className="absolute top-2 left-2 z-20"
                onClick={handleContinueWatching}
                variants={revealOnHover}
                initial="hidden"
                whileHover="hover"
                animate="hidden"
              >
                <div className="bg-primary-600 hover:bg-primary-700 rounded-full p-2 shadow-lg">
                  <PlayIcon className="h-5 w-5 text-white" />
                </div>
              </motion.div>
            )}
            
            {/* Watched badge */}
            {isCompleted && (
              <div className="absolute top-2 left-2 z-20">
                <Badge variant="success" size="sm" className="px-2 py-1">
                  <ClockIcon className="h-3 w-3 mr-1" />
                  Watched
                </Badge>
              </div>
            )}
            
            <Image
              src={movie.img}
              alt={movie.title}
              fill
              className="object-cover rounded-t-lg transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              priority={false}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent p-4 flex flex-col justify-end pointer-events-none">
              <motion.h3 className="text-lg font-bold text-white line-clamp-2" variants={slideUp}>{movie.title}</motion.h3>
              <motion.div className="flex items-center mt-1 text-sm text-gray-300" variants={fadeIn}>
                <span className="mr-2">{movie.year}</span>
                <div className="flex items-center">
                  <StarIcon className="w-4 h-4 text-yellow-500 mr-1" />
                  <span>{movie.rating}</span>
                </div>
              </motion.div>
              
              {/* Progress bar if movie has been watched partially */}
              {hasProgress && (
                <motion.div className="mt-2" variants={fadeIn}>
                  <WatchProgressBar 
                    progress={movieProgress.percentage} 
                    height="h-1"
                    showTooltip={false}
                  />
                </motion.div>
              )}
            </div>
          </div>
          
          <CardContent className="flex-grow flex flex-col justify-between p-3">
            <div>
              <motion.div className="flex flex-wrap gap-1 mb-2" variants={fadeIn}>
                {movie.genre.split(', ').map((genre, index) => (
                  <motion.div key={index} variants={slideUp}>
                    <Badge variant="secondary" size="sm">
                      {genre}
                    </Badge>
                  </motion.div>
                ))}
              </motion.div>
              
              {expanded && (
                <motion.div className="text-sm text-gray-400 mb-4" variants={slideUp}>
                  <p className="text-xs mb-2">Available in: {availableQualities.join(', ')}</p>
                  <p className="text-xs">
                    Size: {movie.torrents.find(t => t.quality === '1080p')?.sizes[0] || 'N/A'}
                  </p>
                </motion.div>
              )}
            </div>
            
            <div className="mt-2">
              {expanded ? (
                <AnimatePresence mode="popLayout">
                  <motion.div className="grid gap-2" variants={expandIn} initial="hidden" animate="visible" exit="exit">
                    {availableQualities.map(quality => (
                      <div key={quality} className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant={quality === '1080p' ? 'primary' : quality === '2160p' ? 'secondary' : 'outline'}
                        className="flex-1"
                        leftIcon={<ArrowDownTrayIcon className="w-4 h-4" />}
                        isLoading={loading === `download-${quality}`}
                        disabled={!!loading}
                        onClick={(e) => handleDownload(quality, e)}
                      >
                        Download {quality}
                      </Button>
                      <Button 
                        size="sm" 
                        variant={quality === '1080p' ? 'primary' : quality === '2160p' ? 'secondary' : 'outline'}
                        className="flex-1"
                        leftIcon={<PlayIcon className="w-4 h-4" />}
                        isLoading={loading === `stream-${quality}`}
                        disabled={!!loading}
                        onClick={(e) => handleStream(quality, e)}
                      >
                        Watch {quality}
                      </Button>
                    </div>
                  ))}
                  </motion.div>
                </AnimatePresence>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="w-full"
                    leftIcon={<ArrowDownTrayIcon className="w-4 h-4" />}
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent navigation
                      setExpanded(true);
                    }}
                  >
                    Download
                  </Button>
                  <Button 
                    size="sm" 
                    variant="primary" 
                    className="w-full"
                    leftIcon={<PlayIcon className="w-4 h-4" />}
                    onClick={(e) => handleStream('1080p', e)}
                    isLoading={loading === 'stream-1080p'}
                    disabled={!!loading}
                  >
                    Watch
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        </motion.div>
      </Link>
      
      {/* Movie Details Modal */}
      <MovieDetailsModal
        isOpen={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        movieId={movie.link}
        onDownload={onDownload}
      />
    </>
  );
};

export default MovieCard;