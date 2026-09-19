import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Account } from '@/services/auth';
import type { Invite, Member } from '@/services/instance';

const h = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return {
    toast,
    session: {
      account: null as Account | null,
      instance: null as { instance_name: string | null } | null,
      isLoading: false,
      error: null as string | null,
      refresh: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn(),
    },
    instanceService: {
      members: vi.fn(),
      createInvite: vi.fn(),
      revokeInvite: vi.fn().mockResolvedValue(undefined),
      resendInvite: vi.fn(),
      revokeMember: vi.fn().mockResolvedValue(undefined),
      restoreMember: vi.fn().mockResolvedValue(undefined),
      removeMember: vi.fn().mockResolvedValue(undefined),
      transfer: vi.fn().mockResolvedValue(undefined),
      updateSettings: vi.fn(),
    },
  };
});

vi.mock('react-hot-toast', () => ({ toast: h.toast, default: h.toast }));
vi.mock('@/context/SessionContext', () => ({ useSession: () => h.session }));
vi.mock('@/services/instance', () => ({ instanceService: h.instanceService }));

import MembersView from './MembersView';

const account = (over: Partial<Account>): Account => ({
  id: 'a0',
  email: null,
  role: 'member',
  status: 'active',
  display_name: null,
  last_login_at: null,
  created_at: null,
  ...over,
});

const OWNER = account({ id: 'a1', email: 'ben@example.com', role: 'owner', display_name: 'Ben' });

const MEMBERS: Member[] = [
  { account: OWNER, profile_count: 1, profile_names: ['Ben'], is_you: true },
  {
    account: account({ id: 'a2', email: 'ava@example.com', display_name: 'Ava' }),
    profile_count: 2,
    profile_names: ['Ava', 'Ava Kids'],
    is_you: false,
  },
  {
    // Minted by the upgrade migration: real watch history, no email yet.
    account: account({ id: 'a3', status: 'pending_email', display_name: 'Kid' }),
    profile_count: 1,
    profile_names: ['Kid'],
    is_you: false,
  },
  {
    account: account({ id: 'a4', email: 'sam@example.com', status: 'revoked', display_name: 'Sam' }),
    profile_count: 1,
    profile_names: ['Sam'],
    is_you: false,
  },
];

const PENDING: Invite = {
  id: 'i1',
  email: 'new@example.com',
  role: 'member',
  expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  accepted_at: null,
  revoked_at: null,
  created_at: null,
};

const ACCEPTED: Invite = { ...PENDING, id: 'i2', email: 'old@example.com', accepted_at: '2026-09-01T00:00:00' };

const rowFor = (name: string): HTMLElement => screen.getByText(name).closest('li') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  h.session.account = OWNER;
  h.session.instance = { instance_name: 'The Herro House' };
  h.session.isLoading = false;
  h.instanceService.members.mockResolvedValue({ members: MEMBERS, invites: [PENDING, ACCEPTED] });
});

describe('MembersView access', () => {
  it('shows a plain not-available state to a member and never fetches', async () => {
    h.session.account = account({ role: 'member' });
    render(<MembersView />);
    expect(await screen.findByText(/not available/i)).toBeInTheDocument();
    expect(h.instanceService.members).not.toHaveBeenCalled();
  });

  it('waits for the session before deciding', () => {
    h.session.isLoading = true;
    h.session.account = null;
    render(<MembersView />);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    expect(h.instanceService.members).not.toHaveBeenCalled();
  });
});

