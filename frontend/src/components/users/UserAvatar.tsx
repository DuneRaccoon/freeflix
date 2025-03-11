import React from 'react';
import { User } from '@/services/users';
import { twMerge } from 'tailwind-merge';

interface UserAvatarProps {
  user: User;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
}

const UserAvatar: React.FC<UserAvatarProps> = ({ 
  user, 
  size = 'md',
  className,
  onClick
}) => {
  // Default avatar if none is set
  const avatarSrc = user.avatar || '/avatars/default.png';
  
  // Size classes
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-12 w-12',
    lg: 'h-24 w-24',
    xl: 'h-32 w-32'
  };
  
  // Set fallback if image fails to load
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.src = '/avatars/default.png';
  };
  
  // Generate initials from display name
  const initials = user.display_name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
    
  return (
    <div 
      className={twMerge(
        `${sizeClasses[size]} rounded-full overflow-hidden bg-gradient-to-br from-primary-600 to-secondary-600 flex items-center justify-center`,
        onClick ? 'cursor-pointer hover:ring-2 hover:ring-primary-500' : '',
        className
      )}
      onClick={onClick}
    >
      {avatarSrc ? (
        <img 
          src={avatarSrc} 
          alt={user.display_name}
          className="h-full w-full object-cover" 
          onError={handleImageError}
        />
      ) : (
        <span className="text-white font-bold text-xl">{initials}</span>
      )}
    </div>
  );
};

export default UserAvatar;