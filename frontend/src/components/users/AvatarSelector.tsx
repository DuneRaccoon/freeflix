import React from 'react';

interface AvatarSelectorProps {
  selectedAvatar: string | null;
  onChange: (avatar: string) => void;
}

// Available avatar options
const avatarOptions = [
  '/avatars/avatar1.png',
  '/avatars/avatar2.png',
  '/avatars/avatar3.png',
  '/avatars/avatar4.png',
  '/avatars/avatar5.png',
  '/avatars/avatar6.png',
  '/avatars/avatar7.png',
  '/avatars/avatar8.png',
];

const AvatarSelector: React.FC<AvatarSelectorProps> = ({ selectedAvatar, onChange }) => {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-200">Select Avatar</label>
      
      <div className="grid grid-cols-4 gap-3">
        {avatarOptions.map((avatar, index) => (
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
              onError={(e) => {
                // Fallback to a default if image fails to load
                e.currentTarget.src = '/avatars/default.png';
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default AvatarSelector;