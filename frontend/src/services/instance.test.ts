import { describe, it, expect, vi, beforeEach } from 'vitest';
import { instanceService } from './instance';
import apiClient from './api-client';

vi.mock('./api-client', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe('instanceService owner settings and playback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getOwnerSettings reads /instance/owner-settings and returns the payload', async () => {
    const data = { auto_next_pct: 80 };
    mocked(apiClient.get).mockResolvedValue({ data });
    const r = await instanceService.getOwnerSettings();
    expect(apiClient.get).toHaveBeenCalledWith('/instance/owner-settings');
    expect(r).toBe(data);
  });

  it('updateOwnerSettings puts the patch and returns the payload', async () => {
    const data = { auto_next_pct: 65 };
    mocked(apiClient.put).mockResolvedValue({ data });
    const r = await instanceService.updateOwnerSettings({ auto_next_pct: 65 });
    expect(apiClient.put).toHaveBeenCalledWith('/instance/owner-settings', { auto_next_pct: 65 });
    expect(r).toBe(data);
  });

  it('getPlayback reads /instance/playback, never the owner-only route', async () => {
    const data = { auto_next_enabled: true, auto_next_pct: 80 };
    mocked(apiClient.get).mockResolvedValue({ data });
    const r = await instanceService.getPlayback();
    expect(apiClient.get).toHaveBeenCalledWith('/instance/playback');
    expect(apiClient.get).not.toHaveBeenCalledWith('/instance/owner-settings');
    expect(r).toBe(data);
  });
});
