'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { devicesService, type DeviceStart } from '@/services/devices';

type Phase = 'starting' | 'ready' | 'denied' | 'unreachable';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const MAX_POLL_FAILURES = 3;
const MAX_BACKOFF_MS = 30_000;

/**
 * /bigscreen/pair — the television's side of device pairing.
 *
 * Starts a pairing, shows the code, and polls until a signed-in phone approves it at
 * /link. This page must never depend on api-client's 401 interceptor to recover: that
 * interceptor deliberately leaves /bigscreen/pair alone.
 */
export default function PairPage() {
  const [phase, setPhase] = useState<Phase>('starting');
  const [start, setStart] = useState<DeviceStart | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const inFlight = useRef(false);
  const failures = useRef(0);

  const begin = useCallback(async () => {
    // A double-press (or StrictMode's double mount) must not mint two pairings and
    // orphan one server-side.
    if (inFlight.current) return;
    inFlight.current = true;
    failures.current = 0;
    setPhase('starting');
    // Drop the old code at once: showing one nobody can use is what a restart is for.
    setStart(null);
    try {
      const s = await devicesService.start();
      setStart(s);
      setPhase('ready');
    } catch {
      setPhase('unreachable');
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void begin();
  }, [begin]);

  const linkUrl = useMemo(() => {
    if (!start) return '';
    try {
      const u = new URL(start.verification_uri, window.location.origin);
      // app_public_url is at its localhost default, which no phone on the network can
      // reach; the origin this television actually loaded from is one that works.
      return LOOPBACK.has(u.hostname)
        ? new URL(u.pathname + u.search + u.hash, window.location.origin).toString()
        : u.toString();
    } catch {
      return `${window.location.origin}/link`;
    }
  }, [start]);

  // Poll with a timeout chained off each response, so a slow reply cannot stack requests.
  useEffect(() => {
    if (!start || phase !== 'ready') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delay = Math.max(1, start.interval) * 1000;

    const tick = async () => {
      let status: string | null = null;
      let threw = false;
      try {
        status = await devicesService.poll(start.device_code);
        failures.current = 0;
      } catch {
        threw = true;
        failures.current += 1;
      }
      if (cancelled) return;
      if (threw) {
        // A blip is retried with backoff; a run of them is a server we cannot reach,
        // and the unreachable screen has the Try again control.
        if (failures.current >= MAX_POLL_FAILURES) {
          setPhase('unreachable');
          return;
        }
        timer = setTimeout(tick, Math.min(delay * 2 ** failures.current, MAX_BACKOFF_MS));
        return;
      }
      if (status === 'approved') {
        // The cookie is already set; a hard navigation is needed because
        // SessionProvider boots once per document.
        window.location.replace('/bigscreen');
        return;
      }
      if (status === 'expired') {
        void begin();
        return;
      }
      if (status === 'denied') {
        setPhase('denied');
        return;
      }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [start, phase, begin]);

  // Lazily imported so the QR is code-split and its absence degrades to the text
  // already on screen rather than breaking the screen. Encodes the user_code only,
  // never the device_code.
  useEffect(() => {
    // Cleared here, not in begin(), so a stale in-flight render cannot land beside a new code.
    setQr(null);
    if (!start || !linkUrl) return;
    let cancelled = false;
    const target = new URL(linkUrl);
    target.searchParams.set('code', start.user_code);
    import('qrcode')
      .then((QR) => {
        const mod = QR as unknown as { default?: typeof QR };
        // 328 = the 360px box minus its 16px padding, so the image is not resampled.
        return (mod.default ?? QR).toDataURL(target.toString(), { margin: 1, width: 328 });
      })
      .then((url) => { if (!cancelled) setQr(url); })
      .catch(() => { /* text URL is the fallback and is already on screen */ });
    return () => { cancelled = true; };
  }, [start, linkUrl]);

  if (phase === 'unreachable') {
    return (
      <main className="bs-page bs-pair">
        <h1>Can&apos;t reach Freeflix</h1>
        <p className="bs-pair-url">Tried {typeof window !== 'undefined' ? window.location.origin : ''}</p>
        <div className="bs-controls">
          <button className="bs-btn" autoFocus onClick={() => void begin()}>Try again</button>
        </div>
      </main>
    );
  }

  if (phase === 'denied') {
    return (
      <main className="bs-page bs-pair">
        <h1>Sign-in was declined</h1>
        <p>The request was denied on your phone.</p>
        <div className="bs-controls">
          <button className="bs-btn" autoFocus onClick={() => void begin()}>Try again</button>
        </div>
      </main>
    );
  }

  if (!start) {
    return (
      <main className="bs-page bs-pair">
        <h1>Sign in to Freeflix</h1>
        <p>Getting a code…</p>
      </main>
    );
  }

  return (
    <main className="bs-page bs-pair">
      <h1>Sign in to Freeflix</h1>
      <div className="bs-pair-row">
        <div>
          <p>On your phone, open</p>
          <p className="bs-pair-url">{linkUrl}</p>
          <p>and enter this code</p>
          <div className="bs-code">{start.user_code}</div>
        </div>
        {qr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bs-qr" src={qr} alt="QR code for the sign-in page" />
        )}
      </div>
    </main>
  );
}
