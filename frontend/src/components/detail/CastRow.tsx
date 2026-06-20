'use client';

/**
 * CastRow — horizontal scrolling cast portraits for the detail page.
 *
 * Props `{ cast: CastMember[] }`.
 * Renders a labelled section with a horizontally scrollable row of round
 * portraits (object-cover, with an initial-letter placeholder when `image`
 * is null or fails to load) and name + character credit below each.
 *
 * Returns null when the cast array is empty.
 */

import React, { useState } from 'react';
import { cn } from '@/lib/cn';
import type { CastMember } from '@/types';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Pick an initial from a name, e.g. "Timothée Chalamet" → "T" */
function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

// ── sub-components ────────────────────────────────────────────────────────────

interface PortraitProps {
  member: CastMember;
}

/**
 * A single cast portrait — round image with name + character credit below.
 * Falls back to an initial-letter avatar when `image` is null or errors.
 */
function Portrait({ member }: PortraitProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = member.image && !imgFailed;

  return (
    <div
      className="flex flex-col items-center text-center w-[104px] shrink-0 group"
      data-testid="cast-member"
    >
      {/* Portrait ring */}
      <div
        className={cn(
          'w-[76px] h-[76px] rounded-full overflow-hidden mb-[10px]',
          'border border-hairline',
          'transition-[transform,border-color] duration-[250ms]',
          'group-hover:scale-[1.06] group-hover:border-gold',
          'bg-surface-2',
        )}
        aria-hidden={!showImage}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={member.image!}
            alt={member.name}
            data-testid={`cast-portrait-${member.name}`}
            className="w-full h-full object-cover block"
            onError={() => setImgFailed(true)}
          />
        ) : (
          /* Initial placeholder */
          <div
            className={cn(
              'w-full h-full flex items-center justify-center',
              'font-display font-semibold text-[26px] text-gold select-none',
            )}
            aria-label={member.name}
            data-testid={`cast-portrait-${member.name}`}
          >
            {initial(member.name)}
          </div>
        )}
      </div>

      {/* Name */}
      <span
        className="text-[13.5px] font-medium text-text leading-[1.3] line-clamp-2"
        data-testid={`cast-name-${member.name}`}
      >
        {member.name}
      </span>

      {/* Character */}
      {member.character && (
        <span
          className="text-[12px] text-muted leading-[1.3] mt-[2px] line-clamp-2"
          data-testid={`cast-character-${member.name}`}
        >
          {member.character}
        </span>
      )}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export interface CastRowProps {
  cast: CastMember[];
}

const CastRow: React.FC<CastRowProps> = ({ cast }) => {
  if (!cast || cast.length === 0) return null;

  return (
    <section aria-label="Cast" className="mt-[40px]">
      {/* Section heading */}
      <h2
        className={cn(
          'font-display font-semibold text-[22px] tracking-[-0.01em]',
          'm-0 mb-[4px]',
        )}
      >
        Cast
      </h2>

      {/* Horizontal scroll track */}
      <div
        role="list"
        aria-label="Cast members"
        className={cn(
          'flex gap-[22px] overflow-x-auto mt-[18px]',
          '[scroll-snap-type:x_proximity]',
          'scroll-smooth',
          // Hide scrollbar
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          'pb-[4px] pt-[2px]',
        )}
      >
        {cast.map((member) => (
          <div key={member.name} role="listitem">
            <Portrait member={member} />
          </div>
        ))}
      </div>
    </section>
  );
};

export default CastRow;
