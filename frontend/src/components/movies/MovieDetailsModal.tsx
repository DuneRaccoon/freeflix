import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { fadeIn, slideUp, staggerContainer } from '@/components/ui/Motion';
import { useRouter } from 'next/navigation';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { 
  XMarkIcon, 
  StarIcon, 
  ClockIcon, 
  FilmIcon, 
  GlobeAltIcon, 
  TrophyIcon,
  LanguageIcon,
  FlagIcon,
  CalendarIcon,
  ArrowsUpDownIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowTopRightOnSquareIcon,
  ArrowDownTrayIcon,
  PlayIcon
} from '@heroicons/react/24/solid';
import { 
  QuestionMarkCircleIcon, 
  BookOpenIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  LinkIcon,
  FilmIcon as FilmIconOutline,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import { moviesService } from '@/services/movies';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Progress from '@/components/ui/Progress';
import { torrentsService } from '@/services/torrents';
import { toast } from 'react-hot-toast';
import { DetailedMovie, Torrent } from '@/types';
import { 
  RottenTomatoesAudienceIcon,
  RottenTomatoesIcon
} from '@/components/icons';
import { handleStreamingStart } from '@/utils/streaming';

interface MovieDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  movieId: string | null; // Can be URL or ID
  onDownload?: (movieId: string, quality: string) => void;
}

