import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

export interface AuthLinkButtonProps {
  href: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * A navigation CTA that looks like the primary <Button> but is a real anchor,
 * so it can be opened in a new tab. Button renders a <button>, which cannot be
 * a link, hence the duplicated token classes.
 */
const AuthLinkButton: React.FC<AuthLinkButtonProps> = ({ href, children, className }) => (
  <Link
    href={href}
    className={cn(
      'relative inline-flex h-11 select-none items-center justify-center gap-2 rounded-full px-6',
      'bg-gradient-to-r from-gold-lite to-gold font-ui text-[15px] font-medium text-ink',
      'transition-[transform,box-shadow,filter] duration-200 hover:brightness-105',
      'focus:outline-none focus-visible:outline-none',
      'focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
      className,
    )}
  >
    {children}
  </Link>
);

export default AuthLinkButton;
