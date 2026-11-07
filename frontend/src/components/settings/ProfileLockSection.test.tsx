import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserSettings } from '@/services/users';

const h = vi.hoisted(() => ({ change: vi.fn() }));

vi.mock('@/context/UserContext', () => ({
  useUser: () => ({ changePasscode: h.change }),
}));

import ProfileLockSection from './ProfileLockSection';

const BASE: Omit<UserSettings, 'has_passcode' | 'passcode_len'> = {
  id: 'settings-1',
  user_id: 'user-1',
  maturity_restriction: 'none',
  require_passcode: false,
  theme: 'dark',
  default_quality: '1080p',
};
const OFF: UserSettings = { ...BASE, has_passcode: false, require_passcode: false, passcode_len: null };
const ON = (len = 4): UserSettings => ({ ...BASE, has_passcode: true, require_passcode: true, passcode_len: len });

const digits = async (s: string) => {
  for (const d of s) await userEvent.click(screen.getByRole('button', { name: d }));
};
const ok = () => userEvent.click(screen.getByRole('button', { name: 'OK' }));
const press = (name: string) => userEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  h.change.mockReset();
});

describe('ProfileLockSection', () => {
  it('no code: Set a passcode → enter → confirm saves with no current code', async () => {
    h.change.mockResolvedValue('ok');
    render(<ProfileLockSection userId="user-1" settings={OFF} />);
    expect(screen.getByText('Profile lock')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove lock' })).toBeNull();
    await press('Set a passcode');
    await digits('1234');
    await ok();
    expect(screen.getByRole('group', { name: 'Enter it again' })).toBeInTheDocument();
    await digits('1234');
    await ok();
    await waitFor(() => expect(h.change).toHaveBeenCalledWith('user-1', { new_passcode: '1234' }));
    expect(h.change).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Set a passcode' })).toBeInTheDocument();
  });

  it('a confirmation that does not match starts again and sends nothing', async () => {
    render(<ProfileLockSection userId="user-1" settings={OFF} />);
    await press('Set a passcode');
    await digits('1234');
    await ok();
    await digits('1235');
    await ok();
    expect(screen.getByRole('alert')).toHaveTextContent("Those didn't match. Start again.");
    expect(screen.getByRole('group', { name: 'Choose a 4–6 digit passcode' })).toBeInTheDocument();
    expect(h.change).not.toHaveBeenCalled();
  });

  it('code set: Change passcode sends current, new and confirmed new', async () => {
    h.change.mockResolvedValue('ok');
    render(<ProfileLockSection userId="user-1" settings={ON(4)} />);
    expect(screen.queryByRole('button', { name: 'Set a passcode' })).toBeNull();
    expect(screen.getByText('This profile asks for its passcode every time it is chosen.')).toBeInTheDocument();
    await press('Change passcode');
    await digits('9876');
    await digits('12345');
    await ok();
    await digits('12345');
    await ok();
    await waitFor(() =>
      expect(h.change).toHaveBeenCalledWith('user-1', { current_passcode: '9876', new_passcode: '12345' }),
    );
  });

  it('change: a wrong current code says so and asks for it again', async () => {
    h.change.mockResolvedValue('wrong');
    render(<ProfileLockSection userId="user-1" settings={ON(4)} />);
    await press('Change passcode');
    await digits('9876');
    await digits('12345');
    await ok();
    await digits('12345');
    await ok();
    expect(await screen.findByRole('alert')).toHaveTextContent("That isn't the current passcode.");
    expect(screen.getByRole('group', { name: 'Enter your current passcode' })).toBeInTheDocument();
  });

  it('remove: asks for the current code only, then sends new_passcode null', async () => {
    h.change.mockResolvedValue('ok');
    render(<ProfileLockSection userId="user-1" settings={ON(4)} />);
    await press('Remove lock');
    await digits('9876');
    await waitFor(() =>
      expect(h.change).toHaveBeenCalledWith('user-1', { current_passcode: '9876', new_passcode: null }),
    );
  });

  it('the current-code numpad uses the stored length, even a legacy eight', async () => {
    h.change.mockResolvedValue('ok');
    render(<ProfileLockSection userId="user-1" settings={ON(8)} />);
    await press('Remove lock');
    await digits('1234');
    expect(h.change).not.toHaveBeenCalled();
    await digits('5678');
    await waitFor(() =>
      expect(h.change).toHaveBeenCalledWith('user-1', { current_passcode: '12345678', new_passcode: null }),
    );
  });

  it('throttled says so and returns to idle', async () => {
    h.change.mockResolvedValue('throttled');
    render(<ProfileLockSection userId="user-1" settings={ON(4)} />);
    await press('Remove lock');
    await digits('9876');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in a few minutes.');
    expect(screen.getByRole('button', { name: 'Remove lock' })).toBeInTheDocument();
  });

  it('an error says so and returns to idle', async () => {
    h.change.mockResolvedValue('error');
    render(<ProfileLockSection userId="user-1" settings={ON(4)} />);
    await press('Remove lock');
    await digits('9876');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save. Try again.');
    expect(screen.getByRole('button', { name: 'Remove lock' })).toBeInTheDocument();
  });

  it('Cancel returns to idle and sends nothing', async () => {
    render(<ProfileLockSection userId="user-1" settings={OFF} />);
    await press('Set a passcode');
    await digits('12');
    await press('Cancel');
    expect(screen.getByRole('button', { name: 'Set a passcode' })).toBeInTheDocument();
    expect(h.change).not.toHaveBeenCalled();
  });

  it('set refused as wrong (stale settings): asks for the current code and then changes with it', async () => {
    h.change.mockResolvedValueOnce('wrong').mockResolvedValueOnce('ok');
    render(<ProfileLockSection userId="user-1" settings={OFF} />);
    await press('Set a passcode');
    await digits('1234');
    await ok();
    await digits('1234');
    await ok();
    expect(await screen.findByRole('alert')).toHaveTextContent("That isn't the current passcode.");
    expect(h.change).toHaveBeenNthCalledWith(1, 'user-1', { new_passcode: '1234' });
    await digits('9876');
    await digits('5678');
    await ok();
    await digits('5678');
    await ok();
    await waitFor(() => expect(h.change).toHaveBeenCalledTimes(2));
    expect(h.change).toHaveBeenNthCalledWith(2, 'user-1', { current_passcode: '9876', new_passcode: '5678' });
  });
});
