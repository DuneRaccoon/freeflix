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

/**
 * STAGE 8 — THE CODEC INSTRUMENT. Four clips, one variable each, and the one state this
 * television will actually be in.
 *
 * The clips live in `frontend/public/samples/` and are served by **Next.js static** at
 * `http://<host>:3001/samples/…`: no torrent, no backend, no auth gate, and no ARM download
 * cap. That is the whole reason they are clips rather than releases — every other playback
 * path on this surface runs through libtorrent and FastAPI, so a failure there has four
 * candidate causes before the decoder is even reached.
 *
 * **The clips are gitignored and they are not in this repo.** Binaries do not belong here and
 * none of the four could be produced from the machine that wrote this code, so
 * `docs/superpowers/plans/2026-10-11-tv-stage8-device-readings.md` carries the exact ffmpeg
 * command line per clip (each labelled written-down-but-never-run) and this section renders
 * **"FILE NOT PRESENT"** as a first-class state. That distinction is the point of the HEAD
 * probe: a 404 and a codec the set cannot decode both end with **no picture**, and
 * `MediaError.code` cannot tell them apart. Without the probe, "stage 8's profile is wrong"
 * and "nobody copied the files over" are the same reading.
 *
 * **Every cell is a raw string.** `MediaError.code`, `videoWidth x videoHeight`, `duration`
 * and `readyState` are printed verbatim — never "ok", "works" or "as expected", which is the
 * summary that cost this project the stage-3 key log.
 *
 * **The audio answer is the operator's, because no code can read it.** A DTS track this set
 * cannot decode plays a **silent picture** and raises no error at all, so a code-only readout
 * would log reading 18 as a pass over a silent film. Hence a yes/no the operator supplies by
 * hand, stored in the same record as the machine-read fields. It is buttons rather than a text
 * field for the reason the profile keypad exists: a remote cannot type.
 *
 * `canPlayType` is **advisory and gates nothing** — it is printed, and the clip mounts
 * whatever it says. Spec §7.2 is right that TV implementations under-report, so a `""` from
 * this row must never be allowed to stand in for a reading off the panel.
 *
 * Readings persist to `sessionStorage` under the house `bs-diag:` prefix, every access in
 * try/catch, for exactly the reason the key log does: stage 3 ran its instrument on this
 * television and wrote none of it down.
 */
const CODEC_STORAGE = 'bs-diag:codec';

const SAMPLES_BASE = '/samples/';

type Clip = { id: string; file: string; label: string; mime: string; note: string };

/**
 * One variable each, and clip 4 is the control.
 *
 * ONE VARIABLE MEANS ONE: clips 1 and 2 carry the control's E-AC3 track, not AC3, so the
 * only thing that changes between clip 4 and them is libx264 -> libx265. They were first
 * written with `-c:a ac3` against the control's `-c:a eac3`, which is two codec variables --
 * and plain AC3 is itself unmeasured on this panel, so a red clip 1 could have been an HEVC
 * verdict or an AC3 verdict and reading 16 would have been unattributable. Caught by the
 * whole-branch review before any reading was taken.
 *
 * Clip 4 reproduces the only AV combination this project has ever measured (the 2026-10-07
 * sitting: a 1080p H.264 MKV with a DDP5.1 / E-AC3 track, streamed off a ~26%-complete
 * torrent). So a red row *there* means the instrument, the mux or the file is wrong — not the
 * panel. Without it a failure on clips 1-3 is unattributable.
 *
 * `.mkv` throughout, deliberately: §3.2 lists Matroska as a supported container and the one
 * measured run was an MKV, so the container is held constant with the measured case rather
 * than introduced as a second variable.
 */
const CLIPS: Clip[] = [
  {
    id: 'c1',
    file: 'clip1-1080p-hevc-main8-eac3.mkv',
    label: 'Clip 1 — 1080p HEVC Main 8-bit + E-AC3',
    mime: 'video/x-matroska; codecs="hvc1.1.6.L120.B0,ec-3"',
    note: 'Reading 16 — gates R9 and the 4K opt-in. HEVC decode is accepted on documentation alone. E-AC3, not AC3, so the ONLY variable against clip 4 is the video codec.',
  },
  {
    id: 'c2',
    file: 'clip2-1080p-hevc-main10-eac3.mkv',
    label: 'Clip 2 — 1080p HEVC Main10 + E-AC3',
    mime: 'video/x-matroska; codecs="hvc1.2.4.L120.B0,ec-3"',
    note: 'Reading 17 — R9 names Main and Main10 in one breath; they are different decoder profiles.',
  },
  {
    id: 'c3',
    file: 'clip3-1080p-h264-dts51.mkv',
    label: 'Clip 3 — 1080p H.264 + DTS 5.1',
    mime: 'video/x-matroska; codecs="avc1.640028,dtsc"',
    note: 'Reading 18 — promotes R3 out of shadow. THE AUDIO ANSWER IS THE READING: silence with a picture and silence with a MediaError are different verdicts.',
  },
  {
    id: 'c4',
    file: 'clip4-1080p-h264-eac3.mkv',
    label: 'Clip 4 — 1080p H.264 + E-AC3 — CONTROL',
    mime: 'video/x-matroska; codecs="avc1.640028,ec-3"',
    note: 'The one measured combination (2026-10-07, DDP5.1). A red row here means the instrument is wrong, not the panel. Read it FIRST.',
  },
];

