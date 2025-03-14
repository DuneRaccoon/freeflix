import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Movie } from '@/types';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination, Keyboard, A11y, Autoplay } from 'swiper/modules';
import MovieCard from '@/components/movies/MovieCard';
import Button from '@/components/ui/Button';
import { ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/24/outline';

import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';

interface MovieCarouselProps {
  movies: Movie[];
  title: string;
  isLoading?: boolean;
  viewAllLink?: string;
  viewAllLabel?: string;
  onDownload?: (movieId: string, quality: string) => void;
}

const MovieCarousel: React.FC<MovieCarouselProps> = ({
  movies,
  title,
  isLoading = false,
  viewAllLink,
  viewAllLabel = 'View All',
  onDownload,
}) => {
  const [swiper, setSwiper] = useState<any>(null);
  const [isBeginning, setIsBeginning] = useState(true);
  const [isEnd, setIsEnd] = useState(false);

  useEffect(() => {
    if (swiper) {
      const updateState = () => {
        setIsBeginning(swiper.isBeginning);
        setIsEnd(swiper.isEnd);
      };

      swiper.on('slideChange', updateState);
      swiper.on('snapGridLengthChange', updateState);
      
      // Initial state
      updateState();

      return () => {
        swiper.off('slideChange', updateState);
        swiper.off('snapGridLengthChange', updateState);
      };
    }
  }, [swiper]);

  // Navigation prev/next buttons
  const navigationPrevRef = React.useRef<HTMLButtonElement>(null);
  const navigationNextRef = React.useRef<HTMLButtonElement>(null);

  // Empty state for when there are no movies or the component is loading
  if ((movies.length === 0 && !isLoading) || (isLoading && movies.length === 0)) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold">{title}</h2>
        </div>
        <div className="bg-card rounded-lg p-12 text-center">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="animate-pulse">
                  <div className="bg-gray-700 rounded-lg h-64"></div>
                  <div className="mt-2 bg-gray-700 h-6 rounded w-3/4"></div>
                  <div className="mt-1 bg-gray-700 h-4 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No movies found</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">{title}</h2>
        <div className="flex items-center space-x-2">
          {/* Custom navigation buttons */}
          <button
            ref={navigationPrevRef}
            className={`p-2 rounded-full ${
              isBeginning
                ? 'text-gray-500 cursor-not-allowed'
                : 'text-white bg-primary-600 hover:bg-primary-700'
            }`}
            disabled={isBeginning}
            aria-label="Previous slide"
          >
            <ArrowLeftIcon className="w-4 h-4" />
          </button>
          <button
            ref={navigationNextRef}
            className={`p-2 rounded-full ${
              isEnd
                ? 'text-gray-500 cursor-not-allowed'
                : 'text-white bg-primary-600 hover:bg-primary-700'
            }`}
            disabled={isEnd}
            aria-label="Next slide"
          >
            <ArrowRightIcon className="w-4 h-4" />
          </button>
          
          {viewAllLink && (
            <Link href={viewAllLink}>
              <Button variant="outline" size="sm" className="ml-2">
                {viewAllLabel}
              </Button>
            </Link>
          )}
        </div>
      </div>

      {isLoading && movies.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="animate-pulse">
              <div className="bg-gray-700 rounded-lg h-64"></div>
              <div className="mt-2 bg-gray-700 h-6 rounded w-3/4"></div>
              <div className="mt-1 bg-gray-700 h-4 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      ) : (
        <Swiper
          modules={[Navigation, Pagination, Keyboard, A11y, Autoplay]}
          spaceBetween={20}
          slidesPerView={1}
          navigation={{
            prevEl: navigationPrevRef.current,
            nextEl: navigationNextRef.current,
          }}
          keyboard={{
            enabled: true,
          }}
          pagination={{
            clickable: true,
            dynamicBullets: true,
          }}
          breakpoints={{
            // when window width is >= 640px
            640: {
              slidesPerView: 2,
            },
            // when window width is >= 768px
            768: {
              slidesPerView: 3,
            },
            // when window width is >= 1024px
            1024: {
              slidesPerView: 4,
            },
            // when window width is >= 1280px
            1280: {
              slidesPerView: 5,
            },
          }}
          grabCursor={true}
          loop={false}
          className="movie-carousel"
          onSwiper={setSwiper}
        >
          {movies.map((movie) => (
            <SwiperSlide key={movie.link} className="h-auto">
              <MovieCard movie={movie} onDownload={onDownload} />
            </SwiperSlide>
          ))}
        </Swiper>
      )}
    </div>
  );
};

export default MovieCarousel;