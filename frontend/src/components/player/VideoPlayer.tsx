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
  registerMethods?: (methods: { seekTo: (time: number) => void }) => void;
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
  onProgress,
  registerMethods
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const volumeBarRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const controlsTimeout = useRef<NodeJS.Timeout | null>(null);
  const cursorTimeout = useRef<NodeJS.Timeout | null>(null);
  const userInteractedRef = useRef<boolean>(false);
  const volumeChangeInProgressRef = useRef<boolean>(false);
  const isDraggingVolumeRef = useRef<boolean>(false);
  
  const [playerState, setPlayerState] = useState<PlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: 0.8,
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
  const [videoIsReady, setVideoIsReady] = useState(false);
  const [showUnmuteButton, setShowUnmuteButton] = useState(false);
  const [hideCursor, setHideCursor] = useState(false);
  
  // Keep track of clicks for double-click detection
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastClickTimeRef = useRef<number>(0);

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

  // Enable audio playback after user interaction
  const enableAudio = useCallback(() => {
    if (debug) console.log("Attempting to enable audio");
    userInteractedRef.current = true;
    
    safeVideoOperation(video => {
      // Try to play to unlock audio capabilities
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          // Now we can set audio properties
          if (debug) console.log("Play successful, setting volume to", playerState.volume);
          video.volume = playerState.volume;
          
          // Only unmute if the user hasn't explicitly muted
          if (!playerState.isMuted) {
            video.muted = false;
            setShowUnmuteButton(false);
          }
          
          // Confirm player state
          setPlayerState(prev => ({ 
            ...prev, 
            isPlaying: true,
            volume: video.volume,
            isMuted: video.muted
          }));
        }).catch(e => {
          console.error("Error in play attempt:", e);
          // We still need to unmute for future interactions
          setShowUnmuteButton(true);
        });
      }
    });
  }, [playerState.volume, playerState.isMuted, safeVideoOperation, debug]);

  // Toggle play/pause
  const togglePlay = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (debug) console.log("Toggle play called");
    userInteractedRef.current = true;
    
    safeVideoOperation(video => {
      if (video.paused || video.ended) {
        if (debug) console.log("Video is paused, playing");
        video.play().catch(err => console.error("Play error:", err));
      } else {
        if (debug) console.log("Video is playing, pausing");
        video.pause();
      }
    });
    
    // Reset the cursor hide timer
    resetCursorTimeout();
  }, [safeVideoOperation, debug]);

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
    
    // Reset the cursor hide timer
    resetCursorTimeout();
  }, []);

  // CRITICAL FIX: Improved click handler with proper double-click detection
  const handleVideoClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    console.log('Video clicked');
    
    const currentTime = Date.now();
    const isDoubleClick = currentTime - lastClickTimeRef.current < 300; // 300ms threshold
    
    if (isDoubleClick) {
      if (debug) console.log("Double click detected - toggling fullscreen");
      toggleFullscreen();
      lastClickTimeRef.current = 0; // Reset after using the double click
    } else {
      lastClickTimeRef.current = currentTime;
      
      // Use a timeout to allow for double-click detection
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
      
      clickTimeoutRef.current = setTimeout(() => {
        if (debug) console.log("Single click confirmed - toggling play");
        togglePlay();
        clickTimeoutRef.current = null;
      }, 300);
    }
    
    // Reset the cursor hide timer
    resetCursorTimeout();
  }, [togglePlay, toggleFullscreen, debug]);

  // Toggle mute
  const handleToggleMute = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (volumeChangeInProgressRef.current) return;
    volumeChangeInProgressRef.current = true;
    
    if (debug) console.log("Toggle mute button clicked");
    userInteractedRef.current = true;
    
    safeVideoOperation(video => {
      // Toggle mute state directly
      const newMutedState = !video.muted;
      if (debug) console.log("Setting muted to:", newMutedState);
      
      video.muted = newMutedState;
      
      // Update UI state
      setPlayerState(prev => ({ ...prev, isMuted: newMutedState }));
      
      // Hide/show unmute button
      setShowUnmuteButton(newMutedState);
    });
    
    // Allow volume changes again after a short delay
    setTimeout(() => {
      volumeChangeInProgressRef.current = false;
    }, 100);
    
    // Reset the cursor hide timer
    resetCursorTimeout();
  }, [safeVideoOperation, debug]);

  // Skip forward or backward
  const skip = useCallback((seconds: number) => {
    safeVideoOperation(video => {
      const newTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
      video.currentTime = newTime;
    });
    
    // Reset the cursor hide timer
    resetCursorTimeout();
  }, [safeVideoOperation]);

  // CRITICAL FIX: Volume control with drag support
  const startVolumeDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!volumeBarRef.current) return;
    
    isDraggingVolumeRef.current = true;
    
    // Set initial volume based on click position
    updateVolumeFromEvent(e);
    
    // Add document-level listeners to track mouse movement outside the volume bar
    document.addEventListener('mousemove', updateVolumeFromMouseMove);
    document.addEventListener('mouseup', stopVolumeDrag);
    
    // Reset the cursor hide timer
    resetCursorTimeout();
  }, []);
  
  // Helper to update volume based on mouse position
  const updateVolumeFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!volumeBarRef.current || volumeChangeInProgressRef.current) return;
    
    volumeChangeInProgressRef.current = true;
    
    try {
      const rect = volumeBarRef.current.getBoundingClientRect();
      let pos = (e.clientX - rect.left) / rect.width;
      pos = Math.max(0, Math.min(1, pos)); // Clamp between 0 and 1
      
      if (debug) console.log("Setting volume to:", pos);
      
      safeVideoOperation(video => {
        // Set volume directly
        video.volume = pos;
        
        // If volume is set to 0, mute; otherwise unmute
        const shouldBeMuted = pos === 0;
        video.muted = shouldBeMuted;
        
        // Update state
        setPlayerState(prev => ({ 
          ...prev, 
          volume: pos,
          isMuted: shouldBeMuted
        }));
        
        // Update UI
        setShowUnmuteButton(shouldBeMuted);
      });
    } catch (e) {
      console.error("Error updating volume:", e);
    }
    
    // Allow volume changes again after a short delay
    setTimeout(() => {
      volumeChangeInProgressRef.current = false;
    }, 50); // Shorter delay for dragging
  }, [safeVideoOperation, debug]);
  
  // Mouse move handler for volume drag
  const updateVolumeFromMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingVolumeRef.current) {
      updateVolumeFromEvent(e);
    }
  }, [updateVolumeFromEvent]);
  
  // Mouse up handler to stop volume drag
  const stopVolumeDrag = useCallback(() => {
    isDraggingVolumeRef.current = false;
    document.removeEventListener('mousemove', updateVolumeFromMouseMove);
    document.removeEventListener('mouseup', stopVolumeDrag);
  }, [updateVolumeFromMouseMove]);

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
    } catch (e) {
      console.error("Error handling progress click:", e);
    }
    
    // Reset the cursor hide timer
    resetCursorTimeout();
  }, []);

  // Init video and handle source changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    if (debug) console.log("Source changed, reinitializing video element");
    
    // Reset state when source changes
    userInteractedRef.current = false;
    setShowUnmuteButton(false);
    volumeChangeInProgressRef.current = false;
    isDraggingVolumeRef.current = false;
    
    // Ensure it starts muted for autoplay
    video.muted = true;
    
    // Set up a one-time click handler to detect first user interaction
    const handleFirstInteraction = () => {
      if (!userInteractedRef.current) {
        if (debug) console.log("First user interaction detected");
        userInteractedRef.current = true;
        document.removeEventListener('click', handleFirstInteraction);
        document.removeEventListener('keydown', handleFirstInteraction);
      }
    };
    
    document.addEventListener('click', handleFirstInteraction);
    document.addEventListener('keydown', handleFirstInteraction);
    
    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
      
      // Also clean up volume drag handlers if they exist
      document.removeEventListener('mousemove', updateVolumeFromMouseMove);
      document.removeEventListener('mouseup', stopVolumeDrag);
    };
  }, [src, debug, updateVolumeFromMouseMove, stopVolumeDrag]);

  // Keyboard controls
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
          if (volumeChangeInProgressRef.current) return;
          volumeChangeInProgressRef.current = true;
          
          safeVideoOperation(video => {
            // Toggle mute state directly
            const newMutedState = !video.muted;
            video.muted = newMutedState;
            
            // Update UI state
            setPlayerState(prev => ({ ...prev, isMuted: newMutedState }));
            setShowUnmuteButton(newMutedState);
          });
          
          setTimeout(() => {
            volumeChangeInProgressRef.current = false;
          }, 100);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (volumeChangeInProgressRef.current) return;
          volumeChangeInProgressRef.current = true;
          
          safeVideoOperation(video => {
            const newVolume = Math.min(1, video.volume + 0.1);
            video.volume = newVolume;
            video.muted = false;
            
            setPlayerState(prev => ({ 
              ...prev, 
              volume: newVolume,
              isMuted: false
            }));
            
            setShowUnmuteButton(false);
          });
          
          setTimeout(() => {
            volumeChangeInProgressRef.current = false;
          }, 100);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (volumeChangeInProgressRef.current) return;
          volumeChangeInProgressRef.current = true;
          
          safeVideoOperation(video => {
            const newVolume = Math.max(0, video.volume - 0.1);
            video.volume = newVolume;
            
            // Only mute if volume goes to 0
            if (newVolume === 0) {
              video.muted = true;
              setShowUnmuteButton(true);
            }
            
            setPlayerState(prev => ({ 
              ...prev, 
              volume: newVolume,
              isMuted: newVolume === 0
            }));
          });
          
          setTimeout(() => {
            volumeChangeInProgressRef.current = false;
          }, 100);
          break;
      }
      
      // Reset cursor timeout on any key press
      resetCursorTimeout();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, toggleFullscreen, skip, safeVideoOperation, debug]);

  // Set up video event listeners
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
        if (debug) console.log("Play event triggered");
        setPlayerState(prev => ({ ...prev, isPlaying: true, isLoading: false }));
      } catch (e) {
        console.error("Error in play event:", e);
      }
    };

    const handlePause = () => {
      try {
        if (debug) console.log("Pause event triggered");
        setPlayerState(prev => ({ ...prev, isPlaying: false }));
      } catch (e) {
        console.error("Error in pause event:", e);
      }
    };

    const handleVolumeChange = () => {
      if (volumeChangeInProgressRef.current) return;
      
      try {
        // Only update state from event if we're not in the middle of a manual change
        if (debug) console.log("Volume change event:", video.volume, "Muted:", video.muted);
        
        setPlayerState(prev => ({
          ...prev,
          volume: video.volume,
          isMuted: video.muted
        }));
        
        // Show unmute button if muted
        setShowUnmuteButton(video.muted);
      } catch (e) {
        console.error("Error in volume change event:", e);
      }
    };

    const handleLoadStart = () => {
      try {
        if (debug) console.log("Load start event");
        setPlayerState(prev => ({ ...prev, isLoading: true }));
        setVideoIsReady(false);
        
        // Ensure video starts muted for autoplay policies
        video.muted = true;
      } catch (e) {
        console.error("Error in load start event:", e);
      }
    };

    const handleCanPlay = () => {
      try {
        if (debug) console.log("Can play event");
        setPlayerState(prev => ({ ...prev, isLoading: false }));
        setVideoIsReady(true);
        
        // Apply playback speed
        video.playbackRate = playbackSpeed;
        
        // Only attempt autoplay if specified
        if (autoPlay) {
          if (debug) console.log("Attempting autoplay");
          
          const playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              if (debug) console.log("Autoplay successful (muted)");
              
              // Show unmute button since autoplay is always muted
              setShowUnmuteButton(true);
              
              setPlayerState(prev => ({ 
                ...prev, 
                isPlaying: true,
                isMuted: true 
              }));
            }).catch(error => {
              if (debug) console.error('Autoplay failed:', error);
            });
          }
        }
      } catch (e) {
        console.error("Error in can play event:", e);
      }
    };

    const handleEnded = () => {
      try {
        if (debug) console.log("Video ended");
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
        if (debug) console.log("Waiting for data");
        setPlayerState(prev => ({ ...prev, isLoading: true }));
      } catch (e) {
        console.error("Error in waiting event:", e);
      }
    };

    const handlePlaying = () => {
      try {
        if (debug) console.log("Playing event");
        setPlayerState(prev => ({ ...prev, isLoading: false, isPlaying: true }));
      } catch (e) {
        console.error("Error in playing event:", e);
      }
    };

    // Helper to track buffered data
    const updateBuffered = () => {
      try {
        let buffered = 0;
        if (video.buffered.length > 0) {
          for (let i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= video.currentTime && 
                video.currentTime <= video.buffered.end(i)) {
              buffered = video.buffered.end(i) / video.duration * 100;
              break;
            }
          }
        }
        setPlayerState(prev => ({ ...prev, buffered }));
      } catch (e) {
        console.error("Error updating buffer:", e);
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
    video.addEventListener('progress', updateBuffered);

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
      video.removeEventListener('progress', updateBuffered);
    };
  }, [autoPlay, onEnded, onError, onProgress, playerState, playbackSpeed, debug]);

  // Apply playback speed when changed
  useEffect(() => {
    safeVideoOperation(video => {
      video.playbackRate = playbackSpeed;
    });
  }, [playbackSpeed, safeVideoOperation]);

  useEffect(() => {
    if (registerMethods) {
      registerMethods({
        seekTo: (time: number) => {
          safeVideoOperation(video => {
            video.currentTime = time;
          });
        }
      });
    }
  }, [registerMethods, safeVideoOperation]);
  
  // CRITICAL FIX: Reset cursor timeout function
  const resetCursorTimeout = useCallback(() => {
    // Show cursor and controls
    setHideCursor(false);
    setPlayerState(prev => ({ ...prev, showControls: true }));
    
    // Clear any existing timeouts
    if (cursorTimeout.current) {
      clearTimeout(cursorTimeout.current);
    }
    
    if (controlsTimeout.current) {
      clearTimeout(controlsTimeout.current);
    }
    
    // Set new timeouts
    if (playerState.isPlaying) {
      // Hide controls after 3 seconds
      controlsTimeout.current = setTimeout(() => {
        setPlayerState(prev => ({ ...prev, showControls: false }));
        setShowVolumeSlider(false);
        setShowSettings(false);
      }, 3000);
      
      // Hide cursor after 3 seconds - slightly longer than controls
      cursorTimeout.current = setTimeout(() => {
        setHideCursor(true);
      }, 3000);
    }
  }, [playerState.isPlaying]);

  // Controls and cursor visibility management
  useEffect(() => {
    const handleMouseMove = () => {
      resetCursorTimeout();
    };
    
    const handleMouseLeave = () => {
      if (playerState.isPlaying) {
        setPlayerState(prev => ({ ...prev, showControls: false }));
        setShowVolumeSlider(false);
        setShowSettings(false);
        setHideCursor(true);
      }
    };
    
    if (playerRef.current) {
      playerRef.current.addEventListener('mousemove', handleMouseMove);
      playerRef.current.addEventListener('mouseleave', handleMouseLeave);
    }

    // Set initial timeouts
    resetCursorTimeout();

    return () => {
      if (controlsTimeout.current) {
        clearTimeout(controlsTimeout.current);
      }
      
      if (cursorTimeout.current) {
        clearTimeout(cursorTimeout.current);
      }
      
      if (playerRef.current) {
        playerRef.current.removeEventListener('mousemove', handleMouseMove);
        playerRef.current.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, [playerState.isPlaying, resetCursorTimeout]);

  // Track fullscreen changes
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
      className={`relative w-full h-full bg-black overflow-hidden ${hideCursor ? 'cursor-none' : 'cursor-auto'}`}
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

      {/* Click Overlay */}
      <div 
        className="absolute inset-0 cursor-pointer z-60"
        style={{ height: '90%' }}
        onClick={handleVideoClick}
      />

      {/* Loading Overlay */}
      {playerState.isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-60 z-40">
          <div className="animate-spin w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full"></div>
        </div>
      )}

      {/* Error Overlay */}
      {playerState.error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80 z-50 text-white p-4">
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

      {/* Debug Overlay */}
      {debug && (
        <div className="absolute top-0 left-0 bg-black/80 text-white text-xs p-2 z-50">
          Volume: {playerState.volume.toFixed(2)} | Muted: {playerState.isMuted.toString()} | 
          Ready: {videoIsReady.toString()} | Interact: {userInteractedRef.current.toString()} |
          Dragging: {isDraggingVolumeRef.current.toString()}
        </div>
      )}

      {/* Big Play/Pause Button */}
      {(!playerState.isPlaying || playerState.showControls) && !playerState.isLoading && !playerState.error && (
        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
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

      {/* Controls Overlay */}
      <div 
        className={`absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/70 via-transparent to-black/70 
                  transition-opacity duration-300 z-40
                  ${playerState.showControls || !playerState.isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        {/* Movie Title */}
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
            />
            
            {/* Playback Progress */}
            <div 
              className="absolute h-full bg-primary-500 group-hover:bg-primary-400 rounded"
              style={{ width: `${(playerState.currentTime / playerState.duration) * 100 || 0}%` }}
            />
            
            {/* Scrubber Handle */}
            <div 
              className="absolute h-4 w-4 bg-primary-500 rounded-full -translate-x-1/2 -translate-y-1/4 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ 
                left: `${(playerState.currentTime / playerState.duration) * 100 || 0}%`,
                top: '50%'
              }}
            />
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
                  onClick={handleToggleMute}
                  onMouseEnter={() => setShowVolumeSlider(true)}
                  aria-label={playerState.isMuted ? 'Unmute' : 'Mute'}
                >
                  {playerState.isMuted || playerState.volume === 0 ? (
                    <SpeakerXMarkIcon className="w-6 h-6" />
                  ) : (
                    <SpeakerWaveIcon className="w-6 h-6" />
                  )}
                </button>
                
                {/* Volume Slider - with drag support */}
                <div 
                  className={`absolute bottom-full left-0 bg-gray-800/90 rounded px-3 py-2 mb-2 transition-all duration-200 
                           group-hover:opacity-100 group-hover:translate-y-0 
                           ${showVolumeSlider ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}
                  onMouseLeave={() => !isDraggingVolumeRef.current && setShowVolumeSlider(false)}
                >
                  <div 
                    ref={volumeBarRef}
                    className="w-24 h-1.5 bg-gray-600 cursor-pointer rounded"
                    onMouseDown={startVolumeDrag}
                  >
                    <div 
                      className="h-full bg-white rounded"
                      style={{ width: `${playerState.isMuted ? 0 : playerState.volume * 100}%` }}
                    />
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

      {/* "Unmute" Button */}
      {showUnmuteButton && playerState.isPlaying && (
        <div className="absolute bottom-20 right-4 z-50">
          <button
            className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-full flex items-center shadow-lg transition-colors"
            onClick={() => {
              if (volumeChangeInProgressRef.current) return;
              volumeChangeInProgressRef.current = true;
              
              userInteractedRef.current = true;
              
              safeVideoOperation(video => {
                video.muted = false;
                video.volume = Math.max(0.1, playerState.volume);
              });
              
              setPlayerState(prev => ({ ...prev, isMuted: false }));
              setShowUnmuteButton(false);
              
              setTimeout(() => {
                volumeChangeInProgressRef.current = false;
              }, 100);
              
              // Reset cursor timeout
              resetCursorTimeout();
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