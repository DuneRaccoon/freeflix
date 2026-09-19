import React from 'react';
import { cn } from '@/lib/cn';

export interface AuthSpinnerProps {
  /** Announced to assistive tech — say what is being waited on, not "loading". */
  label: string;
  className?: string;
}

/** The single loading affordance on the public auth screens: a gold arc on a hairline ring. */
const AuthSpinner: React.FC<AuthSpinnerProps> = ({ label, className }) => (
  <div className={cn('flex justify-center', className)}>
    <span
      role="status"
      aria-label={label}
      className="h-8 w-8 animate-spin rounded-full border-2 border-hairline border-t-gold"
    />
  </div>
);

export default AuthSpinner;
