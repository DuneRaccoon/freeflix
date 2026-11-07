import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetOwnerSettings = vi.fn();
const mockUpdateOwnerSettings = vi.fn();

vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/instance', () => ({
  instanceService: {
    getOwnerSettings: (...a: unknown[]) => mockGetOwnerSettings(...a),
    updateOwnerSettings: (...a: unknown[]) => mockUpdateOwnerSettings(...a),
  },
}));

import { StorageAndPlaybackSection } from './SettingsView';

const DEFAULTS = {
  autovacuum_enabled: false, autovacuum_days: 30, autovacuum_watched_gate: true,
  autovacuum_watched_pct: 80, auto_next_enabled: true, auto_next_pct: 80,
};

const AV = 'Delete untouched downloads automatically';
const GATE = 'Only once everyone who started it has watched';
const NEXT = 'Download the next episode automatically';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOwnerSettings.mockResolvedValue(DEFAULTS);
});

describe('StorageAndPlaybackSection', () => {
  it('loads the saved values', async () => {
    mockGetOwnerSettings.mockResolvedValue({
      autovacuum_enabled: true, autovacuum_days: 14, autovacuum_watched_gate: true,
      autovacuum_watched_pct: 70, auto_next_enabled: true, auto_next_pct: 65,
    });
    render(<StorageAndPlaybackSection />);
    expect(await screen.findByLabelText('Days untouched before deleting')).toHaveValue(14);
    expect(screen.getByLabelText('Watched threshold')).toHaveValue('70');
    expect(screen.getByLabelText('Start the next episode at')).toHaveValue('65');
    expect(screen.getByRole('switch', { name: AV })).toBeChecked();
  });

  it("uses the spec's slider bounds", async () => {
    render(<StorageAndPlaybackSection />);
    const next = await screen.findByLabelText('Start the next episode at');
    expect(next).toHaveAttribute('min', '50');
    expect(next).toHaveAttribute('max', '95');
    expect(next).toHaveAttribute('step', '5');
    const w = screen.getByLabelText('Watched threshold');
    expect(w).toHaveAttribute('min', '10');
    expect(w).toHaveAttribute('max', '100');
    expect(w).toHaveAttribute('step', '5');
  });

  it('saves the whole form as edited', async () => {
    const user = userEvent.setup();
    render(<StorageAndPlaybackSection />);
    await screen.findByLabelText('Days untouched before deleting');
    await user.click(screen.getByRole('switch', { name: AV }));
    const days = screen.getByLabelText('Days untouched before deleting');
    await user.clear(days);
    await user.type(days, '14');
    fireEvent.change(screen.getByLabelText('Start the next episode at'), { target: { value: '65' } });
    mockUpdateOwnerSettings.mockImplementation(async (p) => p);
    await user.click(screen.getByRole('button', { name: 'Save storage & playback' }));
    await vi.waitFor(() =>
      expect(mockUpdateOwnerSettings).toHaveBeenCalledWith({
        autovacuum_enabled: true, autovacuum_days: 14, autovacuum_watched_gate: true,
        autovacuum_watched_pct: 80, auto_next_enabled: true, auto_next_pct: 65,
      }),
    );
  });

  it('refuses out-of-range days before any request', async () => {
    const user = userEvent.setup();
    render(<StorageAndPlaybackSection />);
    await screen.findByLabelText('Days untouched before deleting');
    await user.click(screen.getByRole('switch', { name: AV }));
    const days = screen.getByLabelText('Days untouched before deleting');
    for (const v of ['0', '366']) {
      await user.clear(days);
      await user.type(days, v);
      await user.click(screen.getByRole('button', { name: 'Save storage & playback' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Days must be a whole number from 1 to 365',
      );
    }
    expect(mockUpdateOwnerSettings).not.toHaveBeenCalled();
  });

  it('dependent controls follow their switches', async () => {
    const user = userEvent.setup();
    render(<StorageAndPlaybackSection />);
    const days = await screen.findByLabelText('Days untouched before deleting');
    const watched = screen.getByLabelText('Watched threshold');
    const next = screen.getByLabelText('Start the next episode at');
    expect(days).toBeDisabled();
    expect(watched).toBeDisabled();
    expect(next).toBeEnabled();
    await user.click(screen.getByRole('switch', { name: NEXT }));
    expect(next).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: AV }));
    expect(days).toBeEnabled();
    expect(watched).toBeEnabled();
    await user.click(screen.getByRole('switch', { name: GATE }));
    expect(watched).toBeDisabled();
    expect(days).toBeEnabled();
  });

  it('shows an error, not a form of defaults, when the load fails', async () => {
    mockGetOwnerSettings.mockRejectedValue(new Error('boom'));
    render(<StorageAndPlaybackSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load storage & playback settings.',
    );
    expect(screen.queryByRole('button', { name: 'Save storage & playback' })).toBeNull();
  });
});
