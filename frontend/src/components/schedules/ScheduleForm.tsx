import React, { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { ScheduleConfig, ScheduleResponse } from '@/types';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { schedulesService } from '@/services/schedules';
import { toast } from 'react-hot-toast';

interface ScheduleFormProps {
  scheduleId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const defaultValues: ScheduleConfig = {
  name: '',
  cron_expression: '0 0 * * *', // Daily at midnight
  search_params: {
    keyword: '',
    quality: 'all',
    genre: 'all',
    rating: '7',
    year: 'all',
    order_by: 'rating'
  },
  quality: '1080p',
  max_downloads: 1,
  enabled: true
};

const ScheduleForm: React.FC<ScheduleFormProps> = ({ 
  scheduleId, 
  onSuccess, 
  onCancel 
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(!!scheduleId);
  
  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<ScheduleConfig>({
    defaultValues
  });

  // Fetch schedule data if editing
  useEffect(() => {
    const fetchScheduleData = async () => {
      if (!scheduleId) return;
      
      try {
        setIsLoading(true);
        const schedule = await schedulesService.getSchedule(scheduleId);
        reset({
          name: schedule.name || '',
          cron_expression: schedule.config.cron_expression,
          search_params: schedule.config.search_params,
          quality: schedule.config.quality,
          max_downloads: schedule.config.max_downloads,
          enabled: schedule.config.enabled
        });
      } catch (error) {
        console.error('Error fetching schedule:', error);
        toast.error('Failed to load schedule data');
        if (onCancel) onCancel();
      } finally {
        setIsLoading(false);
      }
    };

    if (scheduleId) {
      fetchScheduleData();
    }
  }, [scheduleId, reset, onCancel]);

  // Submit form
  const onSubmit = async (data: ScheduleConfig) => {
    try {
      setIsLoading(true);
      
      if (isEditing && scheduleId) {
        await schedulesService.updateSchedule(scheduleId, data);
        toast.success('Schedule updated successfully');
      } else {
        await schedulesService.createSchedule(data);
        toast.success('Schedule created successfully');
      }
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('Error saving schedule:', error);
      toast.error(`Failed to ${isEditing ? 'update' : 'create'} schedule`);
    } finally {
      setIsLoading(false);
    }
  };

  // Quality options
  const qualityOptions = [
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '2160p', label: '4K (2160p)' }
  ];
  
  // Genre options
  const genreOptions = [
    { value: 'all', label: 'All Genres' },
    { value: 'action', label: 'Action' },
    { value: 'adventure', label: 'Adventure' },
    { value: 'animation', label: 'Animation' },
    { value: 'biography', label: 'Biography' },
    { value: 'comedy', label: 'Comedy' },
    { value: 'crime', label: 'Crime' },
    { value: 'documentary', label: 'Documentary' },
    { value: 'drama', label: 'Drama' },
    { value: 'family', label: 'Family' },
    { value: 'fantasy', label: 'Fantasy' },
    { value: 'film-noir', label: 'Film-Noir' },
    { value: 'history', label: 'History' },
    { value: 'horror', label: 'Horror' },
    { value: 'music', label: 'Music' },
    { value: 'musical', label: 'Musical' },
    { value: 'mystery', label: 'Mystery' },
    { value: 'romance', label: 'Romance' },
    { value: 'sci-fi', label: 'Sci-Fi' },
    { value: 'sport', label: 'Sport' },
    { value: 'thriller', label: 'Thriller' },
    { value: 'war', label: 'War' },
    { value: 'western', label: 'Western' }
  ];
  
  // Order by options
  const orderByOptions = [
    { value: 'featured', label: 'Featured' },
    { value: 'date', label: 'Date Added' },
    { value: 'rating', label: 'Rating' },
    { value: 'title', label: 'Title' },
    { value: 'year', label: 'Year' },
    { value: 'seeds', label: 'Seeds' }
  ];
  
  // Cron presets
  const cronPresets = [
    { value: '0 0 * * *', label: 'Daily at midnight' },
    { value: '0 12 * * *', label: 'Daily at noon' },
    { value: '0 0 * * 0', label: 'Weekly on Sunday' },
    { value: '0 0 1 * *', label: 'Monthly (1st day)' },
    { value: '0 0 * * 1-5', label: 'Weekdays at midnight' },
    { value: '0 0 * * 6,0', label: 'Weekends at midnight' },
    { value: '0 */6 * * *', label: 'Every 6 hours' },
    { value: '0 */12 * * *', label: 'Every 12 hours' }
  ];

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>{isEditing ? 'Edit Schedule' : 'Create New Schedule'}</CardTitle>
      </CardHeader>
      
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <div className="grid gap-4 mb-6">
            <h3 className="text-lg font-medium">Basic Information</h3>
            
            <Input
              label="Name (optional)"
              placeholder="My Movie Schedule"
              {...register("name")}
              error={errors.name?.message}
            />
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Controller
                name="cron_expression"
                control={control}
                rules={{ required: "Schedule pattern is required" }}
                render={({ field }) => (
                  <Select
                    label="Schedule Pattern"
                    options={cronPresets}
                    {...field}
                    error={errors.cron_expression?.message}
                  />
                )}
              />
              
              <Controller
                name="enabled"
                control={control}
                render={({ field: { value, onChange } }) => (
                  <div className="flex items-center h-full pt-6">
                    <label className="flex items-center cursor-pointer">
                      <div className="relative">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={value}
                          onChange={(e) => onChange(e.target.checked)}
                        />
                        <div className={`w-10 h-6 rounded-full transition ${value ? 'bg-primary-600' : 'bg-gray-700'}`}></div>
                        <div className={`absolute left-1 top-1 w-4 h-4 rounded-full transition transform ${value ? 'translate-x-4 bg-white' : 'bg-gray-400'}`}></div>
                      </div>
                      <span className="ml-3 text-gray-300">
                        {value ? 'Enabled' : 'Disabled'}
                      </span>
                    </label>
                  </div>
                )}
              />
            </div>
          </div>
          
          <div className="grid gap-4 mb-6">
            <h3 className="text-lg font-medium">Search Criteria</h3>
            
            <Input
              label="Search Term (optional)"
              placeholder="Leave blank to use other filters"
              {...register("search_params.keyword")}
            />
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Controller
                name="search_params.genre"
                control={control}
                render={({ field }) => (
                  <Select
                    label="Genre"
                    options={genreOptions}
                    {...field}
                  />
                )}
              />
              
              <Input
                type="number"
                label="Year"
                min="1900"
                max="2099"
                {...register("search_params.year", { 
                  valueAsNumber: true,
                  min: {
                    value: 1900,
                    message: "Year must be after 1900"
                  },
                  max: {
                    value: 2099,
                    message: "Year must be before 2099"
                  }
                })}
                error={errors.search_params?.year?.message}
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                type="number"
                label="Minimum Rating"
                min="0"
                max="10"
                step="0.1"
                {...register("search_params.rating", { 
                  valueAsNumber: true,
                  min: {
                    value: 0,
                    message: "Rating must be at least 0"
                  },
                  max: {
                    value: 10,
                    message: "Rating must be at most 10"
                  }
                })}
                error={errors.search_params?.rating?.message}
              />
              
              <Controller
                name="search_params.order_by"
                control={control}
                render={({ field }) => (
                  <Select
                    label="Sort By"
                    options={orderByOptions}
                    {...field}
                  />
                )}
              />
            </div>
          </div>
          
          <div className="grid gap-4">
            <h3 className="text-lg font-medium">Download Options</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Controller
                name="quality"
                control={control}
                rules={{ required: "Quality is required" }}
                render={({ field }) => (
                  <Select
                    label="Download Quality"
                    options={qualityOptions}
                    {...field}
                    error={errors.quality?.message}
                  />
                )}
              />
              
              <Input
                type="number"
                label="Maximum Downloads"
                min="1"
                max="10"
                {...register("max_downloads", { 
                  valueAsNumber: true,
                  min: {
                    value: 1,
                    message: "Must download at least 1 movie"
                  },
                  max: {
                    value: 10,
                    message: "Maximum 10 movies per run"
                  }
                })}
                error={errors.max_downloads?.message}
              />
            </div>
          </div>
        </CardContent>
        
        <CardFooter className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
          
          <Button
            type="submit"
            variant="primary"
            isLoading={isLoading}
          >
            {isEditing ? 'Update Schedule' : 'Create Schedule'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default ScheduleForm;