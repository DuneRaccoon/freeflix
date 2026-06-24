"use client";
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
import { PlayerState, StreamHealthState, TorrentCandidate } from '@/types';
import BufferingAnimation from '@/components/streaming/BufferingAnimation';
import { cn } from '@/lib/cn';

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
  downloadProgress?: number; // Optional prop to indicate download progress
  // --- W2-declared stream-health / source-switch seam (W6 implements behavior) ---
  // Canonical contract; snake_case StreamHealthState. Declared here so the page
  // can pass them through; left UNCONSUMED until W6 (unused optional = not an error).
  streamHealth?: StreamHealthState;
  sources?: TorrentCandidate[];
  currentSourceId?: string;
  onSelectSource?: (candidate: TorrentCandidate) => void;
  onRecoveryExhausted?: () => void;
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
  registerMethods,
  downloadProgress = 100, // Default to 100% (fully downloaded) if not provided
  streamHealth,
  onRecoveryExhausted,
  sources,
  currentSourceId,
  onSelectSource
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
  const bufferingRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPlayheadPositionRef = useRef<number>(0);
  const stallTimeRef = useRef<number | null>(null);
  const maxStallTime = 10000; // Maximum time (ms) to wait before showing stall warning
  // Bounded exponential backoff recovery (1·2·4·8s, capped). Each attempt re-seeks
  // currentTime to force the browser to re-issue the Range request to the backend.
  const recoveryAttemptRef = useRef<number>(0);
  const recoveryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const RECOVERY_BACKOFF_MS = [1000, 2000, 4000, 8000];
  const MAX_RECOVERY_ATTEMPTS = RECOVERY_BACKOFF_MS.length;

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
  const [showSources, setShowSources] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [videoIsReady, setVideoIsReady] = useState(false);
  const [showUnmuteButton, setShowUnmuteButton] = useState(false);
  const [hideCursor, setHideCursor] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isStalled, setIsStalled] = useState(false);
  const [showBufferingMessage, setShowBufferingMessage] = useState(false);
  // PiP state
  const [isPiP, setIsPiP] = useState(false);

  /**
   * A utility hook that safely performs operations on the video element with error handling.
   */
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

  // Determine if a specific time is buffered
  const isTimeBuffered = useCallback((time: number): boolean => {
    const video = videoRef.current;
    if (!video || !video.buffered || video.buffered.length === 0) return false;

    // Check if the time is within any of the buffered ranges
    for (let i = 0; i < video.buffered.length; i++) {
      if (time >= video.buffered.start(i) && time <= video.buffered.end(i)) {
        return true;
      }
    }

    return false;
  }, []);

  // Get the buffered range ahead of current time
  const getBufferedAhead = useCallback((): number => {
    const video = videoRef.current;
    if (!video || !video.buffered || video.buffered.length === 0) return 0;

    const currentTime = video.currentTime;
    let maxBufferedEnd = currentTime;

    // Find the buffered range that includes current time
    for (let i = 0; i < video.buffered.length; i++) {
      if (currentTime >= video.buffered.start(i) && currentTime <= video.buffered.end(i)) {
        maxBufferedEnd = Math.max(maxBufferedEnd, video.buffered.end(i));
      }
    }

    return maxBufferedEnd - currentTime;
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
        // Check if the current time is buffered before playing
        const isCurrentTimeBuffered = isTimeBuffered(video.currentTime);
        if (isCurrentTimeBuffered || downloadProgress >= 5) {
          video.play().catch(err => console.error("Play error:", err));
        } else {
          // Show buffering message if trying to play unbuffered content
          setShowBufferingMessage(true);
          setIsBuffering(true);
          // Try to play after a short delay
          setTimeout(() => {
            video.play().catch(err => {
              console.error("Delayed play error:", err);
              setIsBuffering(false);
            });
          }, 1000);
        }
      } else {
        if (debug) console.log("Video is playing, pausing");
        video.pause();
      }
    });

    // Reset the cursor hide timer
    resetCursorTimeout();
  }, [safeVideoOperation, isTimeBuffered, downloadProgress, debug]);

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

  // Toggle Picture-in-Picture
  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (!document.pictureInPictureEnabled) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (e) {
      console.error("Error toggling PiP:", e);
    }

    resetCursorTimeout();
  }, []);

  // Improved click handler with proper double-click detection
  const handleVideoClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

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

      // Check if the new time is within a buffered range
      const isNewTimeBuffered = isTimeBuffered(newTime);

      // Only allow seeking to buffered regions or if we have sufficient download progress
      if (isNewTimeBuffered || downloadProgress > (newTime / video.duration) * 100) {
        video.currentTime = newTime;
      } else {
        // Show buffering message for unbuffered regions
        setShowBufferingMessage(true);
        setIsBuffering(true);

        // Still try to seek but be prepared for buffering
        video.currentTime = newTime;
      }
    });

    // Reset the cursor hide timer
    resetCursorTimeout();
  }, [safeVideoOperation, isTimeBuffered, downloadProgress]);

  // Volume control with drag support
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

  // Handle progress bar click with buffering awareness
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !progressBarRef.current) return;

    try {
      e.preventDefault();
      e.stopPropagation();

      const rect = progressBarRef.current.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      const newTime = pos * video.duration;

      // Check if the new time point is buffered
      const isNewTimeBuffered = isTimeBuffered(newTime);

      // Only seek if the time is buffered or we have sufficient download progress
      if (isNewTimeBuffered || downloadProgress > pos * 100) {
        video.currentTime = newTime;
      } else {
        // Indicate buffering for unbuffered regions
        setShowBufferingMessage(true);
        setIsBuffering(true);

        // Try to seek but prepare for buffering
        video.currentTime = newTime;
      }
    } catch (e) {
      console.error("Error handling progress click:", e);
    }

    // Reset the cursor hide timer
    resetCursorTimeout();
  }, [isTimeBuffered, downloadProgress]);

  // Bounded exponential-backoff recovery: re-seek to currentTime so the browser
  // re-requests the active Range from the backend. After MAX_RECOVERY_ATTEMPTS we
  // give up and let the page surface a source switch via onRecoveryExhausted.
  const attemptRecovery = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (recoveryAttemptRef.current >= MAX_RECOVERY_ATTEMPTS) {
      if (debug) console.log('Recovery exhausted after', MAX_RECOVERY_ATTEMPTS, 'attempts');
      onRecoveryExhausted?.();
      return;
    }

    const delay = RECOVERY_BACKOFF_MS[recoveryAttemptRef.current];
    recoveryAttemptRef.current += 1;
    if (debug) console.log(`Recovery attempt ${recoveryAttemptRef.current} in ${delay}ms`);

    setIsBuffering(true);
    setShowBufferingMessage(true);

    if (recoveryTimeoutRef.current) clearTimeout(recoveryTimeoutRef.current);
    recoveryTimeoutRef.current = setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      try {
        // Re-seek to the current position (nudge) to force a fresh Range request.
        const t = v.currentTime;
        v.currentTime = Math.max(0, t);
        v.play().catch(err => {
          if (debug) console.error('Recovery play failed:', err);
        });
      } catch (e) {
        if (debug) console.error('Recovery seek failed:', e);
      }
    }, delay);
  }, [debug, onRecoveryExhausted]);

  // Helper to detect stalled playback
  const checkForStall = useCallback(() => {
    const video = videoRef.current;
    if (!video || !playerState.isPlaying) return;

    // Compare current position with last known position
    const currentPosition = video.currentTime;
    const hasMoved = Math.abs(currentPosition - lastPlayheadPositionRef.current) > 0.01;

    if (!hasMoved && !video.paused && !video.ended) {
      // Video is stalled
      if (stallTimeRef.current === null) {
        // Start tracking stall time
        stallTimeRef.current = Date.now();
        setIsBuffering(true);
      } else {
        // Check if stall has lasted too long
        const stallDuration = Date.now() - stallTimeRef.current;

        if (stallDuration > 2000 && !showBufferingMessage) {
          // After 2 seconds, show buffering message
          setShowBufferingMessage(true);
        }

        if (stallDuration > maxStallTime && !isStalled) {
          // After max stall time (10 seconds by default): surface the warning AND
          // kick off the bounded backoff recovery (re-seek), not just an overlay.
          setIsStalled(true);
          attemptRecovery();
        }
      }
    } else {
      // Reset stall tracking if playhead moved
      lastPlayheadPositionRef.current = currentPosition;

      if (stallTimeRef.current !== null) {
        // Clear stall state
        stallTimeRef.current = null;
        setIsBuffering(false);
        setShowBufferingMessage(false);
        setIsStalled(false);
      }
    }
  }, [playerState.isPlaying, isStalled, attemptRecovery]);

  // Set up stall detection interval
  useEffect(() => {
    const checkInterval = setInterval(checkForStall, 1000);
    return () => clearInterval(checkInterval);
  }, [checkForStall]);

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
    stallTimeRef.current = null;
    lastPlayheadPositionRef.current = 0;
    setIsBuffering(false);
    setShowBufferingMessage(false);
    setIsStalled(false);
    recoveryAttemptRef.current = 0;

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

      // Clear any buffering retry timeouts
      if (bufferingRetryTimeoutRef.current) {
        clearTimeout(bufferingRetryTimeoutRef.current);
      }
      if (recoveryTimeoutRef.current) {
        clearTimeout(recoveryTimeoutRef.current);
      }
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

  // Set up video event listeners with enhanced buffering handling
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

        // Update last known position for stall detection
        lastPlayheadPositionRef.current = video.currentTime;

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
        setPlayerState(prev => ({ ...prev, isPlaying: true }));

        // Only hide the loading indicator if we're not in a buffering state
        if (!isBuffering) {
          setPlayerState(prev => ({ ...prev, isLoading: false }));
        }
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
        setIsBuffering(true);
        setShowBufferingMessage(false);

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
        setIsBuffering(false);
        setShowBufferingMessage(false);

        // Apply playback speed
        video.playbackRate = playbackSpeed;

        // Attempt autoplay — WITH SOUND first. The user pressed Play to get here,
        // and SPA navigation preserves the page's user activation, so the browser
        // normally allows sound-on autoplay. If it's blocked, fall back to muted
        // (so it still plays) and surface the unmute affordance.
        if (autoPlay) {
          if (debug) console.log("Attempting autoplay");

          // Respect an explicit user mute; otherwise start unmuted at the set volume.
          video.muted = playerState.isMuted;
          video.volume = playerState.volume;

          const playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              if (debug) console.log("Autoplay started, muted =", video.muted);
              setShowUnmuteButton(video.muted);
              setPlayerState(prev => ({
                ...prev,
                isPlaying: true,
                isMuted: video.muted,
              }));
            }).catch(error => {
              if (debug) console.error('Sound-on autoplay blocked; retrying muted:', error);
              // Browser blocked autoplay with sound → mute and retry so it still plays.
              video.muted = true;
              video.play().then(() => {
                setShowUnmuteButton(true);
                setPlayerState(prev => ({ ...prev, isPlaying: true, isMuted: true }));
              }).catch(err => {
                if (debug) console.error('Muted autoplay also failed:', err);
              });
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
        // Don't treat network errors during active downloads as fatal
        if (downloadProgress < 100 && (video.error?.code === 2 || video.error?.code === 4)) {
          if (debug) console.log("Network error during download, recovering via backoff");
          // Bounded exponential backoff with re-seek instead of a single 2s retry.
          attemptRecovery();
        } else {
          // Handle other errors normally
          const errorCode = video.error ? video.error.code : "unknown";
          const errorMessage = `Video playback error (${errorCode}): ${video.error ? video.error.message : "Unknown error"}`;
          console.error("Video error:", errorMessage, video.error);

          setPlayerState(prev => ({
            ...prev,
            isLoading: false,
            error: errorMessage
          }));

          if (onError) onError(errorMessage);
        }
      } catch (e) {
        console.error("Error in error event:", e);

        // Fallback error handling
        if (onError) onError("An unexpected error occurred during playback");
      }
    };

    const handleWaiting = () => {
      try {
        if (debug) console.log("Waiting for data");

        // Check if we're near the end of the buffered region
        const bufferedAhead = getBufferedAhead();
        if (debug) console.log(`Buffered ahead: ${bufferedAhead.toFixed(2)} seconds`);

        // If we have a decent buffer, don't show loading yet (prevents flickering)
        if (bufferedAhead < 0.5) {
          setIsBuffering(true);
          setPlayerState(prev => ({ ...prev, isLoading: true }));

          // Show buffering message after a short delay if still buffering
          setTimeout(() => {
            if (isBuffering) {
              setShowBufferingMessage(true);
            }
          }, 500);
        }
      } catch (e) {
        console.error("Error in waiting event:", e);
      }
    };

    const handlePlaying = () => {
      try {
        if (debug) console.log("Playing event");
        setPlayerState(prev => ({ ...prev, isLoading: false, isPlaying: true }));
        setIsBuffering(false);
        setShowBufferingMessage(false);
        setIsStalled(false);
        stallTimeRef.current = null;
        // Healthy playback resumed → reset the backoff ladder.
        recoveryAttemptRef.current = 0;
        if (recoveryTimeoutRef.current) {
          clearTimeout(recoveryTimeoutRef.current);
          recoveryTimeoutRef.current = null;
        }
      } catch (e) {
        console.error("Error in playing event:", e);
      }
    };

    // Helper to track buffered data with improved accuracy
    const updateBuffered = () => {
      try {
        let bufferedEnd = 0;
        let currentTime = video.currentTime;

        if (video.buffered.length > 0) {
          // Find the buffered range that contains the current playback position
          for (let i = 0; i < video.buffered.length; i++) {
            if (currentTime >= video.buffered.start(i) && currentTime <= video.buffered.end(i)) {
              bufferedEnd = video.buffered.end(i);
              break;
            }
          }
        }

        // Calculate buffer percentage relative to video duration
        const buffered = video.duration ? (bufferedEnd / video.duration) * 100 : 0;

        setPlayerState(prev => ({ ...prev, buffered }));

        // If we now have sufficient buffer, reset buffering states
        if (bufferedEnd - currentTime > 5) { // If we have at least 5 seconds buffered ahead
          setIsBuffering(false);
          setShowBufferingMessage(false);
        }
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
  }, [autoPlay, onEnded, onError, onProgress, playerState, playbackSpeed, debug, isBuffering, getBufferedAhead]);

  // Apply playback speed when changed
  useEffect(() => {
    safeVideoOperation(video => {
      video.playbackRate = playbackSpeed;
    });
  }, [playbackSpeed, safeVideoOperation]);

  // Register external methods for the parent component
  useEffect(() => {
    if (registerMethods) {
      registerMethods({
        seekTo: (time: number) => {
          safeVideoOperation(video => {
            // Check if seeking to a buffered region
            const timeBuffered = isTimeBuffered(time);

            if (timeBuffered || downloadProgress > (time / video.duration) * 100) {
              video.currentTime = time;
            } else {
              // Indicate buffering for unbuffered seeks
              setIsBuffering(true);
              setShowBufferingMessage(true);

              // Still perform the seek but be prepared for buffering
              video.currentTime = time;
            }
          });
        }
      });
    }
  }, [registerMethods, safeVideoOperation, isTimeBuffered, downloadProgress]);

  // PiP event listener for external exit
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleLeavePiP = () => setIsPiP(false);
    const handleEnterPiP = () => setIsPiP(true);
    video.addEventListener('leavepictureinpicture', handleLeavePiP);
    video.addEventListener('enterpictureinpicture', handleEnterPiP);
    return () => {
      video.removeEventListener('leavepictureinpicture', handleLeavePiP);
      video.removeEventListener('enterpictureinpicture', handleEnterPiP);
    };
  }, []);

  // Reset cursor timeout function
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

    // Set new timeouts (only when in fullscreen mode)
    if (playerState.isPlaying && playerState.isFullscreen) {
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

  // Ensure controls become visible when playback starts
  useEffect(() => {
    if (playerState.isPlaying) {
      resetCursorTimeout();
    }
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

  // Keep track of clicks for double-click detection
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastClickTimeRef = useRef<number>(0);

  // Computed values for the scrubber
  const playedPct = playerState.duration > 0
    ? (playerState.currentTime / playerState.duration) * 100
    : 0;

  const controlsVisible = playerState.showControls || !playerState.isPlaying;

  // Health-aware buffering copy: a dead/0-peer swarm reads differently from a slow one.
  const healthMessage: string | null = (() => {
    if (!streamHealth) return null;
    if (streamHealth.health === 'dead' || streamHealth.num_peers === 0) {
      return 'Waiting for peers (0 connected)';
    }
    if (isBuffering || isStalled) {
      return `Buffering — slow connection (${streamHealth.num_peers} ${
        streamHealth.num_peers === 1 ? 'peer' : 'peers'
      })`;
    }
    return null;
  })();

  return (
    <div
      ref={playerRef}
      id="ff-player"
      className={cn(
        'relative w-full h-full bg-ink overflow-hidden isolate select-none',
        hideCursor ? 'cursor-none' : 'cursor-auto',
        // paused warmth class
        !playerState.isPlaying ? 'is-paused' : ''
      )}
      tabIndex={0}
      onMouseMove={() => resetCursorTimeout()}
      onMouseMoveCapture={() => resetCursorTimeout()}
      onMouseEnter={() => {
        setPlayerState(prev => ({ ...prev, showControls: true }));
        setHideCursor(false);
      }}
      onMouseLeave={() => {
        if (playerState.isPlaying) {
          setPlayerState(prev => ({ ...prev, showControls: false }));
          setShowVolumeSlider(false);
          setShowSettings(false);
          setHideCursor(true);
        }
      }}
      onClick={handleVideoClick}
      aria-label="Video player"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="relative z-10 w-full h-full object-contain"
        preload="auto"
        playsInline
        onClick={handleVideoClick}
      />

      {/* ---- Paused warm vignette (z-index below controls, above video) ---- */}
      {/* Rendered always, opacity toggled via CSS .is-paused class */}
      <div
        className="ffp-pauseveil absolute inset-0 z-20 pointer-events-none"
        aria-hidden="true"
        style={{
          opacity: playerState.isPlaying ? 0 : 1,
          transition: 'opacity 0.55s ease',
          background: [
            'radial-gradient(72% 56% at 50% 40%, rgba(201,168,106,.14), transparent 72%)',
            'radial-gradient(125% 100% at 50% 46%, transparent 44%, rgba(7,7,9,.52) 80%, rgba(4,4,6,.82) 100%)',
            'linear-gradient(0deg, rgba(7,7,9,.46), transparent 58%)',
          ].join(', '),
        }}
      />

      {/* ---- Subtle grain texture ---- */}
      <div
        className="absolute inset-0 z-20 pointer-events-none"
        aria-hidden="true"
        style={{
          opacity: 0.045,
          mixBlendMode: 'overlay',
          backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        }}
      />

      {/* Loading/Buffering Overlay */}
      {(playerState.isLoading || isBuffering) && (
        <div className="absolute inset-0 z-30 pointer-events-none">
          <BufferingAnimation downloadProgress={downloadProgress} />
          {healthMessage && (
            <div className="absolute inset-x-0 bottom-[18%] flex justify-center px-6">
              <span
                data-testid="player-health-message"
                className={cn(
                  'rounded-full border px-4 py-1.5 text-xs font-medium backdrop-blur-md',
                  streamHealth?.health === 'dead' || streamHealth?.num_peers === 0
                    ? 'border-danger/50 text-danger'
                    : 'border-hairline text-text/90'
                )}
                style={{ background: 'rgba(17,17,19,.6)' }}
              >
                {healthMessage}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Error Overlay */}
      {playerState.error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink/80 z-50 text-text p-4">
          <div className="text-danger text-xl mb-2 font-display font-light">Playback Error</div>
          <p className="text-center mb-6 text-muted text-sm">{playerState.error}</p>
          <button
            className="px-6 py-2.5 rounded-full border border-gold/50 text-gold hover:bg-gold/10 text-sm font-medium transition-colors"
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
        <div className="absolute top-0 left-0 bg-ink/80 text-text text-xs p-2 z-20 font-mono">
          Volume: {playerState.volume.toFixed(2)} | Muted: {playerState.isMuted.toString()} |
          Ready: {videoIsReady.toString()} | Buffering: {isBuffering.toString()} |
          Download: {downloadProgress.toFixed(1)}% | Stalled: {isStalled.toString()} |
          Retry: {recoveryAttemptRef.current}/{MAX_RECOVERY_ATTEMPTS}
          {streamHealth && ` | Seeds: ${streamHealth.num_seeds} | Peers: ${streamHealth.num_peers} | Health: ${streamHealth.health}`}
        </div>
      )}

      {/* ================= TOP OVERLAY ================= */}
      <div
        className={cn(
          'absolute top-0 left-0 right-0 z-40 flex items-start gap-4',
          'px-7 pt-5 pb-14',
          'transition-opacity duration-300',
          controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        style={{
          background: 'linear-gradient(to bottom, rgba(10,10,11,.78) 0%, rgba(10,10,11,.42) 45%, rgba(10,10,11,0) 100%)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Title block */}
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          {movieTitle && (
            <h2
              className="font-display font-light text-text drop-shadow-md"
              style={{ fontSize: 'clamp(1.25rem, 2.5vw, 1.875rem)', lineHeight: 1, letterSpacing: '-0.02em' }}
            >
              {movieTitle}
            </h2>
          )}
          {subtitle && (
            <p className="text-text/70 text-sm drop-shadow-md">{subtitle}</p>
          )}
          {/* Streaming chip — shown when still downloading */}
          {downloadProgress < 100 && (
            <div
              data-testid="streaming-chip"
              className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full border border-hairline text-text text-xs font-medium"
              style={{
                background: 'rgba(17,17,19,.55)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
              }}
            >
              {/* Pulsing gold dot */}
              <span
                className="relative flex-shrink-0 w-1.5 h-1.5 rounded-full bg-gold"
                style={{
                  boxShadow: '0 0 0 0 rgba(201,168,106,.55)',
                  animation: 'ffp-pulse 2.2s ease-out infinite',
                }}
                aria-hidden="true"
              />
              Streaming
              <span className="text-muted">·</span>
              <b className="text-gold-lite font-semibold">{Math.round(downloadProgress)}% downloaded</b>
            </div>
          )}
          {/* Live swarm health (seeds/peers/rate) */}
          {streamHealth && downloadProgress < 100 && (
            <div
              data-testid="swarm-health-chip"
              className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full border border-hairline text-text text-xs"
              style={{ background: 'rgba(17,17,19,.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            >
              <span
                className={cn(
                  'flex-shrink-0 w-1.5 h-1.5 rounded-full',
                  streamHealth.health === 'healthy' ? 'bg-[#4caf6a]'
                    : streamHealth.health === 'low' ? 'bg-gold'
                    : 'bg-muted'
                )}
                aria-hidden="true"
              />
              <span className="text-muted">{streamHealth.num_seeds} seeds · {streamHealth.num_peers} peers</span>
              <span className="text-muted">·</span>
              <b className="text-text/90 font-semibold tabular-nums">
                {(streamHealth.download_rate / 1_000_000).toFixed(1)} MB/s
              </b>
            </div>
          )}
        </div>
      </div>

      {/* ================= CENTER TRANSPORT ================= */}
      {!playerState.isLoading && !isBuffering && !playerState.error && (
        <div
          className={cn(
            'absolute inset-0 z-30 flex items-center justify-center gap-12 pointer-events-none',
            'transition-opacity duration-300',
            controlsVisible ? 'opacity-100' : 'opacity-0'
          )}
        >
          {/* Skip back 10s */}
          <button
            className="pointer-events-auto relative flex items-center justify-center w-14 h-14 rounded-full border border-hairline text-text cursor-pointer transition-transform duration-200 hover:scale-105"
            style={{
              background: 'rgba(17,17,19,.32)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={e => { e.stopPropagation(); skip(-10); }}
            aria-label="Back 10 seconds"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
              <path d="M3 4v6h6"/><path d="M3.5 10a9 9 0 1 1 .5 5"/>
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[8.5px] font-semibold pt-0.5">10</span>
          </button>

          {/* Big play/pause */}
          <button
            className="pointer-events-auto flex items-center justify-center w-[88px] h-[88px] rounded-full border border-text/[.18] bg-text/95 text-ink cursor-pointer transition-transform duration-200 hover:scale-105"
            style={{
              boxShadow: '0 16px 50px -10px rgba(0,0,0,.7), inset 0 0 0 1px rgba(255,255,255,.4)',
            }}
            onClick={e => { e.stopPropagation(); togglePlay(); }}
            aria-label={playerState.isPlaying ? 'Pause' : 'Play'}
            aria-pressed={playerState.isPlaying}
          >
            {playerState.isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                <rect x="6" y="5" width="4" height="14" rx="1"/>
                <rect x="14" y="5" width="4" height="14" rx="1"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 ml-[3px]">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          {/* Skip forward 10s */}
          <button
            className="pointer-events-auto relative flex items-center justify-center w-14 h-14 rounded-full border border-hairline text-text cursor-pointer transition-transform duration-200 hover:scale-105"
            style={{
              background: 'rgba(17,17,19,.32)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={e => { e.stopPropagation(); skip(10); }}
            aria-label="Forward 10 seconds"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
              <path d="M21 4v6h-6"/><path d="M20.5 10a9 9 0 1 0-.5 5"/>
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[8.5px] font-semibold pt-0.5">10</span>
          </button>
        </div>
      )}

      {/* ================= BOTTOM BAR ================= */}
      <div
        className={cn(
          'absolute left-0 right-0 bottom-0 z-40 px-7 pt-16 pb-5',
          'transition-opacity duration-300',
          controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        style={{
          background: 'linear-gradient(to top, rgba(10,10,11,.92) 8%, rgba(10,10,11,.6) 55%, rgba(10,10,11,0) 100%)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Scrubber */}
        <div
          ref={progressBarRef}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(playerState.duration)}
          aria-valuenow={Math.round(playerState.currentTime)}
          aria-valuetext={`${formatTime(playerState.currentTime)} of ${formatTime(playerState.duration)}`}
          className="relative h-[18px] flex items-center cursor-pointer group"
          onClick={handleProgressClick}
          onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
            const video = videoRef.current;
            if (!video) return;
            switch (e.key) {
              case 'ArrowRight':
                e.preventDefault();
                skip(10);
                break;
              case 'ArrowLeft':
                e.preventDefault();
                skip(-10);
                break;
              case 'Home':
                e.preventDefault();
                video.currentTime = 0;
                resetCursorTimeout();
                break;
              case 'End':
                e.preventDefault();
                // Seek near-end (1 second before end to avoid auto-advancing immediately)
                if (video.duration > 0) {
                  video.currentTime = Math.max(0, video.duration - 1);
                }
                resetCursorTimeout();
                break;
            }
          }}
        >
          {/* Track */}
          <div className="relative w-full h-1 rounded-full overflow-visible" style={{ background: 'rgba(244,241,234,.16)' }}>
            {/* Buffered */}
            <div
              data-testid="buffered-bar"
              className="absolute left-0 top-0 bottom-0 rounded-full"
              style={{ width: `${playerState.buffered}%`, background: 'rgba(244,241,234,.34)' }}
            />
            {/* Played — gold */}
            <div
              data-testid="played-bar"
              className="absolute left-0 top-0 bottom-0 rounded-full"
              style={{
                width: `${playedPct}%`,
                background: 'linear-gradient(90deg, #C9A86A 0%, #E7D6AE 100%)',
              }}
            />
            {/* Knob */}
            <div
              className="absolute top-1/2 w-3.5 h-3.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              style={{
                left: `${playedPct}%`,
                transform: 'translate(-50%, -50%)',
                background: '#E7D6AE',
                boxShadow: '0 0 0 4px rgba(201,168,106,.22), 0 2px 6px rgba(0,0,0,.6)',
              }}
            />
          </div>
        </div>

        {/* Editorial hairline */}
        <div
          className="h-px my-3"
          style={{ background: 'linear-gradient(90deg, rgba(244,241,234,0) 0%, rgba(244,241,234,.12) 50%, rgba(244,241,234,0) 100%)' }}
        />

        {/* Controls row */}
        <div className="flex items-center gap-4">
          {/* Play/Pause (small) */}
          <button
            className="inline-flex items-center justify-center text-text hover:text-gold-lite transition-colors p-1.5 rounded-lg"
            onClick={togglePlay}
            aria-label={playerState.isPlaying ? 'Pause' : 'Play'}
            aria-pressed={playerState.isPlaying}
          >
            {playerState.isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                <rect x="6" y="5" width="4" height="14" rx="1"/>
                <rect x="14" y="5" width="4" height="14" rx="1"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 ml-[2px]">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          {/* Volume */}
          <div className="flex items-center gap-2.5 group/vol relative">
            <button
              className="inline-flex items-center justify-center text-text hover:text-gold-lite transition-colors p-0"
              onClick={handleToggleMute}
              onMouseEnter={() => setShowVolumeSlider(true)}
              aria-label={playerState.isMuted ? 'Unmute' : 'Mute'}
            >
              {playerState.isMuted || playerState.volume === 0 ? (
                <SpeakerXMarkIcon className="w-5 h-5" />
              ) : (
                <SpeakerWaveIcon className="w-5 h-5" />
              )}
            </button>

            {/* Volume track */}
            <div
              ref={volumeBarRef}
              className={cn(
                'relative h-1 rounded-full cursor-pointer transition-all duration-200',
                showVolumeSlider ? 'w-22 opacity-100' : 'w-0 opacity-0 pointer-events-none group-hover/vol:w-22 group-hover/vol:opacity-100'
              )}
              style={{ width: showVolumeSlider ? '88px' : undefined, background: 'rgba(244,241,234,.16)' }}
              onMouseDown={startVolumeDrag}
              onMouseLeave={() => !isDraggingVolumeRef.current && setShowVolumeSlider(false)}
            >
              <div
                className="absolute left-0 top-0 bottom-0 rounded-full"
                style={{ width: `${playerState.isMuted ? 0 : playerState.volume * 100}%`, background: 'rgba(244,241,234,.7)' }}
              />
              <div
                className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-text"
                style={{
                  left: `${playerState.isMuted ? 0 : playerState.volume * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 1px 4px rgba(0,0,0,.5)',
                }}
              />
            </div>
          </div>

          {/* Time display */}
          <div className="text-text text-xs tabular-nums whitespace-nowrap" style={{ letterSpacing: '.03em' }}>
            <span className="font-semibold">{formatTime(playerState.currentTime)}</span>
            <span className="text-muted mx-1">/</span>
            <span className="text-muted">{formatTime(playerState.duration)}</span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right cluster */}
          <div className="flex items-center gap-2.5">
            {/* Speed pill */}
            <div className="relative">
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-hairline text-text text-xs font-semibold transition-colors hover:border-gold/40 hover:text-gold-lite"
                style={{ background: 'rgba(22,22,26,.4)', letterSpacing: '.03em' }}
                onClick={() => setShowSettings(!showSettings)}
                aria-label="Playback speed"
              >
                <span className="text-[9px] text-muted uppercase tracking-widest mr-0.5">Speed</span>
                {playbackSpeed === 1 ? '1×' : `${playbackSpeed}×`}
              </button>

              {/* Speed menu */}
              {showSettings && (
                <div
                  className="absolute bottom-full right-0 mb-2 min-w-[110px] rounded-xl border border-hairline py-1.5 z-50"
                  style={{ background: 'rgba(22,22,26,.95)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
                >
                  <div className="px-3 py-1 text-[10px] uppercase tracking-widest text-muted">Speed</div>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => (
                    <button
                      key={speed}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-surface-2',
                        playbackSpeed === speed ? 'text-gold font-semibold' : 'text-text'
                      )}
                      onClick={() => {
                        setPlaybackSpeed(speed);
                        setShowSettings(false);
                      }}
                    >
                      {speed === 1 ? 'Normal' : `${speed}×`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Audio/CC — GATED (aspirational) */}
            <button
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-hairline text-text transition-colors opacity-50 cursor-not-allowed"
              style={{ background: 'rgba(22,22,26,.34)' }}
              aria-label="Audio and subtitles (coming soon)"
              aria-disabled="true"
              title="Coming soon — no subtitle/audio tracks yet"
              tabIndex={-1}
              onClick={e => e.stopPropagation()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-[15px] h-[15px]">
                <rect x="2" y="5" width="20" height="14" rx="2.5"/>
                <path d="M6 12h3.5M6 15h2"/>
                <path d="M14 12h4M14 15h2.5"/>
              </svg>
              <span className="sr-only">Soon</span>
            </button>

            {/* Source / quality switcher — lists WS1 alternatives with health */}
            {sources && sources.length > 0 ? (
              <div className="relative" onClick={e => e.stopPropagation()}>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-hairline text-text text-xs font-semibold transition-colors hover:border-gold/40 hover:text-gold-lite"
                  style={{ background: 'rgba(22,22,26,.4)', letterSpacing: '.03em' }}
                  onClick={() => setShowSources(s => !s)}
                  aria-label="Switch source or quality"
                  aria-expanded={showSources}
                  data-testid="source-switcher-button"
                >
                  <span className="text-[9px] text-muted uppercase tracking-widest mr-0.5">Source</span>
                  {sources.find(s => s.source_id === currentSourceId)?.quality || 'Auto'}
                </button>

                {showSources && (
                  <div
                    className="absolute bottom-full right-0 mb-2 min-w-[240px] max-h-[280px] overflow-y-auto rounded-xl border border-hairline py-1.5 z-50"
                    style={{ background: 'rgba(22,22,26,.97)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
                    data-testid="source-switcher-menu"
                  >
                    <div className="px-3 py-1 text-[10px] uppercase tracking-widest text-muted">Sources</div>
                    {sources.map((s: TorrentCandidate) => (
                      <button
                        key={s.source_id}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-surface-2 text-left',
                          s.source_id === currentSourceId ? 'text-gold font-semibold' : 'text-text'
                        )}
                        onClick={() => {
                          setShowSources(false);
                          if (s.source_id !== currentSourceId) onSelectSource?.(s);
                        }}
                        data-testid="source-option"
                      >
                        {/* Health dot — same palette as SourcePicker's SeedDot */}
                        <span
                          className={cn(
                            'flex-shrink-0 w-2 h-2 rounded-full',
                            s.health === 'healthy' ? 'bg-[#4caf6a]'
                              : s.health === 'low' ? 'bg-gold'
                              : 'bg-muted'
                          )}
                          aria-hidden="true"
                        />
                        <span className="font-semibold">{s.quality || 'SD'}</span>
                        {s.is_season_pack && (
                          <span className="text-[9px] uppercase tracking-widest text-muted border border-hairline rounded px-1">Pack</span>
                        )}
                        <span className="flex-1" />
                        <span className="text-muted tabular-nums">{s.seeds} sd</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              // No alternatives available → keep the gated informational pill.
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-hairline text-text text-xs font-semibold opacity-50 cursor-not-allowed"
                style={{ background: 'rgba(22,22,26,.4)', letterSpacing: '.03em' }}
                aria-label="Quality (informational)"
                aria-disabled="true"
                title="Informational — quality is fixed per torrent"
                tabIndex={-1}
                onClick={e => e.stopPropagation()}
              >
                <span className="text-[9px] text-muted uppercase tracking-widest mr-0.5">HD</span>
                {sources?.find(s => s.source_id === currentSourceId)?.quality || '1080p'}
              </button>
            )}

            {/* Picture-in-Picture */}
            {typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (
              <button
                className={cn(
                  'inline-flex items-center justify-center w-9 h-9 rounded-lg border border-hairline text-text transition-colors hover:border-gold/40',
                  isPiP ? 'text-gold border-gold/55 bg-gold/[.08]' : ''
                )}
                style={{ background: isPiP ? undefined : 'rgba(22,22,26,.34)' }}
                onClick={togglePiP}
                aria-label={isPiP ? 'Exit picture in picture' : 'Picture in picture'}
                aria-pressed={isPiP}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <rect x="3" y="4" width="18" height="14" rx="2.5"/>
                  <rect x="12.5" y="11" width="7" height="5" rx="1.2" fill="currentColor" stroke="none"/>
                </svg>
              </button>
            )}

            {/* Fullscreen */}
            <button
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-hairline text-text transition-colors hover:border-gold/40"
              style={{ background: 'rgba(22,22,26,.34)' }}
              onClick={toggleFullscreen}
              aria-label={playerState.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {playerState.isFullscreen ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
