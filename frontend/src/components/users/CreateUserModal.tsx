'use client';

import React, { useState } from 'react';
import { usersService } from '@/services/users';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { toast } from 'react-hot-toast';
import AvatarSelector from './AvatarSelector';

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUserCreated: () => void;
}

const CreateUserModal: React.FC<CreateUserModalProps> = ({ 
  isOpen, 
  onClose, 
  onUserCreated 
}) => {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // If modal is not open, don't render
  if (!isOpen) return null;
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim() || !displayName.trim()) {
      setError('Username and display name are required');
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      
      // Create user
      await usersService.createUser({
        username: username.trim(),
        display_name: displayName.trim(),
        avatar: selectedAvatar || undefined
      });
      
      toast.success('User created successfully!');
      onUserCreated();
      onClose();
    } catch (err: any) {
      console.error('Error creating user:', err);
      setError(err.response?.data?.detail || 'Failed to create user. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-gray-900 rounded-lg w-full max-w-md p-6 animate-scale-in">
        <h2 className="text-2xl font-bold mb-6">Create New Profile</h2>
        
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded p-3 mb-4 text-red-400">
              {error}
            </div>
          )}
          
          {/* <div className="mb-6">
            <AvatarSelector
              selectedAvatar={selectedAvatar}
              onChange={setSelectedAvatar}
            />
          </div>
           */}
          <div className="space-y-4 mb-6">
            <Input
              label="Username"
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
            
            <Input
              label="Display Name"
              placeholder="Enter display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          
          <div className="flex justify-end space-x-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            
            <Button
              type="submit"
              variant="primary"
              isLoading={isLoading}
            >
              Create Profile
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateUserModal;