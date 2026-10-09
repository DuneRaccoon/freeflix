'use client';
import Link from 'next/link';
import type { FocusProps } from '../_focus/useFocusGrid';

export interface NavTarget {
  href: string;
  label: string;
}

/**
 * Where a viewer can go from home. Search and My List are built by later tasks; until then
 * their links land on the catch-all screen, which says so.
 *
 * "Switch profile" and Diagnostics are here because nothing else on a healthy home links
 * to them (the picker's only other link is in the recovery panel), and a remote cannot type
 * a URL.
 */
export const NAV_TARGETS: readonly NavTarget[] = [
  { href: '/bigscreen/search', label: 'Search' },
  { href: '/bigscreen/list', label: 'My List' },
  { href: '/bigscreen/profiles', label: 'Switch profile' },
  { href: '/bigscreen/diag', label: 'Diagnostics' },
];

/**
 * One focus row, one cell per `NAV_TARGETS` entry. The screen reports
 * `NAV_TARGETS.length` as this row's count: the two must agree.
 */
export function NavRow({
  row,
  focusPropsFor,
}: {
  row: number;
  focusPropsFor: (row: number, col: number) => FocusProps;
}) {
  return (
    <nav className="bs-nav" aria-label="Freeflix">
      {NAV_TARGETS.map((t, col) => (
        <Link key={t.href} href={t.href} className="bs-nav__item" draggable={false} {...focusPropsFor(row, col)}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
