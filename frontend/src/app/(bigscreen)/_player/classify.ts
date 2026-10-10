/**
 * Why a <video> stopped, decided from the HTTP status and nothing else.
 *
 * `dependencies/auth.py:143-156` already ASSERTS this module exists — "the player's
 * error handler checks the status explicitly and routes to sign-in" — and it did not:
 * `grep -rn 401 frontend/src/components/player/` is empty, so a 401 mid-film has
 * always reached the decoder as corrupt media and been retried as a network fault.
 * The statuses below are read off `backend/tests/test_stream_status_matrix.py`, which
 * is the proved contract rather than a reading of the endpoint.
 *
 * HEAD ONLY, AND THAT IS LOAD-BEARING. Every `GET /video` runs
 * `prioritize_video_files` + `force_start_for_stream` (a DB write) and then
 * `_prioritize_window`/`_deadline_pieces` across 32 pieces at the FILE HEAD,
 * re-deadlining every 250ms — unconditionally, even on a complete torrent. A
 * `Range: bytes=0-0` "cheap probe" therefore hijacks libtorrent's deadline queue away
 * from the live playhead, and even a far seek the player refuses leaves an island of
 * prioritised pieces where it gave up. `head_video` touches only
 * `os.path.getsize` and is registered above GET for exactly this reason. The method
 * and the absence of a `Range` header are pinned STRUCTURALLY in the suite, because
 * no behavioural assertion can observe a database write.
 *
 * THE LIMITATION, WRITTEN DOWN: **HEAD STRUCTURALLY CANNOT OBSERVE THE FAR-SEEK
 * 503.** `head_video` answers 200 with the `Content-Length` from metadata whatever is
 * actually on disk — the matrix pins 200 at ZERO bytes downloaded, against a GET that
 * 503s on the same torrent — and nothing on its path can emit a 503 at all. So the
 * far-seek 503 reaches this player exactly two ways, neither of them a probe:
 *   1. PREVENTED, by task 6's seek clamp, which is the design; or
 *   2. INFERRED, when the recovery ladder exhausts while HEAD still says 200 — which
 *      is the `decode` verdict. On this panel that verdict is honest rather than a
 *      guess dressed up: HEVC and DTS at 1080p are both unverified here (hazard 13),
 *      so "the file is there and this set cannot play it" is a truthful thing to say.
 * A classifier documented to do something it structurally cannot is the test-shaped
 * lie this project tracks; this paragraph is the alternative.
 *
 * PLAIN `fetch`, NEVER `apiClient`. The client's rejection interceptor hard-navigates
 * to `/bigscreen/pair` on a 401 from inside the handler, before any caller sees the
 * error (hazard 7, with a module-scoped `redirecting` flag that is never reset), so a
 * player probing through it would be taken out from under itself. The request is
 * same-origin through the Next rewrite, so `credentials: 'same-origin'` carries
 * `ff_session`, and `cache: 'no-store'` keeps a cached 200 — the one answer that must
 * never be believed — out of the verdict.
 *
 * ALWAYS AN AbortController WITH AN EXPLICIT TIMEOUT. Neither `fetch` nor `apiClient`
 * sets one, so a probe against a wedged backend hangs for as long as the socket does,
 * and the next failure starts another one on top of it.
 *
 * NOT `statusOf` (`_data/httpStatus.ts`). That reads an AXIOS REJECTION
 * (`err.response.status`), and `fetch` does not throw on a 401 — it answers
 * `undefined` for a `Response`, which would collapse every row here to `unknown`
 * silently. Two mechanisms, deliberately not merged; `statusOf` stays correct for the
 * screen's axios calls.
 */

/** How long a probe may take before it is abandoned. */
export const PROBE_TIMEOUT_MS = 8000;

/**
 * `Retry-After` bounds. The default is what the backend itself sends on all three
 * 503s ("2"), so an unparseable header lands on the value the server would have sent
 * anyway. The floor exists because `setTimeout(fn, 0)` on a `Retry-After: 0` is a spin
 * loop; the cap because the ladder is bounded at four attempts and a viewer watching
 * a spinner will not wait out an absurd header.
 */
