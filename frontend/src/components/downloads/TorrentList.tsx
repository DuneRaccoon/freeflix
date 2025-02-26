import React, { useEffect, useState, useCallback } from 'react';
import { TorrentStatus, TorrentState } from '@/types';
import TorrentItem from './TorrentItem';
import Select from '@/components/ui/Select';
import { torrentsService } from '@/services/torrents';
import { toast } from 'react-hot-toast';

interface TorrentListProps {
  initialTorrents?: TorrentStatus[];
  autoRefresh?: boolean;
  refreshInterval?: number;
}

const TorrentList: React.FC<TorrentListProps> = ({
  initialTorrents,
  autoRefresh = true,
  refreshInterval = 5000,
}) => {
  const [torrents, setTorrents] = useState<TorrentStatus[]>(initialTorrents || []);
  const [filter, setFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState<boolean>(!initialTorrents);
  const [error, setError] = useState<string | null>(null);

  // Filter options
  const filterOptions = [
    { value: 'all', label: 'All' },
    { value: 'downloading', label: 'Downloading' },
    { value: 'completed', label: 'Completed' },
    { value: 'paused', label: 'Paused' },
    { value: 'active', label: 'Active' },
    { value: 'error', label: 'Error' },
  ];

  // Fetch torrents from API
  const fetchTorrents = useCallback(async () => {
    try {
      setError(null);
      const data = await torrentsService.listTorrents();
      setTorrents(data);
    } catch (err) {
      console.error('Error fetching torrents:', err);
      setError('Failed to fetch torrents');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle filter change
  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilter(e.target.value);
  };

  // Filter torrents based on selected filter
  const getFilteredTorrents = () => {
    if (filter === 'all') return torrents;

    if (filter === 'downloading') {
      return torrents.filter(t => 
        t.state === TorrentState.DOWNLOADING || 
        t.state === TorrentState.DOWNLOADING_METADATA
      );
    }

    if (filter === 'completed') {
      return torrents.filter(t => 
        t.state === TorrentState.FINISHED || 
        t.state === TorrentState.SEEDING
      );
    }

    if (filter === 'paused') {
      return torrents.filter(t => t.state === TorrentState.PAUSED);
    }

    if (filter === 'active') {
      return torrents.filter(t => 
        t.state === TorrentState.DOWNLOADING || 
        t.state === TorrentState.DOWNLOADING_METADATA ||
        t.state === TorrentState.CHECKING ||
        t.state === TorrentState.ALLOCATING ||
        t.state === TorrentState.CHECKING_FASTRESUME ||
        t.state === TorrentState.SEEDING
      );
    }

    if (filter === 'error') {
      return torrents.filter(t => t.state === TorrentState.ERROR);
    }

    return torrents;
  };

  // Initial fetch
  useEffect(() => {
    if (!initialTorrents) {
      fetchTorrents();
    }
  }, [fetchTorrents, initialTorrents]);

  // Auto refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchTorrents();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, fetchTorrents, refreshInterval]);

  // Handle manual refresh
  const handleRefresh = () => {
    setIsLoading(true);
    fetchTorrents();
    toast.success('Refreshed torrents list');
  };

  // Get filtered torrents
  const filteredTorrents = getFilteredTorrents();

  // Loading state
  if (isLoading) {
    return (
      <div className="animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="mb-4 bg-gray-800 rounded-lg h-32"></div>
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500 mb-4">{error}</div>
        <button
          className="px-4 py-2 bg-gray-700 rounded-md hover:bg-gray-600"
          onClick={handleRefresh}
        >
          Try Again
        </button>
      </div>
    );
  }

  // Empty state
  if (torrents.length === 0) {
    return (
      <div className="text-center py-8">
        <h3 className="text-xl font-semibold text-gray-300">No torrents found</h3>
        <p className="text-gray-400 mt-2">
          Start downloading movies to see them here
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">
          Downloads
          <span className="ml-2 text-sm font-normal text-gray-400">
            ({filteredTorrents.length} of {torrents.length})
          </span>
        </h2>
        <div className="flex items-center space-x-4">
          <Select
            options={filterOptions}
            value={filter}
            onChange={handleFilterChange}
            className="w-40"
          />
          <button
            className="text-sm text-primary-400 hover:text-primary-300"
            onClick={handleRefresh}
          >
            Refresh
          </button>
        </div>
      </div>

      {filteredTorrents.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-400">No torrents match the selected filter</p>
        </div>
      ) : (
        filteredTorrents.map((torrent) => (
          <TorrentItem 
            key={torrent.id} 
            torrent={torrent} 
            onStatusChange={fetchTorrents} 
          />
        ))
      )}
    </div>
  );
};

export default TorrentList;