import React, { useState, useEffect, useRef } from 'react';
import Button from '@/components/ui/Button';
import Progress from '@/components/ui/Progress';
import { DetailedMovie } from '@/types/index';
import { 
  ArrowLeftIcon,
  PlayIcon,
  XMarkIcon,
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
  const [previousScene, setPreviousScene] = useState<AnimationScene | null>(null);
  const [message, setMessage] = useState(LOADING_MESSAGES[0]);
  const [prevMessage, setPrevMessage] = useState("");
  const [movie, setMovie] = useState<DetailedMovie | null>(null);
  const [fact, setFact] = useState(MOVIE_FACTS[0]);
  const [prevFact, setPrevFact] = useState("");
  const [showFact, setShowFact] = useState(false);
  const sceneTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messageTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const factTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadTimeRef = useRef<number>(Date.now());
  const [countdown, setCountdown] = useState(5);
  const [isSceneTransitioning, setIsSceneTransitioning] = useState(false);
  
  // Rotate between scenes
  useEffect(() => {
    const sceneSequence: AnimationScene[] = ['popcorn', 'tickets', 'seats', 'lights', 'trivia', 'countdown'];
    let currentIndex = sceneSequence.indexOf(currentScene);
    
    const rotateScene = () => {
      setIsSceneTransitioning(true);
      setPreviousScene(currentScene);
      
      // Short delay before changing to the new scene
      setTimeout(() => {
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
        
        setTimeout(() => {
          setIsSceneTransitioning(false);
        }, 300);
      }, 700); // Transition out time before changing scene
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
      setPrevMessage(message);
      
      // Fade out current message
      const messageElement = document.getElementById('loading-message');
      if (messageElement) {
        messageElement.classList.add('opacity-0', 'translate-y-4');
      }
      
      // After short delay, change message and fade in
      setTimeout(() => {
        const randomIndex = Math.floor(Math.random() * LOADING_MESSAGES.length);
        const newMessage = LOADING_MESSAGES[randomIndex];
        setMessage(newMessage);
        
        if (messageElement) {
          messageElement.classList.remove('opacity-0', 'translate-y-4');
        }
      }, 500);
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
        setPrevFact(fact);
        
        // Fade out current fact
        const factElement = document.getElementById('movie-fact');
        if (factElement) {
          factElement.classList.add('opacity-0', 'translate-y-4');
        }
        
        // After short delay, change fact and fade in
        setTimeout(() => {
          const randomIndex = Math.floor(Math.random() * MOVIE_FACTS.length);
          const newFact = MOVIE_FACTS[randomIndex];
          setFact(newFact);
          
          if (factElement) {
            factElement.classList.remove('opacity-0', 'translate-y-4');
          }
        }, 500);
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
  
  // Get scene transition classes
  const getSceneClasses = (sceneName: AnimationScene) => {
    if (isSceneTransitioning && currentScene === sceneName) {
      return 'opacity-0 transform scale-95 translate-y-4';
    }
    if (!isSceneTransitioning && currentScene === sceneName) {
      return 'opacity-100 transform scale-100 translate-y-0';
    }
    return 'opacity-0 absolute transform scale-90 translate-y-8 pointer-events-none';
  };
  
  return (
    <div className="fixed inset-0 w-screen h-screen flex items-center justify-center bg-black z-50">
      <div className="relative w-full h-full">
        {/* Cinema Screen Background - Full viewport */}
        <div className="absolute inset-0 overflow-hidden bg-gray-900 border-x-8 border-t-8 border-gray-800 rounded-t-xl">
          {/* Close Button */}
          <button 
            onClick={onBack}
            className="absolute top-4 right-4 z-50 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors"
            aria-label="Close"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
          
          {/* Start Anyway Button */}
          <button 
            onClick={onStartAnyway}
            className="absolute top-4 right-16 z-50 bg-primary-600 text-white px-4 py-2 rounded-full hover:bg-primary-700 transition-colors flex items-center"
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
            {/* Movie Title with animation */}
            <h1 className="text-3xl md:text-4xl font-bold text-white text-center mb-8 tracking-wide animate-fade-in">
              {movieTitle}
            </h1>
            
            {/* Animation Area */}
            <div className="w-full max-w-lg h-64 relative mx-auto">
              {/* Different Animation Scenes with enhanced transitions */}
              <div 
                className={`absolute inset-0 flex flex-col items-center justify-center text-center transition-all duration-700 ease-in-out ${getSceneClasses('popcorn')}`}
              >
                <div className="transform transition-transform duration-1000 hover:scale-110">
                  <PopcornAnimation />
                </div>
                <h2 className="text-2xl font-semibold text-white mt-6 mb-2 transition-all duration-500">
                  Getting Your Snacks Ready
                </h2>
                <p 
                  id="loading-message"
                  className="text-gray-300 transition-all duration-500 ease-in-out"
                >
                  {message}
                </p>
              </div>
              
              <div 
                className={`absolute inset-0 flex flex-col items-center justify-center text-center transition-all duration-700 ease-in-out ${getSceneClasses('tickets')}`}
              >
                <div className="transform transition-transform duration-1000 hover:scale-110">
                  <TicketsAnimation />
                </div>
                <h2 className="text-2xl font-semibold text-white mt-6 mb-2 transition-all duration-500">
                  Checking Your Tickets
                </h2>
                <p 
                  id="loading-message"
                  className="text-gray-300 transition-all duration-500 ease-in-out"
                >
                  {message}
                </p>
              </div>
              
              <div 
                className={`absolute inset-0 flex flex-col items-center justify-center text-center transition-all duration-700 ease-in-out ${getSceneClasses('seats')}`}
              >
                <div className="transform transition-transform duration-1000 hover:scale-110">
                  <TheaterSeatsAnimation />
                </div>
                <h2 className="text-2xl font-semibold text-white mt-6 mb-2 transition-all duration-500">
                  Finding Perfect Seats
                </h2>
                <p 
                  id="loading-message"
                  className="text-gray-300 transition-all duration-500 ease-in-out"
                >
                  {message}
                </p>
              </div>
              
              <div 
                className={`absolute inset-0 flex flex-col items-center justify-center text-center transition-all duration-700 ease-in-out ${getSceneClasses('lights')}`}
              >
                <div className="transform transition-transform duration-1000 hover:scale-110">
                  <TheaterLightsAnimation />
                </div>
                <h2 className="text-2xl font-semibold text-white mt-6 mb-2 transition-all duration-500">
                  Dimming The Lights
                </h2>
                <p 
                  id="loading-message"
                  className="text-gray-300 transition-all duration-500 ease-in-out"
                >
                  {message}
                </p>
              </div>
              
              <div 
                className={`absolute inset-0 flex flex-col items-center justify-center text-center max-w-md mx-auto transition-all duration-700 ease-in-out ${getSceneClasses('trivia')}`}
              >
                <div className="transform transition-transform duration-1000 hover:scale-110">
                  <TriviaAnimation />
                </div>
                <h2 className="text-2xl font-semibold text-white mt-6 mb-2 transition-all duration-500">
                  Movie Trivia
                </h2>
                <p 
                  id="movie-fact"
                  className="text-gray-300 text-sm transition-all duration-500 ease-in-out"
                >
                  {fact}
                </p>
              </div>
              
              <div 
                className={`absolute inset-0 flex flex-col items-center justify-center text-center transition-all duration-700 ease-in-out ${getSceneClasses('countdown')}`}
              >
                <div className="relative h-32 w-32 flex items-center justify-center transition-transform duration-1000 transform hover:scale-110">
                  <div className="absolute inset-0 border-4 border-primary-500 rounded-full opacity-30"></div>
                  <div 
                    className="absolute inset-0 border-4 border-primary-500 rounded-full opacity-80 transition-all duration-300"
                    style={{
                      clipPath: `polygon(50% 50%, 50% 0%, ${50 + 50 * Math.sin((countdown/5) * Math.PI * 2)}% ${50 - 50 * Math.cos((countdown/5) * Math.PI * 2)}%, 50% 50%)`
                    }}
                  ></div>
                  <span className="text-6xl font-bold text-primary-500 transition-all duration-300 transform scale-100">{countdown}</span>
                </div>
                <h2 className="text-2xl font-semibold text-white mt-6 mb-2 transition-all duration-500">
                  Starting Soon!
                </h2>
                <p id="loading-message" className="text-gray-300 transition-all duration-500 ease-in-out">
                  Get ready for your movie...
                </p>
              </div>
            </div>
            
            {/* Progress Bar Styled as Film Strip */}
            <div className="w-full max-w-md mt-12 relative">
              <div className="flex justify-between text-sm text-gray-400 mb-1">
                <span className="transition-all duration-300 ease-in-out">Preparing your stream...</span>
                <span className="transition-all duration-300 ease-in-out">{Math.round(progress)}%</span>
              </div>
              
              <div className="relative h-6 bg-gray-800 rounded-md overflow-hidden">
                {/* Film Strip Decoration */}
                <div className="absolute inset-y-0 left-0 right-0 flex justify-between items-center">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className="h-full w-1.5 bg-gray-900"></div>
                  ))}
                </div>
                
                {/* Actual Progress with smooth animation */}
                <div 
                  className="absolute inset-y-0 left-0 bg-primary-600 transition-all duration-700 ease-out"
                  style={{ width: `${percentLoaded}%` }}
                />
              </div>
              
              {/* Loading Stats with fade-in animations */}
              <div className="flex flex-wrap justify-between mt-3 text-xs text-gray-400">
                <div className="transition-all duration-500 ease-in-out hover:text-white">
                  <span className="block text-gray-500">Download Speed</span>
                  <span className="text-white">{downloadSpeed.toFixed(2)} KB/s</span>
                </div>
                <div className="transition-all duration-500 ease-in-out hover:text-white">
                  <span className="block text-gray-500">Peers</span>
                  <span className="text-white">{numPeers}</span>
                </div>
                <div className="transition-all duration-500 ease-in-out hover:text-white">
                  <span className="block text-gray-500">Estimated Wait</span>
                  <span className="text-white">{formatTimeRemaining()}</span>
                </div>
              </div>
            </div>
            
            {/* Control Button */}
            <div className="mt-10">
              <Button 
                variant="primary"
                leftIcon={<PlayIcon className="w-5 h-5" />}
                onClick={onStartAnyway}
                className="animate-pulse hover:scale-105 transition-transform duration-300"
              >
                Start Anyway
              </Button>
            </div>
          </div>
        </div>
        
        {/* Cinema Seats (Decorative) */}
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gray-800 rounded-b-xl overflow-hidden flex">
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