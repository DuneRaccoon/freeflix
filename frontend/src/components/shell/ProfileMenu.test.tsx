import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Account } from '@/services/auth';

const logout = vi.fn();
vi.mock('@/context/UserContext', () => ({
  useUser: () => ({
    currentUser: { id: '1', username: 'ben', display_name: 'Ben', avatar: null, created_at: '' },
    logout,
  }),
}));

const signOut = vi.fn().mockResolvedValue(undefined);
const ownerAccount: Account = {
  id: 'a1',
  email: 'ben@example.com',
  role: 'owner',
  status: 'active',
  display_name: 'Ben',
  last_login_at: null,
  created_at: null,
};
let account: Account | null = ownerAccount;
vi.mock('@/context/SessionContext', () => ({
  useSession: () => ({
    account,
    instance: null,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    signOut,
  }),
}));

import ProfileMenu from './ProfileMenu';

const openMenu = async () => {
  await userEvent.click(screen.getByRole('button', { name: /^ben$/i }));
};

beforeEach(() => {
  account = ownerAccount;
  logout.mockClear();
  signOut.mockClear();
});

describe('ProfileMenu', () => {
  it('toggles the menu and shows the power-tool links', async () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole('button', { name: /^ben$/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'My List' })).toHaveAttribute('href', '/my-list');
    expect(screen.getByRole('menuitem', { name: 'Schedules' })).toHaveAttribute('href', '/schedules');
    expect(screen.getByRole('menuitem', { name: 'Downloads' })).toHaveAttribute('href', '/downloads');
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('shows the account email under the profile name', async () => {
    render(<ProfileMenu />);
    await openMenu();
    expect(screen.getByText('ben@example.com')).toBeInTheDocument();
  });

  it('links an owner to Members', async () => {
    render(<ProfileMenu />);
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Members' })).toHaveAttribute('href', '/members');
  });

  it('hides Members from a member', async () => {
    account = { ...ownerAccount, role: 'member' };
    render(<ProfileMenu />);
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Members' })).toBeNull();
  });

  it('calls logout on Switch profile, leaving the session alone', async () => {
    render(<ProfileMenu />);
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Switch profile' }));
    expect(logout).toHaveBeenCalledOnce();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('calls signOut on Sign out, leaving the active profile alone', async () => {
    render(<ProfileMenu />);
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(logout).not.toHaveBeenCalled();
  });

  it('closes the menu on Escape', async () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole('button', { name: /^ben$/i });
    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
