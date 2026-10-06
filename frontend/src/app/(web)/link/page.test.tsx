import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LinkPage from './page';

vi.mock('@/services/devices', () => ({
  devicesService: { approve: vi.fn() },
}));
const mockSearchParams = { get: vi.fn() };
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

import { devicesService } from '@/services/devices';

describe('/link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.get.mockReturnValue(null);
  });

  it('pre-fills the code from the query string', () => {
    mockSearchParams.get.mockReturnValue('BCDF-GHJK');
    render(<LinkPage />);
    expect((screen.getByLabelText(/code/i) as HTMLInputElement).value).toBe('BCDF-GHJK');
  });

  it('shows the code back for comparison before approving', () => {
    mockSearchParams.get.mockReturnValue('BCDF-GHJK');
    render(<LinkPage />);
    // The genuine risk is social engineering, so the screen must let the person
    // compare what they are approving against what the television shows.
    expect(screen.getByText(/BCDF-GHJK/)).toBeInTheDocument();
  });

  it('approves with the typed code and device name', async () => {
    (devicesService.approve as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<LinkPage />);
    await userEvent.type(screen.getByLabelText(/code/i), 'BCDF-GHJK');
    await userEvent.clear(screen.getByLabelText(/name/i));
    await userEvent.type(screen.getByLabelText(/name/i), 'Living Room TV');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() =>
      expect(devicesService.approve).toHaveBeenCalledWith('BCDF-GHJK', 'Living Room TV'),
    );
  });

  it('reports a rejected code without saying whether it ever existed', async () => {
    (devicesService.approve as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { status: 404 },
    });
    render(<LinkPage />);
    await userEvent.type(screen.getByLabelText(/code/i), 'ZZZZ-ZZZZ');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/not valid/i)).toBeInTheDocument();
  });

  it('reports the throttle distinctly, because the person can act on it', async () => {
    (devicesService.approve as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { status: 429 },
    });
    render(<LinkPage />);
    await userEvent.type(screen.getByLabelText(/code/i), 'ZZZZ-ZZZZ');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/too many/i)).toBeInTheDocument();
  });

  it('confirms success', async () => {
    (devicesService.approve as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<LinkPage />);
    await userEvent.type(screen.getByLabelText(/code/i), 'BCDF-GHJK');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/paired/i)).toBeInTheDocument();
  });
});
