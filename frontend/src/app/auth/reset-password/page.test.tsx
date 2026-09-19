import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const capabilities = vi.fn();
const resetPassword = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams('token=reset-token');

vi.mock('@/services/auth', () => ({
  authService: {
    capabilities: () => capabilities(),
    resetPassword: (...args: unknown[]) => resetPassword(...args),
  },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => search,
  useRouter: () => ({ replace }),
}));

// window.location.replace, not router.replace: the response sets the session cookie and
// SessionProvider only re-reads it on a fresh DOCUMENT load. Asserting router.replace
// would let the "bounced straight back to /signin" regression return unnoticed.
const hardNavigate = vi.fn();
beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, replace: hardNavigate, assign: vi.fn() },
  });
});

import ResetPasswordPage from './page';

/** Waits for the published minimum to land, so the client-side rule is in force. */
const fillIn = async (password: string, confirm = password) => {
  await screen.findByText(/at least 10 characters/i);
  await userEvent.type(screen.getByLabelText('New password'), password);
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm);
  await userEvent.click(screen.getByRole('button', { name: /set password and sign in/i }));
};

beforeEach(() => {
  search = new URLSearchParams('token=reset-token');
  window.localStorage.clear();
  replace.mockReset();
  hardNavigate.mockReset();
  capabilities.mockReset().mockResolvedValue({ password_min_length: 10 });
  resetPassword.mockReset().mockResolvedValue({ ok: true, redirect: '/', claimed: false });
});

describe('ResetPasswordPage', () => {
  it('sets the password and signs the owner in with a hard navigation', async () => {
    render(<ResetPasswordPage />);
    await fillIn('correct-horse-battery');

    expect(resetPassword).toHaveBeenCalledWith('reset-token', 'correct-horse-battery');
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/'));
    expect(replace).not.toHaveBeenCalled();
  });

  it('honours a remembered ?next= from the screen that asked for the link', async () => {
    window.localStorage.setItem('ff_auth_next', '/tv/1399');
    render(<ResetPasswordPage />);
    await fillIn('correct-horse-battery');

    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/tv/1399'));
    // Consumed once, so a later sign-in does not reopen an old page.
    expect(window.localStorage.getItem('ff_auth_next')).toBeNull();
  });

  it('refuses a too-short password without spending the token', async () => {
    render(<ResetPasswordPage />);
    await fillIn('short');

    expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 10 characters.');
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('refuses a mismatched confirmation without a network call', async () => {
    render(<ResetPasswordPage />);
    await fillIn('correct-horse-battery', 'correct-horse-batteries');

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('posts exactly once when the button is double-clicked', async () => {
    // The token is single use: a second POST would 410 a reset that just succeeded.
    let release: (value: unknown) => void = () => {};
    resetPassword.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    render(<ResetPasswordPage />);
    await fillIn('correct-horse-battery');

    await userEvent.click(screen.getByRole('button', { name: /set password and sign in/i }));
    release({ ok: true, redirect: '/', claimed: false });

    await waitFor(() => expect(resetPassword).toHaveBeenCalledTimes(1));
  });

  it('shows an expired state on 410 and sends the owner back for a fresh link', async () => {
    resetPassword.mockRejectedValue({ response: { status: 410 } });
    render(<ResetPasswordPage />);
    await fillIn('correct-horse-battery');

    expect(await screen.findByRole('heading', { name: /that link is spent/i })).toBeInTheDocument();
    expect(screen.getByText(/expired or was already used/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i }))
      .toHaveAttribute('href', '/signin/owner');
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it('repeats the backend detail verbatim on 422, token already burned', async () => {
    resetPassword.mockRejectedValue({
      response: {
        status: 422,
        data: { detail: 'Choose something other than your email address. Request a new link and try again.' },
      },
    });
    render(<ResetPasswordPage />);
    await fillIn('owner@example.com-x');

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Choose something other than your email address. Request a new link and try again.');
    // Retyping into a spent token cannot work, so the form gives way to the way out.
    expect(screen.getByRole('link', { name: /request a new link/i }))
      .toHaveAttribute('href', '/signin/owner');
    expect(screen.queryByRole('button', { name: /set password and sign in/i })).not.toBeInTheDocument();
  });

  it('treats a missing token as expired without calling the backend', async () => {
    search = new URLSearchParams();
    render(<ResetPasswordPage />);

    expect(await screen.findByRole('heading', { name: /that link is spent/i })).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('still submits when the published rules cannot be read', async () => {
    // The server enforces the minimum either way; an unreadable /capabilities must not
    // lock the owner out of the only screen that can set a password.
    capabilities.mockRejectedValue(new Error('network'));
    render(<ResetPasswordPage />);

    await userEvent.type(await screen.findByLabelText('New password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: /set password and sign in/i }));

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('reset-token', 'correct-horse-battery'));
  });
});
