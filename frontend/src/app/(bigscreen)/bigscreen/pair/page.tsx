'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { devicesService, type DeviceStart } from '@/services/devices';

type Phase = 'starting' | 'ready' | 'denied' | 'unreachable';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

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

  const begin = useCallback(async () => {
    setPhase('starting');
    setQr(null);
    try {
      const s = await devicesService.start();
      setStart(s);
      setPhase('ready');
    } catch {
      setStart(null);
      setPhase('unreachable');
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
      return LOOPBACK.has(u.hostname) ? `${window.location.origin}${u.pathname}` : u.toString();
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
      try {
        status = await devicesService.poll(start.device_code);
      } catch {
        // A blip while polling is not a reason to strand the screen; try again.
      }
      if (cancelled) return;
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
    if (!start || !linkUrl) return;
    let cancelled = false;
    import('qrcode')
      .then((QR) => QR.toDataURL(`${linkUrl}?code=${start.user_code}`, { margin: 1, width: 360 }))
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
