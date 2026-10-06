import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import PairPage from './page';

vi.mock('@/services/devices', () => ({
  devicesService: { start: vi.fn(), poll: vi.fn() },
}));
import { devicesService } from '@/services/devices';

const START = {
  device_code: 'dc-secret',
  user_code: 'BCDF-GHJK',
  verification_uri: 'http://192.168.1.9:3001/link',
  expires_in: 600,
  interval: 2,
};

describe('/bigscreen/pair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    (devicesService.start as ReturnType<typeof vi.fn>).mockResolvedValue(START);
    (devicesService.poll as ReturnType<typeof vi.fn>).mockResolvedValue('pending');
  });
  afterEach(() => vi.useRealTimers());

  it('shows the code large, and the URL as text', async () => {
    render(<PairPage />);
    expect(await screen.findByText('BCDF-GHJK')).toBeInTheDocument();
    // The QR is an enhancement; the URL must always be readable so a phone can get
    // there without a camera.
    expect(screen.getByText(/192\.168\.1\.9:3001\/link/)).toBeInTheDocument();
  });

  it('never renders the device_code on screen', async () => {
    const { container } = render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    expect(container.textContent).not.toContain('dc-secret');
  });

  it('polls at the interval the server asked for', async () => {
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect((devicesService.poll as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(devicesService.poll).toHaveBeenCalledWith('dc-secret');
  });

  it('stops polling and reloads once approved', async () => {
    const replace = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, replace, origin: 'http://192.168.1.9:3001' },
      writable: true,
    });
    (devicesService.poll as ReturnType<typeof vi.fn>).mockResolvedValue('approved');
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it('restarts when the code expires rather than stranding the screen', async () => {
    (devicesService.poll as ReturnType<typeof vi.fn>).mockResolvedValue('expired');
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await waitFor(() =>
      expect((devicesService.start as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it('shows a readable message if start fails', async () => {
    (devicesService.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    render(<PairPage />);
    expect(await screen.findByText(/can.t reach/i)).toBeInTheDocument();
  });
});
