# webOS TV — stage 9 sidecar subtitles: device readings

Run: **NOT TAKEN.** Replace this line with the date (or dates) when the readings are taken, as
`2026-09-22-webos-tv-stage3-results.md` does, and say which sitting produced which rows.

Deliverable named in `docs/superpowers/plans/2026-10-20-tv-stage9-subtitles.md`, task 16, whose
twelve numbered readings are enumerated in that plan's **"The device readings"** section. Two of
them are two readings each — 27 and 29 — and both splits are load-bearing rather than arithmetic,
so the table below has **fourteen rows under twelve numbers** and the reason is written into each
split pair.

The instrument for five of them is `/bigscreen/diag` →
**Sidecar subtitles (stage 9)** (`frontend/src/app/(bigscreen)/bigscreen/diag/page.tsx:1329`),
whose five arms are declared at `:391` (`SUBTITLE_ARMS`) and whose own suite is
`bigscreen/diag/page.subtitles.test.tsx` (31 tests, task 15). That page states in its own copy
that it is the instrument for rows **27a, 27b, 30, 32 and 35 "and no others"** (`:1367-1368`) —
which is about the *subtitle* section. Rows **34** and **38** are read from the same page's older
sections (**Remote key codes**, `:1123`, the stage-7 key log; **Device**, `:1080`, untranscribed
since stage 3), and the remaining seven rows need the real player, a real release, or a
read-only pass over the database.

**Companion sheets, and this one is deliberately separate:**
`docs/superpowers/plans/2026-10-10-tv-stage7-device-readings.md` holds rows **1-15** (the stage-7
player) and `docs/superpowers/plans/2026-10-11-tv-stage8-device-readings.md` holds rows **16-26**
(the stage-8 codec profile). Numbering is globally continuous and unique, so stage 9 begins at
**27** — but it is a new file, not an append, for the same reason stage 8 gave: the stage-7
sheet's verdict is a *stage-7* verdict gated on its rows 1-3 and is still **NOT REACHED**. Mixing
stage-9 rows into either would let one verdict answer for two stages, and would let a taken
stage-9 reading mask an untaken stage-7 gate. Both sheets point back here.

> **How to read this document.** Five rules, inherited verbatim from the stage-7 and stage-8
> sheets; only rule 3's example and rule 4's named instrument are stage-9's own.
>
> 1. **Every cell is either a string transcribed verbatim off the television, or the words
>    "not taken".** Nothing here may be inferred from a model number, a vendor table, a desktop
>    browser, or a jsdom test. Where a row says "not taken" it is followed by what is therefore
>    still unknown and what it blocks.
> 2. **A blank cell is a failure, not a pass.** That is why every cell below already reads
>    **not taken**: there is no state this document can be in where an unanswered question looks
>    answered. Do not delete a row you did not take; do not write "ok", "works" or "as
>    expected" — those are summaries, and a summary is what was lost last time.
> 3. **Transcribe the raw string.** `textTracks.length=0` and "subtitles don't work" are not the
>    same reading, and neither are `cues.length=12` and "the cues appeared". The subtitle section
>    of `/bigscreen/diag` prints `textTracks.length`, `mode`, `cues.length`, `readyState`, the
>    HTTP line and which of `load`/`error` fired already in the right form: copy them character
>    for character, including an em dash, a `0` or an `undefined`. **The one question it cannot
>    print is whether text was visible on the panel** — that answer is typed in by the operator
>    and it is a separate field on purpose (see row 27a).
> 4. **This document has no test, deliberately.** Its failure mode is a visible blank, and a test
>    asserting that a markdown table is filled in would be a test about markdown. The *instrument*
>    is tested (`bigscreen/diag/page.subtitles.test.tsx`, 31 tests: that the page cannot mount a
>    `<track>` before its probe answers, cannot collapse the status, the cue count and the
>    operator's visible answer into one cell, and loses nothing across a navigation). Those are
>    properties of the instrument. **Nothing in this repository can prove that a cue paints**, and
>    task 16's own guard (`specCitations.test.ts`) checks the spec's `manager.py` citations, not
>    this sheet.
> 5. **Measurement vs assumption is called out per row** and summarised at the end. Stage 9 ships
>    with **zero** readings from this set behind any of it: every Chromium fact in the plan was
>    measured on **155** on macOS, and the record says the television is **Chromium 120 /
>    webOS 25** (read Oct 2026, UA never transcribed — row 38).

---

## THE SEQUENCING CONSTRAINT — take stage 7's rows 1-3 first

**Stage 7's rows 1-3 block stage 9, and not as a formality.** Gate 1 raises the live possibility
that playback on this set has only ever been observed with `AUTH_ENABLED=false`, so a blank
subtitle screen with auth on would carry an extra candidate cause. Reading **27a**'s instrument
deliberately removes that cause from its own path — no torrent, no FastAPI, no auth, no ARM cap,
no clip — but it cannot remove it from **28** or **31**. Take stage 7's rows 1, 2 and 3 first, in
that sheet, and say in its Run line that you did.

**Stage 7's row 13 is the same stacking fact as 29a/29b** (`isolation: isolate` on `.bs-player`,
`bigscreen.css:944`, keeping the focus ring visible over the video) and must be taken in the same
sitting: a negative row 13 predicts invisible cues before anyone writes a converter.

