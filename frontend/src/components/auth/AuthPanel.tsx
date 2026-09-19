import React from 'react';
import { cn } from '@/lib/cn';

export interface AuthPanelProps {
  children: React.ReactNode;
  className?: string;
}

/** Hairline card the auth forms sit in — the only raised surface on these screens. */
const AuthPanel: React.FC<AuthPanelProps> = ({ children, className }) => (
  <div className={cn(
    'w-full rounded-2xl border border-hairline bg-surface/75 p-6 backdrop-blur sm:p-8',
    className,
  )}>
    {children}
  </div>
);

export default AuthPanel;
