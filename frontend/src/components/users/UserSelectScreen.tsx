'use client';

import React, { useState, useEffect } from 'react';
import { useUser } from '@/context/UserContext';
import { User } from '@/services/users';
import Button from '@/components/ui/Button';
import { PlusIcon } from '@heroicons/react/24/outline';
import UserAvatar from './UserAvatar';
import CreateUserModal from './CreateUserModal';
import { useRouter } from 'next/navigation';

const UserSelectScreen: React.FC = () => {
  const { users, isLoading, error, selectUser, loadUsers } = useUser();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const router = useRouter();
  
  // Force full height on mobile
  useEffect(() => {
    // Fix for mobile viewport height
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    
    setVH();
    window.addEventListener('resize', setVH);
    
    return () => {
      window.removeEventListener('resize', setVH);
    };
  }, []);
  
  // Handle user selection
  const handleSelectUser = async (userId: string) => {
    const success = await selectUser(userId);
    if (success) {
      router.push('/');
    }
  };
  
  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[100vh] w-full bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        <p className="mt-4 text-lg">Loading users...</p>
      </div>
    );
  }
  
  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[100vh] w-full bg-background">
        <div className="text-red-500 mb-4">{error}</div>
        <Button onClick={loadUsers}>Try Again</Button>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col items-center justify-center w-full min-h-[100vh] px-4 bg-background" style={{ minHeight: 'calc(var(--vh, 1vh) * 100)' }}>
      <div className="w-full max-w-5xl mx-auto text-center">
        <h1 className="text-3xl font-bold mb-8">Who's watching?</h1>
        
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 max-w-4xl mx-auto avatar-grid">
          {users.map(user => (
            <div 
              key={user.id}
              className="flex flex-col items-center cursor-pointer transition-transform transform hover:scale-105 user-avatar-container"
              onClick={() => handleSelectUser(user.id)}
            >
              <UserAvatar 
                user={user} 
                size="lg"
                className="mb-3"
              />
              <span className="text-center text-lg font-medium">{user.display_name}</span>
            </div>
          ))}
          
          {/* Add User Button */}
          <div 
            className="flex flex-col items-center cursor-pointer transition-transform transform hover:scale-105 user-avatar-container"
            onClick={() => setShowCreateModal(true)}
          >
            <div className="bg-gray-800 rounded-full h-24 w-24 flex items-center justify-center border-2 border-dashed border-gray-600 hover:border-primary-500">
              <PlusIcon className="h-12 w-12 text-gray-500 hover:text-primary-500" />
            </div>
            <span className="text-center text-lg font-medium mt-3">Add Profile</span>
          </div>
        </div>
      </div>
      
      {/* Create User Modal */}
      <CreateUserModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onUserCreated={loadUsers}
      />
    </div>
  );
};

export default UserSelectScreen;