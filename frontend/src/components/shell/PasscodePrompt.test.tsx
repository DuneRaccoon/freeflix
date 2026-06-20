import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PasscodePrompt from './PasscodePrompt';

describe('PasscodePrompt', () => {
  it('calls onSuccess when the correct passcode is entered', async () => {
    const onSuccess = vi.fn();
    render(<PasscodePrompt open profileName="Ben" expected="1234" onClose={() => {}} onSuccess={onSuccess} />);
    for (const d of ['1', '2', '3', '4']) {
      await userEvent.click(screen.getByRole('button', { name: d }));
    }
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('shows an error and does not succeed on a wrong passcode', async () => {
    const onSuccess = vi.fn();
    render(<PasscodePrompt open profileName="Ben" expected="1234" onClose={() => {}} onSuccess={onSuccess} />);
    for (const d of ['9', '9', '9', '9']) {
      await userEvent.click(screen.getByRole('button', { name: d }));
    }
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByText(/incorrect/i)).toBeInTheDocument();
  });
});
