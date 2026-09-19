import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PasscodePrompt from './PasscodePrompt';

const type = async (digits: string) => {
  for (const d of digits) {
    await userEvent.click(screen.getByRole('button', { name: d }));
  }
};

describe('PasscodePrompt', () => {
  it('submits the entered code once it reaches the configured length', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<PasscodePrompt open profileName="Ben" length={4} onClose={() => {}} onSubmit={onSubmit} />);

    await type('123');
    expect(onSubmit).not.toHaveBeenCalled();

    await type('4');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('1234'));
  });

  it('honours a passcode length other than four', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<PasscodePrompt open profileName="Ben" length={6} onClose={() => {}} onSubmit={onSubmit} />);

    await type('12345');
    expect(onSubmit).not.toHaveBeenCalled();

    await type('6');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('123456'));
  });

  it('shows the error state and clears the entry when the server rejects the code', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    render(<PasscodePrompt open profileName="Ben" length={4} onClose={() => {}} onSubmit={onSubmit} />);

    await type('9999');
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i);

    // Cleared, so the next attempt starts from an empty keypad.
    await type('1');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows the error state when the unlock call throws', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('network'));
    render(<PasscodePrompt open profileName="Ben" length={4} onClose={() => {}} onSubmit={onSubmit} />);

    await type('1234');
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i);
  });

  it('deletes the last digit and never submits a short code', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<PasscodePrompt open profileName="Ben" length={4} onClose={() => {}} onSubmit={onSubmit} />);

    await type('123');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await type('4');
    expect(onSubmit).not.toHaveBeenCalled();

    await type('5');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('1245'));
  });
});
