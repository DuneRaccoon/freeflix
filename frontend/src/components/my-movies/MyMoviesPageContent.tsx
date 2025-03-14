'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useUser } from '@/context/UserContext';
import { TorrentStatus, Movie } from '@/types';
import { torrentsService } from '@/services/torrents';
import { moviesService } from '@/services/movies';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import UserMovieCard from '@/components/movies/UserMovieCard';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';

export default function MyMoviesPageContent() {
  const { currentUser } = useUser();
  const [torrents, setTorrents] = useState<TorrentStatus[]>([]);
  const [movieDetails, setMovieDetails] = useState<{[key: string]: Movie} | null>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<number>(5000);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch torrents and movie details
  const fetchMovies = useCallback(async () => {
    if (!currentUser) return;

    try {
      setIsLoading(true);
      setError(null);
      
      // Fetch all torrents
      const torrentList = await torrentsService.listTorrents();

      // Set torrents immediately to show progress
      setTorrents(torrentList);

      // Fetch movie details for each torrent
      const moviePromises = torrentList.map(async (torrent) => {
        try {
          // For now, use the movie title as the key
          // In a real implementation, you might want to store the movie ID in the torrent metadata
          const movie = await moviesService.searchMovies(torrent.movie_title);
          if (movie && movie.length > 0) {
            return { [torrent.movie_title]: movie[0] };
          }
          return null;
        } catch (err) {
          console.error(`Error fetching details for ${torrent.movie_title}:`, err);
          return null;
        }
      });

      const moviesResults = await Promise.all(moviePromises);
      const moviesMap = moviesResults.reduce((acc, curr) => {
        if (curr) {
          return { ...acc, ...curr };
        }
        return acc;
      }, {});

      setMovieDetails(moviesMap);
    } catch (err) {
      console.error('Error fetching movies:', err);
      setError('Failed to fetch your movies. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  // Initial fetch
  useEffect(() => {
    fetchMovies();
  }, [fetchMovies]);

  // Setup auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      // Only refresh the torrent statuses, not the full movie details
      torrentsService.listTorrents()
        .then(updatedTorrents => {
          setTorrents(updatedTorrents);
        })
        .catch(err => {
          console.error('Error updating torrents:', err);
        });
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval]);

  // Toggle auto-refresh
  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };

  // Handle manual refresh
  const handleRefresh = () => {
    fetchMovies();
    toast.success('Refreshed movies');
  };

  // If still loading initial data
  if (isLoading && torrents.length === 0) {
    return <LoadingScreen message="Loading your movies..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">My Movies</h1>
        
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
          {torrents.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <ExclamationTriangleIcon className="h-16 w-16 text-gray-600 mb-4" />
                
                <h3 className="text-xl font-semibold text-gray-300 mb-2">No movies found</h3>
                <p className="text-gray-400 text-center max-w-md mb-6">
                  You don't have any downloads yet. Start by searching for a movie to download.
                </p>
                
                <Button
                  onClick={() => window.location.href = '/search'}
                  variant="primary"
                >
                  Search Movies
                </Button>
              </CardContent>
            </Card>
          ) : (
            movieDetails && <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {torrents.map(torrent => (
                <UserMovieCard
                  key={torrent.id}
                  torrent={torrent}
                  movie={movieDetails[torrent.movie_title]}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}