'use client';

/**
 * MediaTypeBadge — small neutral corner pill marking a card as a film or a
 * series.
 *
 * Used on the mixed home page, where movies and shows share a rail, so the
 * type is legible at a glance. Kept monochrome / translucent so it never
 * competes with the gold accent — type is information, not promotion. The
 * visible label carries the meaning; the icon is decorative (aria-hidden).
 *
 * Icons (FilmIcon / TvIcon) match the app's bottom-tab iconography for the
 * Movies and Series tabs (see shell/BottomTabBar).
 */

import React from 'react';
import { FilmIcon, TvIcon } from '@heroicons/react/16/solid';
import { cn } from '@/lib/cn';

export interface MediaTypeBadgeProps {
  mediaType: 'movie' | 'tv';
  className?: string;
}

const MediaTypeBadge: React.FC<MediaTypeBadgeProps> = ({ mediaType, className }) => {
  const isTv = mediaType === 'tv';
  const Icon = isTv ? TvIcon : FilmIcon;
  const label = isTv ? 'Series' : 'Film';

  return (
    <span
      data-testid="media-type-badge"
      className={cn(
        'inline-flex items-center gap-1 rounded-full',
        'pl-1.5 pr-2 py-[3px]',
        'font-ui text-[9.5px] font-semibold uppercase tracking-[.14em] text-text',
        'bg-[rgba(10,10,11,.72)] border border-hairline backdrop-blur-sm',
        'shadow-[0_1px_6px_rgba(0,0,0,.4)]',
        className,
      )}
    >
      <Icon aria-hidden="true" className="w-[11px] h-[11px] opacity-80" />
      {label}
    </span>
  );
};

export default MediaTypeBadge;
