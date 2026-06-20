export interface NavLink {
  href: string;
  label: string;
}

export const NAV_LINKS: ReadonlyArray<NavLink> = [
  { href: '/', label: 'Home' },
  { href: '/movies', label: 'Movies' },
  { href: '/tv', label: 'Series' },
  { href: '/search', label: 'Search' },
];

/** Active when pathname equals the link (Home) or is under it (everything else). */
export function isNavActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}
