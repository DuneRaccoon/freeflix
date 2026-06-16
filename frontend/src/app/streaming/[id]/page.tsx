'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { torrentsService } from '@/services/torrents';
import { streamingService } from '@/services/streaming';
import { TorrentStatus, StreamingInfo, TorrentState, VideoFile } from '@/types';
import PatchedVideoPlayer from '@/components/player/PatchedVideoPlayer';
import Button from '@/components/ui/Button';
import Progress from '@/components/ui/Progress';
import {
  ArrowLeftIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  ArrowPathIcon,
  FilmIcon
} from '@heroicons/react/24/outline';
import { formatBytes } from '@/utils/format';
import { isStreamingReady } from '@/utils/streaming';
import PreStreamingAnimation from '@/components/streaming/PreStreamingAnimation';
import { BasicPreStream } from '@/components/streaming/BasicPreStream';

export default function StreamingPage() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const torrentId = Array.isArray(id) ? id[0] : id;

  // File picker state. Guard against junk/empty ?file values (e.g. hand-edited
  // URLs) so they fall back to the default file rather than 404-ing on NaN.
  const fileParam = searchParams.get('file');
  const parsedFileParam = fileParam !== null ? Number(fileParam) : NaN;
  const fileIndex = Number.isInteger(parsedFileParam) ? parsedFileParam : undefined;
  const [videoFiles, setVideoFiles] = useState<VideoFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  const [torrentStatus, setTorrentStatus] = useState<TorrentStatus | null>(null);
  const [streamingInfo, setStreamingInfo] = useState<StreamingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [forceStreaming, setForceStreaming] = useState(false);
  const [showStreamingStats, setShowStreamingStats] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [videoFileProgress, setVideoFileProgress] = useState<number>(0);

  // Fetch the file list for this torrent
  useEffect(() => {
    if (!torrentId) return;
    setFilesLoading(true);
    streamingService.getFiles(torrentId)
      .then(files => setVideoFiles(files))
      .catch(err => {
        console.warn('Could not fetch file list for torrent:', err);
        setVideoFiles([]);
      })
      .finally(() => setFilesLoading(false));
  }, [torrentId]);

  // Determine effective file index:
  // - Use fileIndex from URL if provided
  // - Else if there are multiple files, default to the first file's index
  // - Else undefined (single-file torrent → unchanged behaviour)
  const isMultiFile = videoFiles.length > 1;
  const effectiveFileIndex: number | undefined =
    fileIndex !== undefined
      ? fileIndex
      : isMultiFile
      ? videoFiles[0].index
      : undefined;

  // Check if torrent exists and get initial status
  useEffect(() => {
    const getTorrentStatus = async () => {
      if (!torrentId) return;

      try {
        setIsLoading(true);
        setError(null);

        // Get torrent status
        const status = await torrentsService.getTorrentStatus(torrentId);
        setTorrentStatus(status);

        if (!status) {
          setError('Torrent not found. It may have been deleted or never existed.');
          setIsLoading(false);
          return;
        }

        // Prioritize for streaming if not already
        await torrentsService.prioritizeForStreaming(torrentId);

        // Check if streaming is possible
        const readyToStream = await isStreamingReady(torrentId, 2) || forceStreaming; // Reduced minimum progress to 2%
        setIsStreamReady(readyToStream);

        if (readyToStream) {
          try {
            const info = await streamingService.getStreamingInfo(torrentId, effectiveFileIndex);
            setStreamingInfo(info);

            // Set video file specific progress
            if (info?.video_file) {
              setVideoFileProgress(info.video_file.progress);
            } else {
              setVideoFileProgress(status.progress);
            }
          } catch (err) {
            console.error('Error fetching streaming info:', err);
            // Don't set error yet, we'll retry
            if (retryCount < 3) {
              setRetryCount(prev => prev + 1);
            } else {
              setError('Failed to get streaming information. The file may not be ready yet.');
            }
          }
        }
      } catch (err) {
        console.error('Error loading torrent for streaming:', err);
        setError('Failed to load the movie for streaming. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    getTorrentStatus();

    // Set up interval to refresh status and progress
    const interval = setInterval(async () => {
      if (!torrentId) return;

      try {
        // Get updated torrent status
        const status = await torrentsService.getTorrentStatus(torrentId);
        setTorrentStatus(status);

        if (!status) return;

        // Check streaming status if not ready yet
        if (!isStreamReady && !forceStreaming) {
          const readyToStream = await isStreamingReady(torrentId, 2);
          setIsStreamReady(readyToStream);

          if (readyToStream) {
            try {
              const info = await streamingService.getStreamingInfo(torrentId, effectiveFileIndex);
              setStreamingInfo(info);

              // Set video file specific progress
              if (info?.video_file) {
                setVideoFileProgress(info.video_file.progress);
              } else {
                setVideoFileProgress(status.progress);
              }
            } catch (err) {
              console.error('Error fetching streaming info during retry:', err);
            }
          }
        } else if (streamingInfo) {
          // Update streaming info if already streaming
          try {
            const info = await streamingService.getStreamingInfo(torrentId, effectiveFileIndex);
            setStreamingInfo(info);

            // Update video file specific progress
            if (info?.video_file) {
              setVideoFileProgress(info.video_file.progress);
            } else {
              setVideoFileProgress(status.progress);
            }
          } catch (err) {
            console.error('Error updating streaming info:', err);
          }
        }
      } catch (err) {
        console.error('Error updating torrent status:', err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [torrentId, isStreamReady, forceStreaming, retryCount, effectiveFileIndex]);

  const handleBackClick = () => {
    router.push('/downloads');
  };

  const handleHomeClick = () => {
    router.push('/');
  };

  const toggleStreamingStats = () => {
    setShowStreamingStats(!showStreamingStats);
  };

  const handleForceStreaming = async () => {
    try {
      setIsLoading(true);
      setForceStreaming(true);

      await torrentsService.prioritizeForStreaming(torrentId);

      const info = await streamingService.getStreamingInfo(torrentId, effectiveFileIndex);
      setStreamingInfo(info);

      // Set video file specific progress
      if (info?.video_file) {
        setVideoFileProgress(info.video_file.progress);
      } else if (torrentStatus) {
        setVideoFileProgress(torrentStatus.progress);
      }

      setIsStreamReady(true);
      setError(null);
    } catch (err) {
      console.error('Error forcing stream start:', err);
      setError('Failed to start streaming. The file may not be ready yet.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setIsLoading(true);
      setError(null);

      await torrentsService.prioritizeForStreaming(torrentId);

      const status = await torrentsService.getTorrentStatus(torrentId);
      setTorrentStatus(status);

      if (status) {
        const info = await streamingService.getStreamingInfo(torrentId, effectiveFileIndex);
        setStreamingInfo(info);

        // Update video file specific progress
        if (info?.video_file) {
          setVideoFileProgress(info.video_file.progress);
        } else {
          setVideoFileProgress(status.progress);
        }

        setIsStreamReady(true);
      } else {
        setError('Torrent not found. It may have been deleted or never existed.');
      }
    } catch (err) {
      console.error('Error refreshing stream:', err);
      setError('Failed to refresh streaming data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle video player error
  const handleVideoError = (error: string) => {
    // For minor errors during active downloads, don't show the error screen
    if (torrentStatus && torrentStatus.progress < 100 &&
        (error.includes('network error') || error.includes('buffering'))) {
      // Just log the error but don't show the error screen
      console.warn('Video playback issue during download:', error);
    } else {
      // For serious errors, show the error screen
      setError(error);
    }
  };

  // Handle selecting a different episode from the picker
  const handleFileSelect = (selectedIndex: number) => {
    router.replace(`/streaming/${torrentId}?file=${selectedIndex}`);
  };

  // Get the streaming URL — pass effective file index so switching episodes changes playback
  const streamingUrl = streamingInfo
    ? streamingService.getStreamingUrl(torrentId, torrentStatus?.quality, effectiveFileIndex) ?? ''
    : '';

  // Helper to label a file entry
  const fileLabel = (f: VideoFile): string => {
    if (f.season !== null && f.episode !== null) {
      return `S${String(f.season).padStart(2, '0')}E${String(f.episode).padStart(2, '0')}`;
    }
    return f.name;
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background">
        <div className="animate-spin w-16 h-16 border-4 border-primary-500 border-t-transparent rounded-full mb-4"></div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Loading movie...</h2>
        <p className="text-muted-foreground">Preparing your streaming experience</p>
      </div>
    );
  }

  // Error state
  if (error || !torrentStatus) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background p-4">
        <ExclamationTriangleIcon className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Unable to Stream Movie</h2>
        <p className="text-muted-foreground text-center mb-6 max-w-md">{error || 'Movie not found. It may have been deleted or never existed.'}</p>
        <div className="flex gap-4">
          <Button
            variant="outline"
            leftIcon={<ArrowPathIcon className="w-5 h-5" />}
            onClick={handleRefresh}
          >
            Try Again
          </Button>
          <Button
            variant="primary"
            leftIcon={<ArrowLeftIcon className="w-5 h-5" />}
            onClick={handleBackClick}
          >
            Back to Downloads
          </Button>
        </div>
      </div>
    );
  }

  // Not ready for streaming yet
  if (!isStreamReady && !forceStreaming) {
    return (
      <PreStreamingAnimation
        movieTitle={torrentStatus.movie_title}
        progress={torrentStatus.progress}
        downloadSpeed={torrentStatus.download_rate}
        numPeers={torrentStatus.num_peers}
        onStartAnyway={handleForceStreaming}
        onBack={handleBackClick}
        estimatedTimeSeconds={torrentStatus.progress >= 5 ? 0 : 60}
      />
    );
  }

  // Ready for streaming
  return (
    <div className="h-screen flex flex-col bg-black">
      {/* Header */}
      <div className="flex justify-between items-center p-4 bg-card">
        <Button
          variant="outline"
          size="sm"
          leftIcon={<ArrowLeftIcon className="w-5 h-5" />}
          onClick={handleBackClick}
        >
          Back
        </Button>

        <h1 className="text-xl font-semibold text-foreground">{torrentStatus.movie_title}</h1>

        <Button
          variant="outline"
          size="sm"
          leftIcon={<InformationCircleIcon className="w-5 h-5" />}
          onClick={toggleStreamingStats}
        >
          {showStreamingStats ? 'Hide Stats' : 'Show Stats'}
        </Button>
      </div>

      {/* Episode/File Picker — shown only for season packs (>1 file) */}
      {isMultiFile && (
        <div className="bg-card border-t border-border px-4 py-2 flex items-center gap-3 overflow-x-auto">
          <FilmIcon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <span className="text-sm text-muted-foreground flex-shrink-0">Episode:</span>
          {filesLoading ? (
            <span className="text-sm text-muted-foreground italic">preparing episodes…</span>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {videoFiles.map(f => {
                const isActive = effectiveFileIndex === f.index;
                return (
                  <button
                    key={f.index}
                    onClick={() => handleFileSelect(f.index)}
                    className={[
                      'px-3 py-1 rounded text-sm font-medium transition-colors whitespace-nowrap',
                      isActive
                        ? 'bg-primary-500 text-white'
                        : 'bg-card border border-border text-foreground hover:bg-accent hover:text-accent-foreground',
                    ].join(' ')}
                    title={f.name}
                  >
                    {fileLabel(f)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Player Area */}
      <div className="flex-grow relative overflow-hidden">
        {streamingInfo && streamingUrl && torrentId ? (
          <PatchedVideoPlayer
            src={streamingUrl}
            torrentId={torrentId}
            torrentInfo={torrentStatus}
            movieId={torrentStatus.movie_title}
            movieTitle={torrentStatus.movie_title}
            subtitle={`${torrentStatus.quality} • ${streamingInfo.video_file.name}`}
            onError={handleVideoError}
            downloadProgress={videoFileProgress} // Pass the video-specific progress
            streamingInfo={streamingInfo} // Pass the full streaming info
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <div className="text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-4 border-primary-500 border-t-transparent"></div>
              <p className="text-white mt-2">Loading video player...</p>
            </div>
          </div>
        )}
      </div>

      {/* Streaming Stats Overlay */}
      {showStreamingStats && streamingInfo && (
        <div className="absolute bottom-0 left-0 right-0 bg-card/90 p-4 text-foreground z-10">
          <h3 className="text-lg font-semibold mb-2">Streaming Statistics</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-2">
            <div>
              <span className="text-muted-foreground">Overall Progress:</span>
              <span className="ml-2">{Math.round(torrentStatus.progress)}%</span>
            </div>
            <div>
              <span className="text-muted-foreground">Video File:</span>
              <span className="ml-2">{Math.round(streamingInfo.video_file.progress)}%</span>
            </div>
            <div>
              <span className="text-muted-foreground">Download Speed:</span>
              <span className="ml-2">{torrentStatus.download_rate.toFixed(2)} KB/s</span>
            </div>
            <div>
              <span className="text-muted-foreground">File Size:</span>
              <span className="ml-2">{formatBytes(streamingInfo.video_file.size)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Downloaded:</span>
              <span className="ml-2">{formatBytes(streamingInfo.video_file.downloaded)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Connected Peers:</span>
              <span className="ml-2">{torrentStatus.num_peers}</span>
            </div>
            <div>
              <span className="text-muted-foreground">State:</span>
              <span className="ml-2">{torrentStatus.state}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Progress Rate:</span>
              <span className="ml-2">
                {torrentStatus.download_rate > 0
                  ? `~${(torrentStatus.download_rate / streamingInfo.video_file.size * 100).toFixed(4)}%/s`
                  : 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Format:</span>
              <span className="ml-2">{streamingInfo.video_file.mime_type.split('/')[1].toUpperCase()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">ETA:</span>
              <span className="ml-2">
                {torrentStatus.eta
                  ? `${Math.floor(torrentStatus.eta / 60)} min ${torrentStatus.eta % 60} sec`
                  : 'Unknown'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
