'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

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
 * IT CLAIMS NO BACK KEY, AND THAT IS WHY IT CARRIES ITS OWN WAY OUT. Every other screen on
 * this surface installs `useBackKey`; this one must not. Reading what the remote's Back
 * actually sends is the key log's whole purpose, and a handler that navigated home would
 * take the viewer off the screen before they could read the line it had just logged. But
 * leaving Back to the browser means it walks history, and history can lead out of
 * `(bigscreen)` — which a remote cannot type its way back from. So the exit is the one the
 * profile keypad already uses for the same reason: an on-screen, focusable control, "a way
 * out that does not depend on the remote's own Back key being recognised" (`KEY_ROWS`).
 * It is FIRST in the document, because this screen mounts no focus grid — whether the set's
 * D-pad moves native focus at all is one of the things it is here to find out — so native
 * focus order is the only navigation it has, and an exit after six tiles, a key log and a
 * video is not an exit.
 *
 * IT USES NONE OF THE KEY HOOKS, AND THAT IS THE POINT. `_focus/useMediaKeys` and
 * `_focus/useRevealOnKey` exist (stage 7) and this page deliberately ignores both, as it
 * ignores `useBackKey`. Every one of them is a FILTER: they reject alt/ctrl/meta chords, bail
 * on `defaultPrevented`, and act only on keys they already recognise. Routing presses through
 * them would make this page report the recognition lists back to itself instead of reporting
 * the device — the one measurement nothing else can take. The raw `window` listeners below
 * are the instrument; the hooks are what the instrument is used to narrow. A reader who sees
 * two hooks and a page that does not import them is looking at that on purpose.
 *
 * THE LOG IS PERSISTED, BECAUSE THE LAST READING WAS LOST. `useBackKey.ts:8-11`: the key log
 * was run on the television and what it showed was never written down, so six merged stages
 * rest on exactly one device key number, recorded as an assumption. Pressing Back is itself a
 * navigation — the browser walks history, possibly out of `(bigscreen)` — so the line that
 * press logs used to be destroyed by the press that logged it. The log is now written to
 * `sessionStorage` on every line and restored on mount, which survives any same-tab
 * navigation, including one that leaves this surface and comes back.
 *
 * Both `keydown` and `keyup` are logged, labelled. A transport button that arrives only on
 * keyup previously read as "the television eats it", which is the wrong conclusion to draw
 * from a silent log, and `keyup` is also where a platform that consumes the press in its own
 * player tends to leak.
 *
 * The readings taken with this page belong in
 * `docs/superpowers/plans/2026-10-10-tv-stage7-device-readings.md`. Transcribe the raw lines
 * into it; a blank row there is a failure, not a pass.
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

/**
 * `navigator.mediaSession`, read defensively: the property is absent in jsdom and on older
 * engines, and `navigator` itself is absent while this renders on the server. A probe that
 * throws here would take the whole feature table with it (see the `probeError` catch).
 */
function mediaSession(): { setActionHandler?: unknown } | undefined {
  try {
    return (navigator as unknown as { mediaSession?: { setActionHandler?: unknown } }).mediaSession;
  } catch {
    return undefined;
  }
}

/**
 * The key log's cap, and why it is not 12.
 *
 * The sheet asks for keydown AND keyup for seven buttons (Back, OK, Play, Pause, Stop,
 * Rewind, Fast-Forward) plus the four arrows: twenty-two lines before a single auto-repeat.
 * At 12 the earliest press — usually Back, the one number this project actually needs — was
 * silently dropped off the end of the list by the ones that followed it. Bounded, still: an
 * unbounded log on a held arrow grows without limit and this surface renders every line.
 */
const KEY_LOG_MAX = 60;

/** Per-tab, so it survives the navigation a Back press causes. `bs-` prefix: house pattern. */
const KEY_LOG_STORAGE = 'bs-diag:keylog';

/**
 * sessionStorage access can throw outright on a television in a restricted mode, so a bad
 * read degrades to "no log yet" rather than taking the whole instrument down — the same
 * posture `_focus/useFocusGrid.ts:87` takes for the remembered focus position.
 */
function readKeyLog(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY_LOG_STORAGE);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((l): l is string => typeof l === 'string').slice(0, KEY_LOG_MAX)
      : [];
  } catch {
    return [];
  }
}

