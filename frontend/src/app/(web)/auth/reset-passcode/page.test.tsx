import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const resetPasscode = vi.fn();
let search = new URLSearchParams('token=magic-token');

vi.mock('@/services/auth', () => ({
  authService: { resetPasscode: (...args: unknown[]) => resetPasscode(...args) },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => search,
}));

import ResetPasscodePage from './page';

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  search = new URLSearchParams('token=magic-token');
  resetPasscode.mockReset();
});

describe('ResetPasscodePage', () => {
  it('does nothing until the button is pressed, and a second press while working sends nothing', async () => {
    const pending = deferred<void>();
    resetPasscode.mockReturnValue(pending.promise);
    render(<ResetPasscodePage />);
    expect(resetPasscode).not.toHaveBeenCalled();
    const btn = screen.getByRole('button', { name: 'Remove the lock' });
    await userEvent.click(btn);
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(resetPasscode).toHaveBeenCalledTimes(1);
    expect(resetPasscode).toHaveBeenCalledWith('magic-token');
    await act(async () => { pending.resolve(); });
    expect(await screen.findByText(/the lock is/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Freeflix' })).toHaveAttribute('href', '/');
  });

  it('a spent link (410) says so', async () => {
    resetPasscode.mockRejectedValue(httpError(410));
    render(<ResetPasscodePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove the lock' }));
    expect(await screen.findByText(/spent/i)).toBeInTheDocument();
  });

  it('any other failure is not called spent', async () => {
    resetPasscode.mockRejectedValue(httpError(500));
    render(<ResetPasscodePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove the lock' }));
    expect(await screen.findByText(/could not/i)).toBeInTheDocument();
    expect(screen.queryByText(/spent/i)).toBeNull();
  });

  it('no token: spent, and nothing is sent', () => {
    search = new URLSearchParams('');
    render(<ResetPasscodePage />);
    expect(screen.getByText(/spent/i)).toBeInTheDocument();
    expect(resetPasscode).not.toHaveBeenCalled();
  });
});
