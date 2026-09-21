'use client';
import React, { useState } from 'react';
import { cn } from '@/lib/cn';
import { Pill } from '@/components/ui/fre';
import { AVATAR_COLLECTIONS } from '@/lib/avatars/catalog';
import { resolveAvatarSrc } from '@/lib/avatars/resolve';

export interface AvatarPickerProps {
  value: string | null;
  onChange: (avatar: string | null) => void;
  /** Shown on the "no avatar" tile so the choice previews the typed name. */
  initials?: string;
  disabled?: boolean;
  name?: string;
  className?: string;
}

const TILE =
  'relative grid aspect-square place-items-center overflow-hidden rounded-[18px] border transition-colors duration-200';
const RING =
  'peer-focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]';

/**
 * Built on hidden radio inputs so arrow-key navigation and screen-reader
 * semantics come from the platform rather than hand-rolled key handling —
 * the same trick as the fre RadioGroup.
 */
const AvatarPicker: React.FC<AvatarPickerProps> = ({
  value, onChange, initials = '', disabled = false, name = 'avatar', className,
}) => {
  const [active, setActive] = useState(AVATAR_COLLECTIONS[0].key);
  const collection =
    AVATAR_COLLECTIONS.find((c) => c.key === active) ?? AVATAR_COLLECTIONS[0];

  const options: Array<{ key: string; id: string | null; label: string }> = [
    { key: 'none', id: null, label: 'No avatar' },
    ...collection.pieces.map((p) => ({
      key: p.id,
      id: `house:${p.id}`,
      label: p.label,
    })),
  ];

  return (
    <div className={cn('flex flex-col gap-4', disabled && 'opacity-50', className)}>
      <div className="flex flex-wrap gap-2">
        {AVATAR_COLLECTIONS.map((c) => (
          <Pill
            key={c.key}
            selected={c.key === active}
            disabled={disabled}
            onClick={() => setActive(c.key)}
          >
            {c.title}
          </Pill>
        ))}
      </div>

      <div role="radiogroup" aria-label="Avatar" className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {options.map((opt) => {
          const selected = opt.id === value;
          const id = `${name}-${opt.key}`;
          const src = opt.id ? resolveAvatarSrc(opt.id) : null;
          return (
            <label key={opt.key} htmlFor={id} className={cn('cursor-pointer', disabled && 'pointer-events-none')}>
              <input
                type="radio"
                id={id}
                name={name}
                value={opt.id ?? ''}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(opt.id)}
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
                {src ? (
                  <img src={src} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-display text-lg text-muted">{initials || '—'}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default AvatarPicker;
