/**
 * One row per answer in `backend/tests/test_stream_status_matrix.py`.
 *
 * The matrix is the proved contract — written by task 1 precisely because two careful
 * recon passes disagreed about it in both directions — so these rows are read off it
 * rather than inferred from the endpoint. Where the matrix pins a distinction the
 * client cannot use (the four 404 detail strings, which collide ACROSS routes), the
 * row says so instead of pretending to branch on it.
 *
 * THE STRUCTURAL ROWS ARE THE POINT OF THE FILE. No behavioural assertion can observe
 * that `GET /video` writes to the database and re-deadlines 32 pieces at the file
 * head, so "HEAD only, and no Range header on any call" is asserted against the
 * recorded calls instead.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { statusOf } from '../_data/httpStatus';
import {
  PROBE_TIMEOUT_MS,
  RETRY_AFTER_DEFAULT_MS,
  RETRY_AFTER_MAX_MS,
  RETRY_AFTER_MIN_MS,
  classifyStatus,
  classifyStreamFailure,
  parseRetryAfterMs,
  type StreamFailure,
} from './classify';

const SRC = '/api/v1/streaming/t-1/video?file_index=3';

/** A `fetch` double that answers one status, with the headers the backend sends. */
function answering(status: number, headers: Record<string, string> = {}) {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
  })) as unknown as typeof fetch & { mock: { calls: unknown[][] } };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('classifyStreamFailure — one row per status the routes answer', () => {
  const rows: Array<[string, number, Record<string, string>, StreamFailure]> = [
    // 401 is empty-bodied on all three routes, so the status is the ONLY thing a
    // player can branch on. `dependencies/auth.py:143-156` already asserts this
    // branch exists ("the player's error handler checks the status explicitly and
    // routes to sign-in"); until now it did not.
    ['401 -> session', 401, {}, { kind: 'session' }],
    // 503 x3 mean three different things with one status, one Retry-After and one
    // empty body, and one of the three is permanent. Hence a BOUNDED ladder.
    ['503 + Retry-After: 2 -> retry', 503, { 'Retry-After': '2' }, { kind: 'retry', afterMs: 2000 }],
    ['503 + Accept-Ranges -> still just retry', 503, { 'Retry-After': '2', 'Accept-Ranges': 'bytes' }, { kind: 'retry', afterMs: 2000 }],
    ['404 -> gone, terminal', 404, {}, { kind: 'gone' }],
    ['422 -> badRequest', 422, {}, { kind: 'badRequest' }],
    ['416 -> badRequest', 416, { 'Content-Range': 'bytes */1000' }, { kind: 'badRequest' }],
    // The HEAD probe's whole limitation, as a row: 200 from metadata whatever the
    // download position, so what is left to explain a failed <video> is the decode.
    ['200 -> decode', 200, { 'Content-Length': '0' }, { kind: 'decode' }],
    ['500 -> unknown', 500, {}, { kind: 'unknown', status: 500 }],
    ['418 -> unknown', 418, {}, { kind: 'unknown', status: 418 }],
  ];

  it.each(rows)('%s', async (_name, status, headers, expected) => {
    const fetchImpl = answering(status, headers);
    expect(await classifyStreamFailure({ src: SRC, fetchImpl })).toEqual(expected);
  });

  it('probes with HEAD, and no call carries a Range header', async () => {
    // Every GET /video runs prioritize_video_files + force_start_for_stream (a DB
    // write) and then re-deadlines 32 pieces at the FILE HEAD every 250ms,
    // unconditionally — even on a complete torrent. A `Range: bytes=0-0` "cheap
    // probe" therefore hijacks libtorrent's deadline queue away from the live
    // playhead, and even a refused far seek plants an island where it gave up.
    // `head_video` touches only os.path.getsize.
    const fetchImpl = answering(503, { 'Retry-After': '2' });
    await classifyStreamFailure({ src: SRC, fetchImpl });

    expect(fetchImpl.mock.calls).toHaveLength(1);
    for (const [, init] of fetchImpl.mock.calls as Array<[string, RequestInit]>) {
      expect(init.method).toBe('HEAD');
      const headers = new Headers(init.headers ?? {});
      expect([...headers.keys()].map((k) => k.toLowerCase())).not.toContain('range');
      expect(JSON.stringify(init.headers ?? {}).toLowerCase()).not.toContain('bytes=');
    }
  });

  it('sends the session cookie and bypasses any cache', async () => {
    // Same-origin through the Next rewrite, so `same-origin` carries ff_session. A
    // cached 200 would be the one answer this classifier must never believe.
    const fetchImpl = answering(401);
    await classifyStreamFailure({ src: SRC, fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('is not apiClient, whose interceptor would navigate away mid-probe', async () => {
    // Structural, in the suite rather than only in the header: `apiClient`'s rejection
    // interceptor hard-navigates to /bigscreen/pair on a 401 from inside the handler,
    // before any caller sees the error — so a player that probed through it would be
    // unmounted before it could classify anything. A plain fetch double is enough to
    // classify, and nothing navigates.
    const replace = vi.fn();
    const spy = vi.spyOn(window, 'location', 'get');
    spy.mockReturnValue({ ...window.location, replace } as unknown as Location);
    expect(await classifyStreamFailure({ src: SRC, fetchImpl: answering(401) })).toEqual({
      kind: 'session',
    });
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('Retry-After, parsed so it can never be NaN', () => {
  it.each([
    ['absent', null, RETRY_AFTER_DEFAULT_MS],
    ['empty', '', RETRY_AFTER_DEFAULT_MS],
    ['the backend’s own value', '2', 2000],
    ['fractional', '1.5', 1500],
    ['an HTTP-date', 'Wed, 21 Oct 2026 07:28:00 GMT', RETRY_AFTER_DEFAULT_MS],
    ['garbage', 'soon', RETRY_AFTER_DEFAULT_MS],
    ['zero', '0', RETRY_AFTER_MIN_MS],
    ['negative', '-30', RETRY_AFTER_MIN_MS],
    ['absurd', '99999', RETRY_AFTER_MAX_MS],
  ])('%s -> %i ms', (_name, raw, expected) => {
    const got = parseRetryAfterMs(raw as string | null);
    expect(got).toBe(expected);
    expect(Number.isFinite(got)).toBe(true);
  });

  it('a 503 with a date-form Retry-After still yields a usable delay', async () => {
    // The whole reason the default exists: this value is fed to a setTimeout, and
    // `setTimeout(fn, NaN)` fires immediately — turning a bounded ladder into four
    // instant retries against a backend that just asked for two seconds.
    const got = await classifyStreamFailure({
      src: SRC,
      fetchImpl: answering(503, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }),
    });
    expect(got).toEqual({ kind: 'retry', afterMs: RETRY_AFTER_DEFAULT_MS });
  });
});

describe('the probe can never hang or stack', () => {
  it('aborts itself after PROBE_TIMEOUT_MS and answers unknown', async () => {
    // Neither fetch nor apiClient sets a timeout. A probe against a wedged backend
    // would otherwise sit there, and the next failure would start another one.
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const hanging = vi.fn(
      (_src: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          seen = init?.signal ?? undefined;
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;

    const pending = classifyStreamFailure({ src: SRC, fetchImpl: hanging });
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen?.aborted).toBe(true);
    expect(await pending).toEqual({ kind: 'unknown', status: null });
  });

  it('leaves no timer behind when the probe answers', async () => {
    vi.useFakeTimers();
    await classifyStreamFailure({ src: SRC, fetchImpl: answering(503, { 'Retry-After': '2' }) });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a network-level failure is unknown, not a decode and not a session', async () => {
    const dead = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    expect(await classifyStreamFailure({ src: SRC, fetchImpl: dead })).toEqual({
      kind: 'unknown',
      status: null,
    });
  });

  it('an already-aborted caller signal never reaches the network', async () => {
    const fetchImpl = answering(200);
    const outer = new AbortController();
    outer.abort();
    expect(await classifyStreamFailure({ src: SRC, fetchImpl, signal: outer.signal })).toEqual({
      kind: 'unknown',
      status: null,
    });
    expect(fetchImpl.mock.calls).toHaveLength(0);
  });

  it('a caller abort mid-probe answers unknown', async () => {
    const outer = new AbortController();
    const hanging = vi.fn(
      (_src: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;
    const pending = classifyStreamFailure({ src: SRC, fetchImpl: hanging, signal: outer.signal });
    outer.abort();
    expect(await pending).toEqual({ kind: 'unknown', status: null });
  });
});

describe('the helper this deliberately does NOT use', () => {
  it('statusOf answers undefined for a fetch Response, so every row would be unknown', () => {
    // `_data/httpStatus.ts`'s statusOf reads an AXIOS REJECTION (`err.response.status`).
    // fetch does not throw on a 401 and a Response has no `.response`, so routing this
    // classifier through it would collapse the entire matrix to `unknown` — silently,
    // with every test that only asserted "it did not crash" still green. Two
    // mechanisms, deliberately not merged.
    const response = { status: 401, ok: false, headers: new Headers() };
    expect(statusOf(response)).toBeUndefined();
    expect(classifyStatus({ status: response.status })).toEqual({ kind: 'session' });
  });
});

describe('classifyStatus — the pure core, for a caller that already has a status', () => {
  it('carries a 404 detail when one is readable, and does not invent one otherwise', () => {
    // The HEAD probe can never supply this: HTTP strips HEAD bodies, so the JSON
    // `detail` the 404s carry is unreadable there. An axios caller (/info, polled by
    // the route) does have it — and even then it cannot say WHICH route produced it:
    // /info's video-missing detail is byte-identical to _resolve_video_file's.
    expect(classifyStatus({ status: 404, detail: 'Video file not found on disk' })).toEqual({
      kind: 'gone',
      detail: 'Video file not found on disk',
    });
    expect(classifyStatus({ status: 404 })).toEqual({ kind: 'gone' });
  });

  it('reads Retry-After off the headers it is given', () => {
    expect(classifyStatus({ status: 503, retryAfter: '5' })).toEqual({ kind: 'retry', afterMs: 5000 });
    expect(classifyStatus({ status: 503 })).toEqual({
      kind: 'retry',
      afterMs: RETRY_AFTER_DEFAULT_MS,
    });
  });

  it('treats every 2xx as a decode verdict', () => {
    for (const status of [200, 204, 206]) {
      expect(classifyStatus({ status })).toEqual({ kind: 'decode' });
    }
  });
});
