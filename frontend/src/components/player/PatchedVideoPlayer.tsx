import React, { useState, useEffect, useCallback, useRef } from 'react';
import VideoPlayer from '@/components/player/VideoPlayer';
import { streamingService } from '@/services/streaming';
import { useUser } from '@/context/UserContext';
import { StreamingProgress, StreamingInfo } from '@/types';
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
  downloadProgress?: number; // Add download progress prop
  streamingInfo?: StreamingInfo; // Add streaming info prop
}

const PatchedVideoPlayer: React.FC<PatchedVideoPlayerProps> = ({
  src,
  torrentId,
  movieId,
  movieTitle,
  subtitle,
  poster,
  onError,
  downloadProgress = 0, // Default to 0% downloaded
  streamingInfo
}) => {
  const { currentUser } = useUser();
  const [savedProgress, setSavedProgress] = useState<StreamingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [resumeTime, setResumeTime] = useState(0);
  const [progressId, setProgressId] = useState<string | null>(null);
  const [currentDownloadProgress, setCurrentDownloadProgress] = useState(downloadProgress);
  const [shouldRetry, setShouldRetry] = useState(false);
  
  // Reference to the original VideoPlayer component
  const playerRef = useRef<{
    seekTo: (time: number) => void;
  } | null>(null);
  
  // Interval for saving progress periodically
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Update download progress when prop changes
  useEffect(() => {
    setCurrentDownloadProgress(downloadProgress);
  }, [downloadProgress]);

  // Set up interval for checking streaming info updates
  useEffect(() => {
    // Don't need to run if we're already at 100%
    if (downloadProgress >= 100) return;
    
    const infoInterval = setInterval(async () => {
      try {
        // Get updated streaming info
        const info = await streamingService.getStreamingInfo(torrentId);
        if (info) {
          // Update download progress based on overall progress
          setCurrentDownloadProgress(info.progress);
        }
      } catch (error) {
        console.error('Error updating streaming info:', error);
      }
    }, 5000); // Check every 5 seconds
    
    return () => clearInterval(infoInterval);
  }, [torrentId, downloadProgress]);
  
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
  
  // Handle video error with retry logic
  const handleVideoError = (error: string) => {
    console.error('Video player error:', error);
    
    // If error occurred and we're still downloading, set retry flag
    if (currentDownloadProgress < 100) {
      setShouldRetry(true);
      
      // Set up a retry timeout
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      
      retryTimeoutRef.current = setTimeout(() => {
        // Try reloading the player
        setShouldRetry(false);
        
        // Force a component re-render by updating state
        setIsLoading(true);
        setTimeout(() => setIsLoading(false), 100);
        
        toast.success('Retrying playback...');
      }, 3000); // Retry after 3 seconds
    } else {
      // If download is complete, pass the error to the parent
      if (onError) {
        onError(error);
      }
    }
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
  
  // Clean up retry timeout
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);
  
  if (isLoading) {
    return (
      <div className="w-full h-full bg-black flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }
  
  // If we're retrying, show a friendly message
  if (shouldRetry) {
    return (
      <div className="w-full h-full bg-black flex flex-col items-center justify-center text-white text-center p-6">
        <div className="animate-spin w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full mb-4"></div>
        <h3 className="text-xl font-bold mb-2">Buffering Content</h3>
        <p className="mb-4">
          Your video is still downloading ({Math.round(currentDownloadProgress)}% complete).
          We're preparing to resume playback...
        </p>
        <p className="text-sm text-gray-400">
          Playback will automatically resume in a few moments.
        </p>
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
        onError={handleVideoError}
        registerMethods={registerPlayerMethods}
        downloadProgress={currentDownloadProgress}
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