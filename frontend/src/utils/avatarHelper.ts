/**
 * Helper functions for avatar management
 */

// Default avatar as data URI to ensure it always works
export const DEFAULT_AVATAR_DATA_URI = 'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMjAwIDIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxMDAiIGN5PSIxMDAiIHI9IjEwMCIgZmlsbD0iIzFlMjkzYiIvPjxjaXJjbGUgY3g9IjEwMCIgY3k9IjcwIiByPSIzNiIgZmlsbD0iIzY0NzQ4YiIvPjxwYXRoIGQ9Ik0xMDAgMTIwIEM2MCAxMjAgNDAgMTUwIDQwIDIwMCBMMTYwIDIwMCBDMTYwIDE1MCAxNDAgMTIwIDEwMCAxMjBaIiBmaWxsPSIjNjQ3NDhiIi8+PC9zdmc+';

// Available avatar options with preloading
export const AVATAR_OPTIONS = [
  '/avatars/avatar1.svg',
  '/avatars/avatar2.svg',
  '/avatars/avatar3.svg',
  '/avatars/avatar4.svg',
  '/avatars/avatar5.svg',
  '/avatars/avatar6.svg',
  '/avatars/avatar7.svg',
  '/avatars/avatar8.svg',
];

// Preload avatars to check if they exist
export const preloadAvatars = () => {
  if (typeof window === 'undefined') return; // Skip during SSR
  
  // Preload all avatars
  AVATAR_OPTIONS.forEach(src => {
    const img = new Image();
    img.src = src;
  });
  
  // Preload default avatar
  const defaultImg = new Image();
  defaultImg.src = '/avatars/default.png';
};

// Safe image loading with fallback
export const handleAvatarError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  const target = e.currentTarget;
  
  // If already trying to load default avatar, use data URI
  if (target.src.includes('/avatars/default.png')) {
    target.src = DEFAULT_AVATAR_DATA_URI;
    target.onerror = null; // Prevent further error handling
  } else {
    // First fallback to default avatar
    target.src = '/avatars/default.png';
  }
};

// Get initials from name
export const getInitials = (name: string): string => {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};