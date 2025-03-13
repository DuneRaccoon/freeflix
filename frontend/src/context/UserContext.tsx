'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserSettings, usersService } from '@/services/users';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { preloadAvatars } from '@/utils/avatarHelper';

type UserContextType = {
  currentUser: User | null;
  userSettings: UserSettings | null;
  users: User[];
  isLoading: boolean;
  error: string | null;
  loadUsers: () => Promise<void>;
  selectUser: (userId: string) => Promise<boolean>;
  logout: () => void;
  validatePasscode: (passcode: string) => boolean;
  isPasscodeRequired: (contentRating?: string | null) => boolean;
  isContentAllowed: (contentRating?: string | null) => boolean;
  updateUser: (userId: string, data: { display_name?: string; avatar?: string }) => Promise<void>;
  updateUserSettings: (userId: string, settings: Partial<UserSettings>) => Promise<void>;
};

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Load users on mount
  useEffect(() => {
    // Preload avatars to ensure they're available
    preloadAvatars();
    
    loadUsers();
    
    // Try to get current user from local storage
    const storedUserId = localStorage.getItem('currentUserId');
    if (storedUserId) {
      selectUser(storedUserId).catch(() => {
        // If user doesn't exist anymore, remove from storage
        localStorage.removeItem('currentUserId');
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, []);

  // Load all users
  const loadUsers = async () => {
    try {
      setError(null);
      const userData = await usersService.getUsers();
      setUsers(userData);
    } catch (err) {
      console.error('Error loading users:', err);
      setError('Failed to load users. Please try again.');
    }
  };

  // Select a user
  const selectUser = async (userId: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Get user and settings
      const [user, settings] = await Promise.all([
        usersService.getUser(userId),
        usersService.getUserSettings(userId)
      ]);
      
      setCurrentUser(user);
      setUserSettings(settings);
      
      // Store in local storage
      localStorage.setItem('currentUserId', user.id);
      
      return true;
    } catch (err) {
      console.error('Error selecting user:', err);
      setError('Failed to select user. Please try again.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // Logout user
  const logout = () => {
    setCurrentUser(null);
    setUserSettings(null);
    localStorage.removeItem('currentUserId');
    router.push('/');
  };

  // Validate passcode for restricted content
  const validatePasscode = (passcode: string): boolean => {
    if (!userSettings?.require_passcode) return true;
    return userSettings.passcode === passcode;
  };

  // Maturity levels from least to most restrictive
  const maturityLevels = ['none', 'pg', 'pg13', 'r'];

  // Check if content is allowed based on maturity rating
  const isContentAllowed = (contentRating?: string | null): boolean => {
    // If no settings or no restrictions, allow all
    if (!userSettings || userSettings.maturity_restriction === 'none') {
      return true;
    }
    
    // If no content rating, allow
    if (!contentRating) {
      return true;
    }
    
    // Get numerical values for comparison
    const contentLevel = maturityLevels.indexOf(contentRating.toLowerCase());
    const settingsLevel = maturityLevels.indexOf(userSettings.maturity_restriction);
    
    // If content rating is unknown, allow
    if (contentLevel === -1) {
      return true;
    }
    
    // Allow if content rating is less than or equal to settings restriction
    return contentLevel <= settingsLevel;
  };

  // Check if passcode is required
  const isPasscodeRequired = (contentRating?: string | null): boolean => {
    // If no settings or passcode not required, no passcode needed
    if (!userSettings || !userSettings.require_passcode) {
      return false;
    }
    
    // If no content rating, don't require passcode
    if (!contentRating) {
      return false;
    }
    
    // Get numerical values for comparison
    const contentLevel = maturityLevels.indexOf(contentRating.toLowerCase());
    const settingsLevel = maturityLevels.indexOf(userSettings.maturity_restriction);
    
    // Unknown rating doesn't require passcode
    if (contentLevel === -1) {
      return false;
    }
    
    // Require passcode if content rating is greater than settings restriction
    return contentLevel > settingsLevel;
  };

  // Update user info
  const updateUser = async (userId: string, data: { display_name?: string; avatar?: string }) => {
    try {
      setIsLoading(true);
      const updatedUser = await usersService.updateUser(userId, data);
      
      // Update current user if this is the logged in user
      if (currentUser && currentUser.id === userId) {
        setCurrentUser(updatedUser);
      }
      
      // Refresh the users list
      await loadUsers();
      
      toast.success('User updated successfully');
    } catch (err) {
      console.error('Error updating user:', err);
      toast.error('Failed to update user');
    } finally {
      setIsLoading(false);
    }
  };

  // Update user settings
  const updateUserSettings = async (userId: string, settings: Partial<UserSettings>) => {
    try {
      setIsLoading(true);
      const updatedSettings = await usersService.updateUserSettings(userId, settings);
      
      // Update current user settings if this is the logged in user
      if (currentUser && currentUser.id === userId) {
        setUserSettings(updatedSettings);
      }
      
      toast.success('Settings updated successfully');
    } catch (err) {
      console.error('Error updating settings:', err);
      toast.error('Failed to update settings');
    } finally {
      setIsLoading(false);
    }
  };

  const value = {
    currentUser,
    userSettings,
    users,
    isLoading,
    error,
    loadUsers,
    selectUser,
    logout,
    validatePasscode,
    isPasscodeRequired,
    isContentAllowed,
    updateUser,
    updateUserSettings
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};