import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  selectUser: vi.fn<(id: string, passcode?: string) => Promise<'ok' | 'locked' | 'error'>>(),
  loadUsers: vi.fn().mockResolvedValue(undefined),
  createUser: vi.fn(),
  getUserSettings: vi.fn(),
  // `settings` now rides along on GET /users, so the gate never fetches per-profile
  // settings — the old prefetch existed only to read the plaintext passcode.
  users: [
    {
      id: '1',
      username: 'ben',
      display_name: 'Ben',
      avatar: null,
      created_at: '',
      settings: { require_passcode: true, passcode_len: 6 },
    },
    {
      id: '2',
      username: 'ava',
      display_name: 'Ava',
      avatar: null,
      created_at: '',
      settings: { require_passcode: false, passcode_len: null },
    },
  ],
}));

vi.mock('@/context/UserContext', () => ({
  useUser: () => ({ users: h.users, selectUser: h.selectUser, loadUsers: h.loadUsers }),
}));
vi.mock('@/services/users', () => ({
  usersService: { createUser: h.createUser, getUserSettings: h.getUserSettings },
}));

import ProfileGate from './ProfileGate';

beforeEach(() => {
  vi.clearAllMocks();
  h.selectUser.mockResolvedValue('ok');
  h.createUser.mockResolvedValue({ id: '3', display_name: 'Zed' });
});

describe('ProfileGate', () => {
  it('enters an unlocked profile without a prompt', async () => {
    render(<ProfileGate />);
    await userEvent.click(screen.getByRole('button', { name: /ava/i }));

    await waitFor(() => expect(h.selectUser).toHaveBeenCalledWith('2'));
    expect(screen.queryByText(/enter your passcode/i)).toBeNull();
  });

  it('never prefetches per-profile settings', async () => {
    render(<ProfileGate />);
    await userEvent.click(screen.getByRole('button', { name: /ava/i }));
    await waitFor(() => expect(h.selectUser).toHaveBeenCalled());
    expect(h.getUserSettings).not.toHaveBeenCalled();
  });

  it('badges a profile as locked from require_passcode', () => {
    render(<ProfileGate />);
    expect(screen.getByRole('button', { name: /^ben$/i }).querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: /ava/i }).querySelector('svg')).toBeNull();
  });

  it('prompts for the passcode only when the server says the profile is locked', async () => {
    h.selectUser.mockResolvedValueOnce('locked');
    render(<ProfileGate />);
    await userEvent.click(screen.getByRole('button', { name: /^ben$/i }));

    // The first call carries no code — the server, not the browser, decides.
    await waitFor(() => expect(h.selectUser).toHaveBeenCalledWith('1'));
    expect(await screen.findByText(/enter your passcode/i)).toBeInTheDocument();

    // Keypad length comes from the profile's passcode_len.
    h.selectUser.mockResolvedValueOnce('ok');
    for (const d of '123456') {
      await userEvent.click(screen.getByRole('button', { name: d }));
    }
    await waitFor(() => expect(h.selectUser).toHaveBeenLastCalledWith('1', '123456'));
    await waitFor(() => expect(screen.queryByText(/enter your passcode/i)).toBeNull());
  });

  it('keeps the prompt open when the passcode is rejected', async () => {
    h.selectUser.mockResolvedValueOnce('locked');
    render(<ProfileGate />);
    await userEvent.click(screen.getByRole('button', { name: /^ben$/i }));
    await screen.findByText(/enter your passcode/i);

    // A wrong code comes back as 'locked' (403/423/429) — the keypad stays up.
    h.selectUser.mockResolvedValueOnce('locked');
    for (const d of '000000') {
      await userEvent.click(screen.getByRole('button', { name: d }));
    }
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i);
    expect(screen.getByText(/enter your passcode/i)).toBeInTheDocument();
  });

  it('surfaces a failed entry instead of looking like a dead button', async () => {
    h.selectUser.mockResolvedValueOnce('error');
    render(<ProfileGate />);
    await userEvent.click(screen.getByRole('button', { name: /ava/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not open that profile/i);
    expect(screen.queryByText(/enter your passcode/i)).toBeNull();
  });

  it('creates a profile without minting a username client-side', async () => {
    render(<ProfileGate />);
    await userEvent.click(screen.getByRole('button', { name: /add profile/i }));
    await userEvent.type(await screen.findByLabelText(/profile name/i), 'Zed');
    await userEvent.click(screen.getByRole('button', { name: /create profile/i }));

    await waitFor(() => expect(h.createUser).toHaveBeenCalledWith({ display_name: 'Zed' }));
    await waitFor(() => expect(h.selectUser).toHaveBeenCalledWith('3'));
    expect(h.loadUsers).toHaveBeenCalled();
  });

  it('creates a profile with the chosen avatar', async () => {
    h.createUser.mockResolvedValue({ id: '3' });
    render(<ProfileGate />);

    await userEvent.click(screen.getByRole('button', { name: 'Add profile' }));
    await userEvent.type(screen.getByLabelText('Profile name'), 'Cleo');
    await userEvent.click(screen.getByRole('radio', { name: 'Film reel' }));
    await userEvent.click(screen.getByRole('button', { name: /create profile/i }));

    await waitFor(() =>
      expect(h.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ display_name: 'Cleo', avatar: 'house:reel' })));
  });

  it('surfaces "created but could not be opened" outside the modal, not inside it', async () => {
    h.selectUser.mockResolvedValueOnce('error');
    render(<ProfileGate />);
    await userEvent.click(screen.getByRole('button', { name: /add profile/i }));
    await userEvent.type(await screen.findByLabelText(/profile name/i), 'Zed');
    await userEvent.click(screen.getByRole('button', { name: /create profile/i }));

    // The modal has closed (createError's role="alert" lived only inside it) —
    // the message must appear in entryError's slot instead, or it is lost.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be opened/i);

    // Re-opening the create form must not leak the stale name/avatar/error —
    // that state belongs to the (now-closed) modal, not to entryError above.
    await userEvent.click(screen.getByRole('button', { name: /add profile/i }));
    expect(screen.getByLabelText(/profile name/i)).toHaveValue('');
    expect(screen.getAllByRole('alert')).toHaveLength(1); // only entryError, no createError inside the modal
  });
});
