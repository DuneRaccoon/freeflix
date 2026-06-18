import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const selectUser = vi.fn().mockResolvedValue(true);
vi.mock('@/context/UserContext', () => ({
  useUser: () => ({
    users: [
      { id: '1', username: 'ben', display_name: 'Ben', avatar: null, created_at: '' },
      { id: '2', username: 'ava', display_name: 'Ava', avatar: null, created_at: '' },
    ],
    selectUser,
  }),
}));
vi.mock('@/services/users', () => ({
  usersService: {
    getUserSettings: vi.fn(async (id: string) =>
      id === '1'
        ? { require_passcode: true, passcode: '1234' }
        : { require_passcode: false }),
  },
}));

import ProfileGate from './ProfileGate';

beforeEach(() => selectUser.mockClear());

describe('ProfileGate', () => {
  it('selects an unprotected profile directly', async () => {
    render(<ProfileGate />);
    const ava = await screen.findByRole('button', { name: /ava/i });
    await userEvent.click(ava);
    await waitFor(() => expect(selectUser).toHaveBeenCalledWith('2'));
  });

  it('requires the passcode for a protected profile before selecting', async () => {
    render(<ProfileGate />);
    const ben = await screen.findByRole('button', { name: /ben/i });
    await userEvent.click(ben);
    // passcode prompt appears; selectUser not yet called
    expect(selectUser).not.toHaveBeenCalled();
    for (const d of ['1', '2', '3', '4']) {
      await userEvent.click(await screen.findByRole('button', { name: d }));
    }
    await waitFor(() => expect(selectUser).toHaveBeenCalledWith('1'));
  });
});
