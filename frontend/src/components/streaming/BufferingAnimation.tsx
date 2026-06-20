import React from 'react';
import { Progress } from '@/components/ui/fre';

interface BufferingAnimationProps {
  downloadProgress?: number;
  message?: string;
}

const BufferingAnimation: React.FC<BufferingAnimationProps> = ({
  downloadProgress = 0,
  message = 'Buffering...'
}) => {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-ink/80 z-50">
      {/* Gold spinning ring — FRÈ tint */}
      <div className="relative mb-6">
        {/* Outer pulse rings — gold */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border border-gold/30 opacity-0 animate-ripple-1" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border border-gold/20 opacity-0 animate-ripple-2" />
        {/* Spinner */}
        <div className="w-14 h-14 rounded-full border-2 border-hairline border-t-gold animate-spin" />
      </div>

      <div className="text-center max-w-xs">
        <p className="text-base font-medium text-text mb-1">{message}</p>

        {downloadProgress < 100 && (
          <div className="flex flex-col items-center gap-3 mt-3">
            <p className="text-xs text-muted tabular-nums">
              Video download: <span className="text-gold-lite font-semibold">{downloadProgress.toFixed(1)}%</span> complete
            </p>
            <Progress
              value={downloadProgress}
              label="Download progress"
              className="w-48"
            />
            <p className="text-[11px] text-muted mt-1">
              Playback will continue automatically when ready
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default BufferingAnimation;
