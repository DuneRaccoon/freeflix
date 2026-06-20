import React from 'react';
import { cn } from '@/lib/cn';

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0–100
  label?: string;
}

export const Progress: React.FC<ProgressProps> = ({ value, label, className, ...props }) => {
  const v = clamp(value);
  return (
    <div
      {...props}
      role="progressbar"
      aria-label={label}
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-text/15', className)}
    >
      <div className="h-full rounded-full bg-gold" style={{ width: `${v}%` }} />
    </div>
  );
};

export interface RingProps {
  value: number; // 0–100
  size?: number; // px
  className?: string;
  /** When provided: role="img" + aria-label. Omit for decorative rings (aria-hidden). */
  label?: string;
}

export const Ring: React.FC<RingProps> = ({ value, size = 18, className, label }) => {
  const v = clamp(value);
  const deg = Math.round((v / 100) * 360);
  return (
    <span
      data-testid="fre-ring"
      data-value={v}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('inline-block rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(var(--color-gold) ${deg}deg, color-mix(in oklab, var(--color-text) 14%, transparent) ${deg}deg)`,
        WebkitMask: 'radial-gradient(circle calc(50% - 3px) at center, transparent 98%, #000 100%)',
        mask: 'radial-gradient(circle calc(50% - 3px) at center, transparent 98%, #000 100%)',
      }}
    />
  );
};
