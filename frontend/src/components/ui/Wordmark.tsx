import React from 'react';
import { cn } from '@/lib/cn';

export interface WordmarkProps {
  as?: 'span' | 'a';
  href?: string;
  className?: string;
}

export const Wordmark: React.FC<WordmarkProps> = ({ as = 'span', href, className }) => {
  const cls = cn(
    'inline-block font-display font-semibold tracking-[0.12em] leading-none',
    'bg-gradient-to-r from-white via-gold-lite to-gold bg-clip-text text-transparent',
    className,
  );
  if (as === 'a') {
    return <a href={href} className={cls}>FRÈ</a>;
  }
  return <span className={cls}>FRÈ</span>;
};
