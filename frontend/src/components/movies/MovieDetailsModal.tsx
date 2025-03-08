import React, { useState, useEffect } from 'react';
import { Dialog } from '@headlessui/react';
import { XMarkIcon, StarIcon, ClockIcon, FilmIcon } from '@heroicons/react/24/solid';
import { QuestionMarkCircleIcon, BookOpenIcon } from '@heroicons/react/24/outline';
import { moviesService } from '@/services/movies';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Progress from '@/components/ui/Progress';

// Define the detailed movie type
interface DetailedMovie {
  id: string;
  title: string;
  year: number;
  rating: string;
  link: string;
  genre: string;
  img: string;
  description: string | null;
  plot: string | null;
  runtime: string | null;
  language: string | null;
  country: string | null;
  imdb_id: string | null;
  awards: string | null;
  torrents: Array<{
    id: string;
    quality: string;
    sizes: [string, string];
    url: string;
    magnet: string;
  }>;
  ratings: {
    imdb: string | null;
    rottenTomatoes: string | null;
    metacritic: string | null;
  };
  credits: {
    director: string | null;
    cast: Array<{
      name: string;
      character: string | null;
      image: string | null;
    }>;
  };
  media: {
    poster: string;
    backdrop: string | null;
    trailer: string | null;
  };
  reviews: Array<{
    source: string;
    author: string | null;
    content: string;
    rating: string | null;
    url: string | null;
  }>;
}

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
  const [movie, setMovie] = useState<DetailedMovie | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'cast' | 'reviews'>('overview');
  const [downloadQuality, setDownloadQuality] = useState<string | null>(null);

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
  const handleDownload = (quality: string) => {
    if (!movie) return;
    
    setDownloadQuality(quality);
    
    if (onDownload) {
      onDownload(movie.link, quality);
    }
    
    // Reset download quality after 2 seconds
    setTimeout(() => {
      setDownloadQuality(null);
    }, 2000);
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
  const renderTomatoMeter = (rating: string | null) => {
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
        <span className={`ml-1 ${isFresh ? 'text-green-600' : 'text-red-600'}`}>{rating}</span>
      </div>
    );
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
          <Dialog.Panel className="mx-auto rounded-lg bg-gray-900 shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
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
          </Dialog.Panel>
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
          <Dialog.Panel className="mx-auto rounded-lg bg-gray-900 shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="text-center">
                <QuestionMarkCircleIcon className="h-16 w-16 text-red-500 mx-auto mb-4" />
                <Dialog.Title as="h3" className="text-xl font-semibold mb-2">
                  Error Loading Movie
                </Dialog.Title>
                <p className="text-gray-400 mb-6">{error}</p>
                <Button onClick={onClose}>Close</Button>
              </div>
            </div>
          </Dialog.Panel>
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
      <div className="fixed inset-0 bg-black/70" aria-hidden="true" />
      
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="mx-auto rounded-lg bg-gray-900 shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
          {/* Header with backdrop */}
          <div 
            className="relative h-64 w-full bg-cover bg-center"
            style={{ 
              backgroundImage: `linear-gradient(rgba(0, 0, 0, 0), rgba(23, 23, 23, 1)), url(${backdropImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center top'
            }}
          >
            {/* Close button */}
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-full bg-black/50 hover:bg-black/80 text-white transition-colors"
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
            
            {/* Movie title */}
            <div className="absolute bottom-4 left-6 right-6">
              <h2 className="text-2xl md:text-3xl font-bold text-white drop-shadow-lg">
                {movie.title} <span className="text-gray-300">({movie.year})</span>
              </h2>
            </div>
          </div>
          
          {/* Content */}
          <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 16rem)' }}>
            {/* Movie info and poster */}
            <div className="flex flex-col md:flex-row gap-6 mb-6">
              {/* Poster image */}
              <div className="w-full md:w-1/3 flex-shrink-0">
                <img 
                  src={movie.media.poster} 
                  alt={movie.title} 
                  className="w-full h-auto rounded-lg shadow-lg"
                />
                
                {/* Download buttons */}
                <div className="mt-4 space-y-2">
                  {movie.torrents.map((torrent) => (
                    <Button
                      key={torrent.quality}
                      variant={torrent.quality === '1080p' ? 'primary' : 'outline'}
                      size="sm"
                      className="w-full"
                      onClick={() => handleDownload(torrent.quality)}
                      isLoading={downloadQuality === torrent.quality}
                    >
                      Download {torrent.quality} ({torrent.sizes[0]})
                    </Button>
                  ))}
                </div>
              </div>
              
              {/* Movie details */}
              <div className="w-full md:w-2/3">
                {/* Metadata */}
                <div className="flex flex-wrap gap-2 mb-4">
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
                </div>
                
                {/* Ratings */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 bg-gray-800/40 p-4 rounded-lg">
                  {movie.ratings.imdb && (
                    <div>
                      <h4 className="text-xs text-gray-400 mb-1">IMDB Rating</h4>
                      {renderStars(movie.ratings.imdb)}
                    </div>
                  )}
                  {movie.ratings.rottenTomatoes && (
                    <div>
                      <h4 className="text-xs text-gray-400 mb-1">Rotten Tomatoes</h4>
                      {renderTomatoMeter(movie.ratings.rottenTomatoes)}
                    </div>
                  )}
                  {movie.ratings.metacritic && (
                    <div>
                      <h4 className="text-xs text-gray-400 mb-1">Metacritic</h4>
                      <span className="text-blue-500">{movie.ratings.metacritic}</span>
                    </div>
                  )}
                </div>
                
                {/* Tabs */}
                <div className="border-b border-gray-800 mb-4">
                  <nav className="flex space-x-8" aria-label="Tabs">
                    <button
                      onClick={() => setActiveTab('overview')}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${
                        activeTab === 'overview' 
                          ? 'border-primary-500 text-primary-500' 
                          : 'border-transparent text-gray-400 hover:text-gray-300'
                      }`}
                    >
                      Overview
                    </button>
                    <button
                      onClick={() => setActiveTab('cast')}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${
                        activeTab === 'cast' 
                          ? 'border-primary-500 text-primary-500' 
                          : 'border-transparent text-gray-400 hover:text-gray-300'
                      }`}
                    >
                      Cast & Crew
                    </button>
                    <button
                      onClick={() => setActiveTab('reviews')}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${
                        activeTab === 'reviews' 
                          ? 'border-primary-500 text-primary-500' 
                          : 'border-transparent text-gray-400 hover:text-gray-300'
                      }`}
                    >
                      Reviews
                    </button>
                  </nav>
                </div>
                
                {/* Tab content */}
                <div>
                  {/* Overview tab */}
                  {activeTab === 'overview' && (
                    <div>
                      <h3 className="text-xl font-semibold mb-2">Synopsis</h3>
                      <p className="text-gray-300 mb-4">
                        {movie.plot || movie.description || "No synopsis available."}
                      </p>
                      
                      {/* Additional details */}
                      <div className="grid grid-cols-2 gap-4 mt-6 text-sm">
                        {movie.credits.director && (
                          <div>
                            <span className="text-gray-400">Director:</span>{' '}
                            <span className="text-gray-200">{movie.credits.director}</span>
                          </div>
                        )}
                        {movie.language && (
                          <div>
                            <span className="text-gray-400">Language:</span>{' '}
                            <span className="text-gray-200">{movie.language}</span>
                          </div>
                        )}
                        {movie.country && (
                          <div>
                            <span className="text-gray-400">Country:</span>{' '}
                            <span className="text-gray-200">{movie.country}</span>
                          </div>
                        )}
                        {movie.awards && (
                          <div>
                            <span className="text-gray-400">Awards:</span>{' '}
                            <span className="text-gray-200">{movie.awards}</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Trailer */}
                      {movie.media.trailer && (
                        <div className="mt-6">
                          <h3 className="text-lg font-semibold mb-2">Trailer</h3>
                          <a 
                            href={movie.media.trailer} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-primary-500 hover:text-primary-400"
                          >
                            <FilmIcon className="h-5 w-5 mr-1" />
                            Watch Trailer
                          </a>
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
                            <div className="bg-gray-700 rounded-full h-10 w-10 flex items-center justify-center mr-3">
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
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {movie.credits.cast.map((person, index) => (
                              <div key={index} className="flex items-center bg-gray-800/50 p-3 rounded-lg">
                                {person.image ? (
                                  <img 
                                    src={person.image} 
                                    alt={person.name} 
                                    className="h-12 w-12 object-cover rounded-full mr-3"
                                  />
                                ) : (
                                  <div className="bg-gray-700 rounded-full h-12 w-12 flex items-center justify-center mr-3">
                                    <svg className="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                      <h3 className="text-xl font-semibold mb-4">Reviews</h3>
                      
                      {movie.reviews && movie.reviews.length > 0 ? (
                        <div className="space-y-4">
                          {movie.reviews.map((review, index) => (
                            <div key={index} className="bg-gray-800/50 p-4 rounded-lg">
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <span className="font-semibold">
                                    {review.author || 'Anonymous'}
                                  </span>
                                  <span className="text-xs text-gray-400 ml-2">
                                    via {review.source}
                                  </span>
                                </div>
                                {review.rating && (
                                  <Badge variant="primary" size="sm">
                                    {review.rating}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-gray-300 text-sm">
                                {review.content.length > 300 
                                  ? `${review.content.substring(0, 300)}...` 
                                  : review.content
                                }
                              </p>
                              {review.url && (
                                <a 
                                  href={review.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary-500 hover:text-primary-400 mt-2 inline-block"
                                >
                                  Read full review
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
                </div>
              </div>
            </div>
          </div>
          
          {/* Footer */}
          <div className="border-t border-gray-800 p-4 flex justify-between items-center">
            {movie.imdb_id && (
              <a 
                href={`https://www.imdb.com/title/${movie.imdb_id}`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-gray-300 text-sm"
              >
                View on IMDB
              </a>
            )}
            <Button onClick={onClose} variant="outline" size="sm">
              Close
            </Button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
};

export default MovieDetailsModal;