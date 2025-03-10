// frontend/src/components/player/VideoPlayer.tsx
'use client';

import React, { useRef, useState, useEffect } from 'react';
import { 
  PlayIcon, 
  PauseIcon, 
  SpeakerWaveIcon, 
  SpeakerXMarkIcon, 
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  ForwardIcon,
  BackwardIcon
} from '@heroicons/react/24/solid';
import Progress from '@/components/ui/Progress';
import { PlayerState } from '@/types';
import { formatTime } from '@/utils/format';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  movieTitle?: string;
  subtitle?: string;
  autoPlay?: boolean;
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
  onEnded,
  onError,
  onProgress
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const controlsTimeout = useRef<NodeJS.Timeout | null>(null);
  
  const [playerState, setPlayerState] = useState<PlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: 1,
    isMuted: false,
    isFullscreen: false,
    showControls: true,
    isLoading: true,
    error: null
  });

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle events when this player is in focus
      if (!playerRef.current?.contains(document.activeElement)) return;

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
          adjustVolume(0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          adjustVolume(-0.1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Update buffered amount
  useEffect(() => {
    const updateBuffered = () => {
      const video = videoRef.current;
      if (!video) return;

      let buffered = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime && video.currentTime <= video.buffered.end(i)) {
          buffered = video.buffered.end(i) / video.duration * 100;
          break;
        }
      }
      
      setPlayerState(prev => ({ ...prev, buffered }));
    };

    const video = videoRef.current;
    if (video) {
      video.addEventListener('progress', updateBuffered);
      return () => video.removeEventListener('progress', updateBuffered);
    }
  }, []);

  // Auto-hide controls
  useEffect(() => {
    const hideControls = () => {
      setPlayerState(prev => ({ ...prev, showControls: false }));
    };

    const resetControlsTimeout = () => {
      if (controlsTimeout.current) {
        clearTimeout(controlsTimeout.current);
      }
      
      setPlayerState(prev => ({ ...prev, showControls: true }));
      
      if (playerState.isPlaying) {
        controlsTimeout.current = setTimeout(hideControls, 3000);
      }
    };

    const handleMouseMove = () => resetControlsTimeout();
    
    if (playerRef.current) {
      playerRef.current.addEventListener('mousemove', handleMouseMove);
    }

    return () => {
      if (controlsTimeout.current) {
        clearTimeout(controlsTimeout.current);
      }
      if (playerRef.current) {
        playerRef.current.removeEventListener('mousemove', handleMouseMove);
      }
    };
  }, [playerState.isPlaying]);

  // Handle video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
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
    };

    const handlePlay = () => {
      setPlayerState(prev => ({ ...prev, isPlaying: true, isLoading: false }));
    };

    const handlePause = () => {
      setPlayerState(prev => ({ ...prev, isPlaying: false }));
    };

    const handleVolumeChange = () => {
      setPlayerState(prev => ({
        ...prev,
        volume: video.volume,
        isMuted: video.muted
      }));
    };

    const handleLoadStart = () => {
      setPlayerState(prev => ({ ...prev, isLoading: true }));
    };

    const handleCanPlay = () => {
      setPlayerState(prev => ({ ...prev, isLoading: false }));
      if (autoPlay) {
        video.play().catch(error => {
          console.error('Autoplay failed:', error);
        });
      }
    };

    const handleEnded = () => {
      setPlayerState(prev => ({ ...prev, isPlaying: false }));
      if (onEnded) onEnded();
    };

    const handleError = () => {
      const errorMessage = 'An error occurred while playing the video.';
      setPlayerState(prev => ({ 
        ...prev, 
        isLoading: false, 
        error: errorMessage 
      }));
      if (onError) onError(errorMessage);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('volumechange', handleVolumeChange);
    video.addEventListener('loadstart', handleLoadStart);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('volumechange', handleVolumeChange);
      video.removeEventListener('loadstart', handleLoadStart);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [autoPlay, onEnded, onError, onProgress, playerState]);

  // Handle fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = document.fullscreenElement === playerRef.current;
      setPlayerState(prev => ({ ...prev, isFullscreen }));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Player control functions
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (playerState.isPlaying) {
      video.pause();
    } else {
      video.play().catch(error => {
        console.error('Play error:', error);
        if (onError) onError('Could not play video. Please try again.');
      });
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  };

  const adjustVolume = (change: number) => {
    const video = videoRef.current;
    if (!video) return;
    
    const newVolume = Math.max(0, Math.min(1, video.volume + change));
    video.volume = newVolume;
    
    if (newVolume > 0 && video.muted) {
      video.muted = false;
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const progressBar = e.currentTarget;
    if (!video || !progressBar) return;

    const rect = progressBar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * video.duration;
  };

  const skip = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  };

  const toggleFullscreen = () => {
    if (!playerRef.current) return;

    if (!document.fullscreenElement) {
      playerRef.current.requestFullscreen().catch(err => {
        console.error('Error attempting to enable fullscreen:', err);
      });
    } else {
      document.exitFullscreen();
    }
  };

  // Handle double-click to fast-forward/rewind
  const handleDoubleClick = (e: React.MouseEvent) => {
    const video = videoRef.current;
    if (!video) return;

    const rect = video.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickPosition = x / rect.width;

    if (clickPosition < 0.3) {
      // Double-click on left side - rewind
      skip(-10);
    } else if (clickPosition > 0.7) {
      // Double-click on right side - fast forward
      skip(10);
    }
  };

  return (
    <div 
      ref={playerRef}
      className="relative w-full h-full bg-black overflow-hidden group"
      tabIndex={0}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="w-full h-full object-contain"
        onClick={togglePlay}
        onDoubleClick={handleDoubleClick}
        preload="auto"
        playsInline
      />

      {/* Loading Overlay */}
      {playerState.isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-60 z-10">
          <div className="animate-spin w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full"></div>
        </div>
      )}

      {/* Error Overlay */}
      {playerState.error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80 z-10 text-white p-4">
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

      {/* Controls Overlay - show on hover or when paused */}
      <div 
        className={`absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/70 via-transparent to-black/70 transition-opacity duration-300 ${
          playerState.showControls || !playerState.isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Movie Title Overlay - only shown when paused or on hover */}
        {(movieTitle || subtitle) && (
          <div className="p-4">
            {movieTitle && <h2 className="text-white text-2xl font-bold">{movieTitle}</h2>}
            {subtitle && <p className="text-white/80 text-lg">{subtitle}</p>}
          </div>
        )}

        {/* Bottom Controls */}
        <div className="p-4 space-y-2">
          {/* Progress Bar */}
          <div 
            className="relative h-1 bg-gray-600 cursor-pointer group"
            onClick={seek}
          >
            {/* Buffered Progress */}
            <div 
              className="absolute h-full bg-gray-500"
              style={{ width: `${playerState.buffered}%` }}
            ></div>
            
            {/* Playback Progress */}
            <div 
              className="absolute h-full bg-primary-500 group-hover:bg-primary-400"
              style={{ width: `${(playerState.currentTime / playerState.duration) * 100 || 0}%` }}
            ></div>
            
            {/* Scrubber Handle - only visible on hover */}
            <div 
              className="absolute h-3 w-3 bg-primary-500 rounded-full -translate-x-1/2 -translate-y-1/4 opacity-0 group-hover:opacity-100"
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
                className="text-white hover:text-primary-400 transition-colors"
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
                className="text-white hover:text-primary-400 transition-colors"
                onClick={() => skip(-10)}
                aria-label="Rewind 10 seconds"
              >
                <BackwardIcon className="w-6 h-6" />
              </button>
              
              {/* Skip Forward */}
              <button 
                className="text-white hover:text-primary-400 transition-colors"
                onClick={() => skip(10)}
                aria-label="Fast forward 10 seconds"
              >
                <ForwardIcon className="w-6 h-6" />
              </button>
              
              {/* Volume Control */}
              <div className="flex items-center">
                <button 
                  className="text-white hover:text-primary-400 transition-colors"
                  onClick={toggleMute}
                  aria-label={playerState.isMuted ? 'Unmute' : 'Mute'}
                >
                  {playerState.isMuted || playerState.volume === 0 ? (
                    <SpeakerXMarkIcon className="w-6 h-6" />
                  ) : (
                    <SpeakerWaveIcon className="w-6 h-6" />
                  )}
                </button>
                
                <div className="relative w-16 h-1 bg-gray-600 mx-2 cursor-pointer hidden sm:block">
                  <div 
                    className="absolute h-full bg-white"
                    style={{ width: `${playerState.isMuted ? 0 : playerState.volume * 100}%` }}
                  ></div>
                </div>
              </div>
              
              {/* Time Display */}
              <div className="text-white text-sm">
                {formatTime(playerState.currentTime)} / {formatTime(playerState.duration)}
              </div>
            </div>
            
            {/* Right Side Controls */}
            <div>
              {/* Fullscreen Toggle */}
              <button 
                className="text-white hover:text-primary-400 transition-colors"
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
    </div>
  );
};

export default VideoPlayer;