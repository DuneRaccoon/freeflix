'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useUser } from '@/context/UserContext';
import { usersService } from '@/services/users';
import { toast } from 'react-hot-toast';

type Theme = 'dark' | 'light';

type ThemeContextType = {
  theme: Theme;
  setTheme: (theme: Theme) => Promise<void>;
  toggleTheme: () => Promise<void>;
  isThemeLoading: boolean;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, userSettings } = useUser();
  const [theme, setThemeState] = useState<Theme>('dark'); // Default to dark
  const [isThemeLoading, setIsThemeLoading] = useState(false);

  // Initialize theme from user settings
  useEffect(() => {
    if (userSettings?.theme) {
      setThemeState(userSettings.theme as Theme);
    }
  }, [userSettings]);

  // Apply theme class to html element
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    
    // Save theme preference to localStorage for initial SSR render
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Function to set theme and save to user settings
  const setTheme = async (newTheme: Theme) => {
    if (!currentUser) {
      // If no user is logged in, just update the local theme
      setThemeState(newTheme);
      return;
    }

    try {
      setIsThemeLoading(true);
      // Save theme preference to user settings
      await usersService.updateUserSettings(currentUser.id, {
        theme: newTheme
      });
      
      setThemeState(newTheme);
    } catch (error) {
      console.error('Failed to update theme preference:', error);
      toast.error('Failed to save theme preference');
    } finally {
      setIsThemeLoading(false);
    }
  };

  // Function to toggle between dark and light themes
  const toggleTheme = async () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    await setTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isThemeLoading }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};