import React from 'react';
import { cn } from '@/lib/cn';

export interface ActionLinkNoticeProps {
  url: string;
  /** What the link does, e.g. "finish claiming this instance". */
  action: string;
  className?: string;
}

/**
 * The supported no-Resend path: with no mail provider configured the backend
 * hands the link back in the response instead of emailing it. This is a normal
 * self-hosted setup, so it must not read as an error.
 */
const ActionLinkNotice: React.FC<ActionLinkNoticeProps> = ({ url, action, className }) => (
  <div className={cn('rounded-xl border border-hairline bg-surface-2 px-4 py-4', className)}>
    <p className="font-ui text-sm leading-relaxed text-muted">
      This instance has no mail provider configured, so the link is here instead of in your inbox.
    </p>
    <a
      href={url}
      className={cn(
        'mt-3 inline-block break-all font-ui text-sm text-gold-lite underline underline-offset-4',
        'transition-colors hover:text-gold',
        'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
      )}
    >
      {url}
    </a>
    <p className="mt-2 font-ui text-xs text-muted">
      Open it to {action}. It is single use.
    </p>
  </div>
);

export default ActionLinkNotice;
