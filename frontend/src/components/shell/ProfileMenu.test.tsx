import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const logout = vi.fn();
vi.mock('@/context/UserContext', () => ({
  useUser: () => ({ currentUser: { id: '1', username: 'ben', display_name: 'Ben', avatar: null, created_at: '' }, logout }),
}));

import ProfileMenu from './ProfileMenu';

describe('ProfileMenu', () => {
  it('toggles the menu and shows the power-tool links + sign out', async () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole('button', { name: /ben/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Schedules' })).toHaveAttribute('href', '/schedules');
    expect(screen.getByRole('menuitem', { name: 'Downloads' })).toHaveAttribute('href', '/downloads');
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });
  it('calls logout on Switch profile', async () => {
    render(<ProfileMenu />);
    await userEvent.click(screen.getByRole('button', { name: /ben/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Switch profile' }));
    expect(logout).toHaveBeenCalledOnce();
  });
  it('closes the menu on Escape', async () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole('button', { name: /ben/i });
    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
