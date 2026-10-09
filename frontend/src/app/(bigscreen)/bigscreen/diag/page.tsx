'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * /bigscreen/diag — the stage-3 gate, and afterwards a permanent field tool.
 *
 * It lives on /diag, NOT on /bigscreen, for two reasons. Spec §5.1 assigns
 * /bigscreen to the TV home screen, so leaving the instrument there would mean
 * stage 4 deletes it; and on a television you cannot open devtools without
 * Developer Mode, so this page is the only way to read the engine version, the
 * feature probes, the remote's key codes and an HTTP status off the device.
 *
 * Reports the web-engine version (the single fact that decides the CSS target —
 * Settings > Support shows firmware only, never the engine), probes the CSS and JS
 * features the design depends on, renders the FRE tokens at TV sizes so we can see
 * whether the hand-written stylesheet actually works, logs remote key codes, plays
 * a real library file through a plain <video>, and reads back the raw HTTP status
 * of a far-seek Range request (MediaError.code alone cannot tell a 503 from
 * anything else).
 *
 * Runs unauthenticated, so browse it with AUTH_ENABLED=false set temporarily on the
 * backend (revert immediately afterwards).
 *
 * @allow-legacy-probes — this file names expensive and post-Chromium-87 CSS and JS
 * features on
 * purpose, to probe for them. legacy-target.test.ts skips any file with this marker;
 * no other file on the TV surface may carry it.
 */

type Probe = { label: string; ok: boolean };
type TorrentRow = { torrent_id?: string; id?: string; movie_title?: string; name?: string };

function chromeMajor(ua: string): number | null {
  const m = /Chrome\/(\d+)/.exec(ua);
  return m ? parseInt(m[1], 10) : null;
}

const TOKENS: Array<[string, string]> = [
  ['--ink', 'ink'],
  ['--surface', 'surface'],
  ['--surface-2', 'surface-2'],
  ['--text', 'text'],
  ['--muted', 'muted'],
  ['--hairline', 'hairline'],
  ['--gold', 'gold'],
  ['--gold-lite', 'gold-lite'],
  ['--danger', 'danger'],
  ['--success', 'success'],
];

export default function BigScreenDiagnostics() {
  const [ua, setUa] = useState('');
  const [facts, setFacts] = useState<Array<[string, string]>>([]);
  const [probes, setProbes] = useState<Probe[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [torrents, setTorrents] = useState<TorrentRow[]>([]);
  const [listError, setListError] = useState('');
  const [videoSrc, setVideoSrc] = useState('');
  const [videoState, setVideoState] = useState('idle');
  const [rangeProbe, setRangeProbe] = useState('');
  const [probeError, setProbeError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tilesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // This page's whole purpose is to survive an engine nobody has tested it on, so a
    // probe throwing here must degrade to a visible, readable error — never to a blank
    // section (see the same failure mode fixed for the torrent list below).
    try {
      setUa(navigator.userAgent);
      setFacts([
        ['innerWidth x innerHeight', `${window.innerWidth} x ${window.innerHeight}`],
        ['screen.width x height', `${window.screen.width} x ${window.screen.height}`],
        ['devicePixelRatio', String(window.devicePixelRatio)],
        ['language', navigator.language],
        ['MediaSource present', String(typeof window.MediaSource !== 'undefined')],
      ]);

      const s = (prop: string, value: string) =>
        typeof CSS !== 'undefined' && CSS.supports ? CSS.supports(prop, value) : false;

      setProbes([
        { label: 'CSS custom properties', ok: s('color', 'var(--x)') },
        { label: 'CSS grid', ok: s('display', 'grid') },
        { label: 'position: sticky', ok: s('position', 'sticky') },
        { label: 'object-fit', ok: s('object-fit', 'contain') },
        { label: 'oklch() — Tailwind v4 needs this', ok: s('color', 'oklch(50% 0.1 200)') },
        { label: 'color-mix() — Tailwind v4 needs this', ok: s('color', 'color-mix(in srgb, red, blue)') },
        { label: ':has()', ok: typeof CSS !== 'undefined' && CSS.supports ? CSS.supports('selector(:has(*))') : false },
        { label: 'container queries', ok: s('container-type', 'inline-size') },
        { label: 'aspect-ratio', ok: s('aspect-ratio', '16 / 9') },
        { label: 'backdrop-filter', ok: s('backdrop-filter', 'blur(4px)') },
        { label: 'CSS.registerProperty (@property)', ok: typeof (CSS as unknown as { registerProperty?: unknown }).registerProperty !== 'undefined' },
        { label: 'JS: Array.prototype.at', ok: typeof (Array.prototype as unknown as { at?: unknown }).at === 'function' },
        { label: 'JS: Object.hasOwn', ok: typeof (Object as unknown as { hasOwn?: unknown }).hasOwn === 'function' },
        { label: 'JS: structuredClone', ok: typeof (window as unknown as { structuredClone?: unknown }).structuredClone === 'function' },
      ]);
    } catch (err) {
      setProbeError(`Feature probing failed: ${String(err)}`);
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // The nav hooks (useFocusGrid, useBackKey) ignore any press with alt/ctrl/meta set, and
      // useBackKey acts once on e.repeat, so those fields decide whether the D-pad works at
      // all. Printed only when set, to keep the line short at ten feet: no `mods=` means
      // none held, no `REPEAT` means a fresh press. shift is shown too, though nothing
      // rejects it.
      const mods = [e.altKey && 'alt', e.ctrlKey && 'ctrl', e.metaKey && 'meta', e.shiftKey && 'shift'].filter(Boolean);
      const line =
        `key=${JSON.stringify(e.key)} keyCode=${e.keyCode} code=${e.code || '-'}` +
        (mods.length ? ` mods=${mods.join('+')}` : '') +
        (e.repeat ? ' REPEAT' : '');
      setKeys((prev) => [line, ...prev].slice(0, 12));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    // preventScroll: focusing the first tile must not scroll the verdict banner (the
    // single most important readout on this page) out of view on load.
    const first = tilesRef.current?.querySelector('button');
    if (first instanceof HTMLElement) first.focus({ preventScroll: true });
  }, []);

  // Roving focus across the demo tiles, so the real remote's D-pad can be verified.
  const onTilesKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const buttons = Array.from(tilesRef.current?.querySelectorAll('button') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i === -1) return;
    const next = e.key === 'ArrowRight' ? i + 1 : i - 1;
    const target = buttons[next];
    if (target) {
      e.preventDefault();
      target.focus();
      target.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, []);

  const loadTorrents = useCallback(async () => {
    setListError('');
    try {
      const res = await fetch('/api/v1/torrents/list');
      if (!res.ok) {
        setListError(`GET /api/v1/torrents/list -> ${res.status}. Set AUTH_ENABLED=false on the backend for this test.`);
        return;
      }
      const body = await res.json();
      setTorrents(Array.isArray(body) ? body : (Array.isArray(body?.torrents) ? body.torrents : []));
    } catch (err) {
      setListError(`fetch failed: ${String(err)}`);
    }
  }, []);

  const play = useCallback((row: TorrentRow) => {
    const id = row.torrent_id ?? row.id;
    if (!id) return;
    setVideoSrc(`/api/v1/streaming/${id}/video`);
    setVideoState('loading');
  }, []);

  const seek = useCallback((delta: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, v.currentTime + delta);
  }, []);

  const seekFraction = useCallback((f: number) => {
    const v = videoRef.current;
    if (v && Number.isFinite(v.duration)) v.currentTime = v.duration * f;
  }, []);

  // A far seek into a not-yet-downloaded region is now answered 503 + Retry-After
  // rather than a held-open 206 that truncates. <video> reports that as
  // MediaError.code 2 or 4, identical to a dozen unrelated failures, so the gate
  // cannot be answered by watching the element. This reads the status directly.
  const probeFarRange = useCallback(async () => {
    if (!videoSrc) {
      setRangeProbe('Start a title first — the probe needs a stream URL.');
      return;
    }
    setRangeProbe('probing…');
    try {
      // HEAD gives the full-file length without touching the torrent, which also
      // exercises the new metadata-only HEAD route.
      const head = await fetch(videoSrc, { method: 'HEAD' });
      const len = head.headers.get('Content-Length');
      const size = head.ok && len ? parseInt(len, 10) : 0;
      // 90% in is past anything a sequential download has reached.
      const from = size > 0 ? Math.floor(size * 0.9) : 1024 * 1024 * 1024;
      const res = await fetch(videoSrc, { headers: { Range: 'bytes=' + from + '-' } });
      const retryAfter = res.headers.get('Retry-After');
      const contentRange = res.headers.get('Content-Range');
      setRangeProbe(
        'HEAD -> ' + head.status + ', Content-Length=' + (len || '(absent)') + '\n' +
        'GET Range: bytes=' + from + '- -> ' + res.status + ' ' + res.statusText + '\n' +
        'Retry-After=' + (retryAfter === null ? '(absent)' : retryAfter) + '\n' +
        'Content-Range=' + (contentRange === null ? '(absent)' : contentRange) + '\n' +
        (res.status === 503
          ? 'VERDICT: the new 503 path fired. A TV client must retry after Retry-After.'
          : res.status === 206
            ? 'VERDICT: the range was already available — seek further, or pick a title earlier in its download.'
            : 'VERDICT: unexpected status; record it in the gate notes.')
      );
      // Never drain the body: on a 206 it is the rest of the film.
      if (res.body && typeof res.body.cancel === 'function') res.body.cancel();
    } catch (err) {
      setRangeProbe('probe failed: ' + String(err));
    }
  }, [videoSrc]);

  const major = chromeMajor(ua);
  const verdictClass =
    major === null ? 'bs-verdict bs-verdict--unknown'
      : major >= 111 ? 'bs-verdict bs-verdict--modern'
        : 'bs-verdict bs-verdict--legacy';

  return (
    <div className="bs-page">
      <h1>Freeflix — big-screen diagnostics</h1>

      <div className={verdictClass}>
        <strong>
          {major === null
            ? 'Engine version not detected'
            : major >= 111
              ? `Chromium ${major} — modern target`
              : `Chromium ${major} — legacy target`}
        </strong>
        {major !== null && major >= 111
          ? 'At or above Tailwind v4’s Chrome 111 floor. The existing web stylesheet would render here.'
          : 'Below Tailwind v4’s Chrome 111 floor. The TV surface needs this hand-written stylesheet.'}
        <div style={{ marginTop: 12, color: 'var(--muted)', fontSize: 20, wordBreak: 'break-all' }}>{ua}</div>
      </div>

      <h2>Device</h2>
      <table className="bs-facts">
        <tbody>
          {facts.map(([k, v]) => (
            <tr key={k}><th>{k}</th><td>{v}</td></tr>
          ))}
        </tbody>
      </table>

      <h2>Feature probes</h2>
      {probeError ? <p className="bs-no">{probeError}</p> : null}
      <table className="bs-facts">
        <tbody>
          {probes.map((p) => (
            <tr key={p.label}>
              <th>{p.label}</th>
              <td className={p.ok ? 'bs-yes' : 'bs-no'}>{p.ok ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Tokens</h2>
      <p>Every swatch must show a distinct colour, and both type families must differ.</p>
      <div className="bs-swatches">
        {TOKENS.map(([varName, label]) => (
          <div className="bs-swatch" key={varName}>
            <span style={{ background: `var(${varName})`, border: '1px solid var(--hairline)' }} />
            {label}
          </div>
        ))}
      </div>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 40 }}>Display face — 40px</p>
      <p style={{ fontFamily: 'var(--font-ui)', fontSize: 24 }}>UI face — 24px body floor</p>

      <h2>Focus & D-pad</h2>
      <p>Left/Right should move the gold ring. If it does not, spatial navigation needs the library.</p>
      <div className="bs-tiles" ref={tilesRef} onKeyDown={onTilesKeyDown}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button className="bs-tile" key={n} type="button">Tile {n}</button>
        ))}
      </div>

      <h2>Remote key codes</h2>
      <p>Press Back, Play, Pause, Rewind, Fast-Forward and the arrows. Back should report keyCode 461. A line also shows <code>mods=…</code> if any modifier flag is set and <code>REPEAT</code> if the press is an auto-repeat; if the arrows show a mods flag other than shift, the D-pad is inert on every screen.</p>
      <div className="bs-keylog">
        {keys.length === 0 ? <div style={{ color: 'var(--muted)' }}>waiting for a key…</div>
          : keys.map((k, i) => <div key={`${k}-${i}`}>{k}</div>)}
      </div>

      <h2>Playback</h2>
      <div className="bs-controls">
        <button className="bs-btn" type="button" onClick={loadTorrents}>List torrents</button>
        <button className="bs-btn bs-btn--ghost" type="button" onClick={() => seek(-10)}>-10s</button>
        <button className="bs-btn bs-btn--ghost" type="button" onClick={() => seek(60)}>+60s</button>
        <button className="bs-btn bs-btn--ghost" type="button" onClick={() => seekFraction(0.9)}>Seek to 90%</button>
        <button className="bs-btn bs-btn--ghost" type="button" onClick={probeFarRange}>Probe far seek (HTTP)</button>
      </div>
      {rangeProbe ? <pre className="bs-probe">{rangeProbe}</pre> : null}
      {listError ? <p className="bs-no">{listError}</p> : null}
      <div className="bs-controls">
        {torrents.map((t, i) => (
          <button className="bs-btn bs-btn--ghost" type="button" key={t.torrent_id ?? t.id ?? i}
                  onClick={() => play(t)}>
            {t.movie_title ?? t.name ?? t.torrent_id ?? t.id}
          </button>
        ))}
      </div>
      {videoSrc ? (
        <>
          <video
            className="bs-video"
            ref={videoRef}
            src={videoSrc}
            preload="metadata"
            controls
            onLoadedMetadata={() => {
              const v = videoRef.current;
              setVideoState(v ? `metadata: ${v.videoWidth}x${v.videoHeight}, duration ${Math.round(v.duration)}s` : 'metadata');
            }}
            onPlaying={() => setVideoState('playing')}
            onWaiting={() => setVideoState('waiting (buffering)')}
            onError={() => {
              const code = videoRef.current?.error?.code;
              setVideoState(`ERROR MediaError.code=${code ?? 'unknown'}`);
            }}
          />
          <p><code>{videoState}</code></p>
          <p style={{ color: 'var(--muted)', fontSize: 20, wordBreak: 'break-all' }}>{videoSrc}</p>
        </>
      ) : null}
    </div>
  );
}
