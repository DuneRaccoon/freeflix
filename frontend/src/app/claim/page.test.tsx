import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const instanceStatus = vi.fn();
const claim = vi.fn();
const capabilities = vi.fn();

vi.mock('@/services/auth', () => ({
  authService: {
    instanceStatus: (...args: unknown[]) => instanceStatus(...args),
    claim: (...args: unknown[]) => claim(...args),
    capabilities: (...args: unknown[]) => capabilities(...args),
  },
}));

import ClaimPage from './page';

const unclaimed = { claimed: false, needs_claim: true, instance_name: null, claimed_at: null };

// Deliberately not 10: the page must render whatever the backend publishes, so a test
// that passed with the hard-coded fallback would prove nothing.
const PASSWORD = 'projector-room-9';

beforeEach(() => {
  instanceStatus.mockReset().mockResolvedValue(unclaimed);
  claim.mockReset().mockResolvedValue({ sent: true, delivered: true });
  capabilities.mockReset().mockResolvedValue({ password_min_length: 12 });
});

/** Fills every field. `confirm` defaults to a matching password. */
async function fillForm(opts: { code?: string; password?: string; confirm?: string } = {}) {
  const password = opts.password ?? PASSWORD;
  await userEvent.type(await screen.findByLabelText('Claim code'), opts.code ?? 'ABCD');
  await userEvent.type(screen.getByLabelText('Your email'), 'owner@example.com');
  await userEvent.type(screen.getByLabelText('Choose a password'), password);
  await userEvent.type(screen.getByLabelText('Confirm password'), opts.confirm ?? password);
}

const submitButton = () => screen.getByRole('button', { name: /claim this instance/i });

describe('ClaimPage', () => {
  it('claims the instance with the code, the email and the chosen password', async () => {
    render(<ClaimPage />);

    await fillForm({ code: 'abcd-efgh-jkmn' });
    await userEvent.click(submitButton());

    // The code is normalised before it leaves the browser — the banner prints it uppercase.
    await waitFor(() => expect(claim).toHaveBeenCalledWith('ABCD-EFGH-JKMN', 'owner@example.com', PASSWORD));
    expect(await screen.findByRole('heading', { name: /check your inbox/i })).toBeInTheDocument();
  });

  it('explains where the claim code comes from', async () => {
    render(<ClaimPage />);
    expect(await screen.findByText(/make logs s=backend/)).toBeInTheDocument();
  });

  it('says why the owner is asked for a password and states the published minimum', async () => {
    render(<ClaimPage />);

    const hint = await screen.findByText(/everyone you invite signs in with an emailed link/i);
    expect(hint).toHaveTextContent('At least 12 characters');
  });

  it('collects the password without echoing it', async () => {
    render(<ClaimPage />);

    expect(await screen.findByLabelText('Choose a password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Choose a password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('refuses a mismatched confirmation without calling the backend', async () => {
    render(<ClaimPage />);

    await fillForm({ password: PASSWORD, confirm: `${PASSWORD}x` });

    expect(screen.getByText(/does not match the password above/i)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    // The disabled button is the first guard; the handler is the second, so submit the
    // form directly to prove a stray submit event cannot get past it either.
    fireEvent.submit(submitButton().closest('form')!);

    expect(await screen.findByText(/those passwords do not match/i)).toBeInTheDocument();
    expect(claim).not.toHaveBeenCalled();
  });

  it('refuses a password under the published minimum without calling the backend', async () => {
    render(<ClaimPage />);

    await fillForm({ password: 'short-pass' }); // 10 characters, under the 12 published above
    await userEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 12 characters');
    expect(claim).not.toHaveBeenCalled();
  });

  it('falls back to a built-in minimum when the capabilities call fails', async () => {
    capabilities.mockRejectedValue(new Error('offline'));
    render(<ClaimPage />);

    expect(await screen.findByText(/At least 10 characters/)).toBeInTheDocument();

    await fillForm({ password: 'nine-char' });
    await userEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 10 characters');
    expect(claim).not.toHaveBeenCalled();
  });

  it('shows the backend 422 detail verbatim when it rejects the password', async () => {
    claim.mockRejectedValue({
      response: { status: 422, data: { detail: 'Remove the leading or trailing spaces.' } },
    });
    render(<ClaimPage />);

    await fillForm();
    await userEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Remove the leading or trailing spaces.');
    expect(screen.getByLabelText('Choose a password')).toBeInTheDocument();
  });

  it('says the password is inert until the emailed link is opened', async () => {
    render(<ClaimPage />);

    await fillForm();
    await userEvent.click(submitButton());

    expect(await screen.findByText(/does not work until that link is opened/i)).toBeInTheDocument();
  });

  it('surfaces the action link when no mail provider is configured', async () => {
    claim.mockResolvedValue({
      sent: true,
      delivered: false,
      action_url: 'http://localhost:3001/auth/verify?token=abc',
    });
    render(<ClaimPage />);

    await fillForm();
    await userEvent.click(submitButton());

    const link = await screen.findByRole('link', { name: /auth\/verify\?token=abc/ });
    expect(link).toHaveAttribute('href', 'http://localhost:3001/auth/verify?token=abc');
  });

  it('shows the already-claimed state when the instance reports an owner', async () => {
    instanceStatus.mockResolvedValue({
      claimed: true, needs_claim: false, instance_name: 'The House', claimed_at: '2026-01-01T00:00:00',
    });
    render(<ClaimPage />);

    expect(await screen.findByRole('heading', { name: /this instance has an owner/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to sign in/i })).toHaveAttribute('href', '/signin');
  });

  it('turns a 409 on submit into the already-claimed state', async () => {
    claim.mockRejectedValue({ response: { status: 409 } });
    render(<ClaimPage />);

    await fillForm();
    await userEvent.click(submitButton());

    expect(await screen.findByRole('heading', { name: /this instance has an owner/i })).toBeInTheDocument();
  });

  it('reports a rejected claim code without losing the form', async () => {
    claim.mockRejectedValue({ response: { status: 403 } });
    render(<ClaimPage />);

    await fillForm({ code: 'WRONG' });
    await userEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/claim code was not recognised/i);
    expect(screen.getByLabelText('Claim code')).toBeInTheDocument();
  });
});
