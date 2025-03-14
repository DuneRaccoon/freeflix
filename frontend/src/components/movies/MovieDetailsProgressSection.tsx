import React from 'react';
import { useRouter } from 'next/navigation';
import { useProgress } from '@/context/ProgressContext';
import { DetailedMovie } from '@/types';
import WatchProgressBar from '@/components/ui/WatchProgressBar';
import Button from '@/components/ui/Button';
import { PlayIcon, CheckCircleIcon } from '@heroicons/react/24/solid';
import { formatTime } from '@/utils/format';

interface MovieDetailsProgressSectionProps {
  movie: DetailedMovie;
}

const MovieDetailsProgressSection: React.FC<MovieDetailsProgressSectionProps> = ({ movie }) => {
  const router = useRouter();
  const { getMovieProgress } = useProgress();
  
  // Get progress data - try by ID first, then by title
  const progress = getMovieProgress(movie.id) || getMovieProgress(movie.title);
  
  // If no progress, don't render this section
  if (!progress || progress.percentage <= 0) return null;
  
  const isCompleted = progress.completed;
  const formattedTime = formatTime(progress.current_time);
  const formattedDuration = progress.duration ? formatTime(progress.duration) : null;
  const lastWatchedDate = new Date(progress.last_watched_at).toLocaleDateString();
  
  const handleContinueWatching = () => {
    if (progress.torrent_id) {
      router.push(`/streaming/${progress.torrent_id}`);
    }
  };
  
  return (
    <div className="mb-8 bg-card p-4 rounded-lg shadow-md">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-3">
        <div>
          <h3 className="text-lg font-semibold mb-1 flex items-center">
            {isCompleted ? (
              <>
                <CheckCircleIcon className="w-5 h-5 text-green-500 mr-2" />
                Watched
              </>
            ) : (
              <>
                <span className="text-primary-500 mr-2">●</span>
                Continue Watching
              </>
            )}
          </h3>
          
          <p className="text-sm text-gray-400">
            {isCompleted 
              ? `Watched on ${lastWatchedDate}` 
              : formattedDuration 
                ? `${formattedTime} of ${formattedDuration} (${Math.round(progress.percentage)}%)`
                : `${formattedTime} (${Math.round(progress.percentage)}%)`}
          </p>
        </div>
        
        {!isCompleted && (
          <Button 
            className="mt-2 md:mt-0"
            leftIcon={<PlayIcon className="w-4 h-4" />}
            onClick={handleContinueWatching}
          >
            Continue Watching
          </Button>
        )}
      </div>
      
      <WatchProgressBar 
        progress={progress.percentage} 
        height="h-2"
        showTooltip={false}
      />
    </div>
  );
};

export default MovieDetailsProgressSection;