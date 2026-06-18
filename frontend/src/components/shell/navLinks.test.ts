import { describe, it, expect } from 'vitest';
import { NAV_LINKS, isNavActive } from './navLinks';

describe('navLinks', () => {
  it('lists the four primary links in order', () => {
    expect(NAV_LINKS.map(l => l.label)).toEqual(['Home', 'Movies', 'Series', 'Search']);
    expect(NAV_LINKS.map(l => l.href)).toEqual(['/', '/movies', '/tv', '/search']);
  });
  it('matches Home only exactly', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/', '/movies')).toBe(false);
  });
  it('matches non-home links by prefix (incl. detail routes)', () => {
    expect(isNavActive('/tv', '/tv')).toBe(true);
    expect(isNavActive('/tv', '/tv/123')).toBe(true);
    expect(isNavActive('/movies', '/movies/42')).toBe(true);
    expect(isNavActive('/search', '/tv')).toBe(false);
  });
});
