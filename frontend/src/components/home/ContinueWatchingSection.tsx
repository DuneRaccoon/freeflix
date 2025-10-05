"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { useProgress } from '@/context/ProgressContext';
import { useUser } from '@/context/UserContext';
import { ArrowRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { PlayIcon } from '@heroicons/react/24/solid';
import Image from 'next/image';
import WatchProgressBar from '@/components/ui/WatchProgressBar';
import { StreamingProgress } from '@/types';
import { streamingService } from '@/services/streaming';
import { formatTime } from '@/utils/format';

const ContinueWatchingSection: React.FC = () => {
  const { currentUser } = useUser();
  const { progressData, refreshProgress } = useProgress();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [movieImages, setMovieImages] = useState<Record<string, string>>({});
  
  // Get in-progress movies (not completed and with progress > 0)
  const inProgressItems = useMemo(() => {
    return Object.values(progressData)
      .filter(item => !item.completed && item.percentage > 0)
      .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime())
      .slice(0, 6);
  }, [progressData]);
  
  // Fetch movie images
  useEffect(() => {
    if (inProgressItems.length === 0) {
      // Clear images if nothing to show and avoid unnecessary work
      if (Object.keys(movieImages).length > 0) {
        setMovieImages({});
      }
      return;
    }

    const nextImageKeys = inProgressItems.map(item => item.movie_id).sort();
    const currentKeys = Object.keys(movieImages).sort();
    const keysUnchanged = nextImageKeys.length === currentKeys.length && nextImageKeys.every((k, i) => k === currentKeys[i]);
    if (keysUnchanged) return; // nothing new to load

    const fetchMovieImages = async () => {
      setIsLoading(true);
      const newImages: Record<string, string> = {};
      
      for (const item of inProgressItems) {
        try {
          // Placeholder for now; replace with real posters when available
          newImages[item.movie_id] = `/api/placeholder/${400}/${600}`;
        } catch (error) {
          console.error('Failed to fetch movie image:', error);
          newImages[item.movie_id] = `/api/placeholder/${400}/${600}`;
        }
      }
      
      setMovieImages(newImages);
      setIsLoading(false);
    };
    
    fetchMovieImages();
  }, [inProgressItems, movieImages]);
  
  // Handle continue watching
  const handleContinueWatching = (item: StreamingProgress) => {
    if (item.torrent_id) {
      router.push(`/streaming/${item.torrent_id}`);
    }
  };
  
  // Handle remove from continue watching
  const handleRemove = async (item: StreamingProgress) => {
    if (!currentUser) return;
    
    try {
      await streamingService.deleteProgress(currentUser.id, item.id);
      refreshProgress();
    } catch (error) {
      console.error('Failed to remove from continue watching:', error);
    }
  };
  
  // If no items, don't render the section
  if (inProgressItems.length === 0) return null;

  return (
    <Card className="mb-8">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Continue Watching</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          rightIcon={<ArrowRightIcon className="w-4 h-4" />}
          onClick={() => router.push('/my-movies')}
        >
          See All
        </Button>
      </CardHeader>
      
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {inProgressItems.map((item) => (
            <div key={item.id} className="relative group">
              <div 
                className="rounded-lg overflow-hidden cursor-pointer" 
                onClick={() => handleContinueWatching(item)}
              >
                <div className="aspect-[2/3] relative bg-gray-800">
                  {movieImages[item.movie_id] && (
                    <Image
                      src={movieImages[item.movie_id]}
                      alt={item.movie_id}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 50vw, 33vw"
                    />
                  )}
                  
                  {/* Overlay with play button */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="bg-primary-600 rounded-full p-3">
                      <PlayIcon className="w-8 h-8 text-white" />
                    </div>
                  </div>
                  
                  {/* Remove button */}
                  <button
                    className="absolute top-2 right-2 bg-black/70 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(item);
                    }}
                  >
                    <XMarkIcon className="w-5 h-5 text-white" />
                  </button>
                </div>
                
                {/* Progress information */}
                <div className="p-2">
                  <h3 className="text-sm font-medium line-clamp-1">{item.movie_id}</h3>
                  <div className="flex justify-between text-xs text-gray-400 mt-1 mb-2">
                    <span>
                      {item.duration 
                        ? `${formatTime(item.current_time)} / ${formatTime(item.duration)}`
                        : formatTime(item.current_time)}
                    </span>
                    <span>{Math.round(item.percentage)}%</span>
                  </div>
                  <WatchProgressBar progress={item.percentage} height="h-1" showTooltip={false} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default ContinueWatchingSection;