'use client';
import React, { useState } from 'react';
import { cn } from '@/lib/cn';
import { resolveAvatarSrc, getInitials } from '@/lib/avatars/resolve';

export interface AvatarProps {
  value: string | null | undefined;
  name: string;
  size: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  shape?: 'circle' | 'squircle';
  className?: string;
}

const SIZES: Record<AvatarProps['size'], string> = {
  xs: 'h-8 w-8 text-xs',
  sm: 'h-9 w-9 text-sm',
  md: 'h-12 w-12 text-base',
  lg: 'h-24 w-24 text-2xl',
  xl: 'h-[150px] w-[150px] text-3xl',
};

/**
 * The ONE avatar surface. Anything `resolveAvatarSrc` refuses — an unknown id, a
 * legacy value with no mapping, a hostile string — renders as a monogram, so a
 * stored value can never reach `<img src>` unvalidated.
 */
const Avatar: React.FC<AvatarProps> = ({ value, name, size, shape = 'circle', className }) => {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const src = resolveAvatarSrc(value);
  const showImage = src !== null && brokenSrc !== src;

  return (
    <span
      className={cn(
        'relative grid place-items-center overflow-hidden border border-hairline bg-surface-2',
        'font-display text-muted',
        SIZES[size],
        shape === 'circle' ? 'rounded-full' : 'rounded-[22px]',
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setBrokenSrc(src)}
        />
      ) : (
        <span aria-hidden="true">{getInitials(name)}</span>
      )}
    </span>
  );
};

export default Avatar;
