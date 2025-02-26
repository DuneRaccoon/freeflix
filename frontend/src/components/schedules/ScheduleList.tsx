import React, { useEffect, useState, useCallback } from 'react';
import { ScheduleResponse } from '@/types';
import ScheduleItem from './ScheduleItem';
import Button from '@/components/ui/Button';
import { schedulesService } from '@/services/schedules';
import { toast } from 'react-hot-toast';
import { PlusIcon } from '@heroicons/react/24/solid';

interface ScheduleListProps {
  initialSchedules?: ScheduleResponse[];
  onCreateSchedule?: () => void;
  onEditSchedule?: (scheduleId: string) => void;
}

const ScheduleList: React.FC<ScheduleListProps> = ({
  initialSchedules,
  onCreateSchedule,
  onEditSchedule
}) => {
  const [schedules, setSchedules] = useState<ScheduleResponse[]>(initialSchedules || []);
  const [isLoading, setIsLoading] = useState<boolean>(!initialSchedules);
  const [error, setError] = useState<string | null>(null);

  // Fetch schedules from API
  const fetchSchedules = useCallback(async () => {
    try {
      setError(null);
      const data = await schedulesService.listSchedules();
      setSchedules(data);
    } catch (err) {
      console.error('Error fetching schedules:', err);
      setError('Failed to fetch schedules');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    if (!initialSchedules) {
      fetchSchedules();
    }
  }, [fetchSchedules, initialSchedules]);

  // Handle manual refresh
  const handleRefresh = () => {
    setIsLoading(true);
    fetchSchedules();
    toast.success('Refreshed schedules list');
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="mb-4 bg-gray-800 rounded-lg h-48"></div>
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500 mb-4">{error}</div>
        <button
          className="px-4 py-2 bg-gray-700 rounded-md hover:bg-gray-600"
          onClick={handleRefresh}
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">
          Scheduled Downloads
          <span className="ml-2 text-sm font-normal text-gray-400">
            ({schedules.length})
          </span>
        </h2>
        <div className="flex items-center space-x-4">
          <button
            className="text-sm text-primary-400 hover:text-primary-300"
            onClick={handleRefresh}
          >
            Refresh
          </button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<PlusIcon className="w-4 h-4" />}
            onClick={onCreateSchedule}
          >
            Create New
          </Button>
        </div>
      </div>

      {schedules.length === 0 ? (
        <div className="text-center py-12 bg-gray-800/50 rounded-lg">
          <h3 className="text-lg font-semibold text-gray-300">No schedules found</h3>
          <p className="text-gray-400 mt-2 mb-4">
            Create a schedule to automatically download new movies
          </p>
          <Button
            variant="primary"
            size="md"
            leftIcon={<PlusIcon className="w-5 h-5" />}
            onClick={onCreateSchedule}
          >
            Create First Schedule
          </Button>
        </div>
      ) : (
        schedules.map((schedule) => (
          <ScheduleItem 
            key={schedule.id} 
            schedule={schedule} 
            onStatusChange={fetchSchedules}
            onEdit={onEditSchedule}
          />
        ))
      )}
    </div>
  );
};

export default ScheduleList;