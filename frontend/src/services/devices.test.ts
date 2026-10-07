import { describe, it, expect, vi, beforeEach } from 'vitest';
import { devicesService } from './devices';
import apiClient from './api-client';

vi.mock('./api-client', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

describe('devicesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('start posts with no body and returns the payload', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { device_code: 'dc', user_code: 'BCDF-GHJK', verification_uri: 'http://x/link', expires_in: 600, interval: 2 },
    });
    const r = await devicesService.start();
    expect(apiClient.post).toHaveBeenCalledWith('/auth/device/start');
    expect(r.user_code).toBe('BCDF-GHJK');
  });

  it('poll sends the device_code in the BODY, never the path', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { status: 'pending' } });
    await devicesService.poll('secret-code');
    const [path, body] = (apiClient.post as ReturnType<typeof vi.fn>).mock.calls[0];
    // The error middleware logs request.url.path. A secret in a path is a secret in
    // the logs, which is why the backend takes it in a JSON body.
    expect(path).toBe('/auth/device/poll');
    expect(path).not.toContain('secret-code');
    expect(body).toEqual({ device_code: 'secret-code' });
  });

  it('poll opts out of the global 401 redirect', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { status: 'pending' } });
    await devicesService.poll('dc');
    const cfg = (apiClient.post as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(cfg?.__allow401).toBe(true);
  });

  it('approve normalizes nothing client-side — the server owns the alphabet', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { ok: true } });
    await devicesService.approve('bcdf-ghjk', 'Living Room TV');
    expect(apiClient.post).toHaveBeenCalledWith('/auth/device/approve', {
      user_code: 'bcdf-ghjk',
      device_name: 'Living Room TV',
    });
  });

  it('revoke deletes by id', async () => {
    (apiClient.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { ok: true } });
    await devicesService.revoke('sess-1');
    expect(apiClient.delete).toHaveBeenCalledWith('/auth/devices/sess-1');
  });
});
