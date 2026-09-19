'use client';
import React from 'react';
import { AVATAR_OPTIONS, handleAvatarError } from '@/utils/avatarHelper';
import { cn } from '@/lib/cn';

export interface AvatarPickerProps {
  value: string | null;
  onChange: (avatar: string | null) => void;
  /** Shown on the "no avatar" tile so the choice previews the typed name. */
  initials?: string;
  disabled?: boolean;
  name?: string;
  className?: string;
}

const TILE = 'relative grid aspect-square place-items-center overflow-hidden rounded-[18px] border transition-colors duration-200';
const RING = 'peer-focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]';

/**
 * Avatar choice for the invite setup form. Built on hidden radio inputs (the
 * same trick as the fre RadioGroup) so arrow-key navigation and screen-reader
 * semantics come from the platform rather than hand-rolled key handling.
 */
const AvatarPicker: React.FC<AvatarPickerProps> = ({
  value, onChange, initials = '', disabled = false, name = 'avatar', className,
}) => {
  const options: Array<{ key: string; src: string | null; label: string }> = [
    { key: 'none', src: null, label: 'No avatar' },
    ...AVATAR_OPTIONS.map((src, i) => ({ key: src, src, label: `Avatar ${i + 1}` })),
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Avatar"
      className={cn('grid grid-cols-3 gap-3 sm:grid-cols-5', disabled && 'opacity-50', className)}
    >
      {options.map((opt) => {
        const selected = (opt.src ?? null) === value;
        const id = `${name}-${opt.key}`;
        return (
          <label key={opt.key} htmlFor={id} className={cn('cursor-pointer', disabled && 'pointer-events-none')}>
            <input
              type="radio"
              id={id}
              name={name}
              value={opt.src ?? ''}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(opt.src)}
              aria-label={opt.label}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={cn(
                TILE, RING,
                selected ? 'border-gold bg-surface-2' : 'border-hairline bg-surface-2 hover:border-gold/45',
              )}
            >
              {opt.src ? (
                <img src={opt.src} alt="" onError={handleAvatarError} className="h-full w-full object-cover" />
              ) : (
                <span className="font-display text-lg text-muted">{initials || '—'}</span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
};

export default AvatarPicker;
