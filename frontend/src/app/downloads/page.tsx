'use client';

import React, { useState, useEffect } from 'react';
import { TorrentStatus } from '@/types';
import { torrentsService } from '@/services/torrents';
import TorrentList from '@/components/downloads/TorrentList';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import { ArrowPathIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

export default function DownloadsPage() {
  const [torrents, setTorrents] = useState<TorrentStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch torrents
  const fetchTorrents = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const data = await torrentsService.listTorrents();
      setTorrents(data);
    } catch (err) {
      console.error('Error fetching torrents:', err);
      setError('Failed to fetch torrents. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchTorrents();
  }, []);

  // Handle refresh button click
  const handleRefresh = () => {
    fetchTorrents();
  };

  // Toggle auto-refresh
  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Torrent Downloads</h1>
        
        <div className="flex items-center space-x-4">
          <label className="flex items-center cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only"
                checked={autoRefresh}
                onChange={toggleAutoRefresh}
              />
              <div className={`w-10 h-6 rounded-full transition ${autoRefresh ? 'bg-primary-600' : 'bg-gray-700'}`}></div>
              <div className={`absolute left-1 top-1 w-4 h-4 rounded-full transition transform ${autoRefresh ? 'translate-x-4 bg-white' : 'bg-gray-400'}`}></div>
            </div>
            <span className="ml-3 text-sm text-gray-300">
              Auto-refresh
            </span>
          </label>
          
          <Button
            variant="outline"
            size="sm"
            leftIcon={<ArrowPathIcon className="h-4 w-4" />}
            onClick={handleRefresh}
            isLoading={isLoading}
          >
            Refresh
          </Button>
        </div>
      </div>
      
      {error ? (
        <div className="bg-red-900/20 border border-red-900 rounded-lg p-4 text-red-400">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={handleRefresh}
          >
            Try Again
          </Button>
        </div>
      ) : (
        <>
          {torrents.length === 0 && !isLoading ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <svg
                  className="h-20 w-20 text-gray-600 mb-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                
                <h3 className="text-xl font-semibold text-gray-300 mb-2">No downloads found</h3>
                <p className="text-gray-400 text-center max-w-md mb-6">
                  You don't have any active or completed downloads. Start by searching for a movie.
                </p>
                
                <Link href="/search">
                  <Button
                    leftIcon={<MagnifyingGlassIcon className="h-5 w-5" />}
                  >
                    Search for Movies
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <TorrentList 
              initialTorrents={torrents} 
              autoRefresh={autoRefresh}
              refreshInterval={1000}
            />
          )}
        </>
      )}
    </div>
  );
}