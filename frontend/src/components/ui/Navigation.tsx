'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { twMerge } from 'tailwind-merge';
import { motion } from 'framer-motion';
import { fadeIn, slideUp, staggerContainer } from '@/components/ui/Motion';
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
  overlay?: boolean;
}> = ({
  sticky = false,
  overlay = false
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
    <nav className={twMerge(
      'top-0 z-30',
      overlay ? 'fixed w-full bg-transparent border-none' : 'border-b border-gray-800/60 sticky bg-card/70 backdrop-blur-md'
    )}>
      <div className="container mx-auto px-4">
        <motion.div 
          className="flex justify-between items-center h-16"
          variants={staggerContainer(0.06, 0)}
          initial="hidden"
          animate="visible"
        >
          {/* Logo and Brand */}
          <motion.div className="flex items-center" variants={slideUp}>
            <Link href="/">
              <span className="flex items-center">
                <span className="ml-2 text-xl font-bold">Freeflix</span>
              </span>
            </Link>
          </motion.div>

          {/* Desktop Menu */}
          <motion.div className="hidden md:flex space-x-2" variants={fadeIn}>
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={twMerge(
                  'flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors hover-lift',
                  isActive(item.href)
                    ? overlay ? 'bg-white/10 text-white border border-white/20' : 'bg-gray-800/70 text-white border border-gray-700'
                    : overlay ? 'text-white/80 hover:bg-white/10 hover:text-white' : 'text-gray-300 hover:bg-gray-700/60 hover:text-white'
                )}
              >
                <item.icon className="h-5 w-5 mr-1" />
                {item.label}
              </Link>
            ))}
          </motion.div>

          {/* User Dropdown and Theme Toggle (Desktop) */}
          <motion.div className="hidden md:flex items-center space-x-2" variants={fadeIn}>
            <ThemeToggle />
            <UserDropdown />
          </motion.div>

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
        </motion.div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className={twMerge('md:hidden pb-3 px-4 animate-fade-in', overlay ? 'bg-black/50 backdrop-blur-sm' : 'bg-card')}>
          <div className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={twMerge(
                  'flex items-center px-3 py-2 rounded-md text-base font-medium',
                  isActive(item.href)
                    ? overlay ? 'bg-white/10 text-white' : 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900'
                    : overlay ? 'text-white/80 hover:bg-white/10 hover:text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white dark:text-gray-700 dark:hover:bg-gray-200 dark:hover:text-gray-900'
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