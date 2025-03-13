import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import { SunIcon, MoonIcon } from '@heroicons/react/24/outline';

interface ThemeToggleProps {
  className?: string;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ className }) => {
  const { theme, toggleTheme, isThemeLoading } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      disabled={isThemeLoading}
      className={`relative inline-flex items-center p-2 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 ${
        theme === 'dark' 
          ? 'text-gray-300 hover:text-white hover:bg-gray-700' 
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
      } ${className}`}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {isThemeLoading ? (
        <div className="animate-spin h-5 w-5 border-2 border-current border-t-transparent rounded-full" />
      ) : theme === 'dark' ? (
        <SunIcon className="h-5 w-5" />
      ) : (
        <MoonIcon className="h-5 w-5" />
      )}
    </button>
  );
};

export default ThemeToggle;