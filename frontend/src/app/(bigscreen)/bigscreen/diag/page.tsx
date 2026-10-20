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

/**
 * STAGE 9 — THE SUBTITLE INSTRUMENT. Five arms, and the first one needs nothing that is not
 * already in this repository.
 *
 * NO SUITE ANYWHERE CAN ANSWER THE QUESTION THIS SECTION EXISTS FOR. jsdom 25.0.1 implements
 * no text-track machinery at all — `window.TextTrack` is undefined, `video.textTracks` is a
 * plain zero-length array even with a `<track default>` child present, `trackEl.track` is
 * undefined and `trackEl.readyState` is a hardcoded 0 — and the backend image has no browser
 * binary. So "do WebVTT cues paint on this television" is unanswerable by every instrument
 * this project owns except a panel and a pair of eyes. That is reading 27a, and it is gate A
 * on the stage's "subtitles work on the television" claim.
 *
 * ARM 27a NEEDS NO CLIP, NO TORRENT, NO FASTAPI AND NO AUTH, and that is the whole design.
 * Measured on Chromium 155: a `<track default>` inserted after `loadedmetadata` reaches
 * `mode: 'showing'` with its cues parsed EVEN WITH THE MEDIA ELEMENT IN THE ERROR STATE. So
 * the arm mounts a `<video>` whose `src` cannot resolve on purpose, puts the committed
 * hand-typed `.vtt` beside it, and a blank screen then has ONE candidate cause. Every other
 * playback path on this surface runs through libtorrent, FastAPI, the session gate and the ARM
 * download cap; stage 8's codec rows are still blocked on four clips nobody has produced.
 *
 * THE TWO PROBE FILES ARE COMMITTED, unlike those clips. They are a few hundred bytes of
 * hand-typed text, `frontend/.gitignore` un-ignores `*.vtt` under `public/samples/` for
 * exactly them, and reading 27a's premise is that they are already there.
 *
 * `cue-probe.vtt` IS WRITTEN IN THE CONVERTER'S OWN OUTPUT GRAMMAR, byte for byte in shape:
 * `WEBVTT`, a blank line, no cue identifiers, `HH:MM:SS.mmm --> HH:MM:SS.mmm` with one space
 * each side, LF endings (`backend/app/subtitles/vtt.py`'s emitter). A probe file written in a
 * laxer form would measure one of the five leniencies Chromium 155 was measured to allow and
 * Chromium 120 may not, which is a different question from the one being asked. It carries no
 * `NOTE` block for the same reason: the provenance rides in CUE 1's own text, where the
 * operator reads it, instead of in a header whose support would be a second candidate cause.
 * Its first cue runs 0 -> 10:00 because an errored element's clock never advances, so a cue
 * that starts later is one no arm but 27b can ever paint.
 *
 * `cue-probe-line.vtt` DIFFERS BY EXACTLY ONE VARIABLE — `line:-4` on every timing line —
 * which is stage 8's lesson about clips 1 and 2 applied to a text file. Its CUE 1 names the
 * file, because an operator who cannot tell which of two identical-looking files is on screen
 * transcribes the wrong arm, and that is worse than a one-line text difference in a reading
 * about POSITION.
 *
 * WHAT THIS SECTION DOES NOT DO: claim the band geometry. `line:-4`'s real question (reading
 * 32) is whether a cue can be moved clear of the 480px scrim and the ~334px band, and this
 * page's video box is not the player's geometry at all. Drawing a 480px guide here would be a
 * fabricated measurement. So the arm asks the one question it can answer honestly — does the
 * setting move the cue AT ALL on this engine, compared with arm 27a's identical file without
 * it — and the limit is printed beside it.
 *
 * EVERY FETCH IS A PLAIN `fetch` WITH `cache: 'no-store'` AND `credentials: 'same-origin'`,
 * the `_player/classify.ts` pattern, and never `apiClient`: that client's interceptor
 * hard-navigates to the sign-in page on a 401, which would take the operator off the
 * instrument mid-reading and leave the reading untranscribed. `no-store` because a cached 404
 * from before the files were copied over is the one answer this probe must never give.
 */
const SUBTITLE_STORAGE = 'bs-diag:subtitles';

/** Committed, hand-typed, and in the converter's own output grammar. See the block above. */
const CUE_PROBE = 'cue-probe.vtt';
const CUE_PROBE_LINE = 'cue-probe-line.vtt';

/**
 * Stage 8's control clip, REUSED rather than re-specified: arm 27b's only job is to repeat
 * 27a's question over a real decoded frame, and clip 4 is the one AV combination this project
 * has ever measured. It is a gitignored binary and it is not in this checkout, so 27b reads
 * FILE NOT PRESENT until someone produces it — which is why 27a is the gate and 27b is the
 * tie-breaker.
 */
const CONTROL_CLIP = CLIPS[3].file;

/**
 * A `src` that cannot resolve, on purpose. The arm that uses it is measuring a `<track>` on an
 * element in the ERROR state, which is the state that needs no clip; a src that worked would
 * make the arm depend on an artefact nobody has made.
 */
const BOGUS_VIDEO_SRC = SAMPLES_BASE + 'there-is-deliberately-no-clip-here.mkv';

type SubtitleArm = {
  id: string;
  /** The row number in the stage-9 readings sheet. Printed, so a cell cannot be mis-filed. */
  reading: string;
  label: string;
  vtt: string;
  /** A sample clip's filename, or null for the bogus src. */
  clip: string | null;
  note: string;
  /** Renders `::cue { color: var(--gold) }` and the px rulers beside the element. */
  cueStyle?: boolean;
  /** Adds the `video.load()` press and the track unmount, and the row that records them. */
  doubleLoad?: boolean;
  /** Adds the "did the cue sit higher" operator row. */
  moved?: boolean;
};

const SUBTITLE_ARMS: SubtitleArm[] = [
  {
    id: 's27a',
    reading: '27a',
    label: 'Arm 27a — a <track> on an element in the ERROR state. No clip, no backend.',
    vtt: CUE_PROBE,
    clip: null,
    note: 'GATE A. Do WebVTT cues paint on this set at all, and does a late <track default> reach mode: "showing"? A bogus video src plus the committed .vtt, so nothing here can fail for a reason other than text tracks. Transcribe every cell, and answer the VISIBLE question by hand: a zero-cue reading and an invisible-cue reading are different facts and may not share a cell.',
  },
  {
    id: 's27b',
    reading: '27b',
    label: 'Arm 27b — the same question over a real decoded frame.',
    vtt: CUE_PROBE,
    clip: CONTROL_CLIP,
    note: 'Only needed if 27a is ambiguous. BLOCKER: this clip is a gitignored binary that is not in the repository, so this arm reads FILE NOT PRESENT until someone produces it with the stage-8 sheet’s ffmpeg line. It is also the only arm whose clock advances, so it is the only one that can ever paint CUE 2, 3 or 4.',
  },
  {
    id: 's30',
    reading: '30',
    label: 'Arm 30 — ::cue { color: var(--gold) }, and the default cue size.',
    vtt: CUE_PROBE,
    clip: null,
    cueStyle: true,
    note: 'Does ::cue apply, and does var() resolve inside it? DO NOT substitute a CSS.supports or cssRules probe: measured, Blink retains bottom/transform/padding inside a ::cue block while ignoring them at used-value time, and drops ::cue-region from cssRules entirely, so a parse probe answers yes for properties that do nothing. Compare the cue text against the px rulers below for §8.5’s 24px Read floor, and transcribe the ruler it matches rather than a judgement.',
  },
  {
    id: 's32',
    reading: '32',
    label: 'Arm 32 — line:-4, the one lever that would live in the converter.',
    vtt: CUE_PROBE_LINE,
    clip: null,
    moved: true,
    note: 'The same four cues as arm 27a with line:-4 added, so load 27a first and compare. LIMIT, and it is this arm’s whole caveat: this page’s video box is NOT the player’s geometry, so nothing here can say whether a cue clears the 480px scrim or the ~334px band. What it can say is whether the setting moves the cue on this engine at all — if it does not, reading 29b’s candidate fixes are down to one before anyone writes a line of converter code.',
  },
  {
    id: 's35',
    reading: '35',
    label: 'Arm 35 — does a recovery video.load() duplicate the TextTrack?',
    vtt: CUE_PROBE,
    clip: null,
    doubleLoad: true,
    note: 'Measured on Chromium 155: each video.load() APPENDS a fresh TextTrack per <track> element without discarding the previous — one element, textTracks 1 -> 2 -> 3, every copy showing, three identical cue lines stacked on the picture. Order: Load, then Sample, then press video.load() twice, then unmount the <track> and sample again. The player’s guard (unmount the element while the recovery ladder reloads) is shipped either way; this says whether it is still earned.',
  },
];

/**
 * One arm's row. Every field is a string so what is rendered is what was persisted and what
 * gets transcribed, and the three facts mutation (c) exists for — the HTTP status, the cue
 * count, and whether text was VISIBLE — are three separate fields on purpose. Collapsing them
 * into one ok/failed cell is exactly what makes a bodiless 401 indistinguishable from a
 * malformed file on a screen with no devtools: the 401 on the subtitle routes carries no body
 * (D11, structural), a signature-valid zero-cue body loads at readyState 2 and fires NO EVENT
 * AT ALL, and an invisible cue is a third thing again.
 */
type SubtitleReading = {
  http: string;
  present: 'yes' | 'no' | 'unknown';
  clipHttp: string;
  clipPresent: 'yes' | 'no' | 'unknown';
  tracks: string;
  mode: string;
  cues: string;
  readyState: string;
  event: string;
  loads: string;
  visible: string;
  styled: string;
  moved: string;
  at: string;
};

/** "not taken" / "not answered", never blank — the sheet's own rule, in the instrument. */
const BLANK_SUBTITLE: SubtitleReading = {
  http: 'not probed',
  present: 'unknown',
  clipHttp: 'not probed',
  clipPresent: 'unknown',
  tracks: 'not taken',
  mode: 'not taken',
  cues: 'not taken',
  readyState: 'not taken',
  event: 'not taken',
  loads: 'not taken',
  visible: 'not answered',
  styled: 'not answered',
  moved: 'not answered',
  at: 'not taken',
};

/**
 * What a machine field prints when the ENGINE does not expose the thing at all, as opposed to
 * a value the operator has not sampled yet ("not taken") or one that is exposed and zero
 * ("0"). Three states, because jsdom collapses two of them: in this project's own suite
 * `textTracks.length` reads 0 (a plain zero-length array sits where the list should be) and
 * `trackEl.readyState` reads 0 (hardcoded), while `mode` and `cues.length` read this em dash.
 * A field that printed "0" for all four would make the suite's own output look like a reading.
 */
const NO_VALUE = '—';

function blankSubtitleReadings(): Record<string, SubtitleReading> {
  return Object.fromEntries(SUBTITLE_ARMS.map((a) => [a.id, { ...BLANK_SUBTITLE }]));
}

/** Restored field by field against the blank, for the reason `readCodecReadings` gives. */
function readSubtitleReadings(): Record<string, SubtitleReading> {
  const out = blankSubtitleReadings();
  try {
    const raw = sessionStorage.getItem(SUBTITLE_STORAGE);
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return out;
    for (const arm of SUBTITLE_ARMS) {
      const row = (parsed as Record<string, unknown>)[arm.id];
      if (!row || typeof row !== 'object') continue;
      for (const key of [
        'http', 'clipHttp', 'tracks', 'mode', 'cues', 'readyState', 'event', 'loads',
        'visible', 'styled', 'moved', 'at',
      ] as const) {
        const v = (row as Record<string, unknown>)[key];
        if (typeof v === 'string' && v !== '') out[arm.id][key] = v;
      }
      for (const key of ['present', 'clipPresent'] as const) {
        const p = (row as Record<string, unknown>)[key];
        if (p === 'yes' || p === 'no' || p === 'unknown') out[arm.id][key] = p;
      }
    }
    return out;
  } catch {
    return out;
  }
}

function writeSubtitleReadings(readings: Record<string, SubtitleReading>): void {
  try {
    sessionStorage.setItem(SUBTITLE_STORAGE, JSON.stringify(readings));
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

  /**
   * STAGE 9's subtitle instrument. `subtitleReadings` is the persisted record, `activeArm` is
   * one mounted element at a time (the codec section's reason: one question at a time, and the
   * VISIBLE answer can only be given about one picture), and `trackMounted` is arm 35's own
   * lever — the player unmounts the `<track>` while the recovery ladder reloads, so the arm
   * that measures the duplication has to be able to do the same thing by hand.
   */
  const [subtitleReadings, setSubtitleReadings] =
    useState<Record<string, SubtitleReading>>(blankSubtitleReadings);
  const [activeArm, setActiveArm] = useState<string | null>(null);
  const [trackMounted, setTrackMounted] = useState(true);
  const subtitleVideoRef = useRef<HTMLVideoElement | null>(null);
  const subtitleTrackRef = useRef<HTMLTrackElement | null>(null);
  // Mirrored in a ref for the reason the clip readings are: every write MERGES one field into
  // one row, and doing that inside a setState updater (which React may call twice) would
  // persist a value derived from a state React had not committed.
  const subtitleReadingsRef = useRef<Record<string, SubtitleReading>>(blankSubtitleReadings());

  const updateArm = useCallback((id: string, patch: Partial<SubtitleReading>) => {
    const prev = subtitleReadingsRef.current[id] ?? BLANK_SUBTITLE;
    const next = { ...subtitleReadingsRef.current, [id]: { ...prev, ...patch } };
    subtitleReadingsRef.current = next;
    writeSubtitleReadings(next);
    setSubtitleReadings(next);
  }, []);

  useEffect(() => {
    // In an effect, not a useState initialiser: this renders on the server too, where
    // sessionStorage does not exist. Same reason as the key log's and the clips' restore.
    const saved = readSubtitleReadings();
    subtitleReadingsRef.current = saved;
    setSubtitleReadings(saved);
  }, []);

  /**
   * One HEAD against Next.js static, kept verbatim, and the init is the `classify.ts` one.
   *
   * `no-store` because a cached 404 from before the file was copied over is the one answer
   * this probe may never give; `credentials: 'same-origin'` because the whole point of
   * `/samples/` is that nothing on this path is gated and a cookie would not change that —
   * stating it is what keeps the next hand from reaching for `apiClient`, whose 401
   * interceptor hard-navigates and would take the operator off the page mid-reading.
   *
   * A thrown fetch is `unknown`, NOT absence: "copy the file over" is the one action that
   * cannot help a LAN failure.
   */
  const probeSample = useCallback(
    async (file: string): Promise<{ line: string; present: 'yes' | 'no' | 'unknown' }> => {
      const url = SAMPLES_BASE + file;
      try {
        const res = await fetch(url, {
          method: 'HEAD',
          cache: 'no-store',
          credentials: 'same-origin',
        });
        return {
          line: `HEAD ${url} -> ${res.status} ${res.statusText}`.trimEnd(),
          present: res.ok ? 'yes' : 'no',
        };
      } catch (err) {
        return { line: `HEAD ${url} -> fetch failed: ${String(err)}`, present: 'unknown' };
      }
    },
    [],
  );

  /** True only when everything this arm needs answered 2xx. */
  const probeArm = useCallback(async (arm: SubtitleArm): Promise<boolean> => {
    const vtt = await probeSample(arm.vtt);
    updateArm(arm.id, { http: vtt.line, present: vtt.present });
    if (arm.clip === null) return vtt.present === 'yes';
    const clip = await probeSample(arm.clip);
    updateArm(arm.id, { clipHttp: clip.line, clipPresent: clip.present });
    return vtt.present === 'yes' && clip.present === 'yes';
  }, [probeSample, updateArm]);

  const probeAllArms = useCallback(() => {
    // Parallel across arms, for the reason the clip probe is: one request that never settles
    // must not stop the others from being read.
    void Promise.all(SUBTITLE_ARMS.map((a) => probeArm(a)));
  }, [probeArm]);

  /**
   * PROBE FIRST, MOUNT SECOND — the codec section's rule, and it is sharper here. A `<track>`
   * whose `src` 404s fires exactly the same `error` as one whose body no parser accepts, and
   * the element gets ONE load: nothing retries it. So a missing probe file would be
   * transcribed as "this television does not paint cues", which is the reading this whole
   * section exists to take.
   */
  const loadArm = useCallback(async (arm: SubtitleArm) => {
    const ok = await probeArm(arm);
    setTrackMounted(true);
    setActiveArm(ok ? arm.id : null);
  }, [probeArm]);

  /**
   * Sample the live elements. Called from `loadedmetadata`, the video's `error` and the
   * operator's own press, because `mode`, `cues.length` and `readyState` all change over time
   * — hence `at`, which says WHEN the row was taken.
   *
   * An em dash means the engine does not expose the thing at all, which is a different fact
   * from "not taken" (not sampled yet) and from "0" (exposed, and zero). In this project's own
   * suite `textTracks.length` reads 0 and `readyState` reads 0 — jsdom has a zero-length plain
   * array where the list should be and a hardcoded 0 on the element — and the rest read the em
   * dash. Nothing here is asserted anywhere: the page is an instrument, not a claim.
   */
  const sampleArm = useCallback((id: string, at: string) => {
    const v = subtitleVideoRef.current;
    const trackEl = subtitleTrackRef.current;
    const list = v
      ? (v.textTracks as unknown as
        { length: number; [i: number]: { mode?: string; cues?: { length: number } | null } | undefined }
        | undefined)
      : undefined;
    const first = list && list.length > 0 ? list[0] : undefined;
    updateArm(id, {
      tracks: list ? String(list.length) : NO_VALUE,
      mode: first && typeof first.mode === 'string' ? first.mode : NO_VALUE,
      cues: first && first.cues ? String(first.cues.length) : NO_VALUE,
      readyState: trackEl ? String(trackEl.readyState) : NO_VALUE,
      at,
    });
  }, [updateArm]);

  /**
   * WHICH of `load`/`error` fired, in the order they fired, appended rather than replaced: a
   * track that loads and then errors is a different reading from one that only errors, and the
   * element's own `readyState` is a hardcoded 0 in every suite here, so the event is the only
   * instrument. Both are CAPTURE props, which is not a style choice — react-dom 19's
   * `listenToNonDelegatedEvent` block covers `embed`/`source`/`link` and `case "track":` falls
   * through without them, and the native events do not bubble, so `onLoad`/`onError` on a
   * `<track>` are dead code (`_player/SubtitleTrackElement.tsx` carries the measurement).
   */
  const recordTrackEvent = useCallback((id: string, kind: 'load' | 'error') => {
    const prev = subtitleReadingsRef.current[id]?.event ?? BLANK_SUBTITLE.event;
    updateArm(id, { event: prev === BLANK_SUBTITLE.event ? kind : `${prev}, ${kind}` });
  }, [updateArm]);

  /** Reading 35: `textTracks.length` after each `video.load()`, as a sequence (1 -> 2 -> 3). */
  const callLoadAgain = useCallback((id: string) => {
    const v = subtitleVideoRef.current;
    if (!v) return;
    try {
      v.load();
    } catch (err) {
      updateArm(id, { loads: `video.load() threw: ${String(err)}` });
      return;
    }
    const list = v.textTracks as unknown as { length: number } | undefined;
    const count = list ? String(list.length) : NO_VALUE;
    const prev = subtitleReadingsRef.current[id]?.loads ?? BLANK_SUBTITLE.loads;
    updateArm(id, { loads: prev === BLANK_SUBTITLE.loads ? count : `${prev} -> ${count}` });
  }, [updateArm]);

  const clearSubtitleReadings = useCallback(() => {
    const next = blankSubtitleReadings();
    subtitleReadingsRef.current = next;
    setSubtitleReadings(next);
    writeSubtitleReadings(next);
    setActiveArm(null);
    setTrackMounted(true);
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
      <h2>Sidecar subtitles (stage 9)</h2>
      {/* Named container, because two of the sentences below are deliberately repeated in an
          arm's own note — an operator reads the arm they are loading, not the preamble — and a
          claim with two copies is a claim where deleting either leaves a test green. The
          section's prose is asserted HERE and an arm's guidance on its own row. */}
      <div data-subtitle-intro>
        <p>
          <strong>No suite in this project can answer the question this section asks.</strong>{' '}
          jsdom implements no text-track machinery at all — <code>window.TextTrack</code> is
          undefined, <code>video.textTracks</code> is a plain zero-length array even with a{' '}
          <code>&lt;track default&gt;</code> child present, <code>trackEl.track</code> is
          undefined and <code>trackEl.readyState</code> is a hardcoded <code>0</code> — and the
          backend image has no browser binary. So whether WebVTT cues paint on this television is
          unanswerable by every instrument this project owns except a panel and a pair of eyes.
          This section is that instrument. <strong>It asserts nothing and claims nothing</strong>;
          every cell starts at <em>not taken</em> and stays there until it is sampled.
        </p>
        <p>
          <strong>Arm 27a needs no clip, no torrent, no FastAPI and no auth.</strong> Measured: a{' '}
          <code>&lt;track default&gt;</code> inserted after <code>loadedmetadata</code> reaches{' '}
          <code>mode: &quot;showing&quot;</code> with its cues parsed <strong>even with the media
          element in the error state</strong>, so the arm mounts a <code>&lt;video&gt;</code> whose{' '}
          <code>src</code> cannot resolve on purpose and puts the committed hand-typed{' '}
          <code>.vtt</code> beside it. A blank screen then has <strong>one</strong> candidate
          cause. The two probe files <strong>are in this repository</strong> — a few hundred bytes
          of hand-typed text each, un-ignored by name — unlike the four codec clips above, which
          nobody has produced.
        </p>
        <p>
          <strong>Probe first, mount second</strong>, and it matters more here than it does for a
          clip: a <code>&lt;track&gt;</code> whose <code>src</code> 404s fires exactly the same{' '}
          <code>error</code> as one whose body no parser accepts, and the element gets{' '}
          <strong>one</strong> load — nothing retries it. A missing probe file would otherwise be
          transcribed as “this set does not paint cues”.
        </p>
        <p>
          <strong>Transcribe every cell verbatim</strong> into rows <strong>27a, 27b, 30, 32 and
          35</strong> of{' '}
          <code>docs/superpowers/plans/2026-10-20-tv-stage9-device-readings.md</code> — the five
          this page is the instrument for, and no others — and{' '}
          <strong>answer the VISIBLE question by hand on every arm you load</strong>: a zero-cue
          reading and an invisible-cue reading are different facts and may not share a cell. A
          signature-valid body with no cues in it loads at <code>readyState 2</code> and fires{' '}
          <strong>no event at all</strong>, and the 401 on the subtitle routes is bodiless by
          design — so “it worked / it failed” is the one shape this page may never print.
        </p>
      </div>
      <div className="bs-controls">
        <button className="bs-btn" type="button" onClick={probeAllArms}>
          Probe every arm’s files (HEAD only)
        </button>
        <button className="bs-btn bs-btn--ghost" type="button" onClick={clearSubtitleReadings}>
          Clear subtitle readings
        </button>
      </div>
      {SUBTITLE_ARMS.map((arm) => {
        const r = subtitleReadings[arm.id] ?? BLANK_SUBTITLE;
        const active = activeArm === arm.id;
        const cls = (v: string) => (v === 'yes' ? 'bs-yes' : v === 'no' ? 'bs-no' : undefined);
        const absent = 'FILE NOT PRESENT — nothing was mounted';
        // Built as data so each row is one line to read and the per-arm rows (the clip, the
        // load() sequence, the two extra operator questions) are additions rather than
        // branches inside the table.
        const rows: Array<{ label: string; value: string; cls?: string }> = [
          { label: 'HTTP — the .vtt (verbatim)', value: r.http },
          {
            label: 'Subtitle file present?',
            value: r.present === 'no' ? absent : r.present,
            cls: cls(r.present),
          },
          ...(arm.clip === null
            ? []
            : [
              { label: 'HTTP — the clip (verbatim)', value: r.clipHttp },
              {
                label: 'Clip present?',
                value: r.clipPresent === 'no' ? absent : r.clipPresent,
                cls: cls(r.clipPresent),
              },
            ]),
          { label: 'textTracks.length', value: r.tracks },
          { label: 'textTracks[0].mode', value: r.mode },
          { label: 'cues.length', value: r.cues },
          { label: 'trackEl.readyState', value: r.readyState },
          { label: 'which of load/error fired', value: r.event },
          ...(arm.doubleLoad
            ? [{ label: 'after each video.load(), textTracks.length', value: r.loads }]
            : []),
          { label: 'sampled at', value: r.at },
          {
            label: 'Cue text VISIBLE on the panel? (operator)',
            value: r.visible,
            cls: cls(r.visible),
          },
          ...(arm.cueStyle
            ? [{ label: 'Cue text was GOLD? (operator)', value: r.styled, cls: cls(r.styled) }]
            : []),
          ...(arm.moved
            ? [
              {
                label: 'Cue sat HIGHER than arm 27a’s? (operator)',
                value: r.moved,
                cls: cls(r.moved),
              },
            ]
            : []),
        ];
        return (
          <div key={arm.id} data-subtitle-arm={arm.id} style={{ marginBottom: 32 }}>
            <h3 style={{ fontSize: 28, marginBottom: 8 }}>{arm.label}</h3>
            <p style={{ color: 'var(--muted)', fontSize: 20 }}>
              Reading {arm.reading}. {arm.note}
            </p>
            <div className="bs-controls">
              <button className="bs-btn bs-btn--ghost" type="button" onClick={() => void loadArm(arm)}>
                Load {arm.vtt}
                {arm.clip === null ? '' : ` + ${arm.clip}`}
              </button>
              <button className="bs-btn bs-btn--ghost" type="button"
                      onClick={() => updateArm(arm.id, { visible: 'yes' })}>
                Cue text visible: yes
              </button>
              <button className="bs-btn bs-btn--ghost" type="button"
                      onClick={() => updateArm(arm.id, { visible: 'no' })}>
                Cue text visible: no
              </button>
              {arm.cueStyle ? (
                <>
                  <button className="bs-btn bs-btn--ghost" type="button"
                          onClick={() => updateArm(arm.id, { styled: 'yes' })}>
                    Cue text was gold: yes
                  </button>
                  <button className="bs-btn bs-btn--ghost" type="button"
                          onClick={() => updateArm(arm.id, { styled: 'no' })}>
                    Cue text was gold: no
                  </button>
                </>
              ) : null}
              {arm.moved ? (
                <>
                  <button className="bs-btn bs-btn--ghost" type="button"
                          onClick={() => updateArm(arm.id, { moved: 'yes' })}>
                    Cue sat higher: yes
                  </button>
                  <button className="bs-btn bs-btn--ghost" type="button"
                          onClick={() => updateArm(arm.id, { moved: 'no' })}>
                    Cue sat higher: no
                  </button>
                </>
              ) : null}
            </div>
            <table className="bs-facts">
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    <td className={row.cls}>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.present === 'no' || r.clipPresent === 'no' ? (
              <p className="bs-no">
                <strong>FILE NOT PRESENT.</strong> The HTTP lines above are the reading. This is
                not a text-track result and must not be transcribed as one — nothing was
                mounted, so nothing was asked to parse or paint a cue. The <code>.vtt</code>{' '}
                files are committed, so a 404 on one of those means this build is serving a
                different tree; the clip is a gitignored binary and its ffmpeg line is in the
                stage-8 readings sheet.
              </p>
            ) : null}
            {active ? (
              <>
                {/* The ::cue arm's whole instrument. Inline, because the TV stylesheet ships
                    no ::cue rule and must not grow one on the strength of an untaken
                    reading — bigscreen.css:978 says exactly that. var() inside ::cue is half
                    the question: a rule that applies with an unresolved custom property is
                    indistinguishable on the panel from a rule that did not apply. */}
                {arm.cueStyle ? <style>{'::cue { color: var(--gold); }'}</style> : null}
                <video
                  className="bs-video"
                  data-subtitle-player={arm.id}
                  ref={subtitleVideoRef}
                  src={arm.clip === null ? BOGUS_VIDEO_SRC : SAMPLES_BASE + arm.clip}
                  preload="metadata"
                  controls
                  onLoadedMetadata={() => sampleArm(arm.id, 'loadedmetadata')}
                  onError={() => sampleArm(arm.id, 'video error (expected on the bogus src)')}
                >
                  {trackMounted ? (
                    <track
                      data-subtitle-track={arm.id}
                      ref={subtitleTrackRef}
                      default
                      kind="subtitles"
                      srcLang="en"
                      label={`cue probe ${arm.reading}`}
                      src={SAMPLES_BASE + arm.vtt}
                      onLoadCapture={() => recordTrackEvent(arm.id, 'load')}
                      onErrorCapture={() => recordTrackEvent(arm.id, 'error')}
                    />
                  ) : null}
                </video>
                <div className="bs-controls">
                  <button className="bs-btn bs-btn--ghost" type="button"
                          onClick={() => sampleArm(arm.id, 'operator pressed Sample this arm')}>
                    Sample this arm now
                  </button>
                  {arm.doubleLoad ? (
                    <>
                      <button className="bs-btn bs-btn--ghost" type="button"
                              onClick={() => callLoadAgain(arm.id)}>
                        Call video.load() again
                      </button>
                      <button className="bs-btn bs-btn--ghost" type="button"
                              onClick={() => setTrackMounted(!trackMounted)}>
                        {trackMounted ? 'Unmount the <track>' : 'Mount the <track> again'}
                      </button>
                    </>
                  ) : null}
                </div>
                {arm.cueStyle ? (
                  <>
                    <p style={{ color: 'var(--muted)', fontSize: 20 }}>
                      Compare the cue’s letter height against these three and transcribe{' '}
                      <strong>which line it matches</strong>, not a judgement. §8.5’s Read floor
                      is the first one.
                    </p>
                    {[24, 32, 40].map((px) => (
                      <p key={px} style={{ fontFamily: 'var(--font-ui)', fontSize: px, margin: '4px 0' }}>
                        {px}px — CUE 1 of 4 reference line
                      </p>
                    ))}
                  </>
                ) : null}
                <p style={{ color: 'var(--muted)', fontSize: 20, wordBreak: 'break-all' }}>
                  {SAMPLES_BASE + arm.vtt}
                  {' · '}
                  {arm.clip === null ? BOGUS_VIDEO_SRC : SAMPLES_BASE + arm.clip}
                </p>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
