'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useUser } from '@/context/UserContext';
import { streamingService } from '@/services/streaming';
import { StreamingProgress, Movie } from '@/types';

type ProgressMap = {
  [movieId: string]: StreamingProgress;
};

type ProgressContextType = {
  progressData: ProgressMap;
  getMovieProgress: (movieId: string) => StreamingProgress | null;
  getProgressForMovie: (movie: Movie) => StreamingProgress | null;
  refreshProgress: () => Promise<void>;
  updateLocalProgress: (progress: StreamingProgress) => void;
  isLoading: boolean;
};

const ProgressContext = createContext<ProgressContextType | undefined>(undefined);

export const ProgressProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useUser();
  const [progressData, setProgressData] = useState<ProgressMap>({});
  const [isLoading, setIsLoading] = useState(true);

  const refreshProgress = useCallback(async () => {
    if (!currentUser) {
      setProgressData({});
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      // Get all user's progress entries (with a high limit to get all)
      const progressEntries = await streamingService.getRecentProgress(currentUser.id, 100);
      
      // Convert array to map with movie_id as the key
      const progressMap: ProgressMap = {};
      progressEntries.forEach(entry => {
        // Keep only the most recent entry for each movie
        if (!progressMap[entry.movie_id] || 
            new Date(entry.last_watched_at) > new Date(progressMap[entry.movie_id].last_watched_at)) {
          progressMap[entry.movie_id] = entry;
        }
      });
      
      setProgressData(progressMap);
    } catch (error) {
      console.error('Failed to fetch user progress:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  // Load all progress data when context mounts or user changes
  useEffect(() => {
    if (currentUser) {
      refreshProgress();
    } else {
      setProgressData({});
      setIsLoading(false);
    }
  }, [currentUser, refreshProgress]);

  // Get progress for a specific movie by ID
  const getMovieProgress = useCallback((movieId: string): StreamingProgress | null => {
    return progressData[movieId] || null;
  }, [progressData]);
  
  // Get progress for a Movie object (matching by title or link)
  const getProgressForMovie = useCallback((movie: Movie): StreamingProgress | null => {
    // First try to find progress by exact movie ID (which could be the link)
    if (progressData[movie.link]) {
      return progressData[movie.link];
    }
    
    // Then try to match by title
    const titleMatch = Object.values(progressData).find(
      progress => progress.movie_id === movie.title
    );
    
    return titleMatch || null;
  }, [progressData]);

  // Update progress locally (to avoid refetching)
  const updateLocalProgress = useCallback((progress: StreamingProgress) => {
    setProgressData(prev => ({
      ...prev,
      [progress.movie_id]: progress
    }));
  }, []);
  
  // Save current progress before unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Do a final progress refresh before the page unloads
      refreshProgress();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [refreshProgress]);

  return (
    <ProgressContext.Provider 
      value={{ 
        progressData, 
        getMovieProgress, 
        getProgressForMovie,
        refreshProgress, 
        updateLocalProgress,
        isLoading
      }}
    >
      {children}
    </ProgressContext.Provider>
  );
};

export const useProgress = () => {
  const context = useContext(ProgressContext);
  if (context === undefined) {
    throw new Error('useProgress must be used within a ProgressProvider');
  }
  return context;
};