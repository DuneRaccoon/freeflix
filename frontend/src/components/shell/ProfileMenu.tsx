'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';
import { getInitials, handleAvatarError } from '@/utils/avatarHelper';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/my-list', label: 'My List' },
  { href: '/schedules', label: 'Schedules' },
  { href: '/downloads', label: 'Downloads' },
  { href: '/settings', label: 'Settings' },
];

const ProfileMenu: React.FC = () => {
  const { currentUser, logout } = useUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const name = currentUser?.display_name ?? 'Profile';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className={cn(
          'grid h-9 w-9 place-items-center rounded-full border border-hairline bg-surface-2',
          'font-ui text-sm font-semibold text-text overflow-hidden',
          'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
        )}
      >
        {currentUser?.avatar
          ? <img src={currentUser.avatar} alt={name} onError={handleAvatarError} className="h-full w-full object-cover" />
          : <span aria-hidden="true">{getInitials(name)}</span>}
        <span className="sr-only">{name}</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-52 rounded-xl border border-hairline bg-surface/95 p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur">
          <p className="px-3 pt-1.5 pb-2 font-ui text-xs uppercase tracking-[0.22em] text-muted">{name}</p>
          {ITEMS.map(item => (
            <Link key={item.href} role="menuitem" href={item.href} onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 font-ui text-sm text-text hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2">
              {item.label}
            </Link>
          ))}
          <button role="menuitem" type="button" onClick={() => { setOpen(false); logout(); }}
            className="mt-1 block w-full rounded-lg px-3 py-2 text-left font-ui text-sm text-text hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2">
            Switch profile
          </button>
        </div>
      )}
    </div>
  );
};

export default ProfileMenu;