export const RETRY_AFTER_DEFAULT_MS = 2000;
export const RETRY_AFTER_MIN_MS = 1000;
export const RETRY_AFTER_MAX_MS = 30000;

export type StreamFailure =
  /** 401: the session is gone. The only verdict that must not be retried silently. */
  | { kind: 'session' }
  /** 503: come back, bounded — one of the three 503 paths is permanent. */
  | { kind: 'retry'; afterMs: number }
  /**
   * 404: terminal. `detail` is present only when the caller had a readable body (an
   * axios call); it can never come from the HEAD probe, and it cannot identify the
   * route — `/info`'s video-missing detail is byte-identical to
   * `_resolve_video_file`'s, so "deleted" and "not yet ready" share one string.
   */
  | { kind: 'gone'; detail?: string }
  /** 422 / 416: we asked for something that is not a thing. A client-side defect. */
  | { kind: 'badRequest' }
  /** 2xx: the bytes are there and the element still failed. */
  | { kind: 'decode' }
  /** Anything else, including a probe that never got an answer (`status: null`). */
  | { kind: 'unknown'; status: number | null };

/**
 * Seconds -> ms, with a floor, a cap and a default. NEVER `NaN`: this value is fed to
 * a `setTimeout`, and `setTimeout(fn, NaN)` fires immediately, which would turn a
 * bounded ladder into four instant retries against a backend that just asked for two
 * seconds. The HTTP-date form of `Retry-After` is legal and takes the default.
 */
export function parseRetryAfterMs(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return RETRY_AFTER_DEFAULT_MS;
  const seconds = Number(raw.trim());
  if (raw.trim() === '' || !Number.isFinite(seconds)) return RETRY_AFTER_DEFAULT_MS;
  const ms = Math.round(seconds * 1000);
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, ms));
}

/**
 * The verdict for a status that is already in hand — the pure core, so the route's
 * axios callers (which DO have a readable `detail`) share one switch with the probe.
 */
export function classifyStatus({
  status,
  retryAfter,
  detail,
}: {
  status: number;
  retryAfter?: string | null;
  detail?: string;
}): StreamFailure {
  if (status === 401) return { kind: 'session' };
  if (status === 503) return { kind: 'retry', afterMs: parseRetryAfterMs(retryAfter) };
  if (status === 404) return detail === undefined ? { kind: 'gone' } : { kind: 'gone', detail };
  if (status === 422 || status === 416) return { kind: 'badRequest' };
  if (status >= 200 && status < 300) return { kind: 'decode' };
  return { kind: 'unknown', status };
}

export interface ClassifyOptions {
  /** The exact stream URL the element was given, `file_index` included. */
  src: string;
  /** Injectable for tests; the global `fetch` otherwise. */
  fetchImpl?: typeof fetch;
  /** The caller's cancellation (an unmount, a title change). */
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Probe the stream URL with a HEAD and say why playback failed.
 *
 * A probe that is aborted, times out, or never reaches the server answers
 * `{ kind: 'unknown', status: null }` — not `retry`: a bounded ladder is the caller's
 * decision to make, and an unreachable backend is not the same claim as a 503.
 */
export async function classifyStreamFailure({
  src,
  fetchImpl,
  signal,
  timeoutMs = PROBE_TIMEOUT_MS,
}: ClassifyOptions): Promise<StreamFailure> {
  if (signal?.aborted) return { kind: 'unknown', status: null };

  const doFetch = fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const relay = () => controller.abort();
  signal?.addEventListener('abort', relay, { once: true });

  try {
    const res = await doFetch(src, {
      method: 'HEAD',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    // No body is read, and not only because a HEAD has none: reading one would mean a
    // GET, and a GET is the deadline-queue hijack this whole module avoids.
    return classifyStatus({ status: res.status, retryAfter: res.headers.get('Retry-After') });
  } catch {
    return { kind: 'unknown', status: null };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}
