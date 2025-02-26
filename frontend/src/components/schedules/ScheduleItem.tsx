import React, { useState } from 'react';
import { ScheduleResponse } from '@/types';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { schedulesService } from '@/services/schedules';
import { toast } from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import {
  PlayIcon,
  PencilIcon,
  TrashIcon,
  ClockIcon,
} from '@heroicons/react/24/solid';

interface ScheduleItemProps {
  schedule: ScheduleResponse;
  onStatusChange?: () => void;
  onEdit?: (scheduleId: string) => void;
}

const ScheduleItem: React.FC<ScheduleItemProps> = ({ 
  schedule, 
  onStatusChange,
  onEdit
}) => {
  const [isLoading, setIsLoading] = useState(false);

  // Format cron expression to human readable text
  const formatCronExpression = (cron: string): string => {
    // This is a simplified version - a real implementation would be more comprehensive
    const parts = cron.split(' ');
    
    if (parts.length !== 5) return cron;
    
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    
    if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return 'Daily at midnight';
    }
    
    if (minute === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return `Daily at ${hour}:00`;
    }
    
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '0') {
      return `Every Sunday at ${hour}:${minute}`;
    }
    
    // Default fallback
    return cron;
  };

  // Handle schedule actions
  const handleAction = async (action: 'run' | 'delete') => {
    try {
      setIsLoading(true);
      
      if (action === 'run') {
        await schedulesService.runSchedule(schedule.id);
        toast.success('Schedule executed successfully');
      } else if (action === 'delete') {
        await schedulesService.deleteSchedule(schedule.id);
        toast.success('Schedule deleted successfully');
      }
      
      // Call the onStatusChange callback if provided
      if (onStatusChange) {
        onStatusChange();
      }
    } catch (error) {
      console.error(`Error ${action}ing schedule:`, error);
      toast.error(`Failed to ${action} schedule`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle edit button click
  const handleEdit = () => {
    if (onEdit) {
      onEdit(schedule.id);
    }
  };

  // Format schedule details
  const scheduleName = schedule.name || `Schedule ${schedule.id.substring(0, 8)}`;
  const scheduleParams = schedule.config.search_params;
  const searchDescription = scheduleParams.keyword 
    ? `Search for "${scheduleParams.keyword}"`
    : scheduleParams.year 
      ? `Movies from ${scheduleParams.year}`
      : 'Latest movies';

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <CardTitle>{scheduleName}</CardTitle>
          <Badge variant={schedule.config.enabled ? 'success' : 'warning'}>
            {schedule.config.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="py-2">
        <div className="text-sm text-gray-300 mb-3">
          <div className="flex items-start mb-1">
            <ClockIcon className="w-4 h-4 mt-0.5 mr-2 text-gray-400 flex-shrink-0" />
            <div>
              <p><span className="text-gray-400">Schedule:</span> {formatCronExpression(schedule.config.cron_expression)}</p>
              <p><span className="text-gray-400">Next run:</span> {format(new Date(schedule.next_run), 'PPp')} ({formatDistanceToNow(new Date(schedule.next_run), { addSuffix: true })})</p>
              {schedule.last_run && (
                <p>
                  <span className="text-gray-400">Last run:</span> {format(new Date(schedule.last_run), 'PPp')}
                </p>
              )}
            </div>
          </div>
        </div>
        
        <div className="bg-gray-800 rounded-md p-3 text-sm">
          <p className="font-medium mb-1">{searchDescription}</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
            {scheduleParams.genre && scheduleParams.genre !== 'all' && (
              <div>
                <span className="block">Genre:</span>
                <span className="text-gray-300">{scheduleParams.genre}</span>
              </div>
            )}
            {scheduleParams.quality && scheduleParams.quality !== 'all' && (
              <div>
                <span className="block">Quality:</span>
                <span className="text-gray-300">{scheduleParams.quality}</span>
              </div>
            )}
            {scheduleParams.rating !== undefined && scheduleParams.rating > 0 && (
              <div>
                <span className="block">Min Rating:</span>
                <span className="text-gray-300">{scheduleParams.rating}</span>
              </div>
            )}
            <div>
              <span className="block">Download Quality:</span>
              <span className="text-gray-300">{schedule.config.quality}</span>
            </div>
            <div>
              <span className="block">Max Downloads:</span>
              <span className="text-gray-300">{schedule.config.max_downloads}</span>
            </div>
          </div>
        </div>
      </CardContent>
      
      <CardFooter className="pt-2">
        <div className="flex space-x-2 w-full justify-end">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<PlayIcon className="w-4 h-4" />}
            isLoading={isLoading}
            onClick={() => handleAction('run')}
          >
            Run Now
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            leftIcon={<PencilIcon className="w-4 h-4" />}
            isLoading={isLoading}
            onClick={handleEdit}
          >
            Edit
          </Button>
          
          <Button
            variant="danger"
            size="sm"
            leftIcon={<TrashIcon className="w-4 h-4" />}
            isLoading={isLoading}
            onClick={() => handleAction('delete')}
          >
            Delete
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};

export default ScheduleItem;