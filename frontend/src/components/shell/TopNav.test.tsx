import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/tv' }));
vi.mock('@/lib/useScrolled', () => ({ useScrolled: () => false }));
vi.mock('@/context/UserContext', () => ({
  useUser: () => ({ currentUser: { id: '1', display_name: 'Ben', avatar: null }, logout: vi.fn() }),
}));

import TopNav from './TopNav';

describe('TopNav', () => {
  it('renders the four primary links and marks the active one', () => {
    render(<TopNav />);
    for (const label of ['Home', 'Movies', 'Series', 'Search']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    // pathname is /tv → Series is active
    expect(screen.getByRole('link', { name: 'Series' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });
  it('renders the FRÈ wordmark and a profile trigger', () => {
    render(<TopNav />);
    expect(screen.getByText('FRÈ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ben/i })).toBeInTheDocument();
  });
});