function writeKeyLog(lines: string[]): void {
  try {
    sessionStorage.setItem(KEY_LOG_STORAGE, JSON.stringify(lines));
  } catch {
    /* A television that refuses storage still shows the log on screen. */
  }
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
  // The log mirrored in a ref, so appending is one synchronous write of a known value
  // instead of a side effect inside a setState updater (which React may call twice) or a
  // `[keys]` effect (whose first run would write the empty initial state over a restored
  // log before the restore had committed).
  const keysRef = useRef<string[]>([]);

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
        // Where the transport buttons go if they do not arrive as key events. A television
        // may route Play/Pause/Stop to the Media Session API instead of the page, and a
        // silent key log alone cannot tell "the set eats the button" from "the set delivered
        // it somewhere this page is not listening". Read this row TOGETHER with the key log:
        // present + nothing logged means the buttons exist and are being delivered here, and
        // the shortcut is a stage-10 shell job rather than an unrecognised key code.
        // Presence only — registering a handler would claim the buttons from the platform.
        { label: 'JS: navigator.mediaSession (where media keys may go instead)', ok: mediaSession() !== undefined },
        { label: 'JS: mediaSession.setActionHandler', ok: typeof mediaSession()?.setActionHandler === 'function' },
      ]);
    } catch (err) {
      setProbeError(`Feature probing failed: ${String(err)}`);
    }
  }, []);

  const appendKeyLine = useCallback((line: string) => {
    const next = [line, ...keysRef.current].slice(0, KEY_LOG_MAX);
    keysRef.current = next;
    // Written per line, not debounced. `useFocusGrid` debounces its own sessionStorage write
    // by 200ms because a held arrow would otherwise cost synchronous work inside a frame
    // budget; this page has no frame budget to protect (no animation, no rails, no video
    // until a title is chosen) and the failure being fixed here is a LOST line. A reading
    // that arrives and is then dropped by the navigation it caused is the whole defect.
    writeKeyLog(next);
    setKeys(next);
  }, []);

  const clearKeyLog = useCallback(() => {
    keysRef.current = [];
    setKeys([]);
    writeKeyLog([]);
  }, []);

  useEffect(() => {
    // Restored in an effect rather than from a useState initialiser: this is a client
    // component that Next.js still renders on the server, where sessionStorage does not
    // exist, and a lazy initialiser would make the server and client first paints differ.
    const saved = readKeyLog();
    if (saved.length > 0) {
      keysRef.current = saved;
      setKeys(saved);
    }
  }, []);

  useEffect(() => {
    function record(phase: 'keydown' | 'keyup') {
      return (e: KeyboardEvent) => {
        // The nav hooks (useFocusGrid, useBackKey, useMediaKeys) ignore any press with
        // alt/ctrl/meta set, and act once on e.repeat, so those fields decide whether the
        // D-pad and the transport keys work at all. Printed only when set, to keep the line
        // short at ten feet: no `mods=` means none held, no `REPEAT` means a fresh press.
        // shift is shown too, though nothing rejects it.
        //
        // `t=` is `e.timeStamp` rounded — milliseconds since the page loaded. It is what
        // makes the auto-repeat RATE readable: hold an arrow and subtract two consecutive
        // values. Without it the sheet's repeat-rate row cannot be filled from this screen.
        const mods = [e.altKey && 'alt', e.ctrlKey && 'ctrl', e.metaKey && 'meta', e.shiftKey && 'shift'].filter(Boolean);
        const line =
          `[${phase}] t=${Math.round(e.timeStamp)} ` +
          `key=${JSON.stringify(e.key)} keyCode=${e.keyCode} code=${JSON.stringify(e.code || '')}` +
          (mods.length ? ` mods=${mods.join('+')}` : '') +
          (e.repeat ? ' REPEAT' : '');
        appendKeyLine(line);
      };
    }
    // Both listeners on `window`, never on the <video>: a media key the platform routes to
    // its own player never reaches an element, and the element does not exist until a title
    // is chosen — which is exactly the state the operator is told to take these readings in.
    const onDown = record('keydown');
    const onUp = record('keyup');
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [appendKeyLine]);

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
      {/* First focus stop on the page, deliberately: see the note at the top of this file. */}
      <div className="bs-controls">
        <Link href="/bigscreen" className="bs-btn bs-btn--ghost" draggable={false}>
          Back to home
        </Link>
      </div>
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
      <p>
        <strong>Take these readings before you load a title, below.</strong> The player on this
        page is a plain <code>&lt;video controls&gt;</code>, so once it exists the television’s
        own control UI may consume the arrows and the transport buttons and this log
        under-reports: a key that works would read as a key the set eats.
      </p>
      <p>
        Press Back, OK, Play, Pause, Stop, Rewind, Fast-Forward and the four arrows, then hold
        one arrow down. Every press logs a <code>[keydown]</code> line and a{' '}
        <code>[keyup]</code> line — if only one of the two appears, that is the reading, not a
        bug. <code>t=</code> is milliseconds since load, so two consecutive lines from a held
        arrow give the auto-repeat rate; <code>REPEAT</code> means <code>e.repeat</code> was
        set; <code>mods=…</code> appears if any modifier flag was, and an arrow carrying a flag
        other than shift is a D-pad that is inert on every screen.
      </p>
      <p>
        <strong>keyCode 461 for Back is an assumption, not an expectation</strong> — it comes
        from platform documentation and has never been confirmed on this set. Transcribe
        whatever the lines actually say, verbatim, into the stage-7 device-readings document.
        The log is kept in session storage, so it survives leaving this page and coming back:
        press Back, come back, and the line Back logged is still here.
      </p>
      <div className="bs-controls">
        <button className="bs-btn bs-btn--ghost" type="button" onClick={clearKeyLog}>
          Clear key log
        </button>
      </div>
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
