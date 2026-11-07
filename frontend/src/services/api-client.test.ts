import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import apiClient, { onProfileLocked } from './api-client';

/** The adapter "answers" with this status without touching the network. */
function answerWith(status: number) {
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    throw new AxiosError('refused', 'ERR_BAD_REQUEST', config, {}, {
      status,
      statusText: '',
      data: {},
      headers: {},
      config,
    });
  };
}

describe('onProfileLocked', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a 423 notifies onProfileLocked listeners and still rejects', async () => {
    answerWith(423);
    const listener = vi.fn();
    const off = onProfileLocked(listener);

    await expect(apiClient.get('/users/p1/settings')).rejects.toMatchObject({
      response: { status: 423 },
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toContain('/users/p1/settings');

    off();
    await expect(apiClient.get('/users/p1/settings')).rejects.toBeTruthy();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('other statuses do not notify', async () => {
    answerWith(403);
    const listener = vi.fn();
    const off = onProfileLocked(listener);
    await expect(apiClient.get('/users/p1/settings')).rejects.toBeTruthy();
    expect(listener).not.toHaveBeenCalled();
    off();
  });
});
