import React, { useEffect } from 'react';
import { AVATAR_OPTIONS, handleAvatarError, preloadAvatars } from '@/utils/avatarHelper';

interface AvatarSelectorProps {
  selectedAvatar: string | null;
  onChange: (avatar: string) => void;
}

// Preload avatars to check availability

const AvatarSelector: React.FC<AvatarSelectorProps> = ({ selectedAvatar, onChange }) => {
  // Preload avatars on component mount
  useEffect(() => {
    preloadAvatars();
  }, []);
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-200">Select Avatar</label>
      
      <div className="grid grid-cols-4 gap-3">
        {AVATAR_OPTIONS.map((avatar, index) => (
          <div 
            key={index}
            className={`
              w-16 h-16 rounded-full overflow-hidden cursor-pointer border-2 
              ${selectedAvatar === avatar ? 'border-primary-500' : 'border-transparent'}
              hover:border-primary-400 transition-all
            `}
            onClick={() => onChange(avatar)}
          >
            <img 
              src={avatar} 
              alt={`Avatar ${index + 1}`} 
              className="w-full h-full object-cover"
              onError={handleAvatarError}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default AvatarSelector;