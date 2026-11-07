import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ reset: vi.fn(), link: vi.fn() }));

vi.mock('@/services/users', () => ({
  usersService: { resetPasscodeWithPassword: h.reset, requestPasscodeResetLink: h.link },
}));

import PasscodePrompt from './PasscodePrompt';

/** What axios rejects with for a non-2xx answer. */
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

const type = async (digits: string) => {
  for (const d of digits) {
    await userEvent.click(screen.getByRole('button', { name: d }));
  }
};

beforeEach(() => vi.resetAllMocks());

describe('PasscodePrompt', () => {
  it('submits the entered code once it reaches the configured length', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<PasscodePrompt open profileId="p1" profileName="Ben" length={4} accountRole="member" onClose={() => {}} onSubmit={onSubmit} onReset={() => {}} />);

    await type('123');
    expect(onSubmit).not.toHaveBeenCalled();

    await type('4');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('1234'));
  });

  it('honours a passcode length other than four', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<PasscodePrompt open profileId="p1" profileName="Ben" length={6} accountRole="member" onClose={() => {}} onSubmit={onSubmit} onReset={() => {}} />);

    await type('12345');
    expect(onSubmit).not.toHaveBeenCalled();

    await type('6');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('123456'));
  });

  it('shows the error state and clears the entry when the server rejects the code', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    render(<PasscodePrompt open profileId="p1" profileName="Ben" length={4} accountRole="member" onClose={() => {}} onSubmit={onSubmit} onReset={() => {}} />);

    await type('9999');
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i);

    // Cleared, so the next attempt starts from an empty keypad.
    await type('1');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows the error state when the unlock call throws', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('network'));
    render(<PasscodePrompt open profileId="p1" profileName="Ben" length={4} accountRole="member" onClose={() => {}} onSubmit={onSubmit} onReset={() => {}} />);

    await type('1234');
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i);
  });

  it('deletes the last digit and never submits a short code', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<PasscodePrompt open profileId="p1" profileName="Ben" length={4} accountRole="member" onClose={() => {}} onSubmit={onSubmit} onReset={() => {}} />);

    await type('123');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await type('4');
    expect(onSubmit).not.toHaveBeenCalled();

    await type('5');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('1245'));
  });

  it('owner: Forgot code? asks for the account password and resets with it', async () => {
    h.reset.mockResolvedValue(undefined);
    const onReset = vi.fn();
    render(<PasscodePrompt open profileId="p1" profileName="Ben" length={4} accountRole="owner" onClose={() => {}} onSubmit={vi.fn()} onReset={onReset} />);

    await userEvent.click(screen.getByRole('button', { name: 'Forgot code?' }));
    expect(screen.queryByRole('button', { name: '1' })).toBeNull();
    await userEvent.type(screen.getByLabelText('Account password'), 'hunter22');
    await userEvent.click(screen.getByRole('button', { name: 'Reset passcode' }));

    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
    expect(h.reset).toHaveBeenCalledWith('p1', 'hunter22');
    expect(h.link).not.toHaveBeenCalled();
  });

  it.each([[403, 'Incorrect password'], [500, 'Could not reset the passcode. Try again.']] as const)(
    'owner: a %i says "%s" and does not reset', async (status, text) => {
      h.reset.mockRejectedValue(httpError(status));
      const onReset = vi.fn();
      render(<PasscodePrompt open profileId="p1" profileName="Ben" length={4} accountRole="owner" onClose={() => {}} onSubmit={vi.fn()} onReset={onReset} />);

      await userEvent.click(screen.getByRole('button', { name: 'Forgot code?' }));
      await userEvent.type(screen.getByLabelText('Account password'), 'hunter22');
      await userEvent.click(screen.getByRole('button', { name: 'Reset passcode' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(onReset).not.toHaveBeenCalled();
    });

  it('owner: Back returns to the numpad', async () => {
    render(<PasscodePrompt open profileId="p1" profileName="Ben" length={4} accountRole="owner" onClose={() => {}} onSubmit={vi.fn()} onReset={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Forgot code?' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Account password')).toBeNull();
    expect(h.reset).not.toHaveBeenCalled();
  });

  it('member: Forgot code? sends the link in one press and says to check email', async () => {
    h.link.mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<PasscodePrompt open profileId="p1" profileName="Ben" length={4} accountRole="member" onClose={onClose} onSubmit={vi.fn()} onReset={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Forgot code?' }));
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(h.link).toHaveBeenCalledTimes(1);
    expect(h.link).toHaveBeenCalledWith('p1');
    expect(screen.queryByLabelText('Account password')).toBeNull();
    expect(h.reset).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('member: a failed send says so and stays on the numpad', async () => {
    h.link.mockRejectedValue(new Error('net'));
    render(<PasscodePrompt open profileId="p1" profileName="Ben" length={4} accountRole="member" onClose={() => {}} onSubmit={vi.fn()} onReset={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Forgot code?' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send the email. Try again.');
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
  });

  it('accepts physical digit keys', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    // The Modal focuses the first key inside the numpad, so keydown reaches its root.
    render(<PasscodePrompt open profileId="p1" profileName="Ben" length={4} accountRole="member" onClose={() => {}} onSubmit={onSubmit} onReset={() => {}} />);

    await userEvent.keyboard('4821');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('4821'));
  });
});