/**
 * A clip's row. Every field is a string so that what is rendered is what was persisted and
 * what gets transcribed — no formatting happens between the element and the sheet.
 *
 * `present` is its own field rather than derived from `http`: parsing a status back out of a
 * verbatim line is exactly the kind of re-derivation that makes a reading a judgement. Three
 * values, not two — a `fetch` that **throws** is not an absent file, and calling it one would
 * hide a LAN failure behind "copy the clips over".
 */
type ClipReading = {
  http: string;
  present: 'yes' | 'no' | 'unknown';
  error: string;
  dims: string;
  duration: string;
  readyState: string;
  at: string;
  audio: string;
};

/** "not taken", never blank — the stage-7 sheet's rule, in the instrument that fills it. */
const BLANK_CLIP: ClipReading = {
  http: 'not probed',
  present: 'unknown',
  error: 'not taken',
  dims: 'not taken',
  duration: 'not taken',
  readyState: 'not taken',
  at: 'not taken',
  audio: 'not answered',
};

function blankClipReadings(): Record<string, ClipReading> {
  return Object.fromEntries(CLIPS.map((c) => [c.id, { ...BLANK_CLIP }]));
}

/**
 * Restored field by field against BLANK_CLIP. A stored blob written by an older build (or by
 * anything else on this origin) must degrade to "not taken" rather than render `undefined`,
 * which would read as a blank cell — the one state this instrument is not allowed to produce.
 */
function readCodecReadings(): Record<string, ClipReading> {
  const out = blankClipReadings();
  try {
    const raw = sessionStorage.getItem(CODEC_STORAGE);
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return out;
    for (const c of CLIPS) {
      const row = (parsed as Record<string, unknown>)[c.id];
      if (!row || typeof row !== 'object') continue;
      for (const key of ['http', 'error', 'dims', 'duration', 'readyState', 'at', 'audio'] as const) {
        const v = (row as Record<string, unknown>)[key];
        if (typeof v === 'string' && v !== '') out[c.id][key] = v;
      }
      // `present` is validated against its three values rather than trusted, because it is the
      // field the "FILE NOT PRESENT" branch keys on.
      const p = (row as Record<string, unknown>).present;
      if (p === 'yes' || p === 'no' || p === 'unknown') out[c.id].present = p;
    }
    return out;
  } catch {
    return out;
  }
}

