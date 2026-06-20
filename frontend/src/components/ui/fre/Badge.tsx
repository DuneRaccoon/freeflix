import React from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'default' | 'gold' | 'success' | 'danger';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const tones: Record<BadgeTone, string> = {
  default: 'border-hairline bg-surface-2 text-muted',
  gold: 'border-gold/40 bg-gold/10 text-gold-lite',
  success: 'border-success/40 bg-success/10 text-success',
  danger: 'border-danger/40 bg-danger/10 text-danger',
};

const Badge: React.FC<BadgeProps> = ({ tone = 'default', className, children, ...props }) => (
  <span
    data-tone={tone}
    className={cn(
      'inline-flex items-center rounded-full border px-2.5 py-0.5 font-ui text-xs font-medium tracking-wide',
      tones[tone],
      className,
    )}
    {...props}
  >
    {children}
  </span>
);

export default Badge;
