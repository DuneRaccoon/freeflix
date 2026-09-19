import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const requestLink = vi.fn();
let search = new URLSearchParams();

vi.mock('@/services/auth', () => ({
  authService: { requestLink: (...args: unknown[]) => requestLink(...args) },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => search,
}));

import SignInPage from './page';

beforeEach(() => {
  search = new URLSearchParams();
  window.localStorage.clear();
  requestLink.mockReset().mockResolvedValue({ sent: true, delivered: true });
});

describe('SignInPage', () => {
  it('requests a link and answers without confirming the address exists', async () => {
    render(<SignInPage />);

    await userEvent.type(await screen.findByLabelText('Your email'), 'ben@example.com');
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    expect(requestLink).toHaveBeenCalledWith('ben@example.com');
    expect(await screen.findByText(/if that address has access/i)).toBeInTheDocument();
    // The address must not be echoed back — doing so would confirm it has an account.
    expect(screen.queryByText(/ben@example\.com/)).not.toBeInTheDocument();
  });

  it('stashes ?next= so the link opened from a mail client still lands there', async () => {
    search = new URLSearchParams('next=/tv/1399');
    render(<SignInPage />);

    await userEvent.type(await screen.findByLabelText('Your email'), 'ben@example.com');
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    await screen.findByText(/if that address has access/i);
    expect(window.localStorage.getItem('ff_auth_next')).toBe('/tv/1399');
  });

  it('drops an off-origin ?next=', async () => {
    search = new URLSearchParams('next=//evil.example.com');
    render(<SignInPage />);

    await userEvent.type(await screen.findByLabelText('Your email'), 'ben@example.com');
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    await screen.findByText(/if that address has access/i);
    expect(window.localStorage.getItem('ff_auth_next')).toBeNull();
  });

  it('surfaces the action link when no mail provider is configured', async () => {
    requestLink.mockResolvedValue({
      sent: true,
      delivered: false,
      action_url: 'http://localhost:3001/auth/verify?token=xyz',
    });
    render(<SignInPage />);

    await userEvent.type(await screen.findByLabelText('Your email'), 'ben@example.com');
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    expect(await screen.findByRole('link', { name: /auth\/verify\?token=xyz/ }))
      .toHaveAttribute('href', 'http://localhost:3001/auth/verify?token=xyz');
  });

  it('reports an unreachable instance and keeps the form', async () => {
    requestLink.mockRejectedValue(new Error('network'));
    render(<SignInPage />);

    await userEvent.type(await screen.findByLabelText('Your email'), 'ben@example.com');
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the instance/i);
    expect(screen.getByLabelText('Your email')).toBeInTheDocument();
  });
});