describe('MembersView people', () => {
  it('lists each account with its role, status and profiles', async () => {
    render(<MembersView />);
    await screen.findByText('Ava');

    const ava = rowFor('Ava');
    expect(within(ava).getByText('Member')).toBeInTheDocument();
    expect(within(ava).getByText('Active')).toBeInTheDocument();
    expect(within(ava).getByText(/2 profiles: Ava, Ava Kids/)).toBeInTheDocument();

    const kid = rowFor('Kid');
    expect(within(kid).getByText('Not invited yet')).toBeInTheDocument();

    const sam = rowFor('Sam');
    expect(within(sam).getByText('Revoked')).toBeInTheDocument();
    expect(within(sam).getByRole('button', { name: 'Restore access' })).toBeInTheDocument();
    expect(within(sam).queryByRole('button', { name: 'Revoke access' })).toBeNull();
  });

  it("offers no revoke, remove or transfer controls on the owner's own row", async () => {
    render(<MembersView />);
    await screen.findByText('Ben');
    const ben = rowFor('Ben');
    expect(within(ben).getByText('You')).toBeInTheDocument();
    expect(within(ben).getByText('Owner')).toBeInTheDocument();
    expect(within(ben).queryByRole('button', { name: 'Revoke access' })).toBeNull();
    expect(within(ben).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(ben).queryByRole('button', { name: 'Make owner' })).toBeNull();
  });

  it('names the profiles, history and lists destroyed by a removal', async () => {
    render(<MembersView />);
    await screen.findByText('Ava');
    await userEvent.click(within(rowFor('Ava')).getByRole('button', { name: 'Remove' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/permanently remove ava/i)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/2 profiles \(Ava, Ava Kids\)/);
    expect(dialog).toHaveTextContent(/watch history/i);
    expect(dialog).toHaveTextContent(/lists/i);
    expect(dialog).toHaveTextContent(/cannot be undone/i);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove permanently' }));
    await waitFor(() => expect(h.instanceService.removeMember).toHaveBeenCalledWith('a2'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.instanceService.members).toHaveBeenCalledTimes(2);
  });

  it('says a revoke is reversible and keeps their data', async () => {
    render(<MembersView />);
    await screen.findByText('Ava');
    await userEvent.click(within(rowFor('Ava')).getByRole('button', { name: 'Revoke access' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/reversible/i);
    expect(dialog).toHaveTextContent(/kept/i);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => expect(h.instanceService.revokeMember).toHaveBeenCalledWith('a2'));
    expect(h.instanceService.removeMember).not.toHaveBeenCalled();
  });

  it('re-reads the session after transferring ownership away', async () => {
    render(<MembersView />);
    await screen.findByText('Ava');
    await userEvent.click(within(rowFor('Ava')).getByRole('button', { name: 'Make owner' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/you become a member/i);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Transfer ownership' }));

    await waitFor(() => expect(h.instanceService.transfer).toHaveBeenCalledWith('a2'));
    await waitFor(() => expect(h.session.refresh).toHaveBeenCalled());
  });

  it('cancels without running the action', async () => {
    render(<MembersView />);
    await screen.findByText('Ava');
    await userEvent.click(within(rowFor('Ava')).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.instanceService.removeMember).not.toHaveBeenCalled();
  });
});

describe('MembersView invites', () => {
  it('lists only invites still waiting, with a relative expiry', async () => {
    render(<MembersView />);
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
    expect(screen.queryByText('old@example.com')).toBeNull();
    expect(within(rowFor('new@example.com')).getByText(/expires in 2 days/i)).toBeInTheDocument();
  });

  it('confirms an invite revoke by naming the address', async () => {
    render(<MembersView />);
    await screen.findByText('new@example.com');
    await userEvent.click(within(rowFor('new@example.com')).getByRole('button', { name: 'Revoke' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('new@example.com');
    expect(dialog).toHaveTextContent(/nothing else is deleted/i);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke invite' }));
    await waitFor(() => expect(h.instanceService.revokeInvite).toHaveBeenCalledWith('i1'));
  });

  it('attaches a new invite to an existing profile group', async () => {
    h.instanceService.createInvite.mockResolvedValue({
      invite: PENDING, sent: true, delivered: true, action_url: null,
    });
    render(<MembersView />);
    await screen.findByText('Kid');

    await userEvent.type(screen.getByLabelText(/email address/i), 'kid@example.com');
    await userEvent.selectOptions(screen.getByLabelText(/attach to an existing profile group/i), 'a3');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() =>
      expect(h.instanceService.createInvite).toHaveBeenCalledWith('kid@example.com', 'a3'));
  });

  it('only offers the migration accounts as attachment targets', async () => {
    render(<MembersView />);
    await screen.findByText('Kid');
    const select = screen.getByLabelText(/attach to an existing profile group/i);
    const values = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(['', 'a3']);
  });

  it('surfaces the invite link when the email could not be delivered', async () => {
    h.instanceService.createInvite.mockResolvedValue({
      invite: PENDING,
      sent: true,
      delivered: false,
      action_url: 'http://localhost:3001/invite?token=raw-token',
    });
    render(<MembersView />);
    await screen.findByText('new@example.com');

    await userEvent.type(screen.getByLabelText(/email address/i), 'new@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(await screen.findByText('http://localhost:3001/invite?token=raw-token')).toBeInTheDocument();
    expect(screen.getByText(/could not be sent/i)).toBeInTheDocument();
  });

  it('reports a duplicate address instead of failing silently', async () => {
    h.instanceService.createInvite.mockRejectedValue({ response: { status: 409 } });
    render(<MembersView />);
    await screen.findByText('Kid');

    await userEvent.type(screen.getByLabelText(/email address/i), 'ava@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already belongs to someone/i);
  });

  it('resends an invite and keeps the link when delivery fails again', async () => {
    h.instanceService.resendInvite.mockResolvedValue({
      invite: PENDING,
      sent: true,
      delivered: false,
      action_url: 'http://localhost:3001/invite?token=fresh',
    });
    render(<MembersView />);
    await screen.findByText('new@example.com');
    await userEvent.click(within(rowFor('new@example.com')).getByRole('button', { name: 'Resend' }));

    await waitFor(() => expect(h.instanceService.resendInvite).toHaveBeenCalledWith('i1'));
    expect(await screen.findByText('http://localhost:3001/invite?token=fresh')).toBeInTheDocument();
  });
});

describe('MembersView failure', () => {
  it('reports a failed load', async () => {
    h.instanceService.members.mockRejectedValue(new Error('down'));
    render(<MembersView />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load members/i);
  });
});
