import React from 'react';
import { cn } from '@/lib/cn';

export interface PillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

const Pill: React.FC<PillProps> = ({ selected = false, className, children, ...props }) => (
  <button
    type="button"
    aria-pressed={selected}
    data-selected={selected}
    className={cn(
      'inline-flex items-center gap-2 rounded-full border px-4 h-9 font-ui text-sm transition-colors',
      'outline-none focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
      selected
        ? 'border-gold/60 bg-gold/15 text-gold-lite'
        : 'border-hairline bg-surface-2/60 text-muted hover:text-text hover:border-gold/40',
      className,
    )}
    {...props}
  >
    {children}
  </button>
);

export default Pill;
