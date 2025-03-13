import React from 'react';

interface BufferingAnimationProps {
  downloadProgress?: number;
  message?: string;
}

const BufferingAnimation: React.FC<BufferingAnimationProps> = ({ 
  downloadProgress = 0,
  message = 'Buffering...'
}) => {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-black/80 z-50">
      {/* Ripple Animation */}
      <div className="relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border-2 border-primary-500 opacity-0 animate-ripple-1"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border-2 border-primary-500 opacity-0 animate-ripple-2"></div>
        <div className="w-16 h-16 rounded-full border-4 border-primary-600 border-t-transparent animate-spin"></div>
      </div>
      
      <div className="mt-6 text-center">
        <h3 className="text-xl font-medium text-white mb-2">{message}</h3>
        
        {downloadProgress < 100 && (
          <div className="flex flex-col items-center">
            <p className="text-gray-300 text-sm mb-2">
              Video download: {downloadProgress.toFixed(1)}% complete
            </p>
            
            <div className="w-48 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary-500 rounded-full"
                style={{ width: `${downloadProgress}%` }}
              ></div>
            </div>
            
            <p className="text-gray-400 text-xs mt-4">
              Playback will continue automatically when ready
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default BufferingAnimation;