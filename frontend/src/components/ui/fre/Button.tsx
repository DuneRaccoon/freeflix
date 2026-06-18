import React from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'glass' | 'ghost' | 'icon' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const base =
  'relative inline-flex items-center justify-center gap-2 font-ui font-medium ' +
  'rounded-full select-none transition-[transform,background-color,border-color,color,box-shadow] ' +
  'duration-200 focus:outline-none focus-visible:outline-none ' +
  'focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)] ' +
  'disabled:opacity-50 disabled:pointer-events-none';

const variants: Record<ButtonVariant, string> = {
  // champagne fill, ink text — the precious primary CTA
  primary: 'bg-gradient-to-r from-gold-lite to-gold text-ink hover:brightness-105',
  // hairline glass
  glass: 'border border-hairline bg-surface-2/60 text-text backdrop-blur hover:border-gold/50',
  ghost: 'bg-transparent text-muted hover:text-text',
  icon: 'border border-hairline bg-surface-2/60 text-text hover:border-gold/50 aspect-square !p-0',
  danger: 'bg-transparent text-danger border border-danger/50 hover:bg-danger/10',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-6 text-[15px]',
  lg: 'h-12 px-8 text-base',
};

const Button: React.FC<ButtonProps> = ({
  children, className, variant = 'primary', size = 'md',
  isLoading = false, leftIcon, rightIcon, disabled, ...props
}) => (
  <button
    data-variant={variant}
    data-size={size}
    aria-busy={isLoading || undefined}
    disabled={disabled || isLoading}
    className={cn(base, variants[variant], sizes[size], className)}
    {...props}
  >
    {isLoading && (
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    )}
    {!isLoading && leftIcon}
    {children}
    {!isLoading && rightIcon}
  </button>
);

export default Button;
