import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  selectUser: vi.fn<(id: string, passcode?: string) => Promise<'ok' | 'locked' | 'error'>>(),
  loadUsers: vi.fn().mockResolvedValue(undefined),
  createUser: vi.fn(),
  getUserSettings: vi.fn(),
  reset: vi.fn(),
  link: vi.fn(),
  role: 'member' as 'owner' | 'member',
  lockedProfileId: null as string | null,
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
  useUser: () => ({
    users: h.users, selectUser: h.selectUser, loadUsers: h.loadUsers, lockedProfileId: h.lockedProfileId,
  }),
}));
vi.mock('@/context/SessionContext', () => ({ useSession: () => ({ account: { role: h.role } }) }));
vi.mock('@/services/users', () => ({
  usersService: {
    createUser: h.createUser,
    getUserSettings: h.getUserSettings,
    resetPasscodeWithPassword: h.reset,
    requestPasscodeResetLink: h.link,
  },
}));

import ProfileGate from './ProfileGate';

beforeEach(() => {
  vi.clearAllMocks();
  // Plain fields: clearAllMocks leaves them, and a leaked lockedProfileId opens a prompt in every later test.
  h.role = 'member';
  h.lockedProfileId = null;
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

  it('a locked profile asks for its code on every pick, without a codeless select first', async () => {
    render(<ProfileGate />);
    await userEvent.click(screen.getByRole('button', { name: /^ben$/i }));
    expect(await screen.findByText(/enter your passcode/i)).toBeInTheDocument();
    expect(h.selectUser).not.toHaveBeenCalled(); // the default mock is 'ok': a codeless select would enter

    // Keypad length comes from the profile's passcode_len.
    for (const d of '123456') await userEvent.click(screen.getByRole('button', { name: d }));
    await waitFor(() => expect(h.selectUser).toHaveBeenCalledWith('1', '123456'));
    expect(h.selectUser).toHaveBeenCalledTimes(1);
  });

  it('a profile the list shows open but the server refuses opens the prompt and refreshes the list', async () => {
    h.selectUser.mockResolvedValueOnce('locked');
    render(<ProfileGate />);
    await userEvent.click(screen.getByRole('button', { name: /ava/i }));
    expect(await screen.findByText(/enter your passcode/i)).toBeInTheDocument();
    expect(h.selectUser).toHaveBeenCalledWith('2');
    expect(h.loadUsers).toHaveBeenCalled();
  });

  it('opens the numpad straight away for the profile boot restore found locked', () => {
    h.lockedProfileId = '1';
    render(<ProfileGate />);
    expect(screen.getByRole('dialog', { name: 'Enter passcode for Ben' })).toBeInTheDocument();
  });

  it('an owner reset refreshes the list, then reopens the profile with no code', async () => {
    h.role = 'owner';
    h.reset.mockResolvedValue(undefined);
    render(<ProfileGate />);
    await userEvent.click(screen.getByRole('button', { name: /^ben$/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Forgot code?' }));
    await userEvent.type(screen.getByLabelText('Account password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Reset passcode' }));

    await waitFor(() => expect(h.selectUser).toHaveBeenCalledWith('1'));
    expect(h.loadUsers.mock.invocationCallOrder[0]).toBeLessThan(h.selectUser.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closing the prompt refreshes the list', async () => {
    render(<ProfileGate />);
    await userEvent.click(screen.getByRole('button', { name: /^ben$/i }));
    await screen.findByText(/enter your passcode/i);
    expect(h.loadUsers).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}'); // Modal's document Escape handler calls onClose
    await waitFor(() => expect(screen.queryByText(/enter your passcode/i)).toBeNull());
    expect(h.loadUsers).toHaveBeenCalledTimes(1);
  });

  it('keeps the prompt open when the passcode is rejected', async () => {
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
