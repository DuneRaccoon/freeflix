import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authService } from './auth';
import apiClient from './api-client';

vi.mock('./api-client', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

describe('authService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resetPasscode sends the token in the BODY, never the path', async () => {
    const post = apiClient.post as ReturnType<typeof vi.fn>;
    post.mockResolvedValue({ data: { ok: true } });
    await authService.resetPasscode('secret-token');
    const [path, body] = post.mock.calls[0];
    // Request paths are logged to a persisted file; bodies are not.
    expect(path).toBe('/auth/reset-passcode');
    expect(path).not.toContain('secret-token');
    expect(body).toEqual({ token: 'secret-token' });
  });
});
