import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import VideoPlayer from '@/components/player/VideoPlayer';
import { streamingService } from '@/services/streaming';
import { useUser } from '@/context/UserContext';
import { useProgress } from '@/context/ProgressContext';
import { StreamingProgress, StreamingInfo, TorrentStatus, StreamHealthState, TorrentCandidate } from '@/types';
import { Button as FreButton, Modal } from '@/components/ui/fre';
import { toast } from 'react-hot-toast';

interface PatchedVideoPlayerProps {
  src: string;
  torrentId: string;
  torrentInfo?: TorrentStatus;
  movieId: string;
  contentId?: string;
  fileIndex?: number;
  title?: string;
  movieTitle?: string;
  subtitle?: string;
  poster?: string;
  onError?: (error: string) => void;
  /** Optional external progress callback — fired alongside internal progress tracking */
  onProgress?: (state: { currentTime: number; duration: number }) => void;
  downloadProgress?: number;
  streamingInfo?: StreamingInfo;
  // --- W2-declared stream-health / source-switch seam (W6 implements behavior) ---
  // Pure pass-through to <VideoPlayer/>; PatchedVideoPlayer does NOT act on them here.
  streamHealth?: StreamHealthState;
  sources?: TorrentCandidate[];
  currentSourceId?: string;
  onSelectSource?: (candidate: TorrentCandidate) => void;
  onRecoveryExhausted?: () => void;
}

const PatchedVideoPlayer: React.FC<PatchedVideoPlayerProps> = ({
  src,
  torrentId,
  torrentInfo,
  movieId,
  contentId,
  fileIndex,
  title,
  movieTitle,
  subtitle,
  poster,
  onError,
  onProgress: externalOnProgress,
  downloadProgress = 0,
  streamingInfo,
  streamHealth,
  sources,
  currentSourceId,
  onSelectSource,
  onRecoveryExhausted
}) => {
  // Prefer the stable content_id; fall back to the legacy title-based movieId
  const effectiveMovieId = contentId ?? movieId;
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

  // NOTE: the per-player 5s getStreamingInfo poll was removed (WS6). The streaming
  // page is the single poll owner (§5.2) and feeds download progress down via the
  // `downloadProgress` prop, which the effect above mirrors into local state.


  // Fetch saved progress on mount
  useEffect(() => {
    const fetchProgress = async () => {
      if (!currentUser) {
        setIsLoading(false);
        return;
      }

      try {
        // Prefer lookup by the stable content_id (effectiveMovieId) so per-episode
        // progress is found even for season packs. Fall back to torrent lookup only
        // when no stable id is available.
        let progress: StreamingProgress | null = null;
        if (effectiveMovieId) {
          progress = await streamingService.getProgressByMovie(
            currentUser.id,
            effectiveMovieId
          );
        }
        if (!progress) {
          progress = await streamingService.getProgressByTorrent(
            currentUser.id,
            torrentId
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
  }, [currentUser, torrentId, effectiveMovieId]);

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
  }, [currentUser, torrentId, effectiveMovieId, progressId]);
  
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
    // Fire external progress callback (e.g. for UpNextCard trigger in the page)
    if (externalOnProgress) {
      externalOnProgress({ currentTime: playerState.currentTime, duration: playerState.duration });
    }
  }, [externalOnProgress]);
  
  // Handler for when the video ends
  const handleEnded = useCallback(() => {
    if (!currentUser) return;
    
    // Mark as completed
    const saveCompletedProgress = async () => {
      try {
        const progressData = {
          torrent_id: torrentId,
          movie_id: effectiveMovieId,
          current_time: durationRef.current,
          duration: durationRef.current,
          percentage: 100,
          completed: true,
          ...(fileIndex !== undefined ? { file_index: fileIndex } : {}),
          ...(title !== undefined ? { title } : {}),
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
  }, [currentUser, torrentId, effectiveMovieId, fileIndex, title, progressId, updateLocalProgress]);
  
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
        movie_id: effectiveMovieId,
        current_time: currentTime,
        duration: duration > 0 ? duration : null,
        percentage,
        completed,
        ...(fileIndex !== undefined ? { file_index: fileIndex } : {}),
        ...(title !== undefined ? { title } : {}),
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
    // During an active download, minor network/buffering errors are handled in-player
    // by the backoff recovery — don't escalate to the error screen. A genuinely dead
    // swarm (health === 'dead') still bubbles up so the user can switch sources.
    const isRecoverable =
      torrentInfo && torrentInfo.progress < 100 &&
      streamHealth?.health !== 'dead' &&
      (error.includes('network error') || error.includes('buffering'));
    if (isRecoverable) {
      console.warn('Video playback issue during download (recovering in-player):', error);
    } else if (onError) {
      onError(error);
    }
  };
  
  // Loading state
  if (isLoading) {
    return (
      <div className="w-full h-full bg-ink flex items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-hairline border-t-gold"></div>
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
            streamHealth={streamHealth}
            sources={sources}
            currentSourceId={currentSourceId}
            onSelectSource={onSelectSource}
            onRecoveryExhausted={onRecoveryExhausted}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-ink">
            <div className="text-center">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-hairline border-t-gold"></div>
              <p className="text-white mt-2">Loading video player...</p>
            </div>
          </div>
        )}

        {/* Resume Playback Prompt — FRÈ Modal */}
        <Modal
          open={showResumePrompt}
          onClose={handleStartFromBeginning}
          label="Resume Playback"
        >
          <p className="font-display text-2xl font-light text-text mb-2 tracking-tight">
            Resume Playback
          </p>
          <p className="text-sm text-muted mb-6 leading-relaxed">
            Would you like to resume watching from where you left off?{' '}
            <span className="text-gold font-medium">
              {Math.floor(resumeTime / 60)}m {Math.floor(resumeTime % 60)}s
            </span>
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <FreButton
              variant="glass"
              size="md"
              onClick={handleStartFromBeginning}
              className="flex-1"
            >
              Start from Beginning
            </FreButton>
            <FreButton
              variant="primary"
              size="md"
              onClick={handleResume}
              className="flex-1"
            >
              Resume
            </FreButton>
          </div>
        </Modal>
      </div>
    </div>
  );
};

export default PatchedVideoPlayer;