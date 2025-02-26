import React, { useState } from 'react';
import Image from 'next/image';
import { Movie } from '@/types';
import { Card, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { StarIcon } from '@heroicons/react/24/solid';
import { torrentsService } from '@/services/torrents';
import { toast } from 'react-hot-toast';

interface MovieCardProps {
  movie: Movie;
  onDownload?: (movieId: string, quality: string) => void;
}

const MovieCard: React.FC<MovieCardProps> = ({ movie, onDownload }) => {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  // Handle download button click
  const handleDownload = async (quality: string) => {
    try {
      setLoading(quality);
      
      // Call the API to download the movie
      await torrentsService.downloadMovie({
        movie_id: movie.link,
        quality: quality as '720p' | '1080p' | '2160p',
      });
      
      toast.success(`Added ${movie.title} (${quality}) to download queue`);
      
      // Call the onDownload callback if provided
      if (onDownload) {
        onDownload(movie.link, quality);
      }
    } catch (error) {
      console.error('Error downloading movie:', error);
      toast.error('Failed to add movie to download queue');
    } finally {
      setLoading(null);
    }
  };

  // Get available qualities
  const availableQualities = movie.torrents.map(t => t.quality);

  return (
    <Card className="h-full flex flex-col transform transition-all duration-300 hover:scale-[1.02] hover:shadow-lg">
      <div className="relative pb-[150%] overflow-hidden">
        <Image
          src={movie.img}
          alt={movie.title}
          fill
          className="object-cover rounded-t-lg"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          priority={false}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex flex-col justify-end">
          <h3 className="text-lg font-bold text-white line-clamp-2">{movie.title}</h3>
          <div className="flex items-center mt-1 text-sm text-gray-300">
            <span className="mr-2">{movie.year}</span>
            <div className="flex items-center">
              <StarIcon className="w-4 h-4 text-yellow-500 mr-1" />
              <span>{movie.rating}</span>
            </div>
          </div>
        </div>
      </div>
      
      <CardContent className="flex-grow flex flex-col justify-between p-3">
        <div>
          <div className="flex flex-wrap gap-1 mb-2">
            {movie.genre.split(', ').map((genre, index) => (
              <Badge key={index} variant="secondary" size="sm">
                {genre}
              </Badge>
            ))}
          </div>
          
          {expanded && (
            <div className="text-sm text-gray-400 mb-4 animate-slide-up">
              <p className="text-xs mb-2">Available in: {availableQualities.join(', ')}</p>
              <p className="text-xs">
                Size: {movie.torrents.find(t => t.quality === '1080p')?.sizes[0] || 'N/A'}
              </p>
            </div>
          )}
        </div>
        
        <div className="mt-2">
          {expanded ? (
            <div className="grid grid-cols-2 gap-2 animate-slide-up">
              {availableQualities.includes('720p') && (
                <Button 
                  size="sm" 
                  variant="outline"
                  isLoading={loading === '720p'}
                  disabled={!!loading}
                  onClick={() => handleDownload('720p')}
                >
                  720p
                </Button>
              )}
              {availableQualities.includes('1080p') && (
                <Button 
                  size="sm" 
                  variant="primary"
                  isLoading={loading === '1080p'}
                  disabled={!!loading}
                  onClick={() => handleDownload('1080p')}
                >
                  1080p
                </Button>
              )}
              {availableQualities.includes('2160p') && (
                <Button 
                  size="sm" 
                  variant="secondary"
                  isLoading={loading === '2160p'}
                  disabled={!!loading}
                  onClick={() => handleDownload('2160p')}
                >
                  4K
                </Button>
              )}
            </div>
          ) : (
            <Button 
              size="sm" 
              variant="ghost" 
              className="w-full"
              onClick={() => setExpanded(true)}
            >
              Download
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default MovieCard;