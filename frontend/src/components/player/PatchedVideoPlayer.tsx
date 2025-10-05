import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import VideoPlayer from '@/components/player/VideoPlayer';
import { streamingService } from '@/services/streaming';
import { useUser } from '@/context/UserContext';
import { useProgress } from '@/context/ProgressContext';
import { StreamingProgress, StreamingInfo, TorrentStatus } from '@/types';
import Button from '@/components/ui/Button';
import { PlayIcon, ForwardIcon } from '@heroicons/react/24/solid';
import { toast } from 'react-hot-toast';

interface PatchedVideoPlayerProps {
  src: string;
  torrentId: string;
  torrentInfo?: TorrentStatus;
  movieId: string;
  movieTitle?: string;
  subtitle?: string;
  poster?: string;
  onError?: (error: string) => void;
  downloadProgress?: number;
  streamingInfo?: StreamingInfo;
}

const PatchedVideoPlayer: React.FC<PatchedVideoPlayerProps> = ({
  src,
  torrentId,
  torrentInfo,
  movieId,
  movieTitle,
  subtitle,
  poster,
  onError,
  downloadProgress = 0,
  streamingInfo
}) => {
  const { currentUser } = useUser();
  const { updateLocalProgress } = useProgress();
  const [savedProgress, setSavedProgress] = useState<StreamingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [resumeTime, setResumeTime] = useState(0);
  const [progressId, setProgressId] = useState<string | null>(null);
  const [currentDownloadProgress, setCurrentDownloadProgress] = useState(downloadProgress);
  const [shouldRetry, setShouldRetry] = useState(false);
  
  const router = useRouter();
  
  // Reference to the original VideoPlayer component
  const playerRef = useRef<{
    seekTo: (time: number) => void;
  } | null>(null);
  
  // Interval for saving progress periodically
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const saveInProgressRef = useRef<boolean>(false);
  const lastSaveTimeRef = useRef<number>(0);
  
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
      saveCurrentProgress(true);
    };
  }, [currentUser, torrentId, movieId, progressId]);
  
  // Save progress when user navigates away or closes browser
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Save progress right before the page unloads
      saveCurrentProgress(true); // Force immediate save
    };
    
    // Add event listeners
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      // Clean up event listeners
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      // Final progress save on component unmount
      saveCurrentProgress(true); // Force immediate save
    };
  }, []);
  
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
          const updatedProgress = await streamingService.updateProgress(
            currentUser.id,
            progressId,
            {
              current_time: durationRef.current,
              duration: durationRef.current,
              percentage: 100,
              completed: true
            }
          );
          
          // Update local progress context
          updateLocalProgress(updatedProgress);
        } else {
          const newProgress = await streamingService.saveProgress(
            currentUser.id,
            progressData
          );
          setProgressId(newProgress.id);
          
          // Update local progress context
          updateLocalProgress(newProgress);
        }
      } catch (error) {
        console.error('Failed to save completed progress:', error);
      }
    };
    
    saveCompletedProgress();
  }, [currentUser, torrentId, movieId, progressId, updateLocalProgress]);
  
  // Save current progress
  const saveCurrentProgress = async (forceSave: boolean = false) => {
    if (saveInProgressRef.current || !currentUser || currentTimeRef.current < 5) return;
    
    // Set flag to avoid concurrent saves
    saveInProgressRef.current = true;
    
    try {
      const currentTime = currentTimeRef.current;
      const duration = durationRef.current || 0;
      const percentage = duration > 0 ? (currentTime / duration) * 100 : 0;
      
      // Don't save if we're at the very beginning
      if (currentTime < 5) {
        saveInProgressRef.current = false;
        return;
      }
      
      // Don't save too frequently unless forced
      if (!forceSave && Date.now() - lastSaveTimeRef.current < 5000) {
        saveInProgressRef.current = false;
        return;
      }
      
      // Don't mark as completed unless we're very close to the end
      const completed = percentage > 98;
      
      const progressData = {
        torrent_id: torrentId,
        movie_id: movieId,
        current_time: currentTime,
        duration: duration > 0 ? duration : null,
        percentage,
        completed
      };
      
      if (progressId) {
        const updatedProgress = await streamingService.updateProgress(
          currentUser.id,
          progressId,
          {
            current_time: currentTime,
            duration: duration > 0 ? duration : null,
            percentage,
            completed
          }
        );
        
        // Update local progress context
        updateLocalProgress(updatedProgress);
      } else {
        const newProgress = await streamingService.saveProgress(
          currentUser.id,
          progressData
        );
        setProgressId(newProgress.id);
        
        // Update local progress context
        updateLocalProgress(newProgress);
      }
      
      // Update last save time
      lastSaveTimeRef.current = Date.now();
    } catch (error) {
      console.error('Failed to save progress:', error);
    } finally {
      saveInProgressRef.current = false;
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
  
  // Handle video player error
  const handleVideoError = (error: string) => {
    // For minor errors during active downloads, don't show the error screen
    if (torrentInfo && torrentInfo.progress < 100 && 
        (error.includes('network error') || error.includes('buffering'))) {
      // Just log the error but don't show the error screen
      console.warn('Video playback issue during download:', error);
    } else {
      // For serious errors, show the error screen
      if (onError) {
        onError(error);
      }
    }
  };
  
  // Loading state
  if (isLoading) {
    return (
      <div className="w-full h-full bg-black flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }
  
  // Get the streaming URL if info is available
  const streamingUrl = src;
  
  // Ready for streaming
  return (
    <div className="h-full flex flex-col bg-black relative">
      {/* Player Area */}
      <div className="flex-grow relative overflow-hidden z-[100]">
        {streamingUrl ? (
          <VideoPlayer 
            src={streamingUrl}
            poster={poster}
            movieTitle={movieTitle}
            subtitle={subtitle}
            autoPlay={!showResumePrompt}
            debug
            onProgress={handleProgress}
            onEnded={handleEnded}
            onError={handleVideoError}
            registerMethods={registerPlayerMethods}
            downloadProgress={currentDownloadProgress}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <div className="text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-4 border-primary-500 border-t-transparent"></div>
              <p className="text-white mt-2">Loading video player...</p>
            </div>
          </div>
        )}

        {/* Resume Playback Prompt - inside player area with high z-index */}
        {showResumePrompt && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-[800]">
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
    </div>
  );
};

export default PatchedVideoPlayer;