import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
import BottomTabBar from './BottomTabBar';

describe('BottomTabBar', () => {
  it('renders the four primary links with Home active', () => {
    render(<BottomTabBar />);
    for (const label of ['Home', 'Movies', 'Series', 'Search']) {
      expect(screen.getByRole('link', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('aria-current', 'page');
  });
});
