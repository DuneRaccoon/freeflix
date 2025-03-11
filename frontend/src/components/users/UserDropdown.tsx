'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/context/UserContext';
import UserAvatar from './UserAvatar';
import { User } from '@/services/users';
import {
  UserIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  ChevronDownIcon
} from '@heroicons/react/24/outline';
import Link from 'next/link';

const UserDropdown: React.FC = () => {
  const { currentUser, users, logout, selectUser } = useUser();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // If no user is logged in, show a simple login button
  if (!currentUser) {
    return (
      <button
        className="flex items-center px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-md"
        onClick={() => router.push('/')}
      >
        <UserIcon className="h-5 w-5 mr-2" />
        Select User
      </button>
    );
  }

  // Handle selecting a different user
  const handleUserSelect = async (user: User) => {
    await selectUser(user.id);
    setIsOpen(false);
  };

  // Handle logout
  const handleLogout = () => {
    logout();
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown Trigger Button */}
      <button
        className="flex items-center space-x-2 focus:outline-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <UserAvatar user={currentUser} size="sm" />
        <span className="hidden md:block text-sm font-medium">
          {currentUser.display_name}
        </span>
        <ChevronDownIcon className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-gray-800 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none divide-y divide-gray-700">
          {/* Current User Info */}
          <div className="px-4 py-3">
            <p className="text-sm">Signed in as</p>
            <p className="truncate text-sm font-medium text-white">{currentUser.username}</p>
          </div>

          {/* Settings and Logout */}
          <div className="py-1">
            <Link
              href={`/users/${currentUser.id}/settings`}
              className="flex items-center px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
              onClick={() => setIsOpen(false)}
            >
              <Cog6ToothIcon className="h-5 w-5 mr-2" />
              Settings
            </Link>
            <button
              className="flex w-full items-center px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
              onClick={handleLogout}
            >
              <ArrowRightOnRectangleIcon className="h-5 w-5 mr-2" />
              Sign out
            </button>
          </div>

          {/* Switch User Section */}
          {users.length > 1 && (
            <div className="py-1">
              <div className="px-4 py-2 text-xs text-gray-500">Switch Profile</div>
              {users
                .filter(user => user.id !== currentUser.id)
                .map(user => (
                  <button
                    key={user.id}
                    className="flex w-full items-center px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                    onClick={() => handleUserSelect(user)}
                  >
                    <UserAvatar user={user} size="sm" className="mr-2" />
                    {user.display_name}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UserDropdown;