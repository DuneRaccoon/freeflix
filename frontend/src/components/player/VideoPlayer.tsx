import React, { useRef, useState, useEffect, useCallback } from 'react';
import { 
  PlayIcon, 
  PauseIcon, 
  SpeakerWaveIcon, 
  SpeakerXMarkIcon, 
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  ForwardIcon,
  BackwardIcon,
  Cog6ToothIcon
} from '@heroicons/react/24/solid';
import { formatTime } from '@/utils/format';
import { PlayerState } from '@/types';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  movieTitle?: string;
  subtitle?: string;
  autoPlay?: boolean;
  debug?: boolean;
  onEnded?: () => void;
  onError?: (error: string) => void;
  onProgress?: (state: PlayerState) => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  poster,
  movieTitle,
  subtitle,
  autoPlay = false,
  debug = false,
  onEnded,
  onError,
  onProgress
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const volumeBarRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const controlsTimeout = useRef<NodeJS.Timeout | null>(null);
  const doubleClickTimeout = useRef<NodeJS.Timeout | null>(null);
  const clickCount = useRef<number>(0);
  const userInteractedRef = useRef<boolean>(false);
  
  const [playerState, setPlayerState] = useState<PlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: 0.8, // Start at 80% volume
    isMuted: false,
    isFullscreen: false,
    showControls: true,
    isLoading: true,
    error: null
  });
  
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [videoIsReady, setVideoIsReady] = useState(false);

  // --- Helper Functions ---
  
  // Helper to safely interact with video element
  const safeVideoOperation = useCallback((operation: (video: HTMLVideoElement) => void) => {
    const video = videoRef.current;
    if (!video) return false;
    
    try {
      operation(video);
      return true;
    } catch (e) {
      console.error("Video operation error:", e);
      return false;
    }
  }, []);

  // --- Video Element Initialization ---
  
  // Initialize player when video element is available
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Mark that we'll need user interaction for audio
    userInteractedRef.current = false;
    
    // For debugging
    console.log("Video element initialized");

    // Handle user gesture to enable audio
    const enableAudio = () => {
      if (!userInteractedRef.current) {
        userInteractedRef.current = true;
        console.log("User interaction detected, enabling audio");
        
        // Re-apply volume settings after user interaction
        safeVideoOperation(v => {
          v.muted = playerState.isMuted;
          v.volume = playerState.volume;
          console.log("Volume restored after interaction:", v.volume, "Muted:", v.muted);
        });
        
        // Remove the listeners once we've handled interaction
        document.removeEventListener('click', enableAudio);
        document.removeEventListener('keydown', enableAudio);
      }
    };

    // Listen for user interactions that can enable audio
    document.addEventListener('click', enableAudio);
    document.addEventListener('keydown', enableAudio);

    return () => {
      // Clean up the listeners
      document.removeEventListener('click', enableAudio);
      document.removeEventListener('keydown', enableAudio);
    };
  }, [playerState.isMuted, playerState.volume, safeVideoOperation]);

  // --- Event Handlers ---
  
  // Toggle play/pause
  const togglePlay = useCallback(() => {
    console.log("Toggle play called");
    const video = videoRef.current;
    if (!video) return;

    try {
      if (video.paused || video.ended) {
        console.log("Attempting to play video");
        video.play().then(() => {
          console.log("Play successful");
          setPlayerState(prev => ({ ...prev, isPlaying: true }));
        }).catch(error => {
          console.error('Play error:', error);
          if (onError) onError('Could not play video. Please try again.');
        });
      } else {
        console.log("Pausing video");
        video.pause();
        setPlayerState(prev => ({ ...prev, isPlaying: false }));
      }
    } catch (e) {
      console.error("Error toggling play state:", e);
    }
  }, [onError]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!playerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        playerRef.current.requestFullscreen().catch(err => {
          console.error('Error attempting to enable fullscreen:', err);
        });
      } else {
        document.exitFullscreen();
      }
    } catch (e) {
      console.error("Error toggling fullscreen:", e);
    }
  }, []);

  // Handle click on video (for play/pause toggle)
  const handleVideoClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    console.log("Video clicked");
    
    // Increment click count
    clickCount.current += 1;
    
    // Clear existing double click timeout
    if (doubleClickTimeout.current) {
      clearTimeout(doubleClickTimeout.current);
    }
    
    // If this is the first click, set a timeout to check for double click
    if (clickCount.current === 1) {
      doubleClickTimeout.current = setTimeout(() => {
        // If we get here, it was a single click
        if (clickCount.current === 1) {
          console.log("Single click detected - toggling play"); // Debug log
          togglePlay();
        }
        // Reset click count
        clickCount.current = 0;
      }, 300); // 300ms threshold for double click
    } else {
      // It's a double click, handle fullscreen toggle
      console.log("Double click detected - toggling fullscreen"); // Debug log
      toggleFullscreen();
      // Reset click count
      clickCount.current = 0;
    }
  }, [togglePlay, toggleFullscreen]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    userInteractedRef.current = true; // Mark that user has interacted
    
    safeVideoOperation(video => {
      // Toggle the muted state
      const newMutedState = !video.muted;
      
      // Update the video element
      video.muted = newMutedState;
      
      // Update our state to match
      setPlayerState(prev => ({ ...prev, isMuted: newMutedState }));
      
      console.log("Mute toggled:", newMutedState);
    });
  }, [safeVideoOperation]);

  // Skip forward or backward
  const skip = useCallback((seconds: number) => {
    safeVideoOperation(video => {
      const newTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
      video.currentTime = newTime;
      
      // Update our state to match
      setPlayerState(prev => ({ ...prev, currentTime: newTime }));
    });
  }, [safeVideoOperation]);

  // Set volume level
  const setVolume = useCallback((volumeLevel: number) => {
    userInteractedRef.current = true; // Mark that user has interacted
    
    safeVideoOperation(video => {
      // Ensure volume is between 0 and 1
      const newVolume = Math.max(0, Math.min(1, volumeLevel));
      
      // Update the video element
      video.volume = newVolume;
      
      // If volume is set to 0, mute the video
      if (newVolume === 0) {
        video.muted = true;
      } else if (video.muted) {
        // If we're adjusting volume and it was muted, unmute it
        video.muted = false;
      }
      
      // Update our state to match
      setPlayerState(prev => ({ 
        ...prev, 
        volume: newVolume,
        isMuted: video.muted
      }));
      
      console.log("Volume set to:", newVolume, "Muted:", video.muted);
    });
  }, [safeVideoOperation]);

  // Handle volume bar click
  const handleVolumeClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!volumeBarRef.current) return;
    
    try {
      e.preventDefault();
      e.stopPropagation();
      
      const rect = volumeBarRef.current.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      setVolume(pos);
    } catch (e) {
      console.error("Error handling volume click:", e);
    }
  }, [setVolume]);

  // Handle progress bar click
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !progressBarRef.current) return;
    
    try {
      e.preventDefault();
      e.stopPropagation();
      
      const rect = progressBarRef.current.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      const newTime = pos * video.duration;
      
      // Set new time on video element
      video.currentTime = newTime;
      
      // Update our state to match
      setPlayerState(prev => ({ ...prev, currentTime: newTime }));
    } catch (e) {
      console.error("Error handling progress click:", e);
    }
  }, []);

  // --- Keyboard Controls ---
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle events when this player is in focus or in fullscreen
      if (!playerRef.current?.contains(document.activeElement) && 
          document.fullscreenElement !== playerRef.current) return;

      // Mark user interaction
      userInteractedRef.current = true;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(10);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-10);
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(playerState.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(playerState.volume - 0.1);
          break;
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          // Jump to percentage of video
          if (videoRef.current) {
            e.preventDefault();
            const percent = parseInt(e.key) * 10;
            const newTime = (videoRef.current.duration * percent) / 100;
            videoRef.current.currentTime = newTime;
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playerState.volume, skip, toggleFullscreen, toggleMute, togglePlay, setVolume]);

  // --- Video Event Listeners ---
  
  // Buffered progress tracking
  useEffect(() => {
    const updateBuffered = () => {
      const video = videoRef.current;
      if (!video) return;

      try {
        let buffered = 0;
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= video.currentTime && video.currentTime <= video.buffered.end(i)) {
            buffered = video.buffered.end(i) / video.duration * 100;
            break;
          }
        }
        
        setPlayerState(prev => ({ ...prev, buffered }));
      } catch (e) {
        console.error("Error updating buffer:", e);
      }
    };

    const video = videoRef.current;
    if (video) {
      video.addEventListener('progress', updateBuffered);
      return () => video.removeEventListener('progress', updateBuffered);
    }
  }, []);

  // All video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      try {
        setPlayerState(prev => ({
          ...prev,
          currentTime: video.currentTime,
          duration: video.duration || 0
        }));
        
        if (onProgress) {
          onProgress({
            ...playerState,
            currentTime: video.currentTime,
            duration: video.duration || 0
          });
        }
      } catch (e) {
        console.error("Error in time update:", e);
      }
    };

    const handlePlay = () => {
      try {
        console.log("Play event triggered");
        setPlayerState(prev => ({ ...prev, isPlaying: true, isLoading: false }));
      } catch (e) {
        console.error("Error in play event:", e);
      }
    };

    const handlePause = () => {
      try {
        console.log("Pause event triggered");
        setPlayerState(prev => ({ ...prev, isPlaying: false }));
      } catch (e) {
        console.error("Error in pause event:", e);
      }
    };

    const handleVolumeChange = () => {
      try {
        console.log("Volume change event:", video.volume, "Muted:", video.muted);
        setPlayerState(prev => ({
          ...prev,
          volume: video.volume,
          isMuted: video.muted
        }));
      } catch (e) {
        console.error("Error in volume change event:", e);
      }
    };

    const handleLoadStart = () => {
      try {
        console.log("Load start event");
        setPlayerState(prev => ({ ...prev, isLoading: true }));
        setVideoIsReady(false);
      } catch (e) {
        console.error("Error in load start event:", e);
      }
    };

    const handleCanPlay = () => {
      try {
        console.log("Can play event");
        setPlayerState(prev => ({ ...prev, isLoading: false }));
        setVideoIsReady(true);
        
        // Only autoplay if specified and after we know we can play
        if (autoPlay && userInteractedRef.current) {
          console.log("Attempting autoplay because user has interacted");
          video.play().catch(error => {
            console.error('Autoplay failed:', error);
          });
        } else if (autoPlay) {
          console.log("Deferring autoplay until user interaction");
        }
      } catch (e) {
        console.error("Error in can play event:", e);
      }
    };

    const handleEnded = () => {
      try {
        console.log("Video ended");
        setPlayerState(prev => ({ ...prev, isPlaying: false }));
        if (onEnded) onEnded();
      } catch (e) {
        console.error("Error in ended event:", e);
      }
    };

    const handleError = () => {
      try {
        const errorMessage = 'An error occurred while playing the video.';
        console.error("Video error:", errorMessage, video.error);
        setPlayerState(prev => ({ 
          ...prev, 
          isLoading: false, 
          error: errorMessage 
        }));
        if (onError) onError(errorMessage);
      } catch (e) {
        console.error("Error in error event:", e);
      }
    };

    const handleWaiting = () => {
      try {
        console.log("Waiting for data");
        setPlayerState(prev => ({ ...prev, isLoading: true }));
      } catch (e) {
        console.error("Error in waiting event:", e);
      }
    };

    const handlePlaying = () => {
      try {
        console.log("Playing event");
        setPlayerState(prev => ({ ...prev, isLoading: false, isPlaying: true }));
      } catch (e) {
        console.error("Error in playing event:", e);
      }
    };

    // Add all event listeners
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('volumechange', handleVolumeChange);
    video.addEventListener('loadstart', handleLoadStart);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);

    // Clean up by removing all event listeners
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('volumechange', handleVolumeChange);
      video.removeEventListener('loadstart', handleLoadStart);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
    };
  }, [autoPlay, onEnded, onError, onProgress, playerState]);

  // Set playback speed when changed
  useEffect(() => {
    safeVideoOperation(video => {
      video.playbackRate = playbackSpeed;
    });
  }, [playbackSpeed, safeVideoOperation]);

  // Apply volume fix when video is ready
  useEffect(() => {
    if (videoIsReady && userInteractedRef.current) {
      console.log("Video is ready and user has interacted, applying volume settings");
      safeVideoOperation(video => {
        // Set volume explicitly when video is ready and user has interacted
        console.log("Setting volume:", playerState.volume, "Muted:", playerState.isMuted);
        video.volume = playerState.volume;
        video.muted = playerState.isMuted;
      });
    }
  }, [videoIsReady, playerState.volume, playerState.isMuted, safeVideoOperation]);

  // --- Controls visibility ---
  
  // Auto-hide controls
  useEffect(() => {
    const hideControls = () => {
      if (playerState.isPlaying && !isDraggingProgress && !isDraggingVolume) {
        setPlayerState(prev => ({ ...prev, showControls: false }));
        setShowVolumeSlider(false);
        setShowSettings(false);
      }
    };

    const resetControlsTimeout = () => {
      if (controlsTimeout.current) {
        clearTimeout(controlsTimeout.current);
      }
      
      setPlayerState(prev => ({ ...prev, showControls: true }));
      
      if (playerState.isPlaying && !isDraggingProgress && !isDraggingVolume) {
        controlsTimeout.current = setTimeout(hideControls, 3000);
      }
    };

    const handleMouseMove = () => {
      resetControlsTimeout();
    };
    
    const handleMouseLeave = () => {
      if (playerState.isPlaying && !isDraggingProgress && !isDraggingVolume) {
        hideControls();
      }
    };
    
    if (playerRef.current) {
      playerRef.current.addEventListener('mousemove', handleMouseMove);
      playerRef.current.addEventListener('mouseleave', handleMouseLeave);
    }

    // Set initial timeout
    resetControlsTimeout();

    return () => {
      if (controlsTimeout.current) {
        clearTimeout(controlsTimeout.current);
      }
      if (playerRef.current) {
        playerRef.current.removeEventListener('mousemove', handleMouseMove);
        playerRef.current.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, [playerState.isPlaying, isDraggingProgress, isDraggingVolume]);

  // --- Fullscreen Change Detection ---
  
  // Handle fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = document.fullscreenElement === playerRef.current;
      setPlayerState(prev => ({ ...prev, isFullscreen }));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return (
    <div 
      ref={playerRef}
      className="relative w-full h-full bg-black overflow-hidden"
      tabIndex={0}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="w-full h-full object-contain"
        preload="auto"
        playsInline
      />

      {/* Click Overlay (separate from video for better click handling) */}
      <div 
        className="absolute inset-0 cursor-pointer z-10"
        onClick={handleVideoClick}
        style={{ pointerEvents: playerState.showControls ? 'none' : 'auto' }}
      ></div>

      {/* Loading Overlay */}
      {playerState.isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-60 z-20">
          <div className="animate-spin w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full"></div>
        </div>
      )}

      {/* Error Overlay */}
      {playerState.error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80 z-20 text-white p-4">
          <div className="text-red-500 text-xl mb-2">Error</div>
          <p className="text-center mb-4">{playerState.error}</p>
          <button 
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-md transition-colors"
            onClick={() => {
              const video = videoRef.current;
              if (video) {
                video.load();
                setPlayerState(prev => ({ ...prev, error: null }));
              }
            }}
          >
            Try Again
          </button>
        </div>
      )}

      {/* Debug Overlay - for development only */}
      {
        debug && (
          <div className="absolute top-0 left-0 bg-black/50 text-white text-xs p-1 z-50">
            Volume: {playerState.volume.toFixed(2)} | Muted: {playerState.isMuted.toString()} | 
            Ready: {videoIsReady.toString()} | User Interact: {userInteractedRef.current.toString()}
          </div>
        )
      }

      {/* Big Play/Pause Button - Show when paused or controls visible */}
      {(!playerState.isPlaying || playerState.showControls) && !playerState.isLoading && !playerState.error && (
        <div 
          className={`absolute inset-0 flex items-center justify-center z-30 pointer-events-none`}
        >
          <div 
            className={`${playerState.isPlaying ? 'opacity-0' : 'opacity-90'} 
                        bg-black/40 rounded-full p-4 transition-all duration-200
                        ${playerState.isPlaying ? 'scale-75' : 'scale-100'}`}
          >
            {playerState.isPlaying ? (
              <PauseIcon className="w-12 h-12 text-white" />
            ) : (
              <PlayIcon className="w-12 h-12 text-white" />
            )}
          </div>
        </div>
      )}

      {/* Controls Overlay - show on hover or when paused */}
      <div 
        className={`absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/70 via-transparent to-black/70 
                    transition-opacity duration-300 z-40
                    ${playerState.showControls || !playerState.isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Movie Title Overlay - only shown when paused or on hover */}
        {(movieTitle || subtitle) && (
          <div className="p-4">
            {movieTitle && <h2 className="text-white text-2xl font-bold drop-shadow-md">{movieTitle}</h2>}
            {subtitle && <p className="text-white/80 text-lg drop-shadow-md">{subtitle}</p>}
          </div>
        )}

        {/* Bottom Controls */}
        <div className="p-4 space-y-2">
          {/* Progress Bar */}
          <div 
            ref={progressBarRef}
            className="relative h-2 bg-gray-600/60 cursor-pointer rounded group"
            onClick={handleProgressClick}
          >
            {/* Buffered Progress */}
            <div 
              className="absolute h-full bg-gray-500/70 rounded"
              style={{ width: `${playerState.buffered}%` }}
            ></div>
            
            {/* Playback Progress */}
            <div 
              className="absolute h-full bg-primary-500 group-hover:bg-primary-400 rounded"
              style={{ width: `${(playerState.currentTime / playerState.duration) * 100 || 0}%` }}
            ></div>
            
            {/* Scrubber Handle - only visible on hover */}
            <div 
              className="absolute h-4 w-4 bg-primary-500 rounded-full -translate-x-1/2 -translate-y-1/4 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ 
                left: `${(playerState.currentTime / playerState.duration) * 100 || 0}%`,
                top: '50%'
              }}
            ></div>
          </div>
          
          {/* Control Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {/* Play/Pause Button */}
              <button 
                className="text-white hover:text-primary-400 transition-colors rounded-full p-1 hover:bg-white/10"
                onClick={togglePlay}
                aria-label={playerState.isPlaying ? 'Pause' : 'Play'}
              >
                {playerState.isPlaying ? (
                  <PauseIcon className="w-6 h-6" />
                ) : (
                  <PlayIcon className="w-6 h-6" />
                )}
              </button>
              
              {/* Skip Backward */}
              <button 
                className="text-white hover:text-primary-400 transition-colors rounded-full p-1 hover:bg-white/10"
                onClick={() => skip(-10)}
                aria-label="Rewind 10 seconds"
              >
                <BackwardIcon className="w-6 h-6" />
              </button>
              
              {/* Skip Forward */}
              <button 
                className="text-white hover:text-primary-400 transition-colors rounded-full p-1 hover:bg-white/10"
                onClick={() => skip(10)}
                aria-label="Fast forward 10 seconds"
              >
                <ForwardIcon className="w-6 h-6" />
              </button>
              
              {/* Volume Control */}
              <div className="relative flex items-center group">
                <button 
                  className="text-white hover:text-primary-400 transition-colors rounded-full p-1 hover:bg-white/10"
                  onClick={toggleMute}
                  onMouseEnter={() => setShowVolumeSlider(true)}
                  aria-label={playerState.isMuted ? 'Unmute' : 'Mute'}
                >
                  {playerState.isMuted || playerState.volume === 0 ? (
                    <SpeakerXMarkIcon className="w-6 h-6" />
                  ) : (
                    <SpeakerWaveIcon className="w-6 h-6" />
                  )}
                </button>
                
                {/* Volume Slider - shown on hover */}
                <div 
                  className={`absolute bottom-full left-0 bg-gray-800/90 rounded px-3 py-2 mb-2 transition-all duration-200 
                             group-hover:opacity-100 group-hover:translate-y-0 
                             ${showVolumeSlider ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}
                  onMouseLeave={() => setShowVolumeSlider(false)}
                >
                  <div 
                    ref={volumeBarRef}
                    className="w-24 h-1.5 bg-gray-600 cursor-pointer rounded"
                    onClick={handleVolumeClick}
                  >
                    <div 
                      className="h-full bg-white rounded"
                      style={{ width: `${playerState.isMuted ? 0 : playerState.volume * 100}%` }}
                    ></div>
                  </div>
                </div>
              </div>
              
              {/* Time Display */}
              <div className="text-white text-sm">
                {formatTime(playerState.currentTime)} / {formatTime(playerState.duration)}
              </div>
            </div>
            
            {/* Right Side Controls */}
            <div className="flex items-center space-x-3">
              {/* Settings Button */}
              <div className="relative">
                <button 
                  className="text-white hover:text-primary-400 transition-colors rounded-full p-1 hover:bg-white/10"
                  onClick={() => setShowSettings(!showSettings)}
                  aria-label="Settings"
                >
                  <Cog6ToothIcon className="w-6 h-6" />
                </button>
                
                {/* Settings Menu */}
                {showSettings && (
                  <div className="absolute bottom-full right-0 bg-gray-800/90 rounded py-2 mb-2 min-w-[120px] z-50">
                    <div className="px-3 py-1 text-sm text-gray-300">Playback Speed</div>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => (
                      <button
                        key={speed}
                        className={`w-full text-left px-3 py-1 text-sm hover:bg-gray-700 ${
                          playbackSpeed === speed ? 'text-primary-400' : 'text-white'
                        }`}
                        onClick={() => {
                          setPlaybackSpeed(speed);
                          setShowSettings(false);
                        }}
                      >
                        {speed === 1 ? 'Normal' : `${speed}x`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Fullscreen Toggle */}
              <button 
                className="text-white hover:text-primary-400 transition-colors rounded-full p-1 hover:bg-white/10"
                onClick={toggleFullscreen}
                aria-label={playerState.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {playerState.isFullscreen ? (
                  <ArrowsPointingInIcon className="w-6 h-6" />
                ) : (
                  <ArrowsPointingOutIcon className="w-6 h-6" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* "Unmute" Button - Shows when video is playing but muted */}
      {playerState.isPlaying && playerState.isMuted && !userInteractedRef.current && (
        <div className="absolute bottom-20 right-4 z-50">
          <button
            className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-full flex items-center shadow-lg transition-colors"
            onClick={() => {
              userInteractedRef.current = true;
              toggleMute();
            }}
          >
            <SpeakerWaveIcon className="w-5 h-5 mr-2" />
            Unmute
          </button>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;