**Stage 8's rows 16-26 do not block stage 9**, and 27a is specified so it does not inherit their
missing-clip blocker.

---

## The fourteen rows

| # | Reading | Gates "done"? | Instrument | Status |
| --- | --- | --- | --- | --- |
| **27a** | Do native WebVTT cues PAINT on this set at all, and does a late-inserted `<track default>` reach `mode: 'showing'`? Transcribe `textTracks.length`, `mode`, `cues.length`, `readyState`, which of `load`/`error` fired, **and separately whether text is visible on the panel** — a zero-cue reading and an invisible-cue reading are different facts and may not share a cell. | **YES — gate A** | `/bigscreen/diag` → Sidecar subtitles, **arm `s27a`** (`diag/page.tsx:393`): a `<video>` with a bogus `src` plus the committed `public/samples/cue-probe.vtt`. No torrent, no FastAPI, no auth, no ARM cap, **no clip** — so a blank screen has one candidate cause. | **not taken** |
| 27b | The same question over a real decoded frame. | only if 27a is ambiguous | arm `s27b` (`diag/page.tsx:401`), which wants `samples/clip4-1080p-h264-eac3.mkv`. **BLOCKER: there is still no clip.** `frontend/public/samples/` now holds the two committed `.vtt` probes and nothing else (`frontend/.gitignore` excludes the directory's contents and negates `*.vtt`), and producing a clip on a Pi is not a five-minute job. | **not taken** |
| **28** | Does the `<track>` subresource fetch carry `ff_session` with `AUTH_ENABLED=true`? **Independent of stage 7's row 1 in both directions** — a `<track>` goes through Blink's resource loader, a `<video>` range through the native media pipeline. | **YES — gate B** | the real player, auth on, paired set, and the backend log: `middleware/error_handler.py:30` logs method+path on entry and `:38` the status on completion, with no query strings. No devtools. Ride it with stage 7 row 1 in one sitting, in **separate cells**. | **not taken** |
| **29a** | With task 10 shipped, are cues LEGIBLE with the band **hidden** — the state the feature lives in? | **YES — gate C** | the real player at 1920×1080, screenshot. | **not taken** |
| 29b | Where do cues sit relative to the band when the band is **VISIBLE**? This is a *second* occluder: `.bs-player__bar` is `position: relative` with no `z-index` (`bigscreen.css:980-981`) and so paints above both `z-index:-1` layers, and the stylesheet measures its content at ~334px (`:899-901`). Stage 9 ships no fix. | no — **scopes stage 10** | same sitting, band forced visible. Take it **with stage 7's row 13**: one stacking fact, three readings, and `bigscreen.css:893-896` records that this context already cost the stylesheet a full-bleed focus stop once, found by rendering and not by reading. | **not taken** |
| 30 | Does `::cue` styling apply, does `var()` resolve inside it, and what is the platform's DEFAULT cue size in px at 1080p against §8.5's 24px **Read** floor (the spec's own table row, `:835` after task 16's edits)? **Do not substitute a `CSS.supports`/`cssRules` probe** — measured, Blink retains `bottom`/`transform`/`padding` inside a `::cue` block while ignoring them and drops `::cue-region` entirely, so a parse probe answers yes for properties that do nothing. | no | arm `s30` (`diag/page.tsx:409`), the `::cue { color: var(--gold) }` arm and the px rulers beside it. | **not taken** |
| **31** | Does an admitted sidecar's piece actually ARRIVE on a real low-seeder swarm, and how long after the POST? Record three things separately: whether the piece arrived; whether the torrent returned to `finished` after retraction; whether the nav badge cleared. | **YES — gate D** | a real release carrying a `Subs/` folder, started **fresh** after this ships, timed against the TV's poll and the backend log. The only row that can falsify D1-D4. | **not taken** |
| 32 | Does `line:-4` move a cue clear of the band on this engine? The reading that chooses between reading 29b's candidate fixes, and the only one that would live in the **converter**. | no | arm `s32` (`diag/page.tsx:418`) and `public/samples/cue-probe-line.vtt`, which differs from the 27a probe by exactly one variable. | **not taken** |
| 33 | Does a **seven**-cell transport row fit at the television's own font without overflow, and is the last cell still focusable? `.bs-player__row` is `flex-wrap: nowrap` (`bigscreen.css:991`), so an overflowed cell is one the D-pad can focus and the viewer cannot see — a silent violation of no-cell-that-cannot-act that no test on this surface would catch. Transcribe `scrollWidth` and `clientWidth`. | no | the real player, longest label forced. Seven is `TRANSPORT_CELLS` (six, `TransportBar.tsx:96-107`) plus `RETRY_CELL` (`:110`). `bigscreen.css:910-915` claimed ~1290px for the pre-stage-9 six, says so, and now names this row as the measurement that replaces it. | **not taken** |
| 34 | Does the set's own subtitle/CC remote key reach the page, and with what `keyCode`? | no | `/bigscreen/diag` → **Remote key codes** (`diag/page.tsx:1123`), the same instrument as stage 7 rows 4-8. Decides whether the cell ever earns a `MEDIA_TWINS` entry; task 12 adds none, deliberately. | **not taken** |
| 35 | Does a recovery `video.load()` DUPLICATE the TextTrack on Chromium 120 as it does on 155 (one element, `textTracks` 1→2→3, every copy showing and painting), and does unmounting clear the copies already made? | no | arm `s35` (`diag/page.tsx:427`), the double-`load()` arm. Task 13's guard makes it moot either way; this says whether the guard is still earned. Not observable in any suite. | **not taken** |
| 36 | Does switching language mid-film take effect by remounting one `<track>`, with no `video.load()` and no stream interruption? | no | the real player, two languages, `currentTime` before and after. | **not taken** |
| 37 | How many sidecars do this household's real releases carry, in what formats, languages and encodings, and how many pair to an episode — **and by which rung**? | no | one read-only pass of `list_sidecars` over every `torrents` row after a week of ordinary use. The only row that can say whether §12's "Subtitle coverage disappoints — High" materialised, and the only instrument that can retire §6's encoding and pairing claims. Expect close to zero on today's two titles. | **not taken** |
| 38 | Verbatim `navigator.userAgent` and model SKU **again**, if this is a different sitting from row 26's, so a firmware change between sittings is visible rather than assumed. Every Chromium measurement behind this stage was taken on **155**; the record says the set is Chromium 120 / webOS 25, read Oct 2026. | no | `/bigscreen/diag` → **Device** (`diag/page.tsx:1080`). | **not taken** |

**The four gates: A = 27a, B = 28, C = 29a, D = 31.** Nothing else on this sheet gates the
stage's "subtitles work on the television" claim, and all four are untaken.

---

## Reading 27a — the gate, and the one cell that is not a machine reading *(gate A)*

Six facts, and they may not share a cell. The first five are printed by the page; the sixth is
typed in by whoever is standing in front of the television, because **no API reports it**.

| Fact | Reading |
| --- | --- |
| `textTracks.length` | **not taken** |
| `mode` on the track | **not taken** |
| `cues.length` | **not taken** |
| `trackEl.readyState` | **not taken** |
| Which of `load` / `error` fired (or neither) | **not taken** |
| **Was text visible on the panel?** (operator's own answer) | **not taken** |

**Why the sixth field exists.** A signature-valid WebVTT body with **no cues in it** loads at
`readyState 2` and fires **no event at all** — measured, nine separate shapes — so "no error" is
not evidence of a painted cue. The inverse is just as bad: a `cues.length` of 12 with nothing on
the screen is a *rendering* fact, and it sends the next person to the stylesheet rather than to
the converter. One cell for both questions destroys the attribution that this arm exists to
provide.

**What is still unknown while this reads "not taken":** whether this television paints a native
WebVTT cue at all. That is the whole stage. **What it blocks:** the claim "subtitles work on the
television". If 27a comes back **negative**, tasks 13 and 14 are **replaced, not patched** — the
replacement is DOM-rendered cues from a parsed VTT, which is a different stage with a different
frame budget — and tasks 1-11 survive unchanged.

**Measurement vs assumption:** everything about cue painting is currently an assumption carried
from Chromium **155 on macOS**. jsdom 25.0.1 has no `TextTrack`, `TextTrackList`, `TextTrackCue`
or `VTTCue` at all, `video.textTracks` is a plain zero-length array with a `<track default>`
child present, and `addTextTrack` does not even throw — so the suite's two zeroes are jsdom's,
not a television's.

---

## Reading 28 — does the `<track>` fetch carry the cookie? *(gate B)*

Not a duplicate of stage 7's row 1, in **either** direction: a `<track>` subresource goes through
Blink's ordinary resource loader and a `<video>` byte range goes through the native media
pipeline, and the two have disagreed about credentials on televisions before. Stage 9 ships **no**
`crossOrigin` attribute, with the reason recorded in task 13's guard
(`src/app/(bigscreen)/noCrossOrigin.test.ts`), so the request is a same-origin credentialed one or
it is nothing.

Read it off the backend log, not from devtools, and transcribe the two lines verbatim —
`middleware/error_handler.py:30` logs `METHOD /path` on entry and `:38` logs the status on
completion. Query strings are never logged, which is also why the emailed-token rule exists.

**What is still unknown:** whether an authenticated television can fetch a subtitle at all.
**What it blocks:** gate B, and any claim that the feature works on a box with `AUTH_ENABLED=true`
— i.e. the only configuration a real household runs. The failure mode is the ugly one: the
subtitle routes' 401 is **bodiless and structural** (`main.py:205-208`), so to a `<track>` it is
indistinguishable from a malformed file.

---

## Readings 29a and 29b — two occluders, two fixes, and only one of them is stage 9's *(29a is gate C)*

Task 10 fades the scrim with the band, which clears the state the feature actually lives in: the
band is hidden for almost the whole film. **29a** is that state, and it is the gate.

**29b is a different occluder.** `.bs-player__bar` carries `position: relative` with no `z-index`
of its own (`bigscreen.css:980-981`), so inside `.bs-player`'s `isolation: isolate` (`:944`) it
sits in the positioned-descendant layer at `z-index: auto` and paints above **both** `z-index: -1`
layers — the video and the scrim. The stylesheet measures the band's content at ~334px
(`:899-901`). So for the ~5 s the band is up after a press, a cue may sit behind the transport
row. Stage 9 ships **no** `line:` guess, **no** `::cue` rule and **no** restacking, because every
candidate fix is a guess and this is the reading that chooses between them.

Take both in one sitting **with stage 7's row 13**. Three readings, one stacking fact; and
`bigscreen.css:893-896` records that this same stacking context already cost the stylesheet its
one full-bleed focus stop, found by rendering at 1920×1080 and not by reading the file.

**What is still unknown:** whether a cue is legible at all (29a), and where it sits under the band
(29b). **What 29a blocks:** gate C. **What 29b blocks:** nothing in stage 9 — it **scopes stage
10**, and reading 32 is the candidate fix that would live in the converter rather than the
stylesheet.

---

## Reading 31 — does an admitted piece ever arrive? *(gate D)*

The only row on this sheet that can falsify D1-D4, and the only observation of the mechanism that
task 0 measured in a loopback container with a willing seeder. **A deadline is a request, not a
delivery.** On the low-seeder swarms this project exists to serve, an admitted piece that never
arrives is the hazard the whole design is bounded against: it holds the torrent below 100%
forever, which costs one of the Pi's two slots (`main.py:57`), keeps the nav badge lit
(`api/activity.py:30-38`), and — the severe one — keeps `get_completed_video_file_info`'s progress
gate shut, which reinstates stage 7's 404-after-restart on the television's main content.

Three facts, recorded separately, because they fail independently:

1. did the piece arrive, and how long after the POST;
2. did the torrent return to `finished` after retraction;
3. did the nav badge clear.

Use a release that carries a real `Subs/` folder, started **fresh after this ships** — a torrent
already in the library can never be admitted at all (`coverage: "unknown"`, see the verdict
below).

**What is still unknown:** whether piece-level admission delivers bytes in the field.
**What it blocks:** gate D, and the budget's value — `subtitle_admit_budget_ms` is 45 s by
decision, not by measurement.

---

## Verdict

**→ NOT REACHED.** Fill this in as stage 3's results document does, and state which of the four
gates (A = 27a, B = 28, C = 29a, D = 31) were transcribed. Until those rows carry real strings,
the honest statement is:

> Stage 9 merged on green tests. Subtitles have **not** been observed working on the television.
> Rows 27a, 28, 29a and 31 are untaken, so "subtitles work on the television" is not claimed —
> only that the backend refuses rather than emits, that the cell is honest in every state the
> backend can describe, and that the television's own suites are green.

And the constraint above it still stands: **stage 7's rows 1-3 are untaken**, so a failure in 28
or 31 cannot yet be attributed between the subtitle path and the player.

**All twenty-six prior readings are also still `not taken`** — rows 1-15 (stage 7) and 16-26
(stage 8). This stage adds twelve numbers and takes none of them.

---

## Measurements and assumptions, so a reader six months from now can tell them apart

**Measured on this television, ever:** Chromium **120** from `navigator.userAgent` (stage-3
sitting, 2026-10-06, the string itself not transcribed); every feature probe on the diag page
answered yes; MKV direct play with DDP5.1 audio; streaming from an in-progress torrent at ~26%;
scrubbing inside the downloaded region. **Nothing about subtitles.** Not one character of the
rows above has ever been read off this set.

| Assumption | Where it is relied on | What would settle it |
| --- | --- | --- |
| A native WebVTT cue paints at all | the entire stage | **Row 27a** |
| `default` on a late-inserted `<track>` reaches `mode: 'showing'` | task 13's single `<track>` | **Row 27a** |
| A `<track>` subresource sends `ff_session` | every authenticated box | **Row 28** |
| The faded scrim makes cues legible | task 10, D16 | **Row 29a** |
| A cue behind the band is tolerable for ~5 s | stage 9 shipping no fix | **Row 29b** (scopes stage 10) |
| `::cue` applies, and `var()` resolves inside it | nothing in stage 9 — the stylesheet ships no `::cue` rule (`bigscreen.css:978` says why) | **Row 30** |
| An admitted piece arrives inside the budget | D4's 45 s, and the whole admission design | **Row 31** |
| `line:-4` is a usable lever | 29b's candidate fix, which would live in the converter | **Row 32** |
| Seven cells fit at the television's font | the transport row's own geometry | **Row 33** |
| No subtitle/CC remote key needs handling | task 12 adding no `MEDIA_TWINS` entry | **Row 34** |
| `video.load()` duplicates a TextTrack on 120 as on 155 | task 13's unmount guard being *earned* | **Row 35** |
| Remounting one `<track>` switches language without a stream interruption | the picker's whole interaction | **Row 36** |
| Real releases carry sidecars this ladder can pair | §6's encoding and pairing claims, D20's rungs, D21's language table | **Row 37** |
| The set is still Chromium 120 / webOS 25 | every engine fact in the plan, all of which were measured on **155** | **Row 38** |

**What the suites prove about any of this: nothing.** 1526 TV tests and 2487 frontend tests (the
counts at the commit that adds this sheet) assert properties of the *code* — that the cell is unconditional, that there is exactly one
`<track>`, that the picker is one `rowCounts` replacement inside one grid, that the diag page
cannot report a reading it has not taken. Every *value* those instruments will print is a property
of the engine they run on, and in a test that engine is jsdom, which paints nothing at all.

---

## Follow-ups this sheet will create

1. **Produce a clip, or retire row 27b.** `frontend/public/samples/` holds the two committed
   `.vtt` probes and no video; the four stage-8 clip command lines in
   `2026-10-11-tv-stage8-device-readings.md` were **written down and never run**. Row 27b is
   takeable only after one exists, which is also stage 8's rows 16-18 blocker.
2. **If 27a is negative, open the replacement as its own stage.** Tasks 13 and 14 are replaced by
   DOM-rendered cues from a parsed VTT — a different frame budget and a different design — and
   tasks 1-11 survive unchanged. Do not patch a `<track>` that does not paint.
3. **If 29b shows a cue behind the band, stage 10 owns the fix**, and reading 32 chooses between
   the candidates. Nothing is edited into the stylesheet or the converter from a half-taken
   reading.
4. **Row 37 is the only instrument that can retire §6's pairing and encoding claims**, and it
   needs a week of ordinary use first. Until then every fixture layout in
   `backend/tests/test_subtitle_pairing.py` is a hand-authored assumption with a provenance note,
   and `backend/tests/data/releases.tsv` cannot help: 370 title rows (371 lines with its header),
   nine columns, no path column, zero `.srt`.
5. **The `save_info_dict` repair is filed as a stage-7 follow-up**, not here — follow-up 5 of
   `docs/superpowers/plans/2026-10-10-tv-stage7-device-readings.md`, with the red test that fails
   today. It is the reason `coverage: "unknown"` is the permanent answer for everything already in
   this library, and it is a bigger change than anything stage 9 makes. Stage 9 corrected its
   false docstring (`backend/app/torrent/manager.py`, `_video_files_from_resume_data`) and did
   **not** make the repair.
6. **Stage 7's rows 1-3 are the prerequisite for rows 28 and 31.** Take them first, in that
   sheet, and say in its Run line that you did.
