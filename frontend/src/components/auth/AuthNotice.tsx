import React from 'react';
import { cn } from '@/lib/cn';

export type AuthNoticeTone = 'neutral' | 'danger';

export interface AuthNoticeProps {
  tone?: AuthNoticeTone;
  children: React.ReactNode;
  className?: string;
}

const tones: Record<AuthNoticeTone, string> = {
  neutral: 'border-hairline bg-surface-2 text-muted',
  danger: 'border-danger/40 bg-danger/10 text-danger',
};

/**
 * Inset block for an explanation or a failure. `danger` announces itself, so a
 * failed submit reaches a screen reader without moving focus.
 */
const AuthNotice: React.FC<AuthNoticeProps> = ({ tone = 'neutral', children, className }) => (
  <div
    role={tone === 'danger' ? 'alert' : undefined}
    className={cn(
      'rounded-xl border px-4 py-3 font-ui text-sm leading-relaxed',
      tones[tone],
      className,
    )}
  >
    {children}
  </div>
);

export default AuthNotice;
