import React, { useState, useEffect, useRef } from 'react';
import Button from '@/components/ui/Button';
import Progress from '@/components/ui/Progress';
import { DetailedMovie } from '@/types/index';
import { 
  ArrowLeftIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import {
  PopcornAnimation,
  TicketsAnimation,
  TheaterSeatsAnimation,
  TheaterLightsAnimation,
  TriviaAnimation,
} from './animations';
import { moviesService } from '@/services/movies';

type AnimationScene = 'popcorn' | 'tickets' | 'seats' | 'lights' | 'trivia' | 'countdown';

interface PreStreamingAnimationProps {
  movieTitle: string;
  posterUrl?: string;
  progress: number;
  downloadSpeed: number;
  numPeers: number;
  onStartAnyway: () => void;
  onBack: () => void;
  estimatedTimeSeconds?: number;
}

const LOADING_MESSAGES = [
  "Popping some corn for you...",
  "Finding the best seats in the house...",
  "Dimming the lights...",
  "Silencing cell phones...",
  "Shushing the loud people...",
  "Rolling the film...",
  "Preparing the digital projector...",
  "Adjusting the surround sound...",
  "Getting the 3D glasses ready...",
  "Clearing the sticky floor...",
  "Rewinding the tape... wait, it's digital!",
  "Calibrating the flux capacitor...",
  "Buffering the buffer...",
  "Enhancing the pixels...",
  "Asking everyone to please wait for the end credits...",
  "Making sure the boom mic isn't visible...",
  "Waiting for the director's final cut...",
  "Gathering the finest bits and bytes...",
  "Adjusting the aspect ratio for your viewing pleasure...",
  "Loading the trailer for the sequel...",
];

const MOVIE_FACTS = [
  "The first movie ever made was 'Roundhay Garden Scene' from 1888, lasting only 2.11 seconds.",
  "The Wilhelm Scream is a famous sound effect used in over 400 films since 1951.",
  "The longest film ever made is 'Logistics' (2012), with a runtime of 857 hours (35 days).",
  "The highest-grossing film of all time adjusted for inflation is 'Gone with the Wind' (1939).",
  "The first feature-length animated film was Disney's 'Snow White and the Seven Dwarfs' (1937).",
  "The Toy Story trilogy took over 14 years to complete from start to finish.",
  "The first public movie theater opened in 1895 in Paris, France.",
  "The briefcase in 'Pulp Fiction' contained a hidden light and batteries to illuminate the actors' faces.",
  "The 'Lord of the Rings' trilogy finished filming before the first movie was released.",
  "The 'Star Wars' opening crawl was inspired by Flash Gordon and Buck Rogers serials from the 1930s.",
  "The sound of the T-Rex in 'Jurassic Park' was a combination of baby elephant, alligator, and tiger sounds.",
  "The famous 'Here's Johnny!' scene in 'The Shining' took 3 days and 60 doors to film.",
  "The floating plastic bag scene in 'American Beauty' took 1 hour to film, with no CGI.",
  "Many of the dinosaurs in the original 'Jurassic Park' were actually life-sized puppets, not CGI.",
  "The 'bullet time' effect in 'The Matrix' used 120 cameras in a circle around the actors.",
];

const PreStreamingAnimation: React.FC<PreStreamingAnimationProps> = ({
  movieTitle,
  posterUrl,
  progress,
  downloadSpeed,
  numPeers,
  onStartAnyway,
  onBack,
  estimatedTimeSeconds = 60,
}) => {
  const [currentScene, setCurrentScene] = useState<AnimationScene>('popcorn');
  const [message, setMessage] = useState(LOADING_MESSAGES[0]);
  const [movie, setMovie] = useState<DetailedMovie | null>(null);
  const [fact, setFact] = useState(MOVIE_FACTS[0]);
  const [showFact, setShowFact] = useState(false);
  const sceneTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messageTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const factTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadTimeRef = useRef<number>(Date.now());
  const [countdown, setCountdown] = useState(5);
  
  // Rotate between scenes
  useEffect(() => {
    const sceneSequence: AnimationScene[] = ['popcorn', 'tickets', 'seats', 'lights', 'trivia', 'countdown'];
    let currentIndex = sceneSequence.indexOf(currentScene);
    
    const rotateScene = () => {
      currentIndex = (currentIndex + 1) % sceneSequence.length;
      setCurrentScene(sceneSequence[currentIndex]);
      
      // Show facts during the trivia scene
      if (sceneSequence[currentIndex] === 'trivia') {
        setShowFact(true);
      } else {
        setShowFact(false);
      }
      
      // Start countdown during the countdown scene
      if (sceneSequence[currentIndex] === 'countdown') {
        setCountdown(5);
      }
    };
    
    sceneTimeoutRef.current = setTimeout(rotateScene, 6000);
    
    return () => {
      if (sceneTimeoutRef.current) {
        clearTimeout(sceneTimeoutRef.current);
      }
    };
  }, [currentScene]);
  
  // Rotate loading messages
  useEffect(() => {
    const rotateMessage = () => {
      const randomIndex = Math.floor(Math.random() * LOADING_MESSAGES.length);
      setMessage(LOADING_MESSAGES[randomIndex]);
    };
    
    messageTimeoutRef.current = setTimeout(rotateMessage, 4000);
    
    return () => {
      if (messageTimeoutRef.current) {
        clearTimeout(messageTimeoutRef.current);
      }
    };
  }, [message]);
  
  // Rotate movie facts
  useEffect(() => {
    if (showFact) {
      const rotateFact = () => {
        const randomIndex = Math.floor(Math.random() * MOVIE_FACTS.length);
        setFact(MOVIE_FACTS[randomIndex]);
      };
      
      factTimeoutRef.current = setTimeout(rotateFact, 8000);
      
      return () => {
        if (factTimeoutRef.current) {
          clearTimeout(factTimeoutRef.current);
        }
      };
    }
  }, [fact, showFact]);
  
  // Countdown effect
  useEffect(() => {
    if (currentScene === 'countdown' && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [currentScene, countdown]);
  
  // Calculate the time elapsed and remaining
  const timeElapsed = Math.floor((Date.now() - initialLoadTimeRef.current) / 1000);
  const timeRemaining = Math.max(0, estimatedTimeSeconds - timeElapsed);
  
  // Format time remaining in a user-friendly way
  const formatTimeRemaining = () => {
    if (timeRemaining <= 0) return "Ready soon";
    if (timeRemaining < 60) return `${timeRemaining} seconds`;
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };
  
  // Calculate realistic percent loaded for progress bar animation
  const percentLoaded = progress >= 5 ? progress : Math.min(progress + (timeElapsed / 10), 5);
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-black overflow-hidden">
      <div className="relative w-full max-w-4xl mx-auto">
        {/* Cinema Screen Background */}
        <div className="relative h-[70vh] overflow-hidden bg-gray-900 rounded-t-xl border-x-8 border-t-8 border-gray-800">
          {/* Back Button */}
          <button 
            onClick={onBack}
            className="absolute top-4 left-4 z-50 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors"
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          
          {/* Start Anyway Button */}
          <button 
            onClick={onStartAnyway}
            className="absolute top-4 right-4 z-50 bg-primary-600 text-white px-4 py-2 rounded-full hover:bg-primary-700 transition-colors flex items-center"
          >
            <PlayIcon className="w-5 h-5 mr-1" />
            Start Now
          </button>
          
          {/* Poster Background with Overlay */}
          {posterUrl && (
            <div 
              className="absolute inset-0 opacity-20"
              style={{ 
                backgroundImage: `url(${posterUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(8px)'
              }}
            />
          )}
          
          {/* Animation Container */}
          <div className="relative h-full flex flex-col items-center justify-center z-10 p-8">
            {/* Movie Title */}
            <h1 className="text-3xl md:text-4xl font-bold text-white text-center mb-8 tracking-wide">
              {movieTitle}
            </h1>
            
            {/* Animation Area */}
            <div className="w-full max-w-lg h-64 relative mx-auto">
              {/* Different Animation Scenes */}
              {currentScene === 'popcorn' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <PopcornAnimation />
                  <h2 className="text-2xl font-semibold text-white mt-6 mb-2">Getting Your Snacks Ready</h2>
                  <p className="text-gray-300">{message}</p>
                </div>
              )}
              
              {currentScene === 'tickets' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <TicketsAnimation />
                  <h2 className="text-2xl font-semibold text-white mt-6 mb-2">Checking Your Tickets</h2>
                  <p className="text-gray-300">{message}</p>
                </div>
              )}
              
              {currentScene === 'seats' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <TheaterSeatsAnimation />
                  <h2 className="text-2xl font-semibold text-white mt-6 mb-2">Finding Perfect Seats</h2>
                  <p className="text-gray-300">{message}</p>
                </div>
              )}
              
              {currentScene === 'lights' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <TheaterLightsAnimation />
                  <h2 className="text-2xl font-semibold text-white mt-6 mb-2">Dimming The Lights</h2>
                  <p className="text-gray-300">{message}</p>
                </div>
              )}
              
              {currentScene === 'trivia' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center max-w-md mx-auto">
                  <TriviaAnimation />
                  <h2 className="text-2xl font-semibold text-white mt-6 mb-2">Movie Trivia</h2>
                  <p className="text-gray-300 text-sm">{fact}</p>
                </div>
              )}
              
              {currentScene === 'countdown' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <div className="relative h-32 w-32 flex items-center justify-center">
                    <div className="absolute inset-0 border-4 border-primary-500 rounded-full opacity-30"></div>
                    <div 
                      className="absolute inset-0 border-4 border-primary-500 rounded-full opacity-80"
                      style={{
                        clipPath: `polygon(50% 50%, 50% 0%, ${50 + 50 * Math.sin((countdown/5) * Math.PI * 2)}% ${50 - 50 * Math.cos((countdown/5) * Math.PI * 2)}%, 50% 50%)`
                      }}
                    ></div>
                    <span className="text-6xl font-bold text-primary-500">{countdown}</span>
                  </div>
                  <h2 className="text-2xl font-semibold text-white mt-6 mb-2">Starting Soon!</h2>
                  <p className="text-gray-300">Get ready for your movie...</p>
                </div>
              )}
            </div>
            
            {/* Progress Bar Styled as Film Strip */}
            <div className="w-full max-w-md mt-12 relative">
              <div className="flex justify-between text-sm text-gray-400 mb-1">
                <span>Preparing your stream...</span>
                <span>{Math.round(progress)}%</span>
              </div>
              
              <div className="relative h-6 bg-gray-800 rounded-md overflow-hidden">
                {/* Film Strip Decoration */}
                <div className="absolute inset-y-0 left-0 right-0 flex justify-between items-center">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className="h-full w-1.5 bg-gray-900"></div>
                  ))}
                </div>
                
                {/* Actual Progress */}
                <div 
                  className="absolute inset-y-0 left-0 bg-primary-600 transition-all duration-300 ease-out"
                  style={{ width: `${percentLoaded}%` }}
                />
              </div>
              
              {/* Loading Stats */}
              <div className="flex flex-wrap justify-between mt-3 text-xs text-gray-400">
                <div>
                  <span className="block text-gray-500">Download Speed</span>
                  <span className="text-white">{downloadSpeed.toFixed(2)} KB/s</span>
                </div>
                <div>
                  <span className="block text-gray-500">Peers</span>
                  <span className="text-white">{numPeers}</span>
                </div>
                <div>
                  <span className="block text-gray-500">Estimated Wait</span>
                  <span className="text-white">{formatTimeRemaining()}</span>
                </div>
              </div>
            </div>
            
            {/* Control Buttons */}
            <div className="mt-10 flex gap-4">
              <Button 
                variant="outline" 
                leftIcon={<ArrowLeftIcon className="w-5 h-5" />}
                onClick={onBack}
              >
                Back to Downloads
              </Button>
              
              <Button 
                variant="primary"
                leftIcon={<PlayIcon className="w-5 h-5" />}
                onClick={onStartAnyway}
              >
                Start Anyway
              </Button>
            </div>
          </div>
        </div>
        
        {/* Cinema Seats (Decorative) */}
        <div className="h-20 bg-gray-800 rounded-b-xl relative overflow-hidden flex">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="flex-1 border-r border-gray-700 pt-2">
              <div className="h-4 bg-gray-700 rounded-t-md mx-1"></div>
              <div className="h-8 bg-gray-700 rounded-b-md mx-0.5 mt-1"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PreStreamingAnimation;