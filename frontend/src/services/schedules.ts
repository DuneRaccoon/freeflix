import apiClient from './api-client';
import { ScheduleConfig, ScheduleResponse } from '@/types';

export const schedulesService = {
  // Create a new schedule
  createSchedule: async (config: ScheduleConfig): Promise<ScheduleResponse> => {
    const response = await apiClient.post(`/schedules/`, config);
    return response.data;
  },

  // List all schedules
  listSchedules: async (): Promise<ScheduleResponse[]> => {
    const response = await apiClient.get(`/schedules/`);
    return response.data;
  },

  // Get a schedule by ID
  getSchedule: async (scheduleId: string): Promise<ScheduleResponse> => {
    const response = await apiClient.get(`/schedules/${scheduleId}`);
    return response.data;
  },

  // Update a schedule
  updateSchedule: async (scheduleId: string, config: ScheduleConfig): Promise<ScheduleResponse> => {
    const response = await apiClient.put(`/schedules/${scheduleId}`, config);
    return response.data;
  },

  // Delete a schedule
  deleteSchedule: async (scheduleId: string): Promise<any> => {
    const response = await apiClient.delete(`/schedules/${scheduleId}`);
    return response.data;
  },

  // Run a schedule immediately
  runSchedule: async (scheduleId: string): Promise<any> => {
    const response = await apiClient.post(`/schedules/${scheduleId}/run`);
    return response.data;
  }
};