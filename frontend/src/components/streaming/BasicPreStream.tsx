import Progress from '@/components/ui/Progress';
import Button from '@/components/ui/Button';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { TorrentStatus } from '@/types/index';

export const BasicPreStream: React.FC<{
  torrentStatus: TorrentStatus;
  handleBackClick: () => void;
  handleForceStreaming: () => void;
  handleHomeClick: () => void;
}> = ({ torrentStatus, handleBackClick, handleForceStreaming, handleHomeClick }) => {

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-gray-900 p-4">
      <div className="max-w-md w-full bg-gray-800 rounded-lg p-6 shadow-lg">
        <h2 className="text-xl font-semibold text-white mb-4">Preparing for Streaming...</h2>
        <p className="text-gray-300 mb-6">
          We're downloading the beginning of "{torrentStatus.movie_title}" so you can start watching.
          This may take a few moments depending on your connection speed. We will begin streaming at 5% downloaded.
        </p>
        
        <div className="mb-4">
          <div className="flex justify-between text-sm text-gray-400 mb-1">
            <span>Download Progress</span>
            <span>{Math.round(torrentStatus.progress)}%</span>
          </div>
          <Progress
            value={torrentStatus.progress}
            max={100}
            variant="primary"
            className="mb-2"
          />
        </div>
        
        <div className="flex flex-col sm:flex-row gap-2 justify-between items-center text-sm text-gray-400 mb-6">
          <div className="flex flex-col w-full sm:w-auto">
            <span>Download Speed</span>
            <span className="font-medium text-white">{torrentStatus.download_rate.toFixed(2)} KB/s</span>
          </div>
          <div className="flex flex-col w-full sm:w-auto">
            <span>Connected Peers</span>
            <span className="font-medium text-white">{torrentStatus.num_peers}</span>
          </div>
          <div className="flex flex-col w-full sm:w-auto">
            <span>Estimated Wait</span>
            <span className="font-medium text-white">
              {torrentStatus.progress < 2 ? 'Calculating...' : 
                torrentStatus.progress >= 5 ? 'Ready Soon' : 
                'Less than a minute'}
            </span>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 justify-between">
          <Button 
            variant="outline" 
            leftIcon={<ArrowLeftIcon className="w-5 h-5" />}
            onClick={handleBackClick}
            className="order-2 sm:order-1"
          >
            Back to Downloads
          </Button>
          
          <Button 
            variant="primary"
            onClick={handleForceStreaming}
            className="order-1 sm:order-2"
          >
            Start Anyway
          </Button>
        </div>
        
        <div className="mt-4 text-center">
          <button 
            className="text-primary-400 hover:text-primary-300 text-sm"
            onClick={handleHomeClick}
          >
            Return to Home Page
          </button>
        </div>
      </div>
    </div>
  )
}