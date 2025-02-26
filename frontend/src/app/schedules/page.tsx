'use client';

import React, { useState, useEffect } from 'react';
import { ScheduleResponse } from '@/types';
import { schedulesService } from '@/services/schedules';
import ScheduleList from '@/components/schedules/ScheduleList';
import ScheduleForm from '@/components/schedules/ScheduleForm';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<ScheduleResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);

  // Fetch schedules
  const fetchSchedules = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const data = await schedulesService.listSchedules();
      setSchedules(data);
    } catch (err) {
      console.error('Error fetching schedules:', err);
      setError('Failed to fetch schedules. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchSchedules();
  }, []);

  // Handle create schedule button click
  const handleCreateSchedule = () => {
    setEditingScheduleId(null);
    setShowForm(true);
  };

  // Handle edit schedule button click
  const handleEditSchedule = (scheduleId: string) => {
    setEditingScheduleId(scheduleId);
    setShowForm(true);
  };

  // Handle form success
  const handleFormSuccess = () => {
    setShowForm(false);
    setEditingScheduleId(null);
    fetchSchedules();
  };

  // Handle form cancel
  const handleFormCancel = () => {
    setShowForm(false);
    setEditingScheduleId(null);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Scheduled Downloads</h1>
      
      {showForm ? (
        <ScheduleForm
          scheduleId={editingScheduleId || undefined}
          onSuccess={handleFormSuccess}
          onCancel={handleFormCancel}
        />
      ) : (
        <>
          {error ? (
            <div className="bg-red-900/20 border border-red-900 rounded-lg p-4 text-red-400">
              <p>{error}</p>
              <button
                className="mt-2 text-red-400 underline hover:text-red-300"
                onClick={fetchSchedules}
              >
                Try Again
              </button>
            </div>
          ) : (
            <ScheduleList
              initialSchedules={schedules}
              onCreateSchedule={handleCreateSchedule}
              onEditSchedule={handleEditSchedule}
            />
          )}
        </>
      )}
    </div>
  );
}