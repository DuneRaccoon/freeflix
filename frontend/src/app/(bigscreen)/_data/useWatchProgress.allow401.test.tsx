/**
 * The flush survives a 401, driven through the REAL api-client interceptor.
 *
 * WHY ITS OWN FILE. `useWatchProgress.test.tsx` mocks `@/services/streaming`, and a mocked
 * service never reaches the interceptor that this file exists to exercise. The defect being
 * pinned is hazard 7: `handleUnauthorized` runs inside apiClient's REJECTION HANDLER, before
 * any caller sees the error, and hard-navigates with `window.location.replace`. A player
 * flushing its position on the way out would therefore be destroyed by its own failing
 * write, and the position lost — the one thing the flush exists to prevent.
 *
 * THE MODULE IS STATEFUL AND POISONS ITS NEIGHBOURS. `redirecting` is module-scoped and is
 * never reset, so one trip through the redirect silences every later 401 in the same module
 * registry; and `handleUnauthorized` reads `window.location.pathname` to decide WHERE to
 * send the viewer. So each test here resets the module registry, imports a fresh client,
 * installs a stub adapter on it, and puts `window.location` back afterwards.
 *
 * The adapter rejects with an axios-shaped error rather than resolving a 401, because a
 * custom adapter is the thing that would normally call `settle()`: resolving would never
 * reach the response interceptor at all, and the test would pass while asserting nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { AxiosRequestConfig } from 'axios';

const WATCH_PATH = '/bigscreen/watch/pk';

let realLocation: Location;

beforeEach(() => {
  realLocation = window.location;
  vi.resetModules();
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.restoreAllMocks();
});

/**
 * A fresh api-client with every request answered by `answer`, and a spy on the one call the
 * interceptor would make to take the player out.
 */
async function freshClient(answer: (config: AxiosRequestConfig) => Promise<unknown>) {
  const replace = vi.fn();
  const origin = 'http://localhost:3000';
  // A full-enough Location: axios's own `isURLSameOrigin` builds a `new URL(location.href)`,
  // so a stub carrying only `pathname` throws "Invalid URL" before the request is even sent.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: `${origin}${WATCH_PATH}`,
      origin,
      protocol: 'http:',
      host: 'localhost:3000',
      hostname: 'localhost',
      port: '3000',
      pathname: WATCH_PATH,
      search: '',
      hash: '',
      replace,
      assign: vi.fn(),
      reload: vi.fn(),
      toString: () => `${origin}${WATCH_PATH}`,
    },
  });
  const api = (await import('@/services/api-client')).default;
  const sent: AxiosRequestConfig[] = [];
  api.defaults.adapter = (async (config: AxiosRequestConfig) => {
    sent.push(config);
    return answer(config);
  }) as never;
  return { api, sent, replace };
}

/** What axios's own adapters hand the response interceptor for a 401. */
function axios401(config: AxiosRequestConfig) {
  const response = { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config };
  return Object.assign(new Error('Request failed with status code 401'), {
    isAxiosError: true,
    config,
    response,
  });
}

const ok = (config: AxiosRequestConfig, data: unknown = null) => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
});

describe('the heartbeat cannot be taken out by the 401 redirect it causes', () => {
  it('a 401 on the flush leaves the player where it is', async () => {
    const { sent, replace } = await freshClient(async (config) => {
      if (String(config.method).toLowerCase() === 'post') throw axios401(config);
      return ok(config, null);
    });
    const { useWatchProgress } = await import('./useWatchProgress');

    function Host() {
      useWatchProgress({
        userId: 'p1',
        torrentId: 'pk',
        contentId: 'tv:1399:s2:e5',
        title: 'Show 1399 S02E05',
        fileIndex: 4,
        position: 600,
        duration: 2400,
        writing: true,
      });
      return null;
    }

    const view = render(<Host />);
    await act(async () => {});
    // The flush on the way out: the press a remote makes most.
    await act(async () => {
      view.unmount();
    });
    await act(async () => {});

    const post = sent.find((c) => String(c.method).toLowerCase() === 'post');
    expect.soft(post, 'the position was written at all').toBeDefined();
    // The opt-out, as the interceptor reads it.
    expect.soft(post?.__allow401).toBe(true);
    // And the thing that must NOT have happened: a hard navigation out of the player from
    // inside the rejection handler of the player's own last write.
    expect.soft(replace).not.toHaveBeenCalled();
  });

  it('without the opt-out the same 401 DOES navigate, which is why the flag is there', async () => {
    // The non-vacuity half: proof that this fixture can observe the redirect at all. A test
    // that could not would pass with the opt-out deleted.
    const { api, replace } = await freshClient(async (config) => {
      throw axios401(config);
    });
    await expect(api.post('/streaming/progress/p1', {})).rejects.toThrow();
    expect(replace).toHaveBeenCalledWith('/bigscreen/pair');
  });
});
