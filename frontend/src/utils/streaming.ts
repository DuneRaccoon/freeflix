// src/utils/streaming.ts
import { TorrentRequest, TorrentStatus } from '@/types';
import { torrentsService } from '@/services/torrents';
import { toast } from 'react-hot-toast';

/**
 * Starts the download process for streaming a movie
 * @param request The torrent request parameters
 * @returns The torrent status if successful
 */
export const handleStreamingStart = async (
  request: TorrentRequest
): Promise<TorrentStatus | null> => {
  try {
    toast.loading('Preparing your stream...', { id: 'stream-start' });
    
    // Start the download
    const torrentStatus = await torrentsService.downloadMovie(request);
    
    // Notify the user that we're preparing the stream
    toast.success('Stream is being prepared! Please wait a moment...', { id: 'stream-start' });
    
    // Prioritize the file for streaming
    await torrentsService.prioritizeForStreaming(torrentStatus.id);
    
    return torrentStatus;
  } catch (error) {
    console.error('Error starting stream:', error);
    toast.error('Failed to prepare stream. Please try again.', { id: 'stream-start' });
    return null;
  }
};

/**
 * Checks if a torrent is sufficiently downloaded to begin streaming
 * @param torrentId The ID of the torrent to check
 * @param minimumProgress The minimum download percentage to allow streaming (default: 2%)
 * @returns Whether the torrent is ready for streaming
 */
export const isStreamingReady = async (
  torrentId: string,
  minimumProgress: number = 2
): Promise<boolean> => {
  try {
    const status = await torrentsService.getTorrentStatus(torrentId);
    
    // If the status doesn't exist, it's not ready
    if (!status) return false;
    
    // Check if the torrent is in a playable state
    const playableStates = [
      'downloading', 
      'downloading_metadata', 
      'finished', 
      'seeding'
    ];
    
    // Return true if the status is in a playable state and has downloaded enough
    return playableStates.includes(status.state) && status.progress >= minimumProgress;
  } catch (error) {
    console.error('Error checking streaming readiness:', error);
    return false;
  }
};