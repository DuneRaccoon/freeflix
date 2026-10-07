import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import PairPage from './page';

vi.mock('@/services/devices', () => ({
  devicesService: { start: vi.fn(), poll: vi.fn() },
}));
import { devicesService } from '@/services/devices';

const toDataURL = vi.hoisted(() => vi.fn());
vi.mock('qrcode', () => ({ default: { toDataURL }, toDataURL }));

const realLocation = window.location;
function stubLocation(origin: string, replace = vi.fn()) {
  Object.defineProperty(window, 'location', {
    value: { ...realLocation, replace, origin },
    writable: true,
    configurable: true,
  });
  return replace;
}

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
    toDataURL.mockResolvedValue('data:image/png;base64,AAA');
    (devicesService.start as ReturnType<typeof vi.fn>).mockResolvedValue(START);
    (devicesService.poll as ReturnType<typeof vi.fn>).mockResolvedValue('pending');
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true });
  });

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
    const replace = stubLocation('http://192.168.1.9:3001');
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
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    await waitFor(() =>
      expect((devicesService.start as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it('shows a readable message if start fails', async () => {
    (devicesService.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    render(<PairPage />);
    expect(await screen.findByText(/can.t reach/i)).toBeInTheDocument();
  });

  it('rewrites a loopback verification_uri onto the origin the TV loaded from', async () => {
    stubLocation('http://192.168.1.9:3001');
    (devicesService.start as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...START, verification_uri: 'http://localhost:3000/link',
    });
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    expect(screen.getByText('http://192.168.1.9:3001/link')).toBeInTheDocument();
  });

  it('keeps a public verification_uri unchanged', async () => {
    stubLocation('http://192.168.1.9:3001');
    (devicesService.start as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...START, verification_uri: 'https://tv.example.com/link',
    });
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    expect(screen.getByText('https://tv.example.com/link')).toBeInTheDocument();
  });

  it('encodes the user code, never the device code, in the QR', async () => {
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    await waitFor(() => expect(toDataURL).toHaveBeenCalled());
    const arg = toDataURL.mock.calls[0][0] as string;
    expect(arg).toContain('?code=BCDF-GHJK');
    expect(arg).not.toContain('dc-secret');
  });

  it('shows the NEW code after an expiry restart', async () => {
    const start = devicesService.start as ReturnType<typeof vi.fn>;
    start.mockResolvedValueOnce(START).mockResolvedValue({ ...START, device_code: 'dc-2', user_code: 'WXYZ-QRST' });
    (devicesService.poll as ReturnType<typeof vi.fn>).mockResolvedValueOnce('expired').mockResolvedValue('pending');
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    expect(await screen.findByText('WXYZ-QRST')).toBeInTheDocument();
    expect(screen.queryByText('BCDF-GHJK')).not.toBeInTheDocument();
  });

  it('stops polling after approval and after unmount', async () => {
    stubLocation('http://192.168.1.9:3001');
    const poll = devicesService.poll as ReturnType<typeof vi.fn>;
    poll.mockResolvedValue('approved');
    const { unmount } = render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    const afterApproval = poll.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(poll.mock.calls.length).toBe(afterApproval);

    // Unmount the first tree so only the second is in the document.
    unmount();
    poll.mockClear();
    poll.mockResolvedValue('pending');
    const second = render(<PairPage />);
    await within(second.container).findByText('BCDF-GHJK');
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    // Prove a poll chain was running at the moment of unmount.
    expect(poll.mock.calls.length).toBeGreaterThan(0);
    second.unmount();
    const afterUnmount = poll.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(poll.mock.calls.length).toBe(afterUnmount);
  });

  it('gives up after repeated poll failures and shows the unreachable screen', async () => {
    const poll = devicesService.poll as ReturnType<typeof vi.fn>;
    poll.mockRejectedValue(new Error('down'));
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    await act(async () => { await vi.advanceTimersByTimeAsync(40000); });
    expect(await screen.findByText(/can.t reach/i)).toBeInTheDocument();
    expect(poll).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('does not restart instantly when a pairing comes back expired', async () => {
    const start = devicesService.start as ReturnType<typeof vi.fn>;
    (devicesService.poll as ReturnType<typeof vi.fn>).mockResolvedValue('expired');
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    // Poll fires at 2s; the restart must wait beyond that, not follow it at once.
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(start).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('stops restarting after repeated expiries and shows the unreachable screen', async () => {
    const start = devicesService.start as ReturnType<typeof vi.fn>;
    (devicesService.poll as ReturnType<typeof vi.fn>).mockResolvedValue('expired');
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    // Step in small slices: each restart needs a render before its poll timer exists.
    for (let i = 0; i < 20; i++) await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(await screen.findByText(/can.t reach/i)).toBeInTheDocument();
    const calls = start.mock.calls.length;
    expect(calls).toBe(5);
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(start).toHaveBeenCalledTimes(calls);
  });

  it('says the account can no longer sign in when the pairing is denied', async () => {
    (devicesService.poll as ReturnType<typeof vi.fn>).mockResolvedValue('denied');
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(await screen.findByText(/no longer sign in/i)).toBeInTheDocument();
    expect(screen.queryByText(/declined|on your phone/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
