# webOS TV — stage 8 codec profile: device readings

Run: **NOT TAKEN.** Replace this line with the date (or dates) when the readings are taken, as
`2026-09-22-webos-tv-stage3-results.md` does, and say which sitting produced which rows.

Deliverable named in `docs/superpowers/plans/2026-10-11-tv-stage8-codec-profile.md`, task 10,
whose eleven rows are enumerated in that plan's **"On the television"** section. Rule ids (R1-R10)
are that plan's **"The rules table"** and are implemented in
`backend/app/services/capability.py`; the row ids below are the same ids its `READINGS_ROWS`
tuple carries, and task 4's integrity tests assert in **both directions** that every rule's
`settled_by` names a row here and that every row is claimed by a rule or marked standalone.

**Companion sheet, and this one is deliberately separate:**
`docs/superpowers/plans/2026-10-10-tv-stage7-device-readings.md` holds rows **1-15** (the stage-7
player). Numbering is globally continuous and unique, so stage 8 begins at **16** — but it is a
new file, not an append, because that sheet's verdict is a *stage-7* verdict gated on its rows
1-3 and is still **NOT REACHED**. Mixing stage-8 rows into it would let one verdict answer for
two stages, and would let a taken stage-8 reading mask an untaken stage-7 gate.

> **How to read this document.** Four rules, inherited verbatim from the stage-7 sheet.
>
> 1. **Every cell is either a string transcribed verbatim off the television, or the words
>    "not taken".** Nothing here may be inferred from a model number, a vendor table, a desktop
>    browser, or a jsdom test. Where a row says "not taken" it is followed by what is therefore
>    still unknown and what it blocks.
> 2. **A blank cell is a failure, not a pass.** That is why every cell below already reads
>    **not taken**: there is no state this document can be in where an unanswered question looks
>    answered. Do not delete a row you did not take; do not write "ok", "works" or "as
>    expected" — those are summaries, and a summary is what was lost last time.
> 3. **Transcribe the raw string.** `MediaError.code=4` and "HEVC does not work" are not the
>    same reading. The codec section of `/bigscreen/diag` prints `MediaError.code`,
>    `videoWidth x videoHeight`, `duration` and `readyState` already in the right form: copy them
>    character for character, including a `NaN` or a `0 x 0`.
> 4. **This document has no test, deliberately.** Its failure mode is a visible blank, and a test
>    asserting that a markdown table is filled in would be a test about markdown. The *instrument*
>    is tested (`bigscreen/diag/page.test.tsx`, eleven tests added by task 10) and the *table's*
>    integrity is tested in Python (`READINGS_ROWS` plus task 4's two-direction cross-reference).
>    Neither proves that any codec decodes.
> 5. **Measurement vs assumption is called out per row** and summarised at the end. Stage 8 ships
>    seven rules of which **one** rests on a measurement, and that measurement was taken through
>    the main web app on a release name rather than on a file.

---

## THE SEQUENCING CONSTRAINT — take stage 7's rows 1-3 first

**No document other than this one states it, and it decides whether any reading below means
anything.**

**Nothing in stages 4, 6 or 7 has ever run on this television.** Stage 7's three gates are
untaken, and gate 1 is the dangerous one: `dependencies/auth.py` short-circuits to `_DEV_CONTEXT`
when auth is off, and `/bigscreen/diag`'s own header tells the operator to turn auth off — so it
is entirely possible that **playback on this set has only ever been observed with
`AUTH_ENABLED=false`**, including the successful 2026-10-07 MKV run that clip 4 reproduces.

So a failed reading 16 has **two** candidate causes — an HEVC fact or a player fact — and this
sheet cannot tell them apart. **Take stage 7's rows 1, 2 and 3 first**, in that sheet, and say in
its Run line that you did. Then come back here.

Two more constraints on the sitting, for the same reason:

- **A reading taken through the main web app measures nothing about selection.** The web app
  sends no `client` profile at all (task 6: `client` is a `Literal` on `TorrentRequest` and only
  the TV sends it), so a web-app playback exercises the unprofiled ranking — which is exactly
  what the 2026-10-07 sitting did. Rows 23, 24 and 25 must be taken from the **television's own**
  screens or they are not about this stage.
- **Rows 16-18 and the control clip need no backend at all.** The clips are served by Next.js
  static from `frontend/public/samples/`, so there is no torrent, no FastAPI, no auth gate and no
  ARM download cap in the path. That is why they are the cheap rows, and why a failure in them is
  attributable to the decoder rather than to four other layers.

---

## The eleven rows

| # | Reading | Gates "done"? | Instrument | Status |
| --- | --- | --- | --- | --- |
| **16** | HEVC Main 8-bit at 1080p direct-plays | **YES — gate A** | diag **clip 1** | **not taken** |
| 17 | HEVC Main10 at 1080p direct-plays | no | diag **clip 2** | **not taken** |
| **18** | DTS at 1080p — **and whether a failure is a silent-but-playing picture or a hard `MediaError`** | **YES — gate B** | diag **clip 3** + the operator's audio answer | **not taken** |
| 19 | DTS-HD MA and TrueHD at 1080p | no | real file | **not taken** |
| 20 | AV1 at 1080p | no | real file (see the note in that row) | **not taken** |
| 21 | A Dolby Vision MKV — or **"no sample in this library"** recorded as such | no | real file | **not taken** |
| 22 | A `.mp4` and a `.ts` from the library play | no | real files | **not taken** |
| **23** | One genuine 2160p HEVC release plays **end to end off a still-downloading torrent** | **YES — gate C** | real release, tens of GB, ARM cap of two | **not taken** |
| 24 | DTS or TrueHD at 2160p | no | real release | **not taken** |
| 25 | Sustained bitrate of a 2160p title that plays versus one that stalls, **stating which it measured** | no | real releases | **not taken** |
| 26 | Model SKU and verbatim `navigator.userAgent` | no | `/bigscreen/diag` | **not taken** |

**Which rules each row settles**, from the plan's rules table — the other direction is asserted in
Python, so this column and `capability.py` cannot drift apart silently:

| Row | Settles | Row | Settles |
| --- | --- | --- | --- |
| 16 | **R9** (confirm, or invert HEVC to a reject) | 22 | **R7**'s premise — *standalone* |
| 17 | **R9**'s 10-bit half | 23 | the 4K opt-in's "done" claim |
| 18 | **R3** — promote out of `shadow` | 24 | **R2**, the only AV reject |
| 19 | **R4** — promote or retire | 25 | **R10** — reinstate it |
| 20 | **R6** — retire or re-justify | 26 | *standalone* |
| 21 | **R5** — retire or confirm | — | — |

**Posture: merge on green tests, hold the stage's "done" claim.** Exactly as stage 7's does.
Rows 16, 18 and 23 are what make the profile true and all three are untaken. What may be claimed
today is that the tests are green, that the rule table is honest about its own provenance, and
that the unprofiled ordering is byte-identical to `master`'s. **Not claimable:** that HEVC
decodes, that DTS at 1080p plays, that a 2160p release streams off a partial torrent, or that the
profile is *correct about files* rather than about titles.

---

## Before the sitting: the four clips, and why none of them exists

`/bigscreen/diag` → **Codec clips (stage 8)**. Four clips, **one AV variable each**, read over
plain HTTP from `frontend/public/samples/` at `http://<host>:3001/samples/…`.

**The clips are gitignored (`frontend/.gitignore`) and they are not in this repository, and none
of them could be produced from the machine that wrote the instrument.** Stage 8's decision 3
settles that the stage ships anyway, and the consequence is deliberate: **"FILE NOT PRESENT" is a
tested, first-class rendered state** on that page, not an afterthought. It has to be, because
**a 404 and a codec the panel cannot decode both end with no picture and `MediaError.code` cannot
tell them apart** — so the page HEADs each clip first and prints the raw status. Without that,
"stage 8's profile is wrong" and "nobody copied the files over" are the same reading.

| Clip | File name (exact) | Variable | Row |
| --- | --- | --- | --- |
| 1 | `clip1-1080p-hevc-main8-ac3.mkv` | HEVC **Main**, 8-bit | **16** |
| 2 | `clip2-1080p-hevc-main10-ac3.mkv` | HEVC **Main10**, 10-bit | 17 |
| 3 | `clip3-1080p-h264-dts51.mkv` | **DTS 5.1** audio | **18** |
| 4 | `clip4-1080p-h264-eac3.mkv` | **none — this is the control** | precondition P |

### Precondition P — the control clip, which is not a numbered reading

Clip 4 reproduces the **one AV combination this project has ever measured**: the 2026-10-07
sitting's 1080p H.264 MKV with a DDP5.1 (E-AC3) track. It settles no rule. Its job is
attribution: if clip 4 is red, the instrument, the mux or the file is wrong and **nothing below
is about the panel**. Read it first; record it here anyway, because an unrecorded control is a
control nobody can check.

| Fact | Reading |
| --- | --- |
| HTTP line for clip 4, verbatim | **not taken** |
| `MediaError.code` | **not taken** |
| `videoWidth x videoHeight` | **not taken** |
| `duration` | **not taken** |
| `readyState` | **not taken** |
| Did sound come out of the television? | **not taken** |

**Measurement vs assumption:** the *combination* is measured (2026-10-07); **the clip is not that
file.** The original was a multi-gigabyte release streamed off a ~26%-complete torrent through
FastAPI, and clip 4 is a short file served by Next.js static. The container is held at `.mkv` to
keep the comparison honest, but the mux is a different mux.

### The ffmpeg command lines — **written down, never run**

**Every one of the four lines below was written down and NOT RUN.** No ffmpeg exists on the
machine that produced them. They are here so that producing the clips is one paste rather than a
research task, and they are labelled so that nobody mistakes an untried command for a verified
one. **If a line turns out to be wrong, fix it here and say so in the row it serves** — a command
line that was never run *and* is also wrong is worse than one labelled as untried.

**Check the encoder names before trusting any of this.** Three facts below are **recalled, not
measured**, and one command uses each:

```bash
ffmpeg -encoders | grep -E 'libx265|^ V|dca|eac3|ac3'   # NOT RUN
```

1. **ffmpeg's DTS encoder is `dca`**, it is marked **experimental** (so it needs `-strict -2`),
   and it produces **DTS core only** — no DTS-HD extensions. That is *exactly* what reading 18
   wants, and it is also why **reading 19 (DTS-HD MA / TrueHD) needs a real file rather than a
   clip**: this encoder cannot produce one.
2. **E-AC3 is `eac3`** and **AC3 is `ac3`.**
3. **HEVC Main10 needs BOTH `-pix_fmt yuv420p10le` AND an explicit `profile=main10`**, because
   the pixel format alone does not set the profile tag a decoder reads — and the profile tag is
   what reading 17 is about.

Also recalled rather than measured, and worth a glance if a command fails: that this ffmpeg is
built with `libx265` at all and with 10-bit support (most multilib builds are); that `aevalsrc`'s
`c=` takes a channel layout name and one expression per channel; and that Matroska accepts AC3,
E-AC3 and DTS tracks (§3.2 lists all three in the generic `.mkv` row).

**Clip 1 — 1080p HEVC Main 8-bit + AC3** *(written down, NOT RUN)*

```bash
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=24:duration=20 \
       -f lavfi -i sine=frequency=440:duration=20 \
       -c:v libx265 -preset medium -pix_fmt yuv420p \
       -x265-params profile=main \
       -c:a ac3 -b:a 192k -ac 2 \
       -shortest frontend/public/samples/clip1-1080p-hevc-main8-ac3.mkv
```

**Clip 2 — 1080p HEVC Main10 + AC3** *(written down, NOT RUN)* — one variable away from clip 1:

```bash
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=24:duration=20 \
       -f lavfi -i sine=frequency=440:duration=20 \
       -c:v libx265 -preset medium -pix_fmt yuv420p10le \
       -x265-params profile=main10 \
       -c:a ac3 -b:a 192k -ac 2 \
       -shortest frontend/public/samples/clip2-1080p-hevc-main10-ac3.mkv
```

**Clip 3 — 1080p H.264 + DTS 5.1** *(written down, NOT RUN)* — the video is deliberately the
measured codec, so the only new variable is the audio:

```bash
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=24:duration=20 \
       -f lavfi -i "aevalsrc=sin(440*2*PI*t)|sin(440*2*PI*t)|sin(440*2*PI*t)|sin(440*2*PI*t)|sin(440*2*PI*t)|sin(440*2*PI*t):c=5.1:d=20" \
       -c:v libx264 -preset medium -pix_fmt yuv420p \
       -c:a dca -strict -2 -ac 6 -ar 48000 \
       -shortest frontend/public/samples/clip3-1080p-h264-dts51.mkv
```

**A tone in all six channels is on purpose.** Reading 18's whole point is that a DTS track this
set cannot decode is **silent and raises no error**, so the clip must be unambiguously audible
*if* it decodes. If the operator hears nothing, the reading is "silent", and that is a verdict
about the decoder — not about the file.

**Clip 4 — 1080p H.264 + E-AC3, the control** *(written down, NOT RUN)*

```bash
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=24:duration=20 \
       -f lavfi -i sine=frequency=440:duration=20 \
       -c:v libx264 -preset medium -pix_fmt yuv420p \
       -c:a eac3 -b:a 256k -ac 2 \
       -shortest frontend/public/samples/clip4-1080p-h264-eac3.mkv
```

**A synthetic pattern is a weaker test than a real encode, and that is accepted.** `testsrc2`
produces flat, trivially compressible frames, so these clips exercise **whether the decoder
accepts the profile**, not whether it keeps up at a release bitrate. Reading 23 is the bitrate
test. If a real 20-second excerpt is to hand, the honest substitution is the same command with
`-ss 00:10:00 -t 20 -i <release>.mkv` in place of the two `lavfi` inputs — **also never run** —
and the row must then say which was used.

---

## Reading 16 — Does HEVC Main 8-bit direct-play at 1080p? **(gate A)**

`/bigscreen/diag` → **Codec clips** → `Load clip1-1080p-hevc-main8-ac3.mkv` → press Play on the
element's own controls → read the four machine fields → answer the sound question.

**What it closes.** **R9 (`documented-ok`), and with it the 4K opt-in.** HEVC decode on this set
is accepted on **documentation alone** — §3.2's generic `.mkv` row — and `basis='lg-table'` with
"decode unmeasured" written into the rule. R9 admits HEVC deliberately, because it is the only 4K
video codec besides H.264 that §3.2's Ultra HD table allows, so discouraging it would make the
4K opt-in return nothing at all.

| Fact | Reading |
| --- | --- |
| HTTP line, verbatim | **not taken** |
| `MediaError.code` | **not taken** |
| `videoWidth x videoHeight` | **not taken** |
| `duration` | **not taken** |
| `readyState` | **not taken** |
| Did sound come out of the television? | **not taken** |
| Did the picture move, or was it a still frame? | **not taken** |
| `canPlayType` (advisory — **gates nothing**) | **not taken** |

**If negative, the consequence is the largest in the stage: R9 inverts.** HEVC becomes a
**reject** at every resolution and the 4K opt-in is **withdrawn**, because §3.2 permits only
H.264 and HEVC at 2160p and H.264 2160p releases are rare. That is a rule-table edit plus a cell
removal on the TV's movie screen, not a weight change.

**Read it together with the control.** A red 16 with a red clip 4 is an instrument fault. A red 16
with a **green** clip 4 is the panel, because the two clips differ in exactly one variable.

**Measurement vs assumption today:** pure assumption. Nothing on this television has decoded HEVC,
and the stage-7 sheet already carries "HEVC / H.265 decodes" as a named assumption pointing here.

---

## Reading 17 — Does HEVC Main10 direct-play at 1080p?

Same procedure, `clip2`.

**What it closes.** **R9's 10-bit half.** §7.2 names "HEVC 8/10-bit" in one breath, but Main and
Main10 are **different decoder profiles** and a panel can ship one without the other. The profile
has no bit-depth gate at all (see "What the television loses" in the plan), so a 12-bit HEVC is
treated as 10-bit today.

| Fact | Reading |
| --- | --- |
| HTTP line, verbatim | **not taken** |
| `MediaError.code` | **not taken** |
| `videoWidth x videoHeight` | **not taken** |
| `duration` | **not taken** |
| `readyState` | **not taken** |
| Did sound come out of the television? | **not taken** |
| `canPlayType` (advisory — **gates nothing**) | **not taken** |

**If 16 passes and 17 fails**, R9 splits: HEVC 8-bit stays a tier-B bonus and 10-bit becomes a
cost or a reject. That needs `facts.bit_depth`, which task 2 already parses (8/10/12, co-required
with a codec token) — so the input exists and only the rule would be new.

**Measurement vs assumption today:** pure assumption, and a *different* one from row 16's. Nothing
in this repo distinguishes the two profiles anywhere.

---

## Reading 18 — DTS at 1080p, and **which kind** of failure **(gate B)**

Same procedure, `clip3`. **Then answer the sound question, because that is the reading.**

**The second half of this row is asked by no other document in this repo**, and it is what decides
the rule: **a DTS track this set cannot decode plays a silent picture and raises no error at
all.** A code-only readout would therefore log this row as a **pass over a silent film**.

| Fact | Reading |
| --- | --- |
| HTTP line, verbatim | **not taken** |
| `MediaError.code` | **not taken** |
| `videoWidth x videoHeight` | **not taken** |
| `duration` | **not taken** |
| `readyState` | **not taken** |
| **Did sound come out of the television?** | **not taken** |
| Did the picture play while the sound was absent? | **not taken** |

**The three outcomes, and what each one does to R3 (`dts-at-1080p`, `basis='guess'`, `shadow`):**

| Outcome | Verdict | R3 becomes |
| --- | --- | --- |
| Picture **and** sound | DTS decodes | R3 is **retired** — the penalty is deleted, not promoted |
| Picture, **no** sound | DTS is silent | R3 is promoted `shadow` → **`in_force`** (a one-cell edit to `state`) |
| No picture, a `MediaError` | DTS is a hard failure | R3 becomes a **reject**, and its `basis` must be upgraded out of `guess` first — only `lg-table` and `product` may reject |

**Why it ships in shadow until then.** Stage 8's decision 1: §7.2's own cell calls the rule
*unverified* (LG dropped DTS decode on some model years and which years is unknown), so until this
row exists a 1080p DTS release is chosen exactly as it is today. The cost is that a viewer may land
on a silent film and press Back; the cost of *not* shadowing is a guess that reorders the whole
library with no retirement path. **This row is the retirement path**, and it is one clip.

**Measurement vs assumption today:** pure assumption, inherited from the stage-7 sheet's "DTS at
1080p" row, which now points here.

---

## Reading 19 — DTS-HD MA and TrueHD at 1080p

**Needs a real file, not a clip** — ffmpeg's `dca` encoder produces **DTS core only** (recalled;
see the encoder check above), so no command in this sheet can make one. Find a 1080p release whose
title names `DTS-HD.MA` or `TrueHD`, play it on the TV, and answer the same questions as row 18.

| Fact | Reading |
| --- | --- |
| Release title, verbatim | **not taken** |
| `MediaError.code` from the player's status line | **not taken** |
| Did sound come out? | **not taken** |
| Did the picture play without it? | **not taken** |

**What it closes.** **R4 (`dtshd-truehd-at-1080p`)**, which is a *separate rule* from R3 on
purpose: §7.2's 1080p cell says only "DTS" while §3.2 lumps four codecs at 2160p, and nothing
states which the 1080p rule covers. One merged rule would silently decide that question.

**A caveat this row cannot escape (hazard 9).** A title names **tracks**, not the track that
plays. A `DTS-HD.MA.TrueHD.7.1` release very often also carries a compatibility AC3 track, and
the set may pick it — in which case sound comes out and **this row has measured the fallback, not
the codec**. Record which audio track the television reported if its player UI shows one, and say
so if it does not.

**Measurement vs assumption today:** pure assumption.

---

## Reading 20 — AV1 at 1080p

**Instrument: a real file.** Find a 1080p AV1 release (the title will name `AV1`), play it, record
the status line.

> **A plan inconsistency, recorded rather than resolved.** Stage 8's decision 3 lists "rows 16,
> 17, 18 and **20**" as needing clips produced off-device with ffmpeg, but the plan's own reading
> table gives row 20 the instrument "real file", and the four clips task 10 specifies contain **no
> AV1**. The four clips settle 16, 17 and 18 plus the control. If this library has no AV1 release,
> a fifth clip is the cheap answer — `-c:v libaom-av1 -crf 30 -cpu-used 8` or `-c:v libsvtav1`
> (both **recalled, never run**, and `libaom-av1` is famously slow at default settings).

| Fact | Reading |
| --- | --- |
| Release title (or clip command), verbatim | **not taken** |
| `MediaError.code` | **not taken** |
| `videoWidth x videoHeight` | **not taken** |
| Did it play smoothly, or drop frames? | **not taken** |

**What it closes.** **R6 (`av1`)**, which ships **in force** despite being the weakest-grounded
cost in the table: §7.2's own parenthetical scopes the AV1 penalty to "2022 LCDs", a class this
QNED99 is **not** in. It stays in force only because §11.2 — the one written definition of this
stage's selector test — requires the profile to "penalise AV1", and a non-reordering term would
contradict it. A green row here **retires** R6; a red one **re-justifies** it on this panel
rather than on a class it does not belong to.

**Measurement vs assumption today:** assumption, and one whose stated scope excludes this device.

---

## Reading 21 — A Dolby Vision MKV, or "no sample in this library"

**If this library has no Dolby Vision release, write "no sample in this library" in the cell.**
That is a reading. A blank is not.

| Fact | Reading |
| --- | --- |
| Release title, verbatim (or "no sample in this library") | **not taken** |
| `MediaError.code` | **not taken** |
| Did the picture look washed out / wrongly tone-mapped rather than fail outright? | **not taken** |

**What it closes.** **R5 (`dolby-vision`)**, `basis='lg-doc'` — §3.2 names "Dolby Vision Profile 8
in MKV" as a known direct-play failure. R5 **drops the `in MKV` qualifier** deliberately: the
container is unknowable at selection time, so applying it unconditionally is strictly more
conservative.

**Its input is lossy, not absent, and that matters here.** `_HDR` at `providers/quality.py:40`
*does* match a bare `DV` token; what it misses is exactly `DoVi`, `HLG` and dotted
`Dolby.Vision` (`\s*` does not match `.`). Task 2's `dynamic_range` field was written from scratch
to cover all of those. So a DV release whose title spells it `DoVi` was **invisible to this rule
before stage 8**, and if this row is taken on such a release, record the exact spelling in the
title — it is the thing the parser keys on.

**Measurement vs assumption today:** assumption carried from LG's documentation, for a profile
(Profile 8) the release title may not even state.

---

## Reading 22 — Does a `.mp4` and a `.ts` from the library play? *(standalone)*

Two real files from the library, one of each container, played on the television.

| Container | Release title, verbatim | Result |
| --- | --- | --- |
| `.mp4` | **not taken** | **not taken** |
| `.ts` | **not taken** | **not taken** |

**What it closes.** **R7's premise** — and R7 (`container-proxy-xvid-divx`) is the rule most likely
to be wrong for a reason nobody notices. It is **named a codec proxy, not a container rule**,
because the real container is not knowable at selection time: the provider returns seven keys and
no file list, a season pack's torrent name is a directory name, and nothing in the image can probe
a file before the decision. It fires only on a positively identified `xvid|divx` token, so
**`container_guess is None` is always free.**

The premise it rests on is that `.mkv/.mp4/.ts` are the containers that work — and **only `.mkv`
has ever been measured.** Meanwhile `settings.video_extensions` (`config.py:138-141`) admits
**sixteen** extensions, **thirteen** of them outside that allow-list, each served with a real MIME
type by `api/streaming.py:32-49`. This row measures two of the three allowed ones. *Standalone:* no
rule's `settled_by` points at it, which is why `READINGS_ROWS` marks it so.

**Measurement vs assumption today:** `.mkv` is measured (2026-10-07). `.mp4` and `.ts` are
assumptions from §3.2.

---

## Reading 23 — One genuine 2160p HEVC release, end to end, off a still-downloading torrent **(gate C)**

**The one row no clip can fake, and the schedule risk of the whole stage.** Needs a real 2160p
HEVC release — tens of gigabytes — started from the television's own 4K cell, with the ARM
download cap of two in force, played from the beginning while the torrent is still downloading.

| Fact | Reading |
| --- | --- |
| Release title, verbatim (off `/streaming/{id}/info` → `video_file.name`) | **not taken** |
| Download percentage when playback started | **not taken** |
| `device_verdict` / `device_reasons` the TV disclosed for the chosen release | **not taken** |
| Did it reach the end without a stall the player could not recover from? | **not taken** |
| Every `MediaError.code=…` seen on the way, verbatim | **not taken** |
| Number of stalls, and roughly where | **not taken** |

**What it closes.** The 4K opt-in's **"done" claim, and nothing else.** It is also the only test of
the Pi-throughput risk, which was lowered on a **single 1080p observation** — a 2160p release is
several times the bitrate through the same ARM board, the same libtorrent session and the same
deadline queue.

**Transcribe the release title by hand, because nothing persists it (hazard 15).** `Torrent` has
no release-title column and `meta_data` holds five display fields, so after the fact the database
cannot answer "what did the profile pick, and why". `TorrentCandidate.release_title` **does** exist
(`models.py:200`), so `/sources` has the name — it is the *started* torrent that forgets.

**Measurement vs assumption today:** assumption. The nearest measurement is a 1080p H.264 stream at
~26% complete, which is a different bitrate, a different codec and a different decoder path.

---

## Reading 24 — DTS or TrueHD at 2160p

A real 2160p release whose title names DTS, DTS-HD MA or TrueHD, requested with the 4K cell.

| Fact | Reading |
| --- | --- |
| Release title, verbatim | **not taken** |
| Was it **rejected** by the profile (the TV disclosed `incapable`)? | **not taken** |
| If it was played anyway (profile off / web app): did sound come out? | **not taken** |
| `MediaError.code`, verbatim | **not taken** |

**What it closes.** **R2 (`dts-family-at-2160p`)** — the **only AV reject in the table**, and the
only rule with a published table row behind it (§3.2's Ultra HD table: only H.264/HEVC video and
only DD / DD+ / AAC audio at 3840x2160). Documentation-only today.

**The deviation this row should be read against.** R2 rejects on the **carrier**, not on the word
"Atmos". Atmos rides on E-AC3 (streaming — which §3.2 **permits** at 4K) or on TrueHD (disc —
which it **forbids**), so a literal reading of §7.2's "DTS / DTS-HD / TrueHD / **Atmos** at 2160p"
would reject a perfectly legal `DDP5.1.Atmos` 4K release. The profile vetoes the carrier instead,
and that is recorded as a **deliberate deviation from LG's own wording** in the rule's `why` and in
spec §7.2.

**Measurement vs assumption today:** assumption from a vendor table — the strongest basis in the
stage, and still not a reading.

---

## Reading 25 — Sustained bitrate: a 2160p title that plays versus one that stalls

Two real 2160p releases, one of each behaviour. Record the **sustained** rate, not the peak.

| Fact | Release that played | Release that stalled |
| --- | --- | --- |
| Release title, verbatim | **not taken** | **not taken** |
| File size and runtime (for bytes ÷ runtime) | **not taken** | **not taken** |
| Implied average Mbps | **not taken** | **not taken** |
| Where it stalled, and for how long | **not taken** | **not taken** |

**This row must state what it measured, and it cannot separate the two candidates.** A 2160p title
that stalls may be a decoder refusing a bitrate **or** a Raspberry Pi and a swarm failing to
deliver one. Say which one the reading is about, or say that it cannot tell — **"it stalled" with
no number is the failure mode this whole sheet exists to prevent.**

**What it closes.** **R10 (`hevc-2160p-over-60mbps`)**, which ships as a real row with
`effect=NONE`, `basis='no-input'` and the reason *"bytes ÷ runtime: no runtime reaches the
selector; see row 25"*. §3.2's HEVC 4K row is `maximum 60 Mbps`, and the ceiling is **NOT
IMPLEMENTED** because there is no runtime at the decision point: `rank_candidates` receives
`List[TorrentHit]`, which carries `bytes` and no duration; `resolve_title_year`'s cache-hit branch
reads `CatalogItemCache`, which has no runtime column; `catalog_items.detail_json` holds
`MovieDetail.runtime` but `set_detail` is skipped when `with_qualities=False` — the mode the TV's
own detail load uses — and `services/tv.py` never calls it at all. Add a season pack whose `bytes`
cover N episodes against a one-episode runtime, a `bytes == 0` the selector already distrusts, and
a minutes-read-as-seconds 60x error in the *rejecting* direction: five ways to be silently wrong.

**The named follow-up, so the next reader does not re-derive it.** `movies.detail` calls
`tmdb.movie_details` **unconditionally** (`services/movies.py:70`), before the `with_qualities`
branch at `:79`, and already upserts at `:86-94` through `upsert_list_item(**fields)`, which
`setattr`s whatever it is passed. A **nullable `runtime` Integer** on `catalog_items` (auto-added
by `sync_columns`) plus `runtime=base.runtime` is a one-line, **zero-extra-HTTP** write on the exact
call the TV already makes. Movies only; TV needs its own cache write. A dedicated column rather
than a read of `detail_json`, deliberately: stage 4's parked finding 10 established that reading
`detail_json` is a trap, because `available_qualities` is derived from the **live** torrent search
and serving the blob from cache would silently stale the detail screen's quality list. And note
`tmdb.movie_details` returns `None` without `TMDB_API_KEY`, which is **commented out in this repo's
`.env`** — so even once implemented the rule cannot fire on this box until that key is set.

**What the television loses in the meantime, stated plainly:** with 4K opted in there is **no
bitrate ceiling**. There is partial cover and **it is an accident, not a design** — UHD remuxes are
overwhelmingly DTS-HD MA or TrueHD, so R2 rejects most of them for entirely the wrong reason, and
a **DD+ 4K remux at 80 Mbps passes every rule in the profile.**

**Measurement vs assumption today:** neither. There is no input, so there is not even a guess —
which is why the rule's effect is NONE rather than a number nobody measured.

---

## Reading 26 — Model SKU and the verbatim `navigator.userAgent` *(standalone)*

`/bigscreen/diag` → the **Device** table and the verdict banner. Also the model number off the
television's own Settings > Support screen, and its firmware string.

| Fact | Reading |
| --- | --- |
| Model SKU, off the set's Settings screen | **not taken** |
| Firmware version | **not taken** |
| `navigator.userAgent`, **verbatim and complete** | **not taken** |
| `innerWidth x innerHeight` | **not taken** |
| `screen.width x height` | **not taken** |
| `devicePixelRatio` | **not taken** |

**What it closes.** The provenance of the whole profile name. `lg-webos22-floor` is named after the
AV table its rules are derived from (LG's webOS **22**), **not** after the device: nobody on this
project has read LG's webOS 25 AV table in any form, and "webOS 25" is itself an *inference* from
the measured Chromium 120 through spec §3.1's mapping. **These two strings are the only facts that
could ever justify re-deriving the rules from a newer table** — and they have been untranscribed
since stage 3, which is also follow-up 2 on the stage-7 sheet.

**And the argument that survives either way, which needs no internet.** The engine was upgraded by
software; **the decoder silicon is 2022.** `legacy-target.test.ts:21-24` already states the
principle for CSS — a newer browser engine does not make a TV GPU faster — and CLAUDE.md repeats
it. LG's webOS 25 table describes 2025 model-year hardware; applying it to a Re:New-upgraded 2022
panel claims decoders this panel may never have had. **So the webOS 22 table is the *safer*
derivation for this specific set, not merely a conservative one.** A later *measured* profile is a
**new id** (`lg-qned99-measured`), never a quiet edit to this one's rules.

**Measurement vs assumption today:** Chromium **120** is measured (stage-3 sitting). webOS 25 is an
*inference from* that measurement. The SKU and the verbatim UA are neither — they were read on the
set and not written down, which is the same failure as the stage-3 key log.

---

## Verdict

**→ NOT REACHED.** Fill this in as stage 3's results document does, and state which of the three
gates (A = row 16, B = row 18, C = row 23) were transcribed. Until those rows carry real strings,
the honest statement is:

> Stage 8 merged on green tests. The capability profile has **not** been observed to be correct
> about this television. Rows 16, 18 and 23 are untaken, so "the profile is right" is not claimed —
> only that it is honest about which of its own rules rest on a reading (one, and that one is about
> a release name) and that the unprofiled ordering is byte-identical to `master`'s.

And the constraint above it still stands: **stage 7's rows 1-3 are untaken**, so a failure in rows
16-18 cannot yet be attributed between the codec and the player.

---

## Measurements and assumptions, so a reader six months from now can tell them apart

**Measured on this television (all of it from the stage-3 sitting, 2026-10-06/07, and all of it
through the main web app, which sends no `client` profile):** Chromium **120** from
`navigator.userAgent`; every feature probe on the diag page answered yes; **MKV/Matroska** direct
play; **DDP5.1 (E-AC3)** audio; streaming from an in-progress torrent at ~26%; scrubbing inside the
downloaded region with **no offsets recorded**.

**And three caveats on that one measurement, because the whole stage leans on it.** The resolution
was **never transcribed** — `videoWidth x videoHeight` was not copied, so even "1080p" is a release
*name* claim. The codec and the audio were likewise read off the release **name**, not off the
file. And §11.5(d) asked for **AC3** while the run delivered **E-AC3**, so **plain AC3 is no more
measured than HEVC is.** That is why R8 (`preferred-measured`) carries the list verbatim with its
caveats in its docstring, and why spec §11.2's fixture now says E-AC3.

| Assumption | Where it is relied on | What would settle it |
| --- | --- | --- |
| HEVC Main 8-bit decodes | **R9**, and the entire 4K opt-in | **Row 16** |
| HEVC Main10 decodes | **R9**'s 10-bit half | **Row 17** |
| DTS at 1080p is penalise-worthy | **R3** (`guess`, shipped `shadow`) | **Row 18** |
| DTS-HD MA / TrueHD at 1080p | **R4** (`guess`, shipped `shadow`) | **Row 19** |
| AV1 is penalise-worthy on *this* panel | **R6** (`inferred`, in force; its own scope excludes this set) | **Row 20** |
| Dolby Vision in MKV fails | **R5** (`lg-doc`, in force, `in MKV` qualifier dropped) | **Row 21** |
| `.mp4` and `.ts` play | **R7**'s premise; only `.mkv` is measured | **Row 22** |
| A 2160p release streams off a partial torrent on this Pi | the 4K cell's promise | **Row 23** |
| DTS / TrueHD at 2160p fails | **R2**, the only AV reject (`lg-table`) | **Row 24** |
| 60 Mbps is the right HEVC 4K ceiling | **R10**, which is **NOT IMPLEMENTED** — no input exists | **Row 25** |
| webOS **25** | the profile's *name*, argued against from silicon | **Row 26** (the SKU and the verbatim UA) |
| A title's audio tokens describe the track that plays | every audio rule, unfixably (hazard 9) | nothing in this stage; a post-metadata file probe |

**What jsdom proves about any of this: nothing.** The instrument's own suite asserts that a 404
renders "FILE NOT PRESENT" and mounts no element, that a thrown HEAD is not reported as absence,
that an `error` event surfaces its raw numeric code, that `canPlayType` gates nothing, that the
operator's audio answer is part of the persisted record, and that the whole readout survives a
remount. Those are properties of the **instrument**. Every value it will print is a property of the
**engine it runs on**, and in a test that engine is jsdom — which decodes nothing at all.

---

## Follow-ups this sheet will create

1. **Produce the four clips.** The command lines above are written down and **never run**; the
   `frontend/public/samples/` directory is gitignored and empty. Until they exist, rows 16-18 are
   not takeable and the diag page will say **FILE NOT PRESENT**, which is the correct reading of
   this checkout.
2. **Run `ffmpeg -encoders` before trusting those lines**, and fix this sheet in place if `dca`,
   `-strict -2`, `eac3`, `ac3` or `profile=main10` turns out to be wrong — then say so in the row
   it serves.
3. **Row 20's instrument disagrees with stage 8's decision 3** (clip versus real file). Recorded in
   that row; resolve it by either finding an AV1 release or adding a fifth clip.
4. **If row 16 is negative, R9 inverts** — HEVC becomes a reject at every resolution and the 4K
   cell comes off the movie screen. That is the largest single consequence on this sheet; open it
   as a stage-8 follow-up rather than editing the table from a half-taken reading.
5. **If row 18 says "silent"**, promote R3 `shadow` → `in_force` (one cell) and re-run the suites;
   task 4's mutation list already includes performing exactly that promotion, so the blast radius
   is known.
6. **Reinstate R10** via the nullable `runtime` Integer described in row 25 — one line on the call
   the TV already makes, zero extra HTTP, and `TMDB_API_KEY` must be set for it to fire at all.
7. **Nothing persists which release the profile chose** (hazard 15). `meta_data` is a JSON column
   every writer merges in place, so a `profile` / `release_title` key needs no DDL — deliberately
   out of scope here, because an unread field is an unproved one, but row 23 has to be transcribed
   by hand until it exists.
8. **Stage 7's rows 1-3 are the prerequisite for this entire sheet.** Take them first, in
   `docs/superpowers/plans/2026-10-10-tv-stage7-device-readings.md`, and say in its Run line that
   you did.
