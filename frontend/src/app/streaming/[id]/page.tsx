// frontend/src/app/streaming/[id]/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { torrentsService } from '@/services/torrents';
import { streamingService } from '@/services/streaming';
import { TorrentStatus, StreamingInfo } from '@/types';
import VideoPlayer from '@/components/player/VideoPlayer';
import Button from '@/components/ui/Button';
import { 
  ArrowLeftIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { formatBytes } from '@/utils/format';

export default function StreamingPage() {
  const { id } = useParams();
  const router = useRouter();
  const torrentId = Array.isArray(id) ? id[0] : id;
  
  const [torrentStatus, setTorrentStatus] = useState<TorrentStatus | null>(null);
  const [streamingInfo, setStreamingInfo] = useState<StreamingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [showStreamingStats, setShowStreamingStats] = useState(false);
  
  // Check if torrent exists and get initial status
  useEffect(() => {
    const getTorrentStatus = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const status = await torrentsService.getTorrentStatus(torrentId);
        setTorrentStatus(status);
        
        // Check if streaming is possible
        const isReady = await streamingService.checkStreamingReady(torrentId);
        setIsStreamReady(isReady);
        
        if (isReady) {
          const info = await streamingService.getStreamingInfo(torrentId);
          setStreamingInfo(info);
        }
      } catch (err) {
        console.error('Error loading torrent for streaming:', err);
        setError('Failed to load the movie for streaming. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };
    
    getTorrentStatus();
    
    // Set up interval to refresh status
    const interval = setInterval(async () => {
      try {
        const status = await torrentsService.getTorrentStatus(torrentId);
        setTorrentStatus(status);
        
        // Check streaming status if not ready yet
        if (!isStreamReady) {
          const isReady = await streamingService.checkStreamingReady(torrentId);
          setIsStreamReady(isReady);
          
          if (isReady) {
            const info = await streamingService.getStreamingInfo(torrentId);
            setStreamingInfo(info);
          }
        } else if (streamingInfo) {
          // Update streaming info if already streaming
          const info = await streamingService.getStreamingInfo(torrentId);
          setStreamingInfo(info);
        }
      } catch (err) {
        console.error('Error updating torrent status:', err);
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [torrentId, isStreamReady]);
  
  const handleBackClick = () => {
    router.push('/downloads');
  };
  
  const toggleStreamingStats = () => {
    setShowStreamingStats(!showStreamingStats);
  };
  
  const streamingUrl = streamingInfo ? 
    streamingService.getStreamingUrl(torrentId) : '';
  
  // Loading state
  if (isLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gray-900">
        <div className="animate-spin w-16 h-16 border-4 border-primary-500 border-t-transparent rounded-full mb-4"></div>
        <h2 className="text-xl font-semibold text-white">Loading movie...</h2>
      </div>
    );
  }
  
  // Error state
  if (error || !torrentStatus) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gray-900 p-4">
        <ExclamationTriangleIcon className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">Unable to Stream Movie</h2>
        <p className="text-gray-300 text-center mb-6">{error || 'Movie not found. It may have been deleted or never existed.'}</p>
        <Button 
          variant="primary" 
          leftIcon={<ArrowLeftIcon className="w-5 h-5" />}
          onClick={handleBackClick}
        >
          Back to Downloads
        </Button>
      </div>
    );
  }
  
  // Not ready for streaming yet
  if (!isStreamReady) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gray-900 p-4">
        <div className="max-w-md w-full bg-gray-800 rounded-lg p-6 shadow-lg">
          <h2 className="text-xl font-semibold text-white mb-4">Preparing for Streaming...</h2>
          <p className="text-gray-300 mb-6">
            We're downloading the beginning of "{torrentStatus.movie_title}" so you can start watching.
            This may take a few moments depending on your connection.
          </p>
          
          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-400 mb-1">
              <span>Download Progress</span>
              <span>{Math.round(torrentStatus.progress)}%</span>
            </div>
            <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary-500 transition-all duration-300"
                style={{ width: `${torrentStatus.progress}%` }}
              ></div>
            </div>
          </div>
          
          <div className="flex justify-between items-center text-sm text-gray-400 mb-4">
            <span>Download Speed</span>
            <span>{torrentStatus.download_rate.toFixed(2)} KB/s</span>
          </div>
          
          <div className="flex justify-between">
            <Button 
              variant="outline" 
              leftIcon={<ArrowLeftIcon className="w-5 h-5" />}
              onClick={handleBackClick}
            >
              Back to Downloads
            </Button>
            
            <Button 
              variant="primary"
              onClick={async () => {
                try {
                  setIsLoading(true);
                  setIsStreamReady(true);
                  const info = await streamingService.getStreamingInfo(torrentId);
                  setStreamingInfo(info);
                  setIsLoading(false);
                } catch (err) {
                  console.error('Error forcing stream start:', err);
                  setError('Failed to start streaming. The file may not be ready yet.');
                  setIsLoading(false);
                }
              }}
            >
              Start Anyway
            </Button>
          </div>
        </div>
      </div>
    );
  }
  
  // Ready for streaming
  return (
    <div className="h-screen flex flex-col bg-black">
      {/* Header */}
      <div className="flex justify-between items-center p-4 bg-gray-900">
        <Button 
          variant="outline" 
          size="sm"
          leftIcon={<ArrowLeftIcon className="w-5 h-5" />}
          onClick={handleBackClick}
        >
          Back
        </Button>
        
        <h1 className="text-xl font-semibold text-white">{torrentStatus.movie_title}</h1>
        
        <Button
          variant="outline"
          size="sm"
          leftIcon={<InformationCircleIcon className="w-5 h-5" />}
          onClick={toggleStreamingStats}
        >
          {showStreamingStats ? 'Hide Stats' : 'Show Stats'}
        </Button>
      </div>
      
      {/* Player Area */}
      <div className="flex-grow relative overflow-hidden">
        {streamingInfo && streamingUrl && (
          <VideoPlayer 
            src={streamingUrl}
            movieTitle={torrentStatus.movie_title}
            subtitle={`${torrentStatus.quality} • ${streamingInfo.video_file.name}`}
            autoPlay={true}
            onError={(error) => setError(error)}
          />
        )}
      </div>
      
      {/* Streaming Stats Overlay */}
      {showStreamingStats && streamingInfo && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-4 text-white">
          <h3 className="text-lg font-semibold mb-2">Streaming Statistics</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2">
            <div>
              <span className="text-gray-400">Overall Download:</span>
              <span className="ml-2">{Math.round(torrentStatus.progress)}%</span>
            </div>
            <div>
              <span className="text-gray-400">Video File:</span>
              <span className="ml-2">{Math.round(streamingInfo.video_file.progress)}%</span>
            </div>
            <div>
              <span className="text-gray-400">Download Speed:</span>
              <span className="ml-2">{torrentStatus.download_rate.toFixed(2)} KB/s</span>
            </div>
            <div>
              <span className="text-gray-400">File Size:</span>
              <span className="ml-2">{formatBytes(streamingInfo.video_file.size)}</span>
            </div>
            <div>
              <span className="text-gray-400">Downloaded:</span>
              <span className="ml-2">{formatBytes(streamingInfo.video_file.downloaded)}</span>
            </div>
            <div>
              <span className="text-gray-400">Peers:</span>
              <span className="ml-2">{torrentStatus.num_peers}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
