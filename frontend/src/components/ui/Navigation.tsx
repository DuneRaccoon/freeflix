'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { twMerge } from 'tailwind-merge';
import {
  HomeIcon,
  MagnifyingGlassIcon,
  FilmIcon,
  ClockIcon,
  Cog6ToothIcon,
  Bars3Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import UserDropdown from '@/components/users/UserDropdown';
import ThemeToggle from '@/components/ui/ThemeToggle';

const Navigation: React.FC<{
  sticky?: boolean;
}> = ({
  sticky = false
}) => {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const navItems = [
    { href: '/', label: 'Home', icon: HomeIcon },
    { href: '/search', label: 'Search', icon: MagnifyingGlassIcon },
    { href: '/my-movies', label: 'My Movies', icon: FilmIcon },
    { href: '/schedules', label: 'Schedules', icon: ClockIcon },
    { href: '/settings', label: 'Settings', icon: Cog6ToothIcon },
  ];

  const isActive = (path: string) => {
    return pathname === path;
  };

  return (
    <nav className="border-b border-gray-800 sticky top-0 z-10 bg-card">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          {/* Logo and Brand */}
          <div className="flex items-center">
            <Link href="/">
              <span className="flex items-center">
                <span className="ml-2 text-xl font-bold">Freeflix</span>
              </span>
            </Link>
          </div>

          {/* Desktop Menu */}
          <div className="hidden md:flex space-x-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={twMerge(
                  'flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive(item.href)
                    ? 'bg-gray-800 text-white dark:bg-gray-700 dark:text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white dark:text-gray-700 dark:hover:bg-gray-200 dark:hover:text-gray-900'
                )}
              >
                <item.icon className="h-5 w-5 mr-1" />
                {item.label}
              </Link>
            ))}
          </div>

          {/* User Dropdown and Theme Toggle (Desktop) */}
          <div className="hidden md:flex items-center space-x-2">
            <ThemeToggle />
            <UserDropdown />
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center space-x-3">
            <ThemeToggle />
            <UserDropdown />
            <button
              onClick={toggleMobileMenu}
              className="text-gray-300 hover:text-white focus:outline-none dark:text-gray-700 dark:hover:text-gray-900"
            >
              {isMobileMenuOpen ? (
                <XMarkIcon className="h-6 w-6" />
              ) : (
                <Bars3Icon className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-card pb-3 px-4 animate-fade-in">
          <div className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={twMerge(
                  'flex items-center px-3 py-2 rounded-md text-base font-medium',
                  isActive(item.href)
                    ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white dark:text-gray-700 dark:hover:bg-gray-200 dark:hover:text-gray-900'
                )}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <item.icon className="h-5 w-5 mr-2" />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navigation;