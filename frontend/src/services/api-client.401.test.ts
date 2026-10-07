import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';

// handleUnauthorized is module-private and every 401 in the app passes through it,
// so drive it the way production does: through the response interceptor. The adapter
// is replaced so the request "comes back" 401 without touching the network.
const realLocation = window.location;
let replace: ReturnType<typeof vi.fn>;

function setLocation(pathname: string, search = '') {
  replace = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...realLocation, pathname, search, replace },
    writable: true,
    configurable: true,
  });
}

async function fresh() {
  // `redirecting` is module-level state; a fresh module per case keeps it from leaking.
  vi.resetModules();
  const mod = await import('./api-client');
  const client = mod.default;
  client.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, {}, {
      status: 401,
      statusText: 'Unauthorized',
      data: {},
      headers: {},
      config,
    });
  };
  return client;
}

describe('401 handling', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true });
    vi.restoreAllMocks();
  });

  it('sends a 401 under /bigscreen to /bigscreen/pair', async () => {
    setLocation('/bigscreen/watch/abc');
    const client = await fresh();
    await expect(client.get('/x')).rejects.toBeTruthy();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/bigscreen/pair');
  });

  it('does not navigate on a 401 while already on /bigscreen/pair', async () => {
    setLocation('/bigscreen/pair');
    const client = await fresh();
    await expect(client.get('/x')).rejects.toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('still sends a 401 elsewhere to /signin?next=, encoded', async () => {
    setLocation('/movies/123');
    const client = await fresh();
    await expect(client.get('/x')).rejects.toBeTruthy();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/signin?next=%2Fmovies%2F123');
  });

  it('preserves the query string in next=', async () => {
    setLocation('/movies/123', '?a=1&b=2');
    const client = await fresh();
    await expect(client.get('/x')).rejects.toBeTruthy();
    expect(replace).toHaveBeenCalledWith('/signin?next=%2Fmovies%2F123%3Fa%3D1%26b%3D2');
  });

  it('ignores a request that carries __allow401, on any path', async () => {
    for (const path of ['/movies/123', '/bigscreen/watch/abc']) {
      setLocation(path);
      const client = await fresh();
      await expect(client.get('/x', { __allow401: true })).rejects.toBeTruthy();
      expect(replace).not.toHaveBeenCalled();
    }
  });

  it('navigates only once per page load', async () => {
    setLocation('/movies/123');
    const client = await fresh();
    await Promise.allSettled([client.get('/a'), client.get('/b'), client.get('/c')]);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
