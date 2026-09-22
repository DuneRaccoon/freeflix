import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const passwordSignIn = vi.fn();
const requestPasswordReset = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();

vi.mock('@/services/auth', () => ({
  authService: {
    passwordSignIn: (...args: unknown[]) => passwordSignIn(...args),
    requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
  },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => search,
  useRouter: () => ({ replace }),
}));

// window.location.replace, not router.replace. The 200 carries the session cookie, but
// SessionProvider bootstraps once per DOCUMENT load — a soft navigation leaves
// `account` null and AuthenticatedLayout bounces the owner straight back to /signin.
// Asserting router.replace here would let that regression back in silently.
const hardNavigate = vi.fn();
beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, replace: hardNavigate, assign: vi.fn() },
  });
});

import OwnerSignInPage from './page';

const signIn = async (password = 'correct-horse-battery') => {
  await userEvent.type(await screen.findByLabelText('Your email'), 'owner@example.com');
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
};

beforeEach(() => {
  search = new URLSearchParams();
  window.localStorage.clear();
  replace.mockReset();
  hardNavigate.mockReset();
  passwordSignIn.mockReset().mockResolvedValue({ ok: true, redirect: '/', claimed: false });
  requestPasswordReset.mockReset().mockResolvedValue({ sent: true, delivered: true });
});

describe('OwnerSignInPage', () => {
  it('signs the owner in and lands them with a hard navigation', async () => {
    render(<OwnerSignInPage />);
    await signIn();

    expect(passwordSignIn).toHaveBeenCalledWith('owner@example.com', 'correct-horse-battery');
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/'));
    expect(replace).not.toHaveBeenCalled();
  });

  it('honours ?next= over the response redirect', async () => {
    search = new URLSearchParams('next=/tv/1399');
    render(<OwnerSignInPage />);
    await signIn();

    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/tv/1399'));
  });

  it('drops an off-origin ?next=', async () => {
    search = new URLSearchParams('next=//evil.example.com');
    render(<OwnerSignInPage />);
    await signIn();

    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/'));
  });

  it('renders the one constant error on 401', async () => {
    passwordSignIn.mockRejectedValue({ response: { status: 401, data: { detail: 'Email or password is incorrect.' } } });
    render(<OwnerSignInPage />);
    await signIn('wrong-password-here');

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it('renders the SAME error on 429, never a throttling hint', async () => {
    // The backend folds its rate-limit refusal into the 401 precisely so a throttled
    // address cannot be told apart from an unknown one. Saying "too many attempts"
    // here would undo that on the client.
    passwordSignIn.mockRejectedValue({ response: { status: 429 } });
    render(<OwnerSignInPage />);
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.queryByText(/too many|wait|minutes/i)).not.toBeInTheDocument();
  });

  it('reports an unreachable instance and keeps the form', async () => {
    passwordSignIn.mockRejectedValue(new Error('network'));
    render(<OwnerSignInPage />);
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the instance/i);
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('sends a set-a-password link and answers without confirming who the owner is', async () => {
    render(<OwnerSignInPage />);

    await userEvent.type(await screen.findByLabelText('Your email'), 'owner@example.com');
    await userEvent.click(screen.getByRole('button', { name: /forgot it, or never set one/i }));

    expect(requestPasswordReset).toHaveBeenCalledWith('owner@example.com');
    expect(await screen.findByText(/if that address owns this instance/i)).toBeInTheDocument();
    // Echoing the address back would confirm it owns the instance.
    expect(screen.queryByText(/owner@example\.com/)).not.toBeInTheDocument();
  });

  it('stashes ?next= before the reset link leaves for the inbox', async () => {
    search = new URLSearchParams('next=/tv/1399');
    render(<OwnerSignInPage />);

    await userEvent.type(await screen.findByLabelText('Your email'), 'owner@example.com');
    await userEvent.click(screen.getByRole('button', { name: /forgot it, or never set one/i }));

    await screen.findByText(/if that address owns this instance/i);
    expect(window.localStorage.getItem('ff_auth_next')).toBe('/tv/1399');
  });

  it('surfaces the reset link when no mail provider is configured', async () => {
    requestPasswordReset.mockResolvedValue({
      sent: true,
      delivered: false,
      action_url: 'http://localhost:3001/auth/reset-password?token=xyz',
    });
    render(<OwnerSignInPage />);

    await userEvent.type(await screen.findByLabelText('Your email'), 'owner@example.com');
    await userEvent.click(screen.getByRole('button', { name: /forgot it, or never set one/i }));

    expect(await screen.findByRole('link', { name: /reset-password\?token=xyz/ }))
      .toHaveAttribute('href', 'http://localhost:3001/auth/reset-password?token=xyz');
  });

  it('asks for an address before requesting a link', async () => {
    render(<OwnerSignInPage />);

    await userEvent.click(await screen.findByRole('button', { name: /forgot it, or never set one/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/enter your email address first/i);
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it('points members back at the magic-link screen', async () => {
    render(<OwnerSignInPage />);

    expect(await screen.findByRole('link', { name: /get a sign-in link/i }))
      .toHaveAttribute('href', '/signin');
  });
});
