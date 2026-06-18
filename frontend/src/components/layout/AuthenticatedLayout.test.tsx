import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/shell/TopNav', () => ({ default: () => <header data-testid="topnav" /> }));
vi.mock('@/components/shell/BottomTabBar', () => ({ default: () => <nav data-testid="tabbar" /> }));
vi.mock('@/components/shell/ProfileGate', () => ({ default: () => <div data-testid="gate" /> }));
vi.mock('@/components/fx/CinematicAtmosphere', () => ({ default: () => <div data-testid="atmo" /> }));

const useUserMock = vi.fn();
vi.mock('@/context/UserContext', () => ({ useUser: () => useUserMock() }));

import AuthenticatedLayout from './AuthenticatedLayout';

describe('AuthenticatedLayout', () => {
  it('shows the ProfileGate when no profile is active', () => {
    useUserMock.mockReturnValue({ currentUser: null, isLoading: false });
    render(<AuthenticatedLayout><p>child</p></AuthenticatedLayout>);
    expect(screen.getByTestId('gate')).toBeInTheDocument();
    expect(screen.queryByTestId('topnav')).toBeNull();
  });

  it('shows TopNav + children + tab bar when a profile is active', () => {
    useUserMock.mockReturnValue({ currentUser: { id: '1', display_name: 'Ben' }, isLoading: false });
    render(<AuthenticatedLayout><p>child</p></AuthenticatedLayout>);
    expect(screen.getByTestId('topnav')).toBeInTheDocument();
    expect(screen.getByTestId('tabbar')).toBeInTheDocument();
    expect(screen.getByText('child')).toBeInTheDocument();
  });
});
