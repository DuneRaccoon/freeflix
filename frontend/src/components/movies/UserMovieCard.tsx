import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Movie, TorrentStatus, TorrentState } from '@/types';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { PlayIcon, PauseIcon, StarIcon } from '@heroicons/react/24/solid';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { torrentsService } from '@/services/torrents';
import { toast } from 'react-hot-toast';

interface UserMovieCardProps {
  torrent: TorrentStatus;
  movie?: Movie;
}

const UserMovieCard: React.FC<UserMovieCardProps> = ({ torrent, movie }) => {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);
  
  // Determine card state based on torrent state
  const isDownloading = torrent.state === TorrentState.DOWNLOADING || 
                        torrent.state === TorrentState.DOWNLOADING_METADATA;
  const isComplete = torrent.state === TorrentState.FINISHED || 
                     torrent.state === TorrentState.SEEDING;
  const isPaused = torrent.state === TorrentState.PAUSED;
  const hasError = torrent.state === TorrentState.ERROR;
  
  // Determine progress bar color
  const getProgressColor = () => {
    if (hasError) return 'bg-red-600';
    if (isComplete) return 'bg-green-600';
    if (isPaused) return 'bg-yellow-500';
    return 'bg-primary-600';
  };
  
  // Handle stream/watch button click
  const handleWatch = () => {
    setIsLoading(true);
    
    // Navigate to streaming page
    router.push(`/streaming/${torrent.id}`);
  };
  
  // Handle pause/resume button click
  const handlePauseResume = async () => {
    try {
      setIsLoading(true);
      
      if (isPaused) {
        await torrentsService.performTorrentAction(torrent.id, 'resume');
        toast.success('Download resumed');
      } else {
        await torrentsService.performTorrentAction(torrent.id, 'pause');
        toast.success('Download paused');
      }
    } catch (error) {
      console.error('Error toggling download state:', error);
      toast.error('Failed to change download state');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Default fallback image for when movie details aren't available
  const defaultImage = '/images/movie-placeholder.jpg';
  
  return (
    <Card className="h-full overflow-hidden transition-all duration-300 hover:shadow-lg relative group">
      {/* Progress bar overlay */}
      {!isComplete && (
        <div className="absolute top-0 left-0 right-0 z-10">
          <div className="bg-gray-900/70 h-8 flex items-center justify-between px-2">
            <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden mr-2">
              <div 
                className={`h-full ${getProgressColor()} transition-all duration-300`}
                style={{ width: `${torrent.progress}%` }}
              ></div>
            </div>
            <span className="text-white text-xs font-medium whitespace-nowrap">
              {Math.round(torrent.progress)}%
            </span>
          </div>
        </div>
      )}
      
      {/* Error indicator */}
      {hasError && (
        <div className="absolute top-2 right-2 z-10">
          <Badge variant="danger" size="sm">Error</Badge>
        </div>
      )}
      
      {/* Image container */}
      <div className="relative pb-[150%] overflow-hidden">
        <Image
          src={movie?.img || defaultImage}
          alt={torrent.movie_title}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />
        
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex flex-col justify-end">
          <h3 className="text-lg font-bold text-white line-clamp-2">{torrent.movie_title}</h3>
          <div className="flex items-center mt-1 text-sm text-gray-300">
            <Badge variant="secondary" size="sm" className="mr-2">
              {torrent.quality}
            </Badge>
            
            {movie && (
              <div className="flex items-center">
                <StarIcon className="w-4 h-4 text-yellow-500 mr-1" />
                <span>{movie.rating}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Control buttons */}
      <div className="p-3 bg-gray-800 flex justify-between items-center">
        <Button
          variant={isPaused ? "primary" : "danger"}
          size="sm"
          leftIcon={isPaused ? <PlayIcon className="w-4 h-4" /> : <PauseIcon className="w-4 h-4" />}
          onClick={handlePauseResume}
          isLoading={isLoading}
          disabled={isComplete || hasError}
          className={isComplete || hasError ? "opacity-50 cursor-not-allowed" : ""}
        >
          {isPaused ? "Resume" : "Pause"}
        </Button>
        
        <Button
          variant="primary"
          size="sm"
          leftIcon={<PlayIcon className="w-4 h-4" />}
          onClick={handleWatch}
          isLoading={isLoading}
          disabled={hasError}
          className={hasError ? "opacity-50 cursor-not-allowed" : ""}
        >
          {isComplete ? "Watch" : "Stream"}
        </Button>
      </div>
      
      {/* Error message tooltip */}
      {hasError && torrent.error_message && (
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-red-900/90 text-white text-xs">
          <div className="flex items-start">
            <ExclamationTriangleIcon className="w-4 h-4 mr-1 flex-shrink-0 mt-0.5" />
            <span className="line-clamp-2">{torrent.error_message}</span>
          </div>
        </div>
      )}
    </Card>
  );
};

export default UserMovieCard;