const MovieDetailsModal: React.FC<MovieDetailsModalProps> = ({
  isOpen,
  onClose,
  movieId,
  onDownload
}) => {
  const router = useRouter();
  const [streamingQuality, setStreamingQuality] = useState<string | null>(null);
  const [movie, setMovie] = useState<DetailedMovie | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'cast' | 'reviews' | 'related'>('overview');
  const [downloadQuality, setDownloadQuality] = useState<string | null>(null);
  const [reviewSort, setReviewSort] = useState<'date' | 'rating'>('rating');
  const [reviewSortDirection, setReviewSortDirection] = useState<'asc' | 'desc'>('desc');
  const [reviewFilter, setReviewFilter] = useState<string>('all');

  // Fetch movie details when modal opens
  useEffect(() => {
    const fetchMovieDetails = async () => {
      if (!movieId || !isOpen) return;
      
      try {
        setIsLoading(true);
        setError(null);
        
        const data = await moviesService.getMovieDetails(movieId);
        setMovie(data);
      } catch (err) {
        console.error('Error fetching movie details:', err);
        setError('Failed to load movie details. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchMovieDetails();
  }, [movieId, isOpen]);

  // Handle download button click
  const handleDownload = async (quality: string) => {
    if (!movie) return;
    
    try {
      setDownloadQuality(quality);
      
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
      setTimeout(() => {
        setDownloadQuality(null);
      }, 2000);
    }
  };

  const handleStream = async (quality: string) => {
    if (!movie) return;
    
    try {
      setStreamingQuality(quality);
      
      // Start the download and navigate to streaming page
      const torrentStatus = await handleStreamingStart({
        movie_id: movie.link,
        quality: quality as '720p' | '1080p' | '2160p'
      });
      
      if (torrentStatus?.id) {
        onClose(); // Close the modal before navigating
        router.push(`/streaming/${torrentStatus.id}`);
      }
    } catch (error) {
      console.error('Error starting stream:', error);
      toast.error('Failed to start streaming. Please try again.');
    } finally {
      setStreamingQuality(null);
    }
  };

  // Format IMDB rating as stars
  const renderStars = (rating: string | null) => {
    if (!rating) return null;
    
    const numRating = parseFloat(rating);
    const fullStars = Math.floor(numRating);
    const hasHalfStar = numRating % 1 >= 0.5;
    const maxStars = 10;
    
    return (
      <div className="flex items-center">
        <div className="flex">
          {Array.from({ length: fullStars }).map((_, i) => (
            <StarIcon key={`full-${i}`} className="h-4 w-4 text-yellow-500" />
          ))}
          {hasHalfStar && (
            <div className="relative">
              <StarIcon className="h-4 w-4 text-gray-400" />
              <div className="absolute inset-0 overflow-hidden w-1/2">
                <StarIcon className="h-4 w-4 text-yellow-500" />
              </div>
            </div>
          )}
          {Array.from({ length: maxStars - fullStars - (hasHalfStar ? 1 : 0) }).map((_, i) => (
            <StarIcon key={`empty-${i}`} className="h-4 w-4 text-gray-400" />
          ))}
        </div>
        <span className="ml-1 text-yellow-500">{numRating}/10</span>
      </div>
    );
  };

  // Format Rotten Tomatoes rating
  const renderTomatoMeter = (rating: string | null, count: number | null = null) => {
    if (!rating) return null;
    
    const percentage = parseInt(rating.replace('%', ''));
    const isFresh = percentage >= 60;
    
    return (
      <div className="flex items-center">
        <div className={`p-1 rounded-full ${isFresh ? 'bg-green-600' : 'bg-red-600'}`}>
          {isFresh ? (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
          ) : (
            <XMarkIcon className="w-4 h-4 text-white" />
          )}
        </div>
        <span className={`ml-1 ${isFresh ? 'text-green-600' : 'text-red-600'}`}>
          {rating}
          {count && <span className="text-xs text-gray-400 ml-1">({count} reviews)</span>}
        </span>
      </div>
    );
  };

  // Format Metacritic rating
  const renderMetacritic = (rating: string | null, count: number | null = null) => {
    if (!rating) return null;
    
    const score = parseInt(rating);
    let color = 'bg-red-600';
    if (score >= 75) color = 'bg-green-600';
    else if (score >= 50) color = 'bg-yellow-500';
    
    return (
      <div className="flex items-center">
        <div className={`${color} rounded px-1.5 py-0.5`}>
          <span className="text-white font-bold text-sm">{score}</span>
        </div>
        {count && <span className="text-xs text-gray-400 ml-1">({count} reviews)</span>}
      </div>
    );
  };

  // Get sorted and filtered reviews
  const getSortedAndFilteredReviews = () => {
    if (!movie || !movie.reviews) return [];
    
    // Filter reviews
    let filteredReviews = movie.reviews;
    if (reviewFilter !== 'all') {
      filteredReviews = movie.reviews.filter(review => review.source === reviewFilter);
    }
    
    // Sort reviews
    return [...filteredReviews].sort((a, b) => {
      // Sort by date
      if (reviewSort === 'date') {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return reviewSortDirection === 'asc' ? dateA - dateB : dateB - dateA;
      }
      
      // Sort by rating
      const ratingA = a.rating ? parseFloat(a.rating.replace('%', '')) : 0;
      const ratingB = b.rating ? parseFloat(b.rating.replace('%', '')) : 0;
      return reviewSortDirection === 'asc' ? ratingA - ratingB : ratingB - ratingA;
    });
  };

  // Toggle review sort direction
  const toggleSortDirection = () => {
    setReviewSortDirection(prevDirection => prevDirection === 'asc' ? 'desc' : 'asc');
  };

  // Format review date
  const formatReviewDate = (dateString: string | null) => {
    if (!dateString) return null;
    
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch (e) {
      return dateString;
    }
  };

  // Get unique review sources
  const getReviewSources = () => {
    if (!movie || !movie.reviews) return [];
    
    const sources = movie.reviews.map(review => review.source);
    return ['all', ...new Set(sources)];
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <Dialog
        open={isOpen}
        onClose={onClose}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/70" aria-hidden="true" />
        
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="mx-auto rounded-lg bg-gray-900 shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="animate-pulse">
              <div className="h-64 bg-gray-800 w-full"></div>
              <div className="p-6">
                <div className="h-8 bg-gray-800 w-3/4 mb-4"></div>
                <div className="h-4 bg-gray-800 w-1/2 mb-8"></div>
                <div className="h-4 bg-gray-800 w-full mb-2"></div>
                <div className="h-4 bg-gray-800 w-full mb-2"></div>
                <div className="h-4 bg-gray-800 w-3/4 mb-6"></div>
                
                <div className="flex space-x-2 mb-6">
                  <div className="h-10 bg-gray-800 w-24 rounded-md"></div>
                  <div className="h-10 bg-gray-800 w-24 rounded-md"></div>
                  <div className="h-10 bg-gray-800 w-24 rounded-md"></div>
                </div>
              </div>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    );
  }

  // Error state
  if (error) {
    return (
      <Dialog
        open={isOpen}
        onClose={onClose}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/70" aria-hidden="true" />
        
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="mx-auto rounded-lg bg-gray-900 shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="text-center">
                <QuestionMarkCircleIcon className="h-16 w-16 text-red-500 mx-auto mb-4" />
                <DialogTitle as="h3" className="text-xl font-semibold mb-2">
                  Error Loading Movie
                </DialogTitle>
                <p className="text-gray-400 mb-6">{error}</p>
                <Button onClick={onClose}>Close</Button>
              </div>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    );
  }

  // No movie data yet
  if (!movie) return null;

  // Determine backdrop image
  const backdropImage = movie.media.backdrop || movie.media.poster;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      className="relative z-50"
    >
      {/* Backdrop overlay */}
      <div className="fixed inset-0 bg-black/80" aria-hidden="true" />
      
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto rounded-lg bg-gray-900 shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden glass-card">
          {/* Header with backdrop */}
          <div 
            className="relative h-72 w-full bg-cover bg-center"
            style={{ 
              backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.2), rgba(23, 23, 23, 0.8)), url(${backdropImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center top'
            }}
          >
            {/* Close button */}
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-full bg-black/50 hover:bg-black/80 text-white transition-colors z-10"
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
            
            {/* Movie title and metadata */}
            <motion.div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-gray-900 to-transparent"
              variants={staggerContainer(0.06, 0.1)} initial="hidden" animate="visible">
              <div className="flex items-end gap-6">
                {/* Poster thumbnail */}
                <motion.div className="hidden sm:block w-32 h-48 rounded-md overflow-hidden shadow-lg flex-shrink-0 border border-gray-700 transform -translate-y-6" variants={slideUp}>
                  <img src={movie.media.poster} alt={movie.title} className="w-full h-full object-cover" />
                </motion.div>
                
                {/* Title and metadata */}
                <div className="flex-1">
                  <motion.h2 className="text-2xl md:text-3xl font-bold text-white drop-shadow-lg mb-2" variants={slideUp}>
                    {movie.title} <span className="text-gray-300">({movie.year})</span>
                  </motion.h2>
                  <motion.div className="flex flex-wrap gap-2 mb-3" variants={fadeIn}>
                    {movie.genre.split(', ').map((genre) => (
                      <Badge key={genre} variant="secondary" size="md">
                        {genre}
                      </Badge>
                    ))}
                    {movie.runtime && (
                      <Badge variant="default" size="md" className="flex items-center">
                        <ClockIcon className="w-3 h-3 mr-1" />
                        {movie.runtime}
                      </Badge>
                    )}
                  </motion.div>
                  
                  {/* Ratings bar */}
                  <motion.div className="flex flex-wrap gap-4" variants={fadeIn}>
                    {movie.ratings.imdb && (
                      <div className="flex items-center gap-1">
                        <img 
                          src="https://upload.wikimedia.org/wikipedia/commons/6/69/IMDB_Logo_2016.svg" 
                          alt="IMDB" 
                          className="h-4 w-auto"
                        />
                        {renderStars(movie.ratings.imdb)}
                      </div>
                    )}
                    
                    {movie.ratings.rottenTomatoes && (
                      <div className="flex items-center">
                        {renderTomatoMeter(movie.ratings.rottenTomatoes)}
                      </div>
                    )}
                    
                    {movie.ratings.metacritic && (
                      <div className="flex items-center">
                        {renderMetacritic(movie.ratings.metacritic)}
                      </div>
                    )}
                  </motion.div>
                </div>
              </div>
            </motion.div>
          </div>
          
          {/* Tabs */}
          <div className="border-b border-gray-800">
            <nav className="flex overflow-x-auto scrollbar-hide">
              <button
                onClick={() => setActiveTab('overview')}
                className={`py-3 px-4 font-medium text-sm border-b-2 whitespace-nowrap ${
                  activeTab === 'overview' 
                    ? 'border-primary-500 text-primary-500' 
                    : 'border-transparent text-gray-400 hover:text-gray-300'
                }`}
              >
                <InformationCircleIcon className="w-4 h-4 inline mr-1" />
                Overview
              </button>
              <button
                onClick={() => setActiveTab('cast')}
                className={`py-3 px-4 font-medium text-sm border-b-2 whitespace-nowrap ${
                  activeTab === 'cast' 
                    ? 'border-primary-500 text-primary-500' 
                    : 'border-transparent text-gray-400 hover:text-gray-300'
                }`}
              >
                <UserGroupIcon className="w-4 h-4 inline mr-1" />
                Cast & Crew
              </button>
              <button
                onClick={() => setActiveTab('reviews')}
                className={`py-3 px-4 font-medium text-sm border-b-2 whitespace-nowrap ${
                  activeTab === 'reviews' 
                    ? 'border-primary-500 text-primary-500' 
                    : 'border-transparent text-gray-400 hover:text-gray-300'
                }`}
              >
                <ChatBubbleLeftRightIcon className="w-4 h-4 inline mr-1" />
                Reviews
                {movie.reviews.length > 0 && 
                  <span className="ml-1 text-xs bg-gray-700 rounded-full px-2 py-0.5">
                    {movie.reviews.length}
                  </span>
                }
              </button>
              {movie.related_movies && movie.related_movies.length > 0 && (
                <button
                  onClick={() => setActiveTab('related')}
                  className={`py-3 px-4 font-medium text-sm border-b-2 whitespace-nowrap ${
                    activeTab === 'related' 
                      ? 'border-primary-500 text-primary-500' 
                      : 'border-transparent text-gray-400 hover:text-gray-300'
                  }`}
                >
                  <FilmIconOutline className="w-4 h-4 inline mr-1" />
                  Related Movies
                </button>
              )}
            </nav>
          </div>
          
          {/* Content */}
          <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 22rem)' }}>
            <div className="flex flex-col md:flex-row gap-6">
              {/* Sidebar (visible on all tabs) */}
              <div className="w-full md:w-1/3 flex-shrink-0">
                {/* Download buttons */}
                <div className="bg-gray-800/70 rounded-lg p-4 mb-6">
                  <h3 className="text-lg font-semibold mb-3">Watch Options</h3>
                  <div className="space-y-3">
                    {movie?.torrents.map((torrent: Torrent) => (
                      <div key={torrent.quality} className="flex gap-2">
                        <Button
                          variant={torrent.quality === '1080p' ? 'primary' : torrent.quality === '2160p' ? 'secondary' : 'outline'}
                          size="sm"
                          className="flex-1"
                          leftIcon={<ArrowDownTrayIcon className="w-4 h-4" />}
                          onClick={() => handleDownload(torrent.quality)}
                          isLoading={downloadQuality === torrent.quality}
                        >
                          Download {torrent.quality}
                        </Button>
                        <Button
                          variant={torrent.quality === '1080p' ? 'primary' : torrent.quality === '2160p' ? 'secondary' : 'outline'}
                          size="sm"
                          className="flex-1"
                          leftIcon={<PlayIcon className="w-4 h-4" />}
                          onClick={() => handleStream(torrent.quality)}
                          isLoading={streamingQuality === torrent.quality}
                        >
                          Stream {torrent.quality}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Info Card */}
                <div className="bg-gray-800/70 rounded-lg p-4 mb-6">
                  <h3 className="text-lg font-semibold mb-3">Movie Info</h3>
                  <div className="space-y-2 text-sm">
                    {movie.runtime && (
                      <div className="flex items-start">
                        <ClockIcon className="w-4 h-4 mt-0.5 mr-2 text-gray-400" />
                        <div>
                          <span className="text-gray-400">Runtime:</span>
                          <span className="block text-white">{movie.runtime}</span>
                        </div>
                      </div>
                    )}
                    
                    {movie.language && (
                      <div className="flex items-start">
                        <LanguageIcon className="w-4 h-4 mt-0.5 mr-2 text-gray-400" />
                        <div>
                          <span className="text-gray-400">Language:</span>
                          <span className="block text-white">{movie.language}</span>
                        </div>
                      </div>
                    )}
                    
                    {movie.country && (
                      <div className="flex items-start">
                        <FlagIcon className="w-4 h-4 mt-0.5 mr-2 text-gray-400" />
                        <div>
                          <span className="text-gray-400">Country:</span>
                          <span className="block text-white">{movie.country}</span>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex items-start">
                      <CalendarIcon className="w-4 h-4 mt-0.5 mr-2 text-gray-400" />
                      <div>
                        <span className="text-gray-400">Year:</span>
                        <span className="block text-white">{movie.year}</span>
                      </div>
                    </div>
                    
                    {movie.imdb_id && (
                      <div className="flex items-start">
                        <LinkIcon className="w-4 h-4 mt-0.5 mr-2 text-gray-400" />
                        <div>
                          <span className="text-gray-400">External Links:</span>
                          <a 
                            href={`https://www.imdb.com/title/${movie.imdb_id}`}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-primary-400 hover:text-primary-300 flex items-center"
                          >
                            IMDB
                            <ArrowTopRightOnSquareIcon className="h-3 w-3 ml-1" />
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Ratings Card */}
                <div className="bg-gray-800/70 rounded-lg p-4">
                  <h3 className="text-lg font-semibold mb-3">Ratings</h3>
                  <div className="space-y-4">
                    {movie.ratings.imdb && (
                      <div className="pb-3 border-b border-gray-700">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <img 
                              src="https://upload.wikimedia.org/wikipedia/commons/6/69/IMDB_Logo_2016.svg" 
                              alt="IMDB" 
                              className="h-5 w-auto mr-2"
                            />
                            <span className="font-medium">IMDB</span>
                          </div>
                          <div className="text-yellow-500 font-semibold">
                            {movie.ratings.imdb} / 10
                          </div>
                        </div>
                        <div className="mt-2">
                          {renderStars(movie.ratings.imdb)}
                        </div>
                        {movie.ratings.imdbVotes && (
                          <div className="text-xs text-gray-400 mt-1">
                            based on {movie.ratings.imdbVotes.toLocaleString()} votes
                          </div>
                        )}
                      </div>
                    )}
                    
                    {movie.ratings.rottenTomatoes && (
                      <div className="pb-3 border-b border-gray-700">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <RottenTomatoesIcon type={ parseInt(movie.ratings.rottenTomatoes.replace('%', '')) > 60 ? 'positive' : 'negative'}/>
                            <span className="font-medium">Critics</span>
                          </div>
                          <div className={`font-semibold ${parseInt(movie.ratings.rottenTomatoes.replace('%', '')) >= 60 ? 'text-green-600' : 'text-red-600'}`}>
                            {movie.ratings.rottenTomatoes}
                          </div>
                        </div>
                        {movie.ratings.rottenTomatoesCount && (
                          <div className="text-xs text-gray-400 mt-1">
                            based on {movie.ratings.rottenTomatoesCount.toLocaleString()} reviews
                          </div>
                        )}
                      </div>
                    )}
                    
                    {movie.ratings.rottenTomatoesAudience && (
                      <div className="pb-3 border-b border-gray-700">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <RottenTomatoesAudienceIcon />
                            <span className="font-medium">Audience</span>
                          </div>
                          <div className={`font-semibold ${parseInt(movie.ratings.rottenTomatoesAudience.replace('%', '')) >= 60 ? 'text-green-600' : 'text-red-600'}`}>
                            {movie.ratings.rottenTomatoesAudience}
                          </div>
                        </div>
                        {movie.ratings.rottenTomatoesAudienceCount && (
                          <div className="text-xs text-gray-400 mt-1">
                            based on {movie.ratings.rottenTomatoesAudienceCount.toLocaleString()} ratings
                          </div>
                        )}
                      </div>
                    )}
                    
                    {movie.ratings.metacritic && (
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <span className="font-medium">Metacritic</span>
                          </div>
                          <div className="font-semibold">
                            {renderMetacritic(movie.ratings.metacritic)}
                          </div>
                        </div>
                        {movie.ratings.metacriticCount && (
                          <div className="text-xs text-gray-400 mt-1">
                            based on {movie.ratings.metacriticCount.toLocaleString()} critic reviews
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Main content area */}
              <div className="w-full md:w-2/3">
                {/* Overview tab */}
                {activeTab === 'overview' && (
                  <div>
                    <h3 className="text-xl font-semibold mb-3">Synopsis</h3>
                    <p className="text-gray-300 mb-4">
                      {movie.plot || movie.description || "No synopsis available."}
                    </p>
                    
                    {/* Additional details */}
                    {movie.credits.director && (
                      <div className="mb-4">
                        <h4 className="text-lg font-medium mb-2">Director</h4>
                        <div className="bg-gray-800/50 p-3 rounded-lg">
                          <p className="font-semibold">{movie.credits.director}</p>
                        </div>
                      </div>
                    )}
                    
                    {/* Awards section */}
                    {movie.awards && (
                      <div className="mt-6">
                        <h3 className="text-lg font-semibold mb-2 flex items-center">
                          <TrophyIcon className="h-5 w-5 mr-2 text-yellow-500" />
                          Awards
                        </h3>
                        <div className="bg-gray-800/50 p-4 rounded-lg">
                          <p className="text-gray-200">{movie.awards}</p>
                        </div>
                      </div>
                    )}
                    
                    {/* Trailer */}
                    {movie.media.trailer && (
                      <div className="mt-6">
                        <h3 className="text-lg font-semibold mb-2 flex items-center">
                          <FilmIcon className="h-5 w-5 mr-2 text-primary-500" />
                          Trailer
                        </h3>
                        <div className="bg-gray-800/50 p-4 rounded-lg">
                          <div className="aspect-video rounded-md overflow-hidden">
                            <iframe
                              src={movie.media.trailer.replace('watch?v=', 'embed/')} 
                              title={`${movie.title} Trailer`}
                              allowFullScreen
                              className="w-full h-full"
                            ></iframe>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Cast tab */}
                {activeTab === 'cast' && (
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Cast & Crew</h3>
                    
                    {movie.credits.director && (
                      <div className="mb-6">
                        <h4 className="text-lg font-medium mb-2">Director</h4>
                        <div className="flex items-center bg-gray-800/50 p-3 rounded-lg">
                          <div className="bg-gray-700 rounded-full h-12 w-12 flex items-center justify-center mr-3">
                            <svg className="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </div>
                          <div>
                            <p className="font-semibold">{movie.credits.director}</p>
                            <p className="text-sm text-gray-400">Director</p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {movie.credits.cast && movie.credits.cast.length > 0 ? (
                      <div>
                        <h4 className="text-lg font-medium mb-2">Cast</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {movie.credits.cast.map((person, index) => (
                            <div 
                              key={`${person.name}-${index}`} 
                              className="flex items-center bg-gray-800/50 p-3 rounded-lg"
                            >
                              {person.image ? (
                                <img 
                                  src={person.image} 
                                  alt={person.name} 
                                  className="h-16 w-16 object-cover rounded-full mr-3"
                                />
                              ) : (
                                <div className="bg-gray-700 rounded-full h-16 w-16 flex items-center justify-center mr-3">
                                  <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                  </svg>
                                </div>
                              )}
                              <div>
                                <p className="font-semibold">{person.name}</p>
                                {person.character && (
                                  <p className="text-sm text-gray-400">{person.character}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-400">No cast information available.</p>
                    )}
                  </div>
                )}
                
                {/* Reviews tab */}
                {activeTab === 'reviews' && (
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4">
                      <h3 className="text-xl font-semibold">Reviews</h3>
                      
                      <div className="flex mt-2 sm:mt-0 space-x-2">
                        {/* Filter by source */}
                        <select
                          value={reviewFilter}
                          onChange={(e) => setReviewFilter(e.target.value)}
                          className="bg-gray-800 border border-gray-700 rounded-md text-sm p-1.5"
                        >
                          {getReviewSources().map(source => (
                            <option key={source} value={source}>
                              {source === 'all' ? 'All Sources' : source}
                            </option>
                          ))}
                        </select>
                        
                        {/* Sort options */}
                        <div className="flex border border-gray-700 rounded-md overflow-hidden">
                          <button
                            className={`px-2 py-1.5 text-xs ${reviewSort === 'rating' ? 'bg-gray-700' : 'bg-gray-800'}`}
                            onClick={() => setReviewSort('rating')}
                          >
                            Rating
                          </button>
                          <button
                            className={`px-2 py-1.5 text-xs ${reviewSort === 'date' ? 'bg-gray-700' : 'bg-gray-800'}`}
                            onClick={() => setReviewSort('date')}
                          >
                            Date
                          </button>
                          
                          <button
                            className="px-2 py-1.5 bg-gray-800 border-l border-gray-700"
                            onClick={toggleSortDirection}
                          >
                            {reviewSortDirection === 'asc' ? (
                              <ChevronUpIcon className="h-4 w-4" />
                            ) : (
                              <ChevronDownIcon className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    {movie.reviews && movie.reviews.length > 0 ? (
                      <div className="space-y-4">
                        {getSortedAndFilteredReviews().map((review, index) => (
                          <div key={index} className="bg-gray-800/50 p-4 rounded-lg">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <span className="font-semibold">
                                  {review.author || 'Anonymous'}
                                </span>
                                <span className="text-xs text-gray-400 ml-2">
                                  via {review.source}
                                </span>
                                {review.date && (
                                  <span className="text-xs text-gray-400 ml-2">
                                    {formatReviewDate(review.date)}
                                  </span>
                                )}
                              </div>
                              {review.rating && (
                                <Badge variant={
                                  review.source.includes('Rotten Tomatoes') && parseInt(review.rating.replace('%', '') || '0') >= 60 ? 'success' : 
                                  review.source.includes('Rotten Tomatoes') ? 'danger' : 
                                  'primary'
                                } size="sm">
                                  {review.rating}
                                </Badge>
                              )}
                            </div>
                            <p className="text-gray-300 text-sm">
                              {review.content.length > 300 
                                ? (
                                  <>
                                    {review.content.substring(0, 300)}...
                                    {review.url && (
                                      <a 
                                        href={review.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-xs text-primary-500 hover:text-primary-400 ml-1 inline-flex items-center"
                                      >
                                        Read full review
                                        <ArrowTopRightOnSquareIcon className="h-3 w-3 ml-0.5" />
                                      </a>
                                    )}
                                  </>
                                )
                                : review.content
                              }
                            </p>
                            {review.url && review.content.length <= 300 && (
                              <a 
                                href={review.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-primary-500 hover:text-primary-400 mt-2 inline-flex items-center"
                              >
                                View on {review.source}
                                <ArrowTopRightOnSquareIcon className="h-3 w-3 ml-0.5" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <BookOpenIcon className="h-12 w-12 text-gray-500 mx-auto mb-2" />
                        <p className="text-gray-400">No reviews available.</p>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Related Movies tab */}
                {activeTab === 'related' && movie.related_movies && movie.related_movies.length > 0 && (
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Related Movies</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {movie.related_movies.map((relatedMovie, index) => (
                        <div key={index} className="bg-gray-800/50 rounded-lg overflow-hidden">
                          <div className="aspect-[2/3] relative">
                            {relatedMovie.image ? (
                              <img 
                                src={relatedMovie.image} 
                                alt={relatedMovie.title} 
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full bg-gray-700 flex items-center justify-center">
                                <FilmIconOutline className="h-12 w-12 text-gray-500" />
                              </div>
                            )}
                            {(relatedMovie.critic_score || relatedMovie.audience_score) && (
                              <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-1 flex justify-between">
                                {relatedMovie.critic_score && (
                                  <div className="flex items-center">
                                    <img 
                                      src="https://www.rottentomatoes.com/assets/pizza-pie/images/icons/tomatometer-empty.149b5e8adc3.svg" 
                                      alt="Critics" 
                                      className="h-4 w-4 mr-1" 
                                    />
                                    <span className={`text-xs ${relatedMovie.critic_score >= 60 ? 'text-green-500' : 'text-red-500'}`}>
                                      {relatedMovie.critic_score}%
                                    </span>
                                  </div>
                                )}
                                {relatedMovie.audience_score && (
                                  <div className="flex items-center">
                                    <img 
                                      src="https://www.rottentomatoes.com/assets/pizza-pie/images/icons/audience-empty.a0e89b8ad6f.svg" 
                                      alt="Audience" 
                                      className="h-4 w-4 mr-1" 
                                    />
                                    <span className={`text-xs ${relatedMovie.audience_score >= 60 ? 'text-green-500' : 'text-red-500'}`}>
                                      {relatedMovie.audience_score}%
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="p-2">
                            <h4 className="font-medium text-sm line-clamp-2 h-10">{relatedMovie.title}</h4>
                            <a 
                              href={relatedMovie.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-xs text-primary-500 hover:text-primary-400 mt-1 inline-flex items-center"
                            >
                              View details
                              <ArrowTopRightOnSquareIcon className="h-3 w-3 ml-0.5" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
};

export default MovieDetailsModal;