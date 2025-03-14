// frontend/src/components/ui/WatchProgressBar.tsx
import React from 'react';
import { twMerge } from 'tailwind-merge';

interface WatchProgressBarProps {
  progress: number;
  className?: string;
  height?: string;
  showTooltip?: boolean;
}

const WatchProgressBar: React.FC<WatchProgressBarProps> = ({
  progress,
  className,
  height = 'h-1',
  showTooltip = true
}) => {
  // Cap progress at 100%
  const cappedProgress = Math.min(100, Math.max(0, progress));
  
  return (
    <div 
      className={twMerge(
        'relative w-full bg-gray-800 rounded-full overflow-hidden group',
        height,
        className
      )}
    >
      <div 
        className="absolute h-full bg-primary-500 rounded-full transition-all duration-300"
        style={{ width: `${cappedProgress}%` }}
      />
      
      {showTooltip && (
        <div className="absolute -top-8 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-gray-900 text-white text-xs px-2 py-1 rounded pointer-events-none transform -translate-x-1/2 left-1/2">
          {Math.round(cappedProgress)}% watched
        </div>
      )}
    </div>
  );
};

export default WatchProgressBar;