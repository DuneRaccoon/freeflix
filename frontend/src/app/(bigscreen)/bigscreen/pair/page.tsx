'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { devicesService, type DeviceStart } from '@/services/devices';
import { useFocusGrid } from '../../_focus/useFocusGrid';
import { useBackKey } from '../../_focus/useBackKey';

type Phase = 'starting' | 'ready' | 'denied' | 'unreachable';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const MAX_POLL_FAILURES = 3;
const MAX_BACKOFF_MS = 30_000;
// A pairing that keeps coming back expired is a clock or TTL problem, not a slow phone.
// start is one global rate bucket for the whole household, so restarts back off and stop.
const MIN_RESTART_MS = 2_000;
const MAX_EXPIRED_RESTARTS = 5;

/** The single waiting-state control; see PairPage. */
function NewCodeControl({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  // Own grid, mounted only while waiting: the failure states use autoFocus buttons, and a
  // second live grid would be inert (see useFocusGrid OWNERSHIP).
  const grid = useFocusGrid({ rowCounts: [1] });
  return (
    <div className="bs-controls">
      {/* The label follows the request, because `begin()` refuses a second call while one is
          in flight. A button reading "Get a new code" that does nothing is a lie on screen;
          one reading "Getting a code…" is the truth, and the press is correctly a no-op
          because that is already what it is doing. Same shape as home's retry. */}
      <button type="button" className="bs-btn bs-btn--ghost" {...grid.focusProps(0, 0)} onClick={onPress}>
        {busy ? 'Getting a code…' : 'Get a new code'}
      </button>
    </div>
  );
}

/**
 * /bigscreen/pair — the television's side of device pairing.
 *
 * Starts a pairing, shows the code, and polls until a signed-in phone approves it at
 * /link. This page must never depend on api-client's 401 interceptor to recover: that
 * interceptor deliberately leaves /bigscreen/pair alone.
 *
 * A REMOTE NEEDS SOMETHING FOCUSED. Every state has a focus target: the two failure states
 * their "Try again", and the two waiting states (getting a code, showing it) a "Get a new
 * code" control. It is the one thing a stuck viewer actually wants: the code that is
 * on screen is one they cannot read, scan or type, or it is about to lapse. There is no
 * useful "home" to offer while unpaired (home 401s and bounces straight back here), so a
 * navigation link would be a trap. The control sits in ONE place in the tree across the
 * waiting states, so pressing it (which blanks the code) does not unmount the focused
 * element and drop focus to <body>.
 *
 * BACK is claimed and does nothing. Left unclaimed, the set's native Back walks history to
 * home, which 401s and `location.replace`s back here: the viewer sees a flash, and a fresh
 * pairing is minted and the old one orphaned out of a household-wide rate bucket. There is
 * nowhere to go back to, so the honest response is to stay put.
 */
export default function PairPage() {
  const [phase, setPhase] = useState<Phase>('starting');
  const [start, setStart] = useState<DeviceStart | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const inFlight = useRef(false);
  // A rendered mirror of `inFlight`, purely so the control's label can tell the truth:
  // a ref cannot drive a render, and `!start` is also true during an expiry restart's
  // backoff wait, when a press DOES do something.
  const [requesting, setRequesting] = useState(false);
  const failures = useRef(0);
  const expiredRuns = useRef(0);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // `isRestart` is true only for the automatic expiry restart, which must keep counting.
  const begin = useCallback(async (isRestart = false) => {
    // A double-press (or StrictMode's double mount) must not mint two pairings and
    // orphan one server-side.
    if (inFlight.current) return;
    inFlight.current = true;
    setRequesting(true);
    failures.current = 0;
    if (!isRestart) expiredRuns.current = 0;
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
      setRequesting(false);
    }
  }, []);

  // Pressing it during an expiry restart's wait must not leave that timer to mint a second one.
  const newCode = useCallback(() => {
    if (restartTimer.current) clearTimeout(restartTimer.current);
    void begin();
  }, [begin]);

  // Claimed and deliberately inert, for the same reason as home (see its `stayOnHome`):
  // handed to the browser it walks history to home, which 401s and bounces straight back
  // here — minting a fresh pairing and orphaning the old one out of the household-wide
  // rate bucket. STAGE 10 OWES THIS A REAL ANSWER: inside the webOS shell, Back on the
  // first screen is how a viewer expects to leave, and only the shell can exit cleanly.
  useBackKey(() => {});

  useEffect(() => {
    void begin();
    return () => {
      if (restartTimer.current) clearTimeout(restartTimer.current);
    };
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
      } catch {
        threw = true;
      }
      if (cancelled) return;
      // After the cancelled check, so a stale poll cannot touch the shared counter.
      failures.current = threw ? failures.current + 1 : 0;
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
      if (status !== 'expired') expiredRuns.current = 0;
      if (status === 'approved') {
        // The cookie is already set; a hard navigation is needed because
        // SessionProvider boots once per document.
        window.location.replace('/bigscreen');
        return;
      }
      if (status === 'expired') {
        expiredRuns.current += 1;
        if (expiredRuns.current >= MAX_EXPIRED_RESTARTS) {
          setPhase('unreachable');
          return;
        }
        // Drop the dead code now; the next one starts after a growing minimum delay.
        setPhase('starting');
        setStart(null);
        restartTimer.current = setTimeout(
          () => void begin(true),
          Math.min(MIN_RESTART_MS * 2 ** (expiredRuns.current - 1), MAX_BACKOFF_MS),
        );
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
        <h1>That account can no longer sign in</h1>
        <p>It may have been suspended or removed. Try again with a different account.</p>
        <div className="bs-controls">
          <button className="bs-btn" autoFocus onClick={() => void begin()}>Try again</button>
        </div>
      </main>
    );
  }

  return (
    <main className="bs-page bs-pair">
      <h1>Sign in to Freeflix</h1>
      {start ? (
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
      ) : (
        // While the request is out, the button below carries that message and holds the
        // focus ring, so saying it twice is just noise. The other way to be here is an
        // expiry restart's backoff wait, where a press skips the wait.
        !requesting && <p>A new code is on its way…</p>
      )}
      <NewCodeControl onPress={newCode} busy={requesting} />
    </main>
  );
}
