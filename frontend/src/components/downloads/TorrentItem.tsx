import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TorrentStatus, TorrentState } from '@/types';
import { Card, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Progress from '@/components/ui/Progress';
import { torrentsService } from '@/services/torrents';
import { toast } from 'react-hot-toast';
import {
  PlayIcon,
  PauseIcon,
  StopIcon,
  TrashIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/solid';

interface TorrentItemProps {
  torrent: TorrentStatus;
  onStatusChange?: () => void;
}

const TorrentItem: React.FC<TorrentItemProps> = ({ 
  torrent, 
  onStatusChange 
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isStreamLoading, setIsStreamLoading] = useState(false);

  const router = useRouter();

  const formatSpeed = (speedKBps: number): string => {
    if (speedKBps > 1024) {
      return `${(speedKBps / 1024).toFixed(2)} MB/s`;
    }
    return `${speedKBps.toFixed(2)} KB/s`;
  };

  const formatETA = (seconds?: number): string => {
    if (!seconds) return 'unknown';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const getStateVariant = (state: TorrentState) => {
    switch (state) {
      case TorrentState.DOWNLOADING:
        return 'success'
      case TorrentState.DOWNLOADING_METADATA:
        return 'primary';
      case TorrentState.FINISHED:
      case TorrentState.SEEDING:
        return 'success';
      case TorrentState.PAUSED:
        return 'warning';
      case TorrentState.ERROR:
        return 'danger';
      default:
        return 'default';
    }
  };

  const handleAction = async (action: 'pause' | 'resume' | 'stop' | 'remove') => {
    try {
      setIsLoading(true);
      
      if (action === 'remove') {
        await torrentsService.deleteTorrent(torrent.id, false);
      } else {
        await torrentsService.performTorrentAction(torrent.id, action);
      }
      
      toast.success(`Torrent ${action}ed successfully`);
      
      // Call the onStatusChange callback if provided
      if (onStatusChange) {
        onStatusChange();
      }
    } catch (error) {
      console.error(`Error ${action}ing torrent:`, error);
      toast.error(`Failed to ${action} torrent`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStream = async () => {
    try {
      setIsStreamLoading(true);
      
      // Prioritize for streaming
      await torrentsService.prioritizeForStreaming(torrent.id);
      
      // Navigate to the streaming page
      router.push(`/streaming/${torrent.id}`);
    } catch (error) {
      console.error('Error preparing stream:', error);
      toast.error('Failed to prepare streaming. Please try again.');
      setIsStreamLoading(false);
    }
  };

  const canStream = [
    TorrentState.DOWNLOADING,
    TorrentState.DOWNLOADING_METADATA,
    TorrentState.FINISHED,
    TorrentState.SEEDING
  ].includes(torrent.state);

  return (
    <Card className="mb-4 overflow-visible">
      <CardContent className="p-4">
        <div className="flex flex-col md:flex-row justify-between">
          <div className="flex-1">
            <div className="flex items-center">
              <h3 className="text-lg font-semibold mr-2">{torrent.movie_title}</h3>
              <Badge variant={getStateVariant(torrent.state)}>
                {torrent.state}
              </Badge>
              {torrent.quality && (
                <Badge variant="secondary" className="ml-2">
                  {torrent.quality}
                </Badge>
              )}
            </div>
            
            <Progress 
              value={torrent.progress} 
              max={100} 
              showValue={true}
              variant={getStateVariant(torrent.state)}
              className="mt-3 mb-2"
              formatValue={(value) => `${Math.round(value)}%`}
            />
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-400 mt-2">
              <div>
                <span className="block">Speed:</span>
                <span className="font-medium text-gray-300">
                  {formatSpeed(torrent.download_rate)}
                </span>
              </div>
              
              <div>
                <span className="block">ETA:</span>
                <span className="font-medium text-gray-300">
                  {torrent.state === TorrentState.DOWNLOADING ? formatETA(torrent.eta) : '-'}
                </span>
              </div>
              
              <div>
                <span className="block">Peers:</span>
                <span className="font-medium text-gray-300">{torrent.num_peers}</span>
              </div>
              
              <div>
                <span className="block">Added:</span>
                <span className="font-medium text-gray-300">
                  {new Date(torrent.created_at).toLocaleString()}
                </span>
              </div>
            </div>
            
            {torrent.error_message && (
              <div className="mt-2 text-red-500 text-sm flex items-start">
                <ExclamationTriangleIcon className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0" />
                <span>{torrent.error_message}</span>
              </div>
            )}
          </div>
          
          <div className="flex space-x-2 mt-4 md:mt-0 md:ml-4">
            {/* Play/Stream Button - Prioritized and improved */}
            {canStream && (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<PlayIcon className="w-4 h-4" />}
                onClick={handleStream}
                isLoading={isStreamLoading}
              >
                Watch Now
              </Button>
            )}
            
            {/* Pause/Resume Button */}
            {torrent.state === TorrentState.PAUSED ? (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<PlayIcon className="w-4 h-4" />}
                isLoading={isLoading}
                onClick={() => handleAction('resume')}
              >
                Resume
              </Button>
            ) : torrent.state === TorrentState.DOWNLOADING || 
                torrent.state === TorrentState.DOWNLOADING_METADATA ? (
              <Button
                variant="danger"
                size="sm"
                leftIcon={<PauseIcon className="w-4 h-4" />}
                isLoading={isLoading}
                onClick={() => handleAction('pause')}
              >
                Pause
              </Button>
            ) : null}

            {/* Stop Button */}
            {torrent.state !== TorrentState.STOPPED && 
            torrent.state !== TorrentState.FINISHED && 
            torrent.state !== TorrentState.ERROR && (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<StopIcon className="w-4 h-4" />}
                isLoading={isLoading}
                onClick={() => handleAction('stop')}
              >
                Stop
              </Button>
            )}
            
            {/* Remove Button */}
            <Button
              variant="danger"
              size="sm"
              leftIcon={<TrashIcon className="w-4 h-4" />}
              isLoading={isLoading}
              onClick={() => handleAction('remove')}
            >
              Remove
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TorrentItem;