function writeCodecReadings(readings: Record<string, ClipReading>): void {
  try {
    sessionStorage.setItem(CODEC_STORAGE, JSON.stringify(readings));
  } catch {
    /* A television that refuses storage still shows the readings on screen. */
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

  // Stage 8's codec instrument. `clips` is the persisted record; `canPlay` is the advisory
  // `canPlayType` read and is deliberately NOT persisted, because it is re-derivable on any
  // mount and must never be mistaken for a transcribed reading. `activeClip` is a single
  // mounted element at a time: a television has one hardware decoder worth trusting, and the
  // sound question can only be answered about one clip at a time anyway.
  const [clips, setClips] = useState<Record<string, ClipReading>>(blankClipReadings);
  const [canPlay, setCanPlay] = useState<Record<string, string>>({});
  const [activeClip, setActiveClip] = useState<string | null>(null);
  const clipVideoRef = useRef<HTMLVideoElement | null>(null);

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

  // The clip readings, mirrored in a ref for the same reason the key log is: every write is a
  // MERGE of one field into one row, and doing that inside a setState updater (which React may
  // call twice) would persist a value derived from a state React had not committed.
  const clipsRef = useRef<Record<string, ClipReading>>(blankClipReadings());

  const updateClip = useCallback((id: string, patch: Partial<ClipReading>) => {
    const next = { ...clipsRef.current, [id]: { ...clipsRef.current[id], ...patch } };
    clipsRef.current = next;
    writeCodecReadings(next);
    setClips(next);
  }, []);

  useEffect(() => {
    // Restored in an effect, not a useState initialiser: this renders on the server too, where
    // sessionStorage does not exist, and a lazy initialiser would make the two first paints
    // differ. Same reason as the key log's restore above.
    const saved = readCodecReadings();
    clipsRef.current = saved;
    setClips(saved);
  }, []);

  useEffect(() => {
    // ADVISORY ONLY, and in its own effect with its own catch so that an engine without
    // `canPlayType` cannot take the feature table down with it (the `mediaSession()` posture).
    // Nothing below reads this value: the clip mounts whatever it says. §7.2 — "TV
    // implementations under-report" — is the reason it may not gate anything.
    try {
      const probe = document.createElement('video');
      const out: Record<string, string> = {};
      for (const c of CLIPS) {
        out[c.id] =
          typeof probe.canPlayType === 'function' ? JSON.stringify(probe.canPlayType(c.mime)) : 'canPlayType absent';
      }
      setCanPlay(out);
    } catch (err) {
      setCanPlay(Object.fromEntries(CLIPS.map((c) => [c.id, `threw: ${String(err)}`])));
    }
  }, []);

  /**
   * One HEAD per clip, and the answer is kept verbatim.
   *
   * This is the only thing that can separate "the file is not here" from "this panel cannot
   * decode it", because both end with no picture and `MediaError.code` is identical. A thrown
   * fetch is recorded as `unknown`, NOT as absence: a LAN or server failure must not be
   * reported as "copy the clips over".
   */
  const probeClip = useCallback(async (clip: Clip): Promise<boolean> => {
    const url = SAMPLES_BASE + clip.file;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      updateClip(clip.id, {
        http: `HEAD ${url} -> ${res.status} ${res.statusText}`.trimEnd(),
        present: res.ok ? 'yes' : 'no',
      });
      return res.ok;
    } catch (err) {
      updateClip(clip.id, { http: `HEAD ${url} -> fetch failed: ${String(err)}`, present: 'unknown' });
      return false;
    }
  }, [updateClip]);

  const probeAllClips = useCallback(() => {
    // Parallel, not a serial loop: one clip whose request never settles must not stop the other
    // three from being probed.
    void Promise.all(CLIPS.map((c) => probeClip(c)));
  }, [probeClip]);

  /**
   * Sample the live element. Called from `loadedmetadata`, `playing`, `error` and the operator's
   * own "Sample now" — the last one matters because `readyState` and `duration` both change over
   * time, so a reading has to say WHEN it was taken. Hence `at`.
   *
   * `video.error === null` is printed as itself. "no error" is a judgement; the absence of a
   * MediaError is a fact about the element.
   */
  const sampleClip = useCallback((id: string, v: HTMLVideoElement, at: string) => {
    const err = v.error;
    updateClip(id, {
      error: err ? `MediaError.code=${err.code}` : 'video.error === null',
      dims: `${v.videoWidth} x ${v.videoHeight}`,
      duration: String(v.duration),
      readyState: String(v.readyState),
      at,
    });
  }, [updateClip]);

  /**
   * Probe first, mount second. A 404 renders the FILE NOT PRESENT state and mounts NOTHING —
   * an empty `<video>` over a missing file looks exactly like an unsupported codec, which is
   * the confusion this whole section exists to prevent.
   */
  const loadClip = useCallback(async (clip: Clip) => {
    const ok = await probeClip(clip);
    setActiveClip(ok ? clip.id : null);
  }, [probeClip]);

  const sampleActiveClip = useCallback(() => {
    const v = clipVideoRef.current;
    if (v && activeClip) sampleClip(activeClip, v, 'operator pressed Sample now');
  }, [activeClip, sampleClip]);

  const clearClipReadings = useCallback(() => {
    const next = blankClipReadings();
    clipsRef.current = next;
    setClips(next);
    writeCodecReadings(next);
    setActiveClip(null);
  }, []);

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
      <h2>Codec clips (stage 8)</h2>
      <p>
        Four clips, one variable each, served by Next.js static out of{' '}
        <code>frontend/public/samples/</code> — <strong>no torrent, no backend, no auth gate and
        no ARM download cap</strong>, so a failure here is the decoder and nothing else.{' '}
        <strong>Read clip 4 first: it is the control</strong>, the one combination this project
        has actually measured, so a red row there means the instrument or the file is wrong
        rather than the panel.
      </p>
      <p>
        <strong>The clips are not in the repository.</strong> They are gitignored binaries that
        nobody has produced yet; copy them into <code>frontend/public/samples/</code> under the
        exact file names below. The ffmpeg command line for each one is in{' '}
        <code>docs/superpowers/plans/2026-10-11-tv-stage8-device-readings.md</code>, labelled
        written-down-but-never-run. Until they exist every row reads{' '}
        <strong>FILE NOT PRESENT</strong>, which is a real reading and not a blank.
      </p>
      <p>
        <strong>Transcribe these cells verbatim</strong> into rows 16-18 of that sheet —{' '}
        <code>MediaError.code</code>, <code>videoWidth x videoHeight</code>,{' '}
        <code>duration</code> and <code>readyState</code> exactly as printed. Never “ok”,
        “works” or “as expected”: a summary is what was lost from the stage-3 sitting.{' '}
        <strong>
          And answer the sound question by hand on every clip you play — a DTS track this set
          cannot decode is a SILENT PICTURE with no error at all,
        </strong>{' '}
        so the machine-read fields alone would log reading 18 as a pass over a silent film.
      </p>
      <div className="bs-controls">
        <button className="bs-btn" type="button" onClick={probeAllClips}>
          Probe all four clips (HEAD only)
        </button>
        <button className="bs-btn bs-btn--ghost" type="button" onClick={sampleActiveClip}>
          Sample now
        </button>
        <button className="bs-btn bs-btn--ghost" type="button" onClick={clearClipReadings}>
          Clear clip readings
        </button>
      </div>
      {CLIPS.map((c) => {
        const r = clips[c.id] ?? BLANK_CLIP;
        return (
          <div key={c.id} data-clip-row={c.id} style={{ marginBottom: 32 }}>
            <h3 style={{ fontSize: 28, marginBottom: 8 }}>{c.label}</h3>
            <p style={{ color: 'var(--muted)', fontSize: 20 }}>{c.note}</p>
            <div className="bs-controls">
              <button className="bs-btn bs-btn--ghost" type="button" onClick={() => void loadClip(c)}>
                Load {c.file}
              </button>
              <button className="bs-btn bs-btn--ghost" type="button"
                      onClick={() => updateClip(c.id, { audio: 'yes' })}>
                Sound came out: yes
              </button>
              <button className="bs-btn bs-btn--ghost" type="button"
                      onClick={() => updateClip(c.id, { audio: 'no' })}>
                Sound came out: no
              </button>
            </div>
            <table className="bs-facts">
              <tbody>
                <tr>
                  <th>HTTP (verbatim)</th>
                  <td>{r.http}</td>
                </tr>
                <tr>
                  <th>File present?</th>
                  <td className={r.present === 'yes' ? 'bs-yes' : r.present === 'no' ? 'bs-no' : undefined}>
                    {r.present === 'no' ? 'FILE NOT PRESENT — nothing was mounted' : r.present}
                  </td>
                </tr>
                <tr>
                  <th>MediaError.code</th>
                  <td>{r.error}</td>
                </tr>
                <tr>
                  <th>videoWidth x videoHeight</th>
                  <td>{r.dims}</td>
                </tr>
                <tr>
                  <th>duration</th>
                  <td>{r.duration}</td>
                </tr>
                <tr>
                  <th>readyState</th>
                  <td>{r.readyState}</td>
                </tr>
                <tr>
                  <th>sampled at</th>
                  <td>{r.at}</td>
                </tr>
                <tr>
                  <th>Did sound come out of the television? (operator)</th>
                  <td className={r.audio === 'yes' ? 'bs-yes' : r.audio === 'no' ? 'bs-no' : undefined}>
                    {r.audio}
                  </td>
                </tr>
                <tr>
                  <th>canPlayType — ADVISORY, GATES NOTHING</th>
                  <td>{canPlay[c.id] ?? 'not probed'}</td>
                </tr>
              </tbody>
            </table>
            {r.present === 'no' ? (
              <p className="bs-no">
                <strong>FILE NOT PRESENT.</strong> The HTTP line above is the reading. This is not
                a codec result and must not be transcribed as one — nothing was mounted, so the
                panel was never asked to decode anything. Produce{' '}
                <code>{SAMPLES_BASE + c.file}</code> with the sheet’s ffmpeg line and load it
                again.
              </p>
            ) : null}
            {activeClip === c.id ? (
              <>
                <video
                  className="bs-video"
                  data-clip-player={c.id}
                  ref={clipVideoRef}
                  src={SAMPLES_BASE + c.file}
                  preload="metadata"
                  controls
                  onLoadedMetadata={(e) => sampleClip(c.id, e.currentTarget, 'loadedmetadata')}
                  onPlaying={(e) => sampleClip(c.id, e.currentTarget, 'playing')}
                  onError={(e) => sampleClip(c.id, e.currentTarget, 'error')}
                />
                <p style={{ color: 'var(--muted)', fontSize: 20, wordBreak: 'break-all' }}>
                  {SAMPLES_BASE + c.file}
                </p>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
