import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const verify = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams('token=magic-token');

vi.mock('@/services/auth', () => ({
  authService: { verify: (...args: unknown[]) => verify(...args) },
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

import VerifyPage from './page';

beforeEach(() => {
  search = new URLSearchParams('token=magic-token');
  window.localStorage.clear();
  replace.mockReset();
  hardNavigate.mockReset();
  verify.mockReset().mockResolvedValue({ ok: true, redirect: '/', claimed: false });
});

describe('VerifyPage', () => {
  it('burns the token once and routes to the response destination', async () => {
    render(<VerifyPage />);

    expect(screen.getByRole('status', { name: /signing you in/i })).toBeInTheDocument();
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/'));
    expect(verify).toHaveBeenCalledWith('magic-token');
  });

  it('posts the token exactly once under StrictMode', async () => {
    // The token is single use: a second POST from StrictMode's double-invoked
    // effect would consume it and then 410 a legitimate sign-in.
    render(
      <React.StrictMode>
        <VerifyPage />
      </React.StrictMode>,
    );

    await waitFor(() => expect(hardNavigate).toHaveBeenCalled());
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('honours a remembered ?next= destination', async () => {
    window.localStorage.setItem('ff_auth_next', '/tv/1399');
    render(<VerifyPage />);

    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/tv/1399'));
    // Consumed once, so a later sign-in does not reopen an old page.
    expect(window.localStorage.getItem('ff_auth_next')).toBeNull();
  });

  it('sends a freshly claimed instance home, not to the remembered path', async () => {
    window.localStorage.setItem('ff_auth_next', '/tv/1399');
    verify.mockResolvedValue({ ok: true, redirect: '/', claimed: true });
    render(<VerifyPage />);

    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/'));
  });

  it('shows an expired state on 410 and offers a fresh link', async () => {
    verify.mockRejectedValue({ response: { status: 410 } });
    render(<VerifyPage />);

    expect(await screen.findByRole('heading', { name: /that link is spent/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /send a new link/i })).toHaveAttribute('href', '/signin');
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it('shows an error state when the instance does not answer', async () => {
    verify.mockRejectedValue(new Error('network'));
    render(<VerifyPage />);

    expect(await screen.findByRole('heading', { name: /could not finish that/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/signin');
  });

  it('treats a missing token as expired without calling the backend', async () => {
    search = new URLSearchParams();
    render(<VerifyPage />);

    expect(await screen.findByRole('heading', { name: /that link is spent/i })).toBeInTheDocument();
    expect(verify).not.toHaveBeenCalled();
  });
});
