import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const invitePreview = vi.fn();
const inviteAccept = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams('token=invite-token');

vi.mock('@/services/auth', () => ({
  authService: {
    invitePreview: (...args: unknown[]) => invitePreview(...args),
    inviteAccept: (...args: unknown[]) => inviteAccept(...args),
  },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => search,
  useRouter: () => ({ replace }),
}));

// window.location.replace, not router.replace. SessionProvider bootstraps once per
// DOCUMENT load, so only a hard navigation lets it see the cookie that was just set —
// a soft navigation leaves `account` null and AuthenticatedLayout bounces the
// freshly signed-in user back to /signin. Asserting on router.replace here would let
// that regression back in silently.
const hardNavigate = vi.fn();
beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, replace: hardNavigate, assign: vi.fn() },
  });
});

import InvitePage from './page';

const preview = {
  email: 'ava@example.com',
  invited_by: 'Ben',
  instance_name: 'The House',
  expires_at: '2099-01-01T00:00:00',
};

beforeEach(() => {
  search = new URLSearchParams('token=invite-token');
  replace.mockReset();
  hardNavigate.mockReset();
  invitePreview.mockReset().mockResolvedValue(preview);
  inviteAccept.mockReset().mockResolvedValue({ ok: true });
});

describe('InvitePage', () => {
  it('previews the invitation and sets up the first profile', async () => {
    render(<InvitePage />);

    await waitFor(() => expect(invitePreview).toHaveBeenCalledWith('invite-token'));
    expect(await screen.findByText('Ben')).toBeInTheDocument();
    expect(screen.getByText('ava@example.com')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Profile name'), 'Ava');
    await userEvent.click(screen.getByRole('radio', { name: 'Clapperboard' }));
    await userEvent.click(screen.getByRole('button', { name: /join the house/i }));

    await waitFor(() =>
      expect(inviteAccept).toHaveBeenCalledWith('invite-token', 'Ava', 'house:clapper'));
    // The cookie arrived on that response, so the shell can bootstrap normally.
    expect(hardNavigate).toHaveBeenCalledWith('/');
  });

  it('sends no avatar when none is chosen', async () => {
    render(<InvitePage />);

    await userEvent.type(await screen.findByLabelText('Profile name'), 'Ava');
    await userEvent.click(screen.getByRole('button', { name: /join the house/i }));

    await waitFor(() => expect(inviteAccept).toHaveBeenCalledWith('invite-token', 'Ava', undefined));
  });

  it('shows an expired state when the invite is gone', async () => {
    invitePreview.mockRejectedValue({ response: { status: 410 } });
    render(<InvitePage />);

    expect(await screen.findByRole('heading', { name: /no longer open/i })).toBeInTheDocument();
    expect(screen.getByText(/ask the owner of this instance to send you a fresh invitation/i))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/signin');
  });

  it('treats a missing token as an expired invitation without calling the backend', async () => {
    search = new URLSearchParams();
    render(<InvitePage />);

    expect(await screen.findByRole('heading', { name: /no longer open/i })).toBeInTheDocument();
    expect(invitePreview).not.toHaveBeenCalled();
  });

  it('falls back to the expired state if the invite is consumed while the form is open', async () => {
    inviteAccept.mockRejectedValue({ response: { status: 410 } });
    render(<InvitePage />);

    await userEvent.type(await screen.findByLabelText('Profile name'), 'Ava');
    await userEvent.click(screen.getByRole('button', { name: /join the house/i }));

    expect(await screen.findByRole('heading', { name: /no longer open/i })).toBeInTheDocument();
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it('keeps the form after a failed accept', async () => {
    inviteAccept.mockRejectedValue(new Error('network'));
    render(<InvitePage />);

    await userEvent.type(await screen.findByLabelText('Profile name'), 'Ava');
    await userEvent.click(screen.getByRole('button', { name: /join the house/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not set up your profile/i);
    expect(screen.getByLabelText('Profile name')).toHaveValue('Ava');
  });
});
