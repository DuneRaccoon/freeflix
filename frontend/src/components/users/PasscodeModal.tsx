'use client';

import React, { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useUser } from '@/context/UserContext';

interface PasscodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PasscodeModal: React.FC<PasscodeModalProps> = ({ 
  isOpen, 
  onClose, 
  onSuccess
}) => {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { userSettings, validatePasscode } = useUser();
  
  if (!isOpen || !userSettings?.require_passcode) return null;
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!passcode.trim()) {
      setError('Please enter a passcode');
      return;
    }
    
    if (validatePasscode(passcode.trim())) {
      setPasscode('');
      onSuccess();
    } else {
      setError('Incorrect passcode');
    }
  };
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-gray-900 rounded-lg w-full max-w-md p-6 animate-scale-in">
        <h2 className="text-2xl font-bold mb-2">Enter Passcode</h2>
        <p className="text-gray-400 mb-6">This content requires a passcode to access.</p>
        
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded p-3 mb-4 text-red-400">
              {error}
            </div>
          )}
          
          <Input
            type="password"
            label="Passcode"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Enter passcode"
            autoFocus
          />
          
          <div className="flex justify-end space-x-3 mt-6">
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
            >
              Submit
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PasscodeModal;