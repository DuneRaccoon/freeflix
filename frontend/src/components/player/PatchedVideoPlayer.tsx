import React, { useState, useEffect, useCallback, useRef } from 'react';
import VideoPlayer from '@/components/player/VideoPlayer';
import { streamingService } from '@/services/streaming';
import { useUser } from '@/context/UserContext';
import { StreamingProgress } from '@/types';
import Button from '@/components/ui/Button';
import { PlayIcon, ForwardIcon } from '@heroicons/react/24/solid';
import { toast } from 'react-hot-toast';

interface PatchedVideoPlayerProps {
  src: string;
  torrentId: string;
  movieId: string;
  movieTitle?: string;
  subtitle?: string;
  poster?: string;
  onError?: (error: string) => void;
}

const PatchedVideoPlayer: React.FC<PatchedVideoPlayerProps> = ({
  src,
  torrentId,
  movieId,
  movieTitle,
  subtitle,
  poster,
  onError
}) => {
  const { currentUser } = useUser();
  const [savedProgress, setSavedProgress] = useState<StreamingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [resumeTime, setResumeTime] = useState(0);
  const [progressId, setProgressId] = useState<string | null>(null);
  
  // Reference to the original VideoPlayer component
  const playerRef = useRef<{
    seekTo: (time: number) => void;
  } | null>(null);
  
  // Interval for saving progress periodically
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  
  // Fetch saved progress on mount
  useEffect(() => {
    const fetchProgress = async () => {
      if (!currentUser) {
        setIsLoading(false);
        return;
      }

      try {
        // Try to get progress by torrent first
        let progress = await streamingService.getProgressByTorrent(
          currentUser.id,
          torrentId
        );
        
        // If no progress found by torrent, try by movie
        if (!progress) {
          progress = await streamingService.getProgressByMovie(
            currentUser.id,
            movieId
          );
        }
        
        if (progress && progress.current_time > 30 && progress.percentage < 98) {
          setSavedProgress(progress);
          setProgressId(progress.id);
          setResumeTime(progress.current_time);
          setShowResumePrompt(true);
        }
      } catch (error) {
        console.error('Failed to fetch streaming progress:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProgress();
  }, [currentUser, torrentId, movieId]);
  
  // Setup and cleanup progress saving interval
  useEffect(() => {
    if (!currentUser) return;
    
    // Save progress every 30 seconds
    saveIntervalRef.current = setInterval(() => {
      saveCurrentProgress();
    }, 30000);
    
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
      // Save progress on unmount
      saveCurrentProgress();
    };
  }, [currentUser, torrentId, movieId, progressId]);
  
  // Handler for progress updates from the VideoPlayer
  const handleProgress = useCallback((playerState: any) => {
    currentTimeRef.current = playerState.currentTime;
    durationRef.current = playerState.duration;
  }, []);
  
  // Handler for when the video ends
  const handleEnded = useCallback(() => {
    if (!currentUser) return;
    
    // Mark as completed
    const saveCompletedProgress = async () => {
      try {
        const progressData = {
          torrent_id: torrentId,
          movie_id: movieId,
          current_time: durationRef.current,
          duration: durationRef.current,
          percentage: 100,
          completed: true
        };
        
        if (progressId) {
          await streamingService.updateProgress(
            currentUser.id,
            progressId,
            {
              current_time: durationRef.current,
              duration: durationRef.current,
              percentage: 100,
              completed: true
            }
          );
        } else {
          const newProgress = await streamingService.saveProgress(
            currentUser.id,
            progressData
          );
          setProgressId(newProgress.id);
        }
      } catch (error) {
        console.error('Failed to save completed progress:', error);
      }
    };
    
    saveCompletedProgress();
  }, [currentUser, torrentId, movieId, progressId]);
  
  // Save current progress
  const saveCurrentProgress = async () => {
    if (!currentUser || currentTimeRef.current < 5) return;
    
    const currentTime = currentTimeRef.current;
    const duration = durationRef.current || 0;
    const percentage = duration > 0 ? (currentTime / duration) * 100 : 0;
    
    // Don't save if we're at the very beginning
    if (currentTime < 5) return;
    
    // Don't mark as completed unless we're very close to the end
    const completed = percentage > 98;
    
    try {
      const progressData = {
        torrent_id: torrentId,
        movie_id: movieId,
        current_time: currentTime,
        duration: duration > 0 ? duration : null,
        percentage,
        completed
      };
      
      if (progressId) {
        await streamingService.updateProgress(
          currentUser.id,
          progressId,
          {
            current_time: currentTime,
            duration: duration > 0 ? duration : null,
            percentage,
            completed
          }
        );
      } else {
        const newProgress = await streamingService.saveProgress(
          currentUser.id,
          progressData
        );
        setProgressId(newProgress.id);
      }
    } catch (error) {
      console.error('Failed to save progress:', error);
    }
  };
  
  // Handle resume playback
  const handleResume = () => {
    if (playerRef.current && resumeTime > 0) {
      playerRef.current.seekTo(resumeTime);
      setShowResumePrompt(false);
      toast.success('Resuming from where you left off');
    }
  };
  
  // Handle start from beginning
  const handleStartFromBeginning = () => {
    setShowResumePrompt(false);
    // Player will start from the beginning by default
    toast.success('Starting from the beginning');
  };
  
  // Register seek method from VideoPlayer
  const registerPlayerMethods = (methods: { seekTo: (time: number) => void }) => {
    playerRef.current = methods;
  };
  
  // Auto-resume after a timeout if user doesn't choose
  useEffect(() => {
    if (showResumePrompt) {
      const timeout = setTimeout(() => {
        handleResume();
      }, 10000); // Auto-resume after 10 seconds
      
      return () => clearTimeout(timeout);
    }
  }, [showResumePrompt, resumeTime]);
  
  if (isLoading) {
    return (
      <div className="w-full h-full bg-black flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }
  
  return (
    <div className="relative w-full h-full">
      <VideoPlayer
        src={src}
        poster={poster}
        movieTitle={movieTitle}
        subtitle={subtitle}
        autoPlay={!showResumePrompt}
        onProgress={handleProgress}
        onEnded={handleEnded}
        onError={onError}
        registerMethods={registerPlayerMethods}
      />
      
      {/* Resume playback prompt */}
      {showResumePrompt && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-80 z-50">
          <div className="bg-card rounded-lg shadow-xl p-6 m-4 max-w-sm mx-auto text-center">
            <h3 className="text-xl font-bold text-foreground mb-2">Resume Playback</h3>
            <p className="text-muted-foreground mb-6">
              Would you like to resume watching from where you left off? 
              ({Math.floor(resumeTime / 60)}m {Math.floor(resumeTime % 60)}s)
            </p>
            <div className="flex flex-col sm:flex-row justify-center space-y-3 sm:space-y-0 sm:space-x-3">
              <Button
                variant="outline"
                onClick={handleStartFromBeginning}
                leftIcon={<PlayIcon className="w-5 h-5" />}
              >
                Start from Beginning
              </Button>
              <Button
                variant="primary"
                onClick={handleResume}
                leftIcon={<ForwardIcon className="w-5 h-5" />}
              >
                Resume
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatchedVideoPlayer;