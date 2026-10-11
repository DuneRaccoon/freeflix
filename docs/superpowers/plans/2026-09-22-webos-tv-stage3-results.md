# webOS TV — stage 3 gate results

Run: **2026-10-06** (engine and rendering) and **2026-10-07** (playback).
Instance at `http://<host>:3001`, reached from the TV's own built-in browser —
`/bigscreen/diag` for the engine half, the **main web app** for the playback half.

This is the deliverable named in the plan's file table
(`docs/superpowers/plans/2026-09-22-webos-tv-stage1-3-foundations.md`, Task 8 Step 6).

> **How to read this document.** Every row is either a value that was *observed on the television*
> or the words **not tested**. Nothing here is inferred from a model number, a vendor table or a
> desktop browser. Where a cell says "not tested" it is followed by why, and by what would settle
> it. Two entries — HEVC decode and the `webos22` profile name — were **accepted risks** carried on
> documentation rather than measurement, and are labelled as such. *(The naming half was settled in
> stage 8 on 2026-10-11: the profile is `lg-webos22-floor`, carrying the table's provenance and the
> posture instead of a device version. HEVC decode is **still** unmeasured — readings 16, 17 and 23
> of `docs/superpowers/plans/2026-10-11-tv-stage8-device-readings.md`.)* A reader six months from now
> should be able to tell measurement from assumption without leaving this page.

---

## Device

| Fact | Value |
| --- | --- |
| Model number | **not transcribed.** The TV is the 75-inch 2022 LG identified in spec §3.1 as the one Re:New-eligible exception at that size — a **QNED99 8K**. The exact SKU string was not read off Settings → Support → TV Information during the run. |
| Firmware | **not transcribed** (same reason; firmware does not report the engine anyway, per spec §3.1). |
| User-agent | **not transcribed verbatim.** The diagnostics page's verdict banner was read instead — see the next two rows. The full UA string was not copied down. |
| Chromium major | **120** — read from the `/bigscreen/diag` verdict banner, which displayed **`Chromium 120 — modern target`**. |
| Inferred webOS version | **25**, per the mapping table in spec §3.1 (`Chromium 120` ↔ webOS 25). This is the only inferred value in this table, and it is inferred from a *measured* engine version, not from the SKU. |
| innerWidth x innerHeight | **not transcribed.** The diagnostics page displays it; the value was not copied down. |
| devicePixelRatio | **not transcribed**, same reason. |

**The headline: the spec's engine inference was wrong.** The spec reasoned from the 75-inch panel
size to "mainstream 2022 LCD line → webOS 22 → Chromium 87" and told the implementation to build for
87. The measurement says Chromium 120 / webOS 25. The inference was sound and the conclusion was
wrong; the set is the QNED99 8K exception the spec itself named. Sequencing this twenty-minute read
*before* stage 4 is the only reason the cost of being wrong was one `browserslist` line and one guard
list rather than a rebuilt UI.

---

## Feature probes

Observed result: **every probe on the page answered yes.** The individual rows below are therefore
recorded as yes on the strength of "every probe answered yes" being what was read off the banner and
tables — they were not transcribed one by one, but no probe reported a no.

| Probe | Result |
| --- | --- |
| `oklch()` | yes |
| `color-mix()` | yes |
| `:has()` | yes |
| container queries | yes |
| `aspect-ratio` | yes (no probe reported a no) |
| `backdrop-filter` | yes (no probe reported a no) — **supported, and still forbidden.** The ban is a frame-budget decision (spec §9), not an engine one. See "Follow-ups". |
| `CSS.registerProperty` / `@property` | yes |
| `Array.prototype.at` | yes (no probe reported a no) |
| `Object.hasOwn` | yes (no probe reported a no) |
| `structuredClone` | yes (no probe reported a no) |
| `MediaSource` | yes (no probe reported a no) |

This is consistent with Chromium 120: every construct spec §3.1 listed as unavailable (`@layer` 99,
`:has()` 105, container queries 105, `color-mix()` / `oklch()` / `oklab()` 111, `@property` 111,
nesting 112, and the JS entries) lands below 120.

---

## Stylesheet

- All ten token swatches distinct: **yes** — observed on the diagnostics page.
- Display and UI faces visibly different: **not separately confirmed.** The page renders both; the
  run recorded the swatches and the verdict banner, and no font problem was reported, but "visibly
  different" was not called out as an observation.
- Body text readable from the sofa: **not tested.** This is the question stage 4 exists to answer and
  the diagnostics page cannot: see "The Magic-Remote caveat" below. 24px body text at viewing
  distance remains unverified.
- Anything visibly broken: **nothing reported.** Separately, and more usefully: **the existing
  Tailwind v4 web app renders correctly on the TV** at Chromium 120. That was observed during the
  playback run (Part 2), in the main web app rather than the diagnostics page. It retires the
  "Tailwind's `@layer` wrapper is discarded, leaving an unstyled page" failure mode entirely.

---

## Remote

| Button | key | keyCode |
| --- | --- | --- |
| Up / Down / Left / Right | **not transcribed** | **not transcribed** |
| OK | **not transcribed** | **not transcribed** |
| Back | **not transcribed** | **not transcribed** |
| Play / Pause / Stop | **not transcribed** | **not transcribed** |
| Rewind / Fast-Forward | **not transcribed** | **not transcribed** |
| Number key | **not transcribed** | **not transcribed** |

**What was actually observed:** the key log on `/bigscreen/diag` **displayed remote key codes as
expected**. The individual `key` / `keyCode` values were *not* written down, so this document
records none of them. In particular, **keyCode 461 for Back is still an assumption** carried from
LG's documentation (spec §5.2, §8.3) — it has not been confirmed against this set. Stage 7, which
binds 461, should re-read the key log and transcribe the codes before relying on them.

- Left/Right moved the focus ring: **not tested** — not recorded during the run.
- Magic Remote pointer produced a cursor and hover: **yes, and this is a finding, not a footnote.**
  The Magic Remote is a pointer that emits real mouse events. See below.

---

## Playback

Run 2026-10-07, on the TV, through the **main web app** (not the diagnostics page), against a real
library title while its torrent was **still downloading, at ~26%**.

```
The Boys S01E01 The Name of the Game 1080p AMZN WEB-DL DDP5 1 H 264-FLUX.mkv
mime: video/x-matroska
```

| Title | Container / video / audio | Plays | Resolution | Audio | Scrub (downloaded region) | Seek past download point | MediaError |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The Boys S01E01 (1080p AMZN WEB-DL) | `.mkv` (Matroska) / H.264 / DDP5.1 (E-AC3) | **yes — direct play** | not transcribed (the release is 1080p; `videoWidth x videoHeight` was not copied off the metadata line) | **yes** | **yes** — scrubbing worked. Specific offsets were not recorded, so no individual seek distance is claimed | **not tested** — at ~26% downloaded, any seek past that point was not attempted | no problems reported (the overlay's `MediaError.code` was not read) |

**Passed, and why each one matters:**

- **MKV / Matroska container — direct play.** This was the single biggest unknown in the whole
  design. Desktop Chrome cannot demux Matroska at all, and the premise that "the TV's native
  pipeline is better than the browser's" (spec §3.2) rested entirely on it. Confirmed on hardware.
- **DDP5.1 (Dolby Digital Plus / E-AC3) audio.** The library's YTS AAC releases never exercise this
  path. It works.
- **Streaming from an in-progress torrent at ~26%.** The piece-gated generator, sequential download
  and HTTP range handling from stages 1 and 5 all worked end to end on real data, through a real TV
  media pipeline.
- **Seeking within already-downloaded regions.** Scrubbing worked.
- **The existing Tailwind v4 web app renders correctly on the TV.**

**NOT tested. None of the following is a pass:**

| Item | Status | Why it is still open |
| --- | --- | --- |
| **Seeking past the download point** into a not-yet-downloaded region | **not tested** | This is precisely the case the stage-1 first-chunk precheck and the `503` + `Retry-After` work were built for. At ~26% the attempt was not made. **Still unknown on real hardware.** |
| **The far-seek HTTP status probe** ("Probe far seek (HTTP)" on `/bigscreen/diag`) | **not tested** | The 503 path has unit tests (`backend/tests/test_first_chunk_precheck.py`) but has **never been observed from the TV**. A `<video>` element only reports `MediaError.code`, so without this probe the status is unobservable on a device with no devtools. |
| **HEVC / H.265 decode** | **not tested — accepted risk, carried on documentation** | The tested file is **H.264**. The owner's decision was to accept HEVC on documentation rather than measurement: LG's AV table lists HEVC Main/Main10 for webOS **22**, and this set is **two platform versions newer** (webOS 25), so the newer table is at least as permissive. That is a reasoned acceptance, **not a result**. If HEVC fails in the field, the lever is torrent selection (spec §7.2) — an HLS remux is unavailable on a Pi. |
| **DTS at 1080p** | **not tested — untouched** | The question spec §7.2 explicitly left unresolved: LG dropped DTS decode in some model years and which years is unverified. No DTS file was played. The profile keeps DTS-at-1080p as a *penalty*, not a reject, and that remains unvalidated either way. |
| **Seek into an undownloaded region returned 503 (not a silent stall)** | **not tested** | Same as the first two rows. Recorded here because the template asks it directly: the answer is neither yes nor no. |

---

## Verdict

**→ TAKEN, 2026-10-06: "Proceed, simplified."** The second of the plan's four branches.

Engine at or above 111 — the existing Tailwind v4 stylesheet renders (and was subsequently observed
rendering correctly in the main web app on the TV). The separate `(bigscreen)` surface is kept: the
focus, 10-foot layout and player work is unchanged, and "the TV surface may use the normal build" is
*permission*, not instruction. Taking it would drag the hover-driven rails and the §9 blur stacks
onto TV silicon.

Actions taken on `master`:

1. `"browserslist": ["chrome 87"]` removed from `frontend/package.json`. Measured recovery:
   `/downloads` 8.71 → 4.45 kB, `/members` 8.8 → 4.55 kB, `/streaming/[id]` 24.6 → 20.2 kB.
2. `frontend/src/app/(bigscreen)/legacy-target.test.ts` **split by rationale** rather than relaxed
   wholesale. The engine-driven bans are gone; the performance-driven ones (`backdrop-filter`,
   `mix-blend-mode`, `filter: blur()`, SVG filters, plus the `framer-motion` / `globals.css` /
   `@/components` import bans) are kept in a separately commented list naming spec §9 as their
   authority, so a future engine reassessment cannot take them with it.
3. **Not** done, deliberately: the `(web)` / `(bigscreen)` split stays; `public/bigscreen.css` stays
   hand-authored and outside PostCSS.

The playback half (2026-10-07) does not change this verdict. It **strengthens** it on the media
path — MKV direct play and in-progress-torrent streaming were the two genuine unknowns and both
passed — while leaving the three items above untested.

### The Magic-Remote caveat, and what it does to stage 4

The owner reported that the main web app "works perfectly" on the TV. That is true **through the
Magic Remote, which is a pointer** — it emits real mouse events, so hover-driven rails and
click-to-play card overlays behave as they do on a desktop. Spec §8.4 already called this "a trap"
and it is: it does **not** follow that the UI works on the **D-pad**, nor that 24px body text is
readable at viewing distance.

So **stage 4's justification narrows**:

- It is needed for **D-pad navigation** — the web UI's browse surface has no focus management:
  `scrollIntoView` is never called from it, nothing in it calls `.focus()`, and a `PosterCard`
  has four focus stops (`Link` :166, `a` :208, `button` :222, `a` :242), so a 20-item rail is
  ~80 D-pad presses. (The only `.focus()`/`scrollIntoView` calls in the repo are in
  `ui/fre/Modal.tsx` and the diagnostics page built in stage 3.)
  safe-area insets, focus-ring visibility).
- It is **not** needed for rendering or CSS compatibility. That justification is gone — the engine is
  Chromium 120 and Tailwind v4 renders on the set.

That is a materially smaller job than the spec assumed.

---

## Follow-ups discovered

1. **Seek past the download point is still unverified on hardware.** Highest-value remaining gate
   item, and the cheapest: load a title at a low download percentage, press "Probe far seek (HTTP)"
   on `/bigscreen/diag`, and record the full readout (HEAD status, GET status, `Retry-After`,
   `Content-Range`). Belongs before or alongside stage 7, which is where the TV player must honour
   the 503.
2. **Transcribe the remote key codes.** Observed as "displaying as expected", but no code was
   written down — including the 461 that spec §5.2 and §8.3 bind for Back. Do this before stage 7
   relies on it.
3. **RESOLVED in stage 8 (2026-10-11).** The profile is `client=lg-webos22-floor`, still built
   from LG's webOS 22 AV table — not re-derived from the webOS 25 one. The decision, in short: the
   engine was upgraded by software but the decoder silicon is 2022, so the 22 table is the *safer*
   derivation for this set rather than merely a conservative one, and the name now carries the
   table's provenance (`webos22`) and the posture (`-floor`) instead of claiming a device match.
   Nobody has read LG's webOS 25 table in any form, and "webOS 25" is itself inferred from the
   measured Chromium 120 — the model SKU and the verbatim user agent are **both still
   untranscribed** (reading 26). A later *measured* profile gets a new id, never a quiet edit to
   this one's rules. See spec §7.2 and
   `docs/superpowers/plans/2026-10-11-tv-stage8-codec-profile.md`.
4. **HEVC and DTS-at-1080p remain unmeasured.** HEVC is an accepted documentation-backed risk; DTS is
   untouched. Both are naturally settled during stage 8, which needs real files to validate the
   profile against anyway.
5. **`backdrop-filter` and friends are supported by the engine and still banned.** The guard test now
   says why in its own comments. Do not delete those bans on the grounds that "Chromium 120 supports
   it" — a newer engine does not make a 2022 TV GPU faster.
6. **Device facts not captured:** model SKU, firmware, verbatim UA, `innerWidth`/`innerHeight`,
   `devicePixelRatio`. None is load-bearing now that the engine is measured, but a future
   reassessment would want them. They are one visit to `/bigscreen/diag` away.
