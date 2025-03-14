import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Movie } from '@/types';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Autoplay, Navigation, Pagination, EffectFade } from 'swiper/modules';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { PlayIcon, ArrowDownTrayIcon, StarIcon } from '@heroicons/react/24/solid';
import { torrentsService } from '@/services/torrents';
import { handleStreamingStart } from '@/utils/streaming';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';

// Import required Swiper styles
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import 'swiper/css/effect-fade';
import '@/styles/feature-carousel.css';

interface FeatureCarouselProps {
  movies: Movie[];
  isLoading?: boolean;
}

const FeatureCarousel: React.FC<FeatureCarouselProps> = ({ movies, isLoading = false }) => {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Handle stream button click
  const handleStream = async (movie: Movie, quality: string) => {
    try {
      setLoadingId(`stream-${movie.link}`);
      
      // Start the download and navigate to streaming page
      const torrentStatus = await handleStreamingStart({
        movie_id: movie.link,
        quality: quality as '720p' | '1080p' | '2160p'
      });
      
      if (torrentStatus?.id) {
        router.push(`/streaming/${torrentStatus.id}`);
      }
    } catch (error) {
      console.error('Error starting stream:', error);
      toast.error('Failed to start streaming. Please try again.');
    } finally {
      setLoadingId(null);
    }
  };

  // Handle download button click
  const handleDownload = async (movie: Movie, quality: string) => {
    try {
      setLoadingId(`download-${movie.link}`);
      
      // Call the API to download the movie
      await torrentsService.downloadMovie({
        movie_id: movie.link,
        quality: quality as '720p' | '1080p' | '2160p',
      });
      
      toast.success(`Added ${movie.title} (${quality}) to download queue`);
    } catch (error) {
      console.error('Error downloading movie:', error);
      toast.error('Failed to add movie to download queue');
    } finally {
      setLoadingId(null);
    }
  };

  // Get best available quality for a movie
  const getBestQuality = (movie: Movie): string => {
    if (movie.torrents.some(t => t.quality === '2160p')) return '2160p';
    if (movie.torrents.some(t => t.quality === '1080p')) return '1080p';
    return '720p';
  };

  // Loading skeleton
  if (isLoading || movies.length === 0) {
    return (
      <div className="w-full h-[400px] md:h-[500px] bg-gray-800 animate-pulse rounded-xl overflow-hidden">
        <div className="h-full w-full flex items-center justify-center">
          <div className="text-center">
            <div className="rounded-full h-12 w-12 bg-gray-700 animate-pulse mx-auto mb-4"></div>
            <div className="h-6 bg-gray-700 rounded w-36 mx-auto"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-[400px] md:h-[500px] overflow-hidden rounded-xl relative">
      <Swiper
        modules={[Autoplay, Navigation, Pagination, EffectFade]}
        slidesPerView={1}
        effect="fade"
        autoplay={{
          delay: 5000,
          disableOnInteraction: false,
        }}
        navigation
        pagination={{ clickable: true }}
        loop={true}
        className="h-full w-full feature-carousel"
      >
        {movies.map((movie) => {
          const bestQuality = getBestQuality(movie);
          
          return (
            <SwiperSlide key={movie.link} className="relative h-full">
              {/* Background Image with Gradient Overlay */}
              <div className="absolute inset-0 z-0">
                <Image
                  src={movie.img}
                  alt={movie.title}
                  fill
                  className="object-cover"
                  priority
                />
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/60 to-transparent"></div>
              </div>

              {/* Content */}
              <div className="relative z-10 h-full w-full flex flex-col justify-end p-8 md:p-12">
                <div className="max-w-2xl">
                  <div className="flex flex-wrap gap-2 mb-3">
                    {movie.genre.split(', ').slice(0, 3).map((genre, idx) => (
                      <Badge key={idx} variant="secondary" size="sm">
                        {genre}
                      </Badge>
                    ))}
                  </div>
                  
                  <h2 className="text-3xl md:text-4xl font-bold text-white mb-2">
                    {movie.title} <span className="text-xl md:text-2xl text-gray-300">({movie.year})</span>
                  </h2>
                  
                  <div className="flex items-center mb-4">
                    <div className="flex items-center mr-4">
                      <StarIcon className="w-5 h-5 text-yellow-500 mr-1" />
                      <span className="text-white">{movie.rating}</span>
                    </div>
                    <span className="text-gray-300">{bestQuality}</span>
                  </div>
                  
                  <p className="text-gray-300 text-base mb-6 line-clamp-2 md:line-clamp-3">
                    {movie.description || 'No description available.'}
                  </p>
                  
                  <div className="flex flex-wrap gap-4">
                    <Button
                      size="lg"
                      variant="primary"
                      leftIcon={<PlayIcon className="w-5 h-5" />}
                      isLoading={loadingId === `stream-${movie.link}`}
                      onClick={() => handleStream(movie, bestQuality)}
                    >
                      Watch Now
                    </Button>
                    
                    <Button
                      size="lg"
                      variant="outline"
                      leftIcon={<ArrowDownTrayIcon className="w-5 h-5" />}
                      isLoading={loadingId === `download-${movie.link}`}
                      onClick={() => handleDownload(movie, bestQuality)}
                    >
                      Download
                    </Button>
                    
                    <Link href={`/movies/${encodeURIComponent(movie.link)}`} className="hidden md:block">
                      <Button size="lg" variant="ghost">
                        More Info
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </SwiperSlide>
          );
        })}
      </Swiper>
    </div>
  );
};

export default FeatureCarousel;