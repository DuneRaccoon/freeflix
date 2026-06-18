import { Progress } from '@/components/ui/fre';
import { Button } from '@/components/ui/fre';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { TorrentStatus } from '@/types/index';

export const BasicPreStream: React.FC<{
  torrentStatus: TorrentStatus;
  handleBackClick: () => void;
  handleForceStreaming: () => void;
  handleHomeClick: () => void;
}> = ({ torrentStatus, handleBackClick, handleForceStreaming, handleHomeClick }) => {

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-ink p-6">
      <div className="max-w-md w-full border border-hairline bg-surface rounded-2xl p-7 shadow-[0_32px_80px_-20px_rgba(0,0,0,.8)]">

        {/* Title */}
        <h2 className="font-display text-2xl text-text tracking-tight mb-4">
          Preparing to Stream
        </h2>

        {/* Description */}
        <p className="text-sm text-muted leading-relaxed mb-6">
          Downloading the beginning of{' '}
          <span className="text-text font-medium">"{torrentStatus.movie_title}"</span>{' '}
          so you can start watching. Streaming begins at 5% downloaded.
        </p>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-muted mb-2">
            <span className="uppercase tracking-widest font-medium">Download Progress</span>
            <span className="text-gold-lite font-semibold tabular-nums">
              {Math.round(torrentStatus.progress)}%
            </span>
          </div>
          <Progress
            value={torrentStatus.progress}
            label="Download progress"
            className="h-1.5"
          />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-7">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted uppercase tracking-widest">Speed</span>
            <span className="text-sm font-medium text-text tabular-nums">
              {torrentStatus.download_rate.toFixed(2)}<span className="text-muted text-xs"> KB/s</span>
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted uppercase tracking-widest">Peers</span>
            <span className="text-sm font-medium text-text tabular-nums">{torrentStatus.num_peers}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted uppercase tracking-widest">Est. Wait</span>
            <span className="text-sm font-medium text-text">
              {torrentStatus.progress < 2
                ? 'Calculating…'
                : torrentStatus.progress >= 5
                ? 'Ready Soon'
                : '< 1 min'}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="glass"
            size="sm"
            onClick={handleBackClick}
            className="order-2 sm:order-1"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleForceStreaming}
            className="order-1 sm:order-2 flex-1 sm:flex-none"
          >
            Start Anyway
          </Button>
        </div>

        {/* Home link */}
        <div className="mt-5 text-center">
          <button
            className="text-xs text-muted hover:text-text transition-colors"
            onClick={handleHomeClick}
          >
            Return to Home
          </button>
        </div>
      </div>
    </div>
  );
};
