import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';

/**
 * What this file exists for, and why it is not another component test.
 *
 * Stage 8 gives the television a capability profile (`client=lg-webos22-floor`) that re-orders
 * candidates for one device. It must reach the TV's two requests and **no** web request: a profile
 * applied to a desktop user silently re-ranks their source list and can refuse their download.
 *
 * The plan named the eleven existing web payload assertions as the detector for that leak
 * (`MovieDetailView.test.tsx:329`, `EpisodeList.test.tsx:364`/`389`, `ShowDetailView.test.tsx:392`/
 * `:425`, and six more on the Play path). **They cannot detect it, and that was measured, not
 * assumed.** All three of those files mock the service wholesale —
 * `vi.mock('@/services/torrents', …)` at `MovieDetailView.test.tsx:57`, `EpisodeList.test.tsx:40`,
 * `ShowDetailView.test.tsx:53` — so they compare the object handed *into* `downloadCatalogMovie`.
 * The real module never runs, `api-client` is never even imported, and a default inside either one
 * is invisible. Both halves were run against the full suite: a `client` defaulted in
 * `torrentsService.downloadCatalogMovie` and a `client` injected from `apiClient.interceptors.request`
 * each left **2292 tests passing**. `services/torrents.ts` had no test of its own at all, while five
 * sibling services did.
 *
 * So the eleven assertions guard the web **callers**, which is a real but different failure, and
 * the service and interceptor layers were guarded by review only. This file guards them.
 *
 * THE HARNESS IS THE POINT. Mocking `./api-client` — the pattern in `movies.test.ts` — would close
 * the service-default hole and leave the interceptor hole wide open, because the mock replaces the
 * module along with its interceptors. So this follows `api-client.401.test.ts` instead and swaps
 * `defaults.adapter`, which means **the real request interceptors run** and anything they add to a
 * request is visible here. `test_adapter_harness_observes_an_interceptor` proves that claim against
 * a deliberately injected sentinel rather than asserting it in prose, because a guard whose
 * mechanism is untested is a guard nobody has checked.
 */

const TV_PROFILE = 'lg-webos22-floor';

/** The last request the adapter saw, with the POST body already parsed back out of JSON. */
type Seen = { url?: string; params?: Record<string, unknown>; body: Record<string, unknown> | null };

async function harness() {
  // Fresh module per case: api-client holds module-level state (`redirecting`) and installs its
  // interceptors at import time.
  vi.resetModules();
  const client = (await import('./api-client')).default;
  const { torrentsService } = await import('./torrents');
  const seen: Seen[] = [];
  client.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    seen.push({
      url: config.url,
      params: config.params,
      body: typeof config.data === 'string' ? JSON.parse(config.data) : (config.data ?? null),
    });
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
  return { client, torrentsService, seen, last: () => seen[seen.length - 1] };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the adapter harness really observes what the pipeline adds', () => {
  it('sees a field a request interceptor injects — so the interceptor guards below are not vacuous', async () => {
    const { client, torrentsService, last } = await harness();
    // A deliberately hostile interceptor, standing in for the one-line change this file exists to
    // catch. Without this case, "an interceptor cannot inject client" would be asserted by a
    // harness nobody had shown could see an interceptor at all.
    // NOTE: a request interceptor runs BEFORE axios serializes the body, so `config.data` is still
    // the object here — it is a JSON string only by the time the adapter sees it. A leak would be
    // written at this layer, in object form, which is exactly what is injected below.
    const id = client.interceptors.request.use((config) => {
      if (config.data && typeof config.data === 'object') {
        config.data = { ...(config.data as Record<string, unknown>), __sentinel: true };
      }
      return config;
    });
    try {
      await torrentsService.downloadCatalogMovie({ tmdb_id: 603, quality: '1080p' });
      expect(last().body).toHaveProperty('__sentinel', true);
    } finally {
      client.interceptors.request.eject(id);
    }
  });
});

describe('torrentsService.downloadCatalogMovie sends the body verbatim', () => {
  it('a web request arrives with NO client key — not merely an undefined one', async () => {
    const { torrentsService, last } = await harness();
    await torrentsService.downloadCatalogMovie({ tmdb_id: 603, quality: '1080p' });
    expect(last().url).toBe('/torrents/download');
    // Exact equality, so an injected key fails here; `in` as well, because toEqual treats an
    // explicitly-undefined key as absent and a default of `undefined` is not what we are afraid of.
    expect(last().body).toEqual({ tmdb_id: 603, quality: '1080p' });
    expect('client' in (last().body as object)).toBe(false);
  });

  it('a web request on the TV path shape still carries no profile', async () => {
    const { torrentsService, last } = await harness();
    await torrentsService.downloadCatalogMovie({
      tmdb_id: 1399, quality: '2160p', media_type: 'tv', season: 1, episode: 3,
    });
    expect(last().body).toEqual({ tmdb_id: 1399, quality: '2160p', media_type: 'tv', season: 1, episode: 3 });
    expect('client' in (last().body as object)).toBe(false);
  });

  it('passes a client straight through when the caller is the television', async () => {
    const { torrentsService, last } = await harness();
    await torrentsService.downloadCatalogMovie({ tmdb_id: 603, quality: '1080p', client: TV_PROFILE });
    expect(last().body).toEqual({ tmdb_id: 603, quality: '1080p', client: TV_PROFILE });
  });

  it('spells the wire value exactly, written out rather than imported', async () => {
    // The literal, not the constant: a test that imports TV_PROFILE agrees with a renamed constant
    // and proves nothing about what the backend's Literal will accept.
    const { torrentsService, last } = await harness();
    await torrentsService.downloadCatalogMovie({ tmdb_id: 603, quality: '1080p', client: TV_PROFILE });
    expect((last().body as { client: string }).client).toBe('lg-webos22-floor');
  });
});

describe('torrentsService.getSources sends the params verbatim', () => {
  it('a web source-picker request carries no client, so every candidate comes back unjudged', async () => {
    const { torrentsService, last } = await harness();
    await torrentsService.getSources({ tmdb_id: 603, quality: '1080p' });
    expect(last().url).toBe('/torrents/sources');
    expect(last().params).toEqual({ tmdb_id: 603, quality: '1080p' });
    expect('client' in (last().params as object)).toBe(false);
  });

  it('passes a client through when one is given', async () => {
    const { torrentsService, last } = await harness();
    await torrentsService.getSources({ tmdb_id: 603, quality: '1080p', client: TV_PROFILE });
    expect(last().params).toEqual({ tmdb_id: 603, quality: '1080p', client: TV_PROFILE });
  });
});

describe('the other write paths are not quietly profiled either', () => {
  it('downloadMovie (the legacy YTS-shaped request) sends its body unchanged', async () => {
    const { torrentsService, last } = await harness();
    await torrentsService.downloadMovie({ movie_id: 'm1', quality: '1080p' } as never);
    expect(last().body).toEqual({ movie_id: 'm1', quality: '1080p' });
    expect('client' in (last().body as object)).toBe(false);
  });

  it('performTorrentAction sends only the action', async () => {
    const { torrentsService, last } = await harness();
    await torrentsService.performTorrentAction('t1', 'resume' as never);
    expect(last().body).toEqual({ action: 'resume' });
  });
});
