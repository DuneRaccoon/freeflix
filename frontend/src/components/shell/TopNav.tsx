'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from '@/components/ui/Wordmark';
import { Ring } from '@/components/ui/fre';
import { useScrolled } from '@/lib/useScrolled';
import { NAV_LINKS, isNavActive } from './navLinks';
import ProfileMenu from './ProfileMenu';
import { cn } from '@/lib/cn';
import { activityService } from '@/services/activity';

/** How often to poll the activity endpoint (ms). */
const POLL_INTERVAL_MS = 15_000;

const TopNav: React.FC = () => {
  const pathname = usePathname();
  const scrolled = useScrolled(60);

  const [activeDownloads, setActiveDownloads] = useState(0);
  const [aggregateProgress, setAggregateProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchActivity = async () => {
      try {
        const data = await activityService.getCount();
        if (!cancelled) {
          setActiveDownloads(data.active_downloads);
          setAggregateProgress(data.aggregate_progress);
        }
      } catch {
        // Silently ignore errors — badge simply stays hidden / at last known value.
      }
    };

    fetchActivity();
    const timer = setInterval(fetchActivity, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <header
      className={cn(
        'ff-topnav fixed inset-x-0 top-0 z-50 flex items-center gap-8 px-[clamp(20px,4vw,56px)] h-[72px]',
        'transition-[background-color,backdrop-filter,border-color] duration-300 border-b',
        scrolled
          ? 'bg-ink/95 backdrop-blur-md saturate-150 border-hairline'
          : 'bg-gradient-to-b from-ink/70 to-transparent border-transparent backdrop-blur-sm',
      )}
    >
      <Link href="/" aria-label="FRÈ home" className="shrink-0">
        <Wordmark className="text-2xl ff-shine" />
      </Link>

      <nav className="ml-2 hidden items-center gap-7 md:flex">
        {NAV_LINKS.map(link => {
          const active = isNavActive(link.href, pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative font-ui text-sm font-medium transition-colors py-1.5',
                'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                active ? 'text-text' : 'text-muted hover:text-text',
                active && 'after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-gradient-to-r after:from-gold after:to-gold-lite',
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        {activeDownloads > 0 && (
          <Link
            href="/downloads"
            aria-label={`Activity: ${activeDownloads} active download${activeDownloads !== 1 ? 's' : ''}`}
            className="hidden items-center gap-2 rounded-full border border-hairline bg-surface-2/60 px-3 h-9 font-ui text-xs text-text sm:flex focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]"
          >
            <Ring value={Math.round(aggregateProgress)} />
            <span className="font-semibold text-gold-lite">{activeDownloads}</span>
          </Link>
        )}
        <ProfileMenu />
      </div>
    </header>
  );
};

export default TopNav;
