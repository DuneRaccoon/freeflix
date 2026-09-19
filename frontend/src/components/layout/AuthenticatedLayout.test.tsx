import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pathnameMock = vi.fn(() => '/');
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

vi.mock('@/components/shell/TopNav', () => ({ default: () => <header data-testid="topnav" /> }));
vi.mock('@/components/shell/BottomTabBar', () => ({ default: () => <nav data-testid="tabbar" /> }));
vi.mock('@/components/shell/ProfileGate', () => ({ default: () => <div data-testid="gate" /> }));
vi.mock('@/components/fx/CinematicAtmosphere', () => ({ default: () => <div data-testid="atmo" /> }));

const createUserMock = vi.fn();
vi.mock('@/services/users', () => ({
  usersService: { createUser: (...args: unknown[]) => createUserMock(...args) },
}));

const useUserMock = vi.fn();
vi.mock('@/context/UserContext', () => ({ useUser: () => useUserMock() }));

const useSessionMock = vi.fn();
vi.mock('@/context/SessionContext', () => ({ useSession: () => useSessionMock() }));

import AuthenticatedLayout from './AuthenticatedLayout';

const ACCOUNT = { id: 'acc-1', email: 'ben@example.com', role: 'owner' as const };
const CLAIMED = { claimed: true, needs_claim: false, instance_name: null, claimed_at: null };
const UNCLAIMED = { claimed: false, needs_claim: true, instance_name: null, claimed_at: null };

const PROFILE = { id: '1', display_name: 'Ben' };

function session(over: Record<string, unknown> = {}) {
  useSessionMock.mockReturnValue({
    account: ACCOUNT,
    instance: CLAIMED,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
    ...over,
  });
}

function user(over: Record<string, unknown> = {}) {
  useUserMock.mockReturnValue({
    currentUser: PROFILE,
    users: [PROFILE],
    isLoading: false,
    loadUsers: vi.fn(),
    selectUser: vi.fn(),
    ...over,
  });
}

describe('AuthenticatedLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameMock.mockReturnValue('/');
    session();
    user();
  });

  it('renders a public route bare, without waiting on the session', () => {
    pathnameMock.mockReturnValue('/claim');
    // A signed-out visitor on /claim must reach the page itself; the gate below would
    // otherwise replace it with "Who's watching?" and the claim could never happen.
    session({ account: null, instance: UNCLAIMED, isLoading: true });
    user({ currentUser: null, users: [], isLoading: true });

    render(<AuthenticatedLayout><p>child</p></AuthenticatedLayout>);

    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.queryByTestId('gate')).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('shows the spinner while the session is resolving', () => {
    session({ account: null, instance: null, isLoading: true });
    user({ currentUser: null, users: [], isLoading: true });

    render(<AuthenticatedLayout><p>child</p></AuthenticatedLayout>);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('child')).toBeNull();
  });

  it('redirects to /claim when the instance is unclaimed', async () => {
    session({ account: null, instance: UNCLAIMED });
    user({ currentUser: null, users: [] });

    render(<AuthenticatedLayout><p>child</p></AuthenticatedLayout>);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/claim'));
    expect(screen.queryByText('child')).toBeNull();
  });

  it('redirects to /signin with a next param when there is no account', async () => {
    pathnameMock.mockReturnValue('/movies/42');
    session({ account: null });
    user({ currentUser: null, users: [] });

    render(<AuthenticatedLayout><p>child</p></AuthenticatedLayout>);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(`/signin?next=${encodeURIComponent('/movies/42')}`),
    );
  });

  it('asks for a first profile when the account has none', async () => {
    const loadUsers = vi.fn().mockResolvedValue(undefined);
    const selectUser = vi.fn().mockResolvedValue('ok');
    user({ currentUser: null, users: [], loadUsers, selectUser });
    createUserMock.mockResolvedValue({ id: 'p-9', display_name: 'Ben' });

    render(<AuthenticatedLayout><p>child</p></AuthenticatedLayout>);

    expect(screen.queryByTestId('gate')).toBeNull();
    const nameField = screen.getByLabelText('Profile name');
    await userEvent.type(nameField, 'Ben');
    await userEvent.click(screen.getByRole('button', { name: 'Start watching' }));

    // No `username`: it is minted server-side.
    await waitFor(() =>
      expect(createUserMock).toHaveBeenCalledWith({ display_name: 'Ben', avatar: undefined }),
    );
    await waitFor(() => expect(selectUser).toHaveBeenCalledWith('p-9'));
    expect(loadUsers).toHaveBeenCalled();
  });

  it('shows the ProfileGate when profiles exist but none is active', () => {
    user({ currentUser: null });

    render(<AuthenticatedLayout><p>child</p></AuthenticatedLayout>);

    expect(screen.getByTestId('gate')).toBeInTheDocument();
    expect(screen.queryByTestId('topnav')).toBeNull();
  });

  it('shows TopNav + children + tab bar when a profile is active', () => {
    render(<AuthenticatedLayout><p>child</p></AuthenticatedLayout>);

    expect(screen.getByTestId('topnav')).toBeInTheDocument();
    expect(screen.getByTestId('tabbar')).toBeInTheDocument();
    expect(screen.getByText('child')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('renders the player route full-bleed, with no chrome', () => {
    pathnameMock.mockReturnValue('/streaming/abc');

    render(<AuthenticatedLayout><p>child</p></AuthenticatedLayout>);

    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.queryByTestId('topnav')).toBeNull();
    expect(screen.queryByTestId('tabbar')).toBeNull();
  });
});
