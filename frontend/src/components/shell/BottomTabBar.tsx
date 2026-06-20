'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HomeIcon, FilmIcon, TvIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { NAV_LINKS, isNavActive } from './navLinks';
import { cn } from '@/lib/cn';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '/': HomeIcon,
  '/movies': FilmIcon,
  '/tv': TvIcon,
  '/search': MagnifyingGlassIcon,
};

const BottomTabBar: React.FC = () => {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 flex h-16 items-stretch border-t border-hairline bg-ink/95 backdrop-blur-md md:hidden"
    >
      {NAV_LINKS.map(link => {
        const Icon = ICONS[link.href] ?? HomeIcon;
        const active = isNavActive(link.href, pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 font-ui text-[11px]',
              'focus:outline-none focus-visible:bg-surface-2',
              active ? 'text-gold-lite' : 'text-muted',
            )}
          >
            <Icon className="h-5 w-5" />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

export default BottomTabBar;
