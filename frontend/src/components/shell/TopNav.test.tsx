import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/tv' }));
vi.mock('@/lib/useScrolled', () => ({ useScrolled: () => false }));
vi.mock('@/context/UserContext', () => ({
  useUser: () => ({ currentUser: { id: '1', display_name: 'Ben', avatar: null }, logout: vi.fn() }),
}));
vi.mock('@/services/activity', () => ({
  activityService: { getCount: vi.fn().mockResolvedValue({ active_downloads: 0, aggregate_progress: 0, max_active_downloads: 2 }) },
}));

import TopNav from './TopNav';
import { activityService } from '@/services/activity';

const mockGetCount = vi.mocked(activityService.getCount);

describe('TopNav', () => {
  beforeEach(() => {
    mockGetCount.mockResolvedValue({ active_downloads: 0, aggregate_progress: 0, max_active_downloads: 2 });
  });

  it('renders the four primary links and marks the active one', async () => {
    await act(async () => { render(<TopNav />); });
    for (const label of ['Home', 'Movies', 'Series', 'Search']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    // pathname is /tv → Series is active
    expect(screen.getByRole('link', { name: 'Series' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('renders the FRÈ wordmark and a profile trigger', async () => {
    await act(async () => { render(<TopNav />); });
    expect(screen.getByText('FRÈ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ben/i })).toBeInTheDocument();
  });

  it('hides the activity pill when there are no active downloads', async () => {
    await act(async () => { render(<TopNav />); });
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /activity/i })).not.toBeInTheDocument();
    });
  });

  it('shows the activity pill with the correct download count when there are active downloads', async () => {
    mockGetCount.mockResolvedValue({ active_downloads: 3, aggregate_progress: 45.5, max_active_downloads: 2 });
    await act(async () => { render(<TopNav />); });
    await waitFor(() => {
      const activityLink = screen.getByRole('link', { name: /activity: 3 active downloads/i });
      expect(activityLink).toBeInTheDocument();
      expect(activityLink).toHaveAttribute('href', '/downloads');
    });
    // Count badge
    expect(screen.getByText('3')).toBeInTheDocument();
    // Ring is rendered with the rounded aggregate progress
    const ring = screen.getByTestId('fre-ring');
    expect(ring).toHaveAttribute('data-value', '46');
  });

  it('shows singular label for exactly 1 active download', async () => {
    mockGetCount.mockResolvedValue({ active_downloads: 1, aggregate_progress: 20, max_active_downloads: 2 });
    await act(async () => { render(<TopNav />); });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /activity: 1 active download$/i })).toBeInTheDocument();
    });
  });
});
