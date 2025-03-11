// frontend/src/services/users.ts
import apiClient from './api-client';

// User types
export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  created_at: string;
}

export interface UserSettings {
  id: string;
  user_id: string;
  maturity_restriction: 'none' | 'pg' | 'pg13' | 'r';
  require_passcode: boolean;
  passcode?: string;
  theme: 'dark' | 'light';
  default_quality: '720p' | '1080p' | '2160p';
  download_path?: string;
}

export interface UserCreate {
  username: string;
  display_name: string;
  avatar?: string;
}

export interface UserUpdate {
  display_name?: string;
  avatar?: string;
}

export const usersService = {
  // Create a new user
  createUser: async (userData: UserCreate): Promise<User> => {
    const response = await apiClient.post('/users', userData);
    return response.data;
  },

  // Get all users
  getUsers: async (): Promise<User[]> => {
    const response = await apiClient.get('/users');
    return response.data;
  },

  // Get user by ID
  getUser: async (userId: string): Promise<User> => {
    const response = await apiClient.get(`/users/${userId}`);
    return response.data;
  },

  // Update user
  updateUser: async (userId: string, userData: UserUpdate): Promise<User> => {
    const response = await apiClient.put(`/users/${userId}`, userData);
    return response.data;
  },

  // Delete user
  deleteUser: async (userId: string): Promise<void> => {
    await apiClient.delete(`/users/${userId}`);
  },

  // Get user settings
  getUserSettings: async (userId: string): Promise<UserSettings> => {
    const response = await apiClient.get(`/users/${userId}/settings`);
    return response.data;
  },

  // Update user settings
  updateUserSettings: async (userId: string, settings: Partial<UserSettings>): Promise<UserSettings> => {
    const response = await apiClient.put(`/users/${userId}/settings`, settings);
    return response.data;
  }
};