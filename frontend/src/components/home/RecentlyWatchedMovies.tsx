import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { streamingService } from '@/services/streaming';
import { useUser } from '@/context/UserContext';
import { StreamingProgress } from '@/types';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import { PlayIcon, ClockIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { formatTime } from '@/utils/format';

const RecentlyWatchedMovies: React.FC = () => {
  const { currentUser } = useUser();
  const [recentlyWatched, setRecentlyWatched] = useState<StreamingProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRecentlyWatched = async () => {
      if (!currentUser) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const progress = await streamingService.getRecentProgress(currentUser.id, 5);
        setRecentlyWatched(progress);
      } catch (error) {
        console.error('Failed to fetch recently watched movies:', error);
        setError('Failed to load your recently watched movies');
      } finally {
        setIsLoading(false);
      }
    };

    fetchRecentlyWatched();
  }, [currentUser]);

  const handleRemoveProgress = async (progressId: string) => {
    if (!currentUser) return;

    try {
      await streamingService.deleteProgress(currentUser.id, progressId);
      // Update the list by removing the deleted item
      setRecentlyWatched(prev => prev.filter(item => item.id !== progressId));
    } catch (error) {
      console.error('Failed to remove progress:', error);
    }
  };

  // If no user or still loading, don't show anything
  if (!currentUser || (isLoading && recentlyWatched.length === 0)) {
    return null;
  }

  // If there's no recently watched movies, don't show the section
  if (recentlyWatched.length === 0 && !isLoading) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Continue Watching</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse flex justify-between items-center p-3 rounded-lg bg-card/50">
                <div className="flex-1">
                  <div className="h-5 bg-muted rounded w-1/2 mb-2"></div>
                  <div className="h-4 bg-muted rounded w-1/4"></div>
                </div>
                <div className="h-8 w-20 bg-muted rounded"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {recentlyWatched.map(progress => (
              <div 
                key={progress.id} 
                className="flex justify-between items-center p-3 rounded-lg hover:bg-muted/20 transition-colors group relative"
              >
                <div className="flex-1">
                  <h3 className="font-medium text-foreground">{progress.movie_id}</h3>
                  <div className="flex items-center text-sm text-muted-foreground space-x-2">
                    <ClockIcon className="w-4 h-4" />
                    <span>
                      {progress.completed 
                        ? 'Completed' 
                        : `${formatTime(progress.current_time)} / ${formatTime(progress.duration || 0)} (${Math.round(progress.percentage)}%)`}
                    </span>
                  </div>
                  <div className="w-full h-1 bg-muted mt-2 rounded overflow-hidden">
                    <div 
                      className="h-full bg-primary" 
                      style={{ width: `${progress.percentage}%` }}
                    ></div>
                  </div>
                </div>
                <Link href={`/streaming/${progress.torrent_id}`}>
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<PlayIcon className="w-4 h-4" />}
                  >
                    {progress.completed ? 'Watch Again' : 'Continue'}
                  </Button>
                </Link>

                {/* Remove button that appears on hover */}
                <button
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemoveProgress(progress.id)}
                  aria-label="Remove from continue watching"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default RecentlyWatchedMovies;