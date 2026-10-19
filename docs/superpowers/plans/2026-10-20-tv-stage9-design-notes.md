# Stage 9 design record — sidecar subtitles

Companion to `2026-10-20-tv-stage9-subtitles.md`. This is where the plan's decisions come from:
what was measured, what was only read, which of the competing designs was wrong about what, and
which ground facts the brief itself got wrong. Read it before your task. The plan's `D`-numbers
point back here.

## How this was produced

Seven recon areas against the real tree at `4cad98b` — `priority`, `resolution`, `conversion`,
`endpoints`, `tv-ui`, `web-regression`, `validation` — each one then **adversarially re-checked by
a second pass against its own citations**. Then four competing designs written to four different
briefs, three judge panels scoring them on independent axes, and a synthesis.

| Design | Stance | Honesty | Blast radius | TV fitness |
|---|---|---|---|---|
| 1 `minimal-honest` | ship the smallest thing that is true; decline what cannot be made honest cheaply | 8 | 8 | 7 |
| 2 `coverage-first` | maximise titles that get captions; three resolution sources, three parsers | 6 | **3** | 8 |
| 3 `blast-radius-zero` | the shared backend is sacred; new files plus one router, every shared surface byte-unchanged | 8 | **9** | 7 |
| 4 `device-truth` | nothing about this television is known; every TV assumption behind a printable value | **9** | 6 | 6 |

No design won outright and the plan is not any one of them. **Design 3 supplied the mechanism**
(piece-level admission, the POST, gate 4), **Design 4 supplied the posture** (the backend is the
oracle, the `<track>` never is; pairwise-distinct labels as a test; task 0 before the design),
**Design 1 supplied the refusal discipline** (naming an individual test arm as currently
unfalsifiable at the point of use), and **Design 2 supplied `pair_source`** — the one graft all
three panels asked for independently.

## The three things nobody got right

Each panel was asked, separately, what all four designs missed. The three answers are different
and all three are now plan decisions.

**1. A mis-paired sidecar is invisible to the viewer** (honesty panel). All four designs built a
multi-rung pairing ladder, all four found the sharpest trap in it, and all four then presented the
ladder's output to the television as settled fact. Designs 2 and 3 compute `pair_source` precisely
so the rung is observable — and route it to the API and the test suite, never to the screen. The
failure mode is the dual of the one the stage was convened to prevent: not "the viewer believes
captions exist when they do not," but *"the viewer believes the captions on screen belong to what
they are watching."* On a season pack whose `Subs/` tree follows a convention none of these ladders
anticipated, E01's dialogue is confidently captioned over E04 under a cell reading `Subtitles · EN`.
There is no error event, no status code, no zero-cue refusal and no device reading that catches it;
the VTT is valid, the readiness measurement is correct, and the sentence is true about everything
except whose episode it is. Every honesty mechanism in all four designs is pointed at whether a
subtitle is **there**; none at whether it is the **right one**. → **D20**: the rung is returned *and
rendered* (`(matched by folder)` / `(matched by episode number)`, `· guessed` on the cell).

**2. The player-divergence registry** (blast-radius panel). `engineContract.test.ts:231`/`:253`
holds a hand-maintained map of every place the two players deliberately disagree, a predicate per
entry, set equality between the maps, and `expect.soft(…).toHaveLength(6)` on both with a comment
stating why the count is absolute. All four designs create the seventh entry it exists to record —
the TV rendering a native `<track>` while the web CC button stays `aria-disabled` — and all four
defend it in a trade-off bullet without touching the file. **The count pin does not redden when a
seventh divergence appears**, because the registry is additive by hand. The irony is sharpest for
the two best designs: Design 1 congratulates itself that nothing new goes under `_player/`; Design
3's whole stance is "every shared surface is byte-unchanged with a mechanical gate proving it," and
it cites this very file twice by line. Both read it. Neither looked 180 lines further down, where
the repo had already written the gate their stance needed. → **D22** and task 13.

**3. There are two occluders, not one** (TV-fitness panel). All four designs found the cue/scrim
collision and described it identically and correctly. But `.bs-player__bar` is `position: relative`
with **no** `z-index` (`bigscreen.css:957-958`), so inside `.bs-player`'s `isolation: isolate`
(`:933`) it sits in the positioned-descendant layer at `z-index: auto` and paints above *both*
`z-index: -1` layers. The stylesheet measures its content at ~334px in its own words (`:899-900`).
So a cue at the bottom of the video box is occluded by the **scrim** at all times and by the
**bar** whenever the band is visible — which is exactly the moment the viewer has just pressed the
Subtitles cell to check. Fading the scrim with `visible` (Designs 1, 2, 3) *inverts* the two rather
than solving both. Design 4's three candidate fixes do not reach the second either: "move the video
out of the negative-z layer" would put it at `z-index: 0`, still below a `z-index: auto` positioned
sibling later in source order. Only Design 1 did any arithmetic, and only against the scrim (≈0.82
alpha at 45% of 480px → roughly `line:-9`, mid-screen, rejected). Design 2 is the only design that
ships a lift, and `line:-3` is ~162px at the measured ~54px cue height against a ~334px band — so
the one lever anybody shipped lands the cue *inside the transport row*, and is then asserted to
"keep them inside the safe area in both states." → **D16** fades the scrim and ships no lift, and
**reading 29 is split into 29a and 29b** because one cell cannot separate two occluders: a
band-up screenshot showing nothing readable is attributable to the scrim, to the bar, or to cues
not painting at all.

## What was measured, and with what

Everything below is a measurement, not a reading of source. The probes are in the session
scratchpad at `…/scratchpad/s9/` (`probe_blob.py`, `probe_pieces.py`, `probe_pieces2.py`,
`blobs.tsv`); task 0 re-runs the piece probe and pastes [A]–[F] into the plan's Corrections
section, because a scratchpad is not a record.

**Resume data carries no info dict.** Same torrent, two calls in a throwaway loopback session:
bare `save_resume_data()` — as shipped at all three sites — produced a **1498-byte** blob with
`ti=ABSENT`; `save_resume_data(lt.torrent_handle.save_info_dict)` produced a **2470-byte** blob with
`ti=PRESENT` and 6 files from 3 created. So `lt.read_resume_data(...).ti` is `None` for every blob
this application has ever written, `_video_files_from_resume_data` takes its own `if ti is None`
branch and returns `[]`, and `get_completed_video_file_info` returns `None` at gate 4b for every
torrent that exists. **Stage 7's headline repair is inert**, and the docstring at
`manager.py:1140-1143` asserts the opposite in the words "round-trip verified against the pinned
libtorrent 2.0.11" — it was verified against the hand-built `add_torrent_params` at
`test_finished_torrent_streamable.py:144`, not against a blob from this code path. The code is the
evidence; the dev DB's two blobs are corroboration, not the finding.

**The pad-file hazard is real and the file order is not derivable.** `lt.create_torrent` interleaved
five `.pad/N` entries on the padded layout, so a 3-file tree became `num_files() == 6` with the
sidecar at index 4. With `v1_only` the **same** tree came out in readdir order with 0 pads. A
torrent's file order is not derivable from its filenames in either direction — which `manager.py:1145-1149`
already forbids relying on. → **D9**: the index is the torrent's own, and the route resolves only
through the lister.

**A changed priority list wipes the playhead's window.** `handle.prioritize_files(list)` and
`handle.file_priority(i, p)` both recompute the whole torrent's piece priorities and wipe
`_prioritize_window`'s raised window; re-applying an **identical** list does not. And a **short**
list re-admits rather than deselects: `prioritize_files([1,0,0])` on a 5-file torrent whose
pre-state was `[1,0,0,0,0]` yielded `[1,0,0,4,0]` — the tail goes to libtorrent's **default 4**,
silently, with no error. → **D1**, and task 1(b)'s characterisation.

**Piece-level admission works and is byte-exactly retractable.** Raising a piece wholly inside a
deselected file widened `total_wanted` by exactly that file's bytes and left every file priority
untouched; retraction restored `total_wanted` to baseline with **residual 0** and the state back to
`finished`. The first run of this probe was **worthless** and is recorded as such: it ran against a
`seeding` torrent, which has no piece picker. The measurement that counts ran against an incomplete
torrent with the sidecars deleted before recheck and no peers.

**Gate 4, and the defect the dossier would have shipped.** `piece_priority(p, 0)` on retraction,
applied to a piece a **wanted** file also occupies, **de-wants video bytes**: on the unpadded
layout `total_wanted` fell *below* baseline and the torrent reported `finished` at 100% with a piece
containing a video file's head never downloaded. **An unplayable episode marked complete.** Found by
Design 3's probe; three of the four designs would have shipped it. → **D3**, and gate 4 is
re-checked at retraction because `_prioritize_window`'s relax branch sets `piece_priority(p, 1)`.

**The cost is piece-shaped, not byte-shaped.** §7.5's "(kilobytes)" is wrong by up to four orders of
magnitude: the marginal cost is `extra_pieces × piece_length` — measured 0 on an unpadded v1
torrent, one full piece per sidecar on a pad-aligned one, i.e. **N sidecars × `piece_length`**:
**20 × 8 MiB = 160 MiB** for a 20-language `Subs/` tree, and **~1.6 GiB** only at the ~200 sidecars
of a 20-language × ~10-episode season pack. libtorrent 2.0's own `create_torrent` pads by default,
as does qBittorrent, and every v2/hybrid torrent must. → **D4**'s 4-piece span cap forecloses it
structurally. (This record read 1.6 GiB for the 20-language tree, 10× off; corrected by the plan's
C5. Neither the conclusion nor the cap changes.)

**Nine malformed WebVTT shapes load silently.** `readyState 2`, `load` fired, `error` **not** fired,
**zero cues** — and it is per-cue. A payload line containing `-->` yields a cue with `text === ""`
that **passes** a cue-count check. Raw ASS, an empty file and a header-less file all fire a real
`error`; wrap any of them in `WEBVTT\n\n` and they become silent zero-cue successes. → **D19**, and
the most important mutation in the stage: "return `WEBVTT\n\n` on zero cues" must redden four
refusal fixtures at once.

**Two carries, separately.** `00:00:75,000` and `00:75:01,000` are separately measured silent zeros,
so seconds≥60→minutes and minutes≥60→hours are two mutations and one fixture cannot discriminate
both. `{\an8}Top line` renders the braces literally. `A &notreal; B` renders `A ¬real; B` through a
legacy semicolon-less entity, so `&` is escaped unconditionally. A blanket `html.escape()` puts the
literal text `<i>` on screen for the whole film. Blink drops `<font …>` and keeps the text, and
keeps `end <= start` cues as invisible dead weight — only the converter can remove them.

**`::cue` cannot move a cue.** Blink retains `bottom`/`transform`/`padding` inside a `::cue` block
while ignoring them at used-value time, and `::cue-region` does not survive into `cssRules` at all.
So a `CSS.supports`/`cssRules` parse probe answers *yes* for properties that do nothing — which is
why reading 30 forbids substituting one. The only lever is a WebVTT cue setting the converter would
have to invent, coupling backend output to a TV stylesheet with no runtime meeting point.

**A late `<track default>` reaches `showing`, and `load()` duplicates it.** A `<track default>`
inserted after `loadedmetadata` reaches `mode: 'showing'` asynchronously **even with the media
element in the error state** — which is what makes reading 27a's instrument need no clip and no
backend. And each `video.load()` **appends** a fresh TextTrack per `<track>` element without
discarding the previous: one element, `textTracks` 1 → 2 → 3, every copy `showing`, three identical
cue lines stacked on the picture. React cannot reconcile that away. → **D14**: exactly one element,
unmounted while `recovery.kind === 'reloading'`.

**jsdom 25.0.1 has no text-track machinery at all.** `window.TextTrack` is undefined,
`video.textTracks` is a plain zero-length `Array` with a `<track default>` child present,
`trackEl.track` is undefined, `trackEl.readyState` is a hardcoded 0, and `addTextTrack` does **not
throw** — it reports a jsdomError and returns `undefined`, so even a `toThrow` guard around it is
dead code. A mode-setting implementation would be a silent no-op in every test *and* unexecutable
in principle.

**`react-dom` 19.0.0 does not wire `onError`/`onLoad` on a `<track>`.** Its
`listenToNonDelegatedEvent` block covers `embed`/`source`/`link` and `case "track":` falls through
without them; the native events do not bubble. So the bubble prop is dead code no test would catch,
while the root-container capture listener fires in jsdom **and** in Blink. → **D14**:
`onErrorCapture`, and task 13(f)'s dispatch must be non-bubbling or the mutation cannot discriminate.

**MIME types come from the base image, not from Python.** Measured in the real image (Python
3.10.22, `/etc/mime.types` present): `.srt → text/plain`, `.ass → audio/aac`, `.ssa → None`, only
`.vtt → text/vtt`. So `get_mime_type` would tell the television an `.ass` sidecar is AAC audio, and
a `python:3.10-slim` bump can change the table with nothing noticing. → **D10**.

**BOM-less UTF-16 decodes as valid UTF-8.** Both LE and BE, into a NUL-riddled string a browser
renders as visible U+FFFD garbage with no error — so the `"\x00" not in text` conjunct is
load-bearing, not hygiene. A bespoke character-category detector was built and measured **7/13**,
identical to the naive ladder and wrong on worse rows: Latin-1 mojibake of Cyrillic is 100% letters
in one script, so category scoring cannot separate it from real text. `charset_normalizer` measured
10/12 and is importable in the image — but only because `backend/Dockerfile:6` sets
`POETRY_VIRTUALENVS_CREATE=false` and `:25` pip-installs poetry into the same site-packages; it is
in neither `pyproject.toml`'s 23 dependencies nor any `[[package]]` block of `poetry.lock` (its four
appearances there are inside extras lists). The density gate's blind spot is measured: Turkish
cp1254 scores ≈0.10 and sails through with its `ğ ş İ ı` mangled. A single Polish line measures
0.60 and the same file measures 0.157, which is why task 5(d)'s fixture must be ~20 lines.

**`parse_episode` is an `re.search` and the root overrides the truth.**
`parse_episode("Subs/E01.en.srt")` is `None` — `_SXXEYY` is `[Ss](\d{1,2})[\s._-]?[Ee](\d{1,3})`
(`providers/episodes.py:6`) and a bare `E01` matches neither it nor `_XNOTATION`. And because it
takes the first left-to-right match, a range-named root **overrides** a correct later segment:
`Breaking.Bad.S01E01-07.1080p.BluRay/Subs/Breaking.Bad.S01E04/3_English.srt` parses to **(1, 1)**.
Ten of the 94 `shape=episode` rows in `releases.tsv` are range-named and 0 of 119 `pack` rows parse
any episode — so the trap set is exactly the releases most likely to ship a multi-sidecar `Subs/`
tree. → **D20**: rung 2 cannot use `parse_episode`, and rung 3 excludes the root.

**`'en' in name.lower()` is the measured language trap.** `Movie.French.srt` → `fr-EN-ch`. The same
class hits `Children`, `Golden`, `Kingsman`. → **D21**: exact token match, and `hi` returns `None`
(Hindi vs hearing-impaired).

**Seven cells measured 1041px of 1728px** in Chromium 155 on macOS. `bigscreen.css:910-911` claims
~1290px for the current six and is wrong in the safe direction. Neither number was read off the set,
and `.bs-player__row` is `flex-wrap: nowrap`, so overflow clips rather than wraps — an overflowed
cell is one the D-pad can focus and the viewer cannot see. → **reading 33**.

## Corrections to the brief's own ground facts

The brief that launched this round carried nine scouted facts. Two were wrong, and one of them was
mine.

**Mine, and the important one.** I handed the round "does `resume_data` carry enough to enumerate
sidecars?" as an *open question* while implying stage 7's mechanism works. It does not, and I had
already measured that it does not before the round finished. The `resolution` recon area asked
exactly this question and **found it independently**, three passes over, which is why D5 reads the
way it does rather than needing a correction after the fact. The plan now treats the dead path as a
premise and files the repair as a stage-7 follow-up with its red test.

**`skip_non_video_files` is at `manager.py:1342`, not `:1226-1228`.** That was in the brief
correctly — but the spec still carries the stale citation, and here is where it gets interesting:
**four independent recon passes all corrected it the same wrong way**, reporting the stale citation
at *three* spec sites. `grep -c` says **two** (`:267` in §4.4 and `:662` in §7.5). §10's row at
`:796` carries no line number at all, and three designs put `:796` in a task's done-criteria,
sending an implementer to hunt a citation that does not exist. Four "I scouted this against the real
source" corrections, all wrong in the same checkable way, about the very thing they were correcting.
**Do not inherit a number from a correction without opening the file.**

**§7.5 does not contradict §13 about ASS/SSA.** Three designs and the brief read it as a
contradiction to be resolved. It is not: §7.5 at `:662` lists the formats, `:667-669` says styling is
dropped to plain text, and §13 at `:894` excludes ASS/SSA **styling**. Those are consistent —
convert the format, drop the styling. So the plan is **declining a spec commitment with grounds**,
which is a different and more honest thing to write down. The real contradiction is §11 point 4 at
`:824` filing "SRT→VTT conversion" under *Frontend, vitest*, against §7.5 and §10 putting the
converter in the backend; the backend reading has two votes and is the only one a native `<track>`
can use, since `frontend/vitest.config.ts:14` is jsdom, which implements no WebVTT parser. (And
there is no §11.2 — the heading is a flat `## 11` at `:807`; the brief inherited that misnomer from
the stage-8 plan.)

**Line numbers drift ±1–2 everywhere.** The scrim render is `page.tsx:989`, not `:990`; the web CC
button's `aria-disabled` is `:1820` by one panel's count and `:1821` by another's; the bar div is
`:997`, which two designs put at `:994` and `:995`; `_prioritize_window`'s clamp is `:1947`, not
`:1951`; `engineContract.test.ts`'s `method: 'GET'` ban is near `:207-215`, and Design 3 cited it at
`:48-50` — wrong by about 160 lines — then built its `_data/` placement argument on the misread
range (right conclusion, wrong grounds). **The function names and the mechanisms are right
everywhere; the line numbers are not load-bearing and should be re-checked at the point of use.**

## Mechanisms the plan refuses, and why

- **Design 1's admission seam inside `wait_for_first_chunk`** — that function has exactly one
  caller, `api/streaming.py:334`, the shared `GET /video` path the **web** player drives too. Every
  web stream open would widen that torrent's wanted set and inherit the strand, on the same two-slot
  Pi, with no subtitle UI to show for it. A design whose stance is "the smallest thing that is true"
  put its one mutating call into the function with the largest shared fan-in.
- **Design 2's file-level admission** — it edits `test_skip_non_video.py:31`, the test that already
  encodes the house answer with `subs.srt` named explicitly at index 3, and calls that the plan. On
  a blast-radius lens that is not a trade-off to weigh, it is the signal that the mechanism is
  wrong — and its own §3 proves `piece_priority` reaches the same sidecar without touching either
  selector. **The clearest single sign that this plan's mechanism is right is that
  `test_skip_non_video.py:31` survives the stage unmodified.**
- **Design 2's strand watchdog** — "a sidecar can then never be the reason a torrent fails to
  finish" is false in the case that matters: the watchdog only fires once every video file is
  complete, so on a low-seeder torrent whose video never completes the precondition never opens and
  the wide wanted set lives as long as the download does. A guarantee that holds only once the thing
  you were worried about has resolved itself is a mechanism that looks enforced and is not.
- **Design 2's ASS parser, on by default** — converting a format from recalled grammar, with no
  `.ass` file anywhere in this repo, whose worst outcome is a 200 body of `WEBVTT\n\n` that a
  `<track>` reports as a successful load with no event at all.
- **Design 3's `sha256(rel_path)[:16]` token** — a lovely containment shape ("a token cannot express
  a path") that, because it is deliberately not decodable, makes the VTT route re-enumerate on every
  request, and for a disk-sourced entry that is an `os.walk` on the ARM disk libtorrent is writing
  to, while a stream runs, with no memo anywhere. For a design whose whole stance is the Pi's shared
  backend, the one cost it imposed on that Pi is the one it did not count. The plan keeps the
  resolve-only-through-the-lister rule and drops the token, because the live-session-only decision
  (D5) removes the walk entirely.
- **Design 3's and Design 4's blind OK-cycle** — capped at six server-chosen entries with
  `truncated: true` that no cell state ever renders, no wrap back to Off, and no way to see what is
  coming. On a 20-language tree that is up to 20 presses on a surface where `move` never wraps.
  → **D13**: a picker, as a `rowCounts` replacement inside the one grid.
- **A second `useFocusGrid` for the picker** — `useFocusGrid.ts:25` says only one may be live per
  screen, and during an overlapping mount the **incoming** grid is the dead one. The working
  precedent is `bigscreen/profiles/page.tsx`: three mutually exclusive grids.
- **A cycle-on-OK inside the transport cell** — nothing arrow-driven can live there:
  `ScrubBar.tsx:18-22` eats the horizontal arrows while focused with an unconditional
  `preventDefault()` at `:112`. And on this television the transport row is usually the **only** row,
  because `scrubRowCount` returns 0 unless duration is finite and a finite duration has never been
  observed for an in-progress stream on this set.
- **A shrink rescue for the picker** — `clampTarget` already clamps a column into a shorter row, so
  there is no line to delete and no mutation to run. This is stage 8's dead-rescue shape, which
  measured 63/63 green; it is refused by name rather than reintroduced.
- **A test of the form "admitting a sidecar does not block the torrent"** — it cannot fail.
  `validate_torrent_content` runs first and builds its list from `ti.file_at(i).path/.size`, never
  from priorities; `classify_torrent_files` reads only path and size; and
  `test_content_guard_manager.py:46` already pins a `.srt`-bearing torrent as allowed.
- **A `MEDIA_TWINS` entry for the cell** — no subtitle key code has ever been read off this set.
  Reading 34 decides it. `TWIN_CELL` is a `Record<TransportAction, …>` and *does* force `tsc`;
  `MEDIA_TWINS` is keyed on `MediaKeyAction` and correctly does not complain.

## What each design was right about, in one line each

- **1**: labelling an individual test **arm** as currently unfalsifiable *inside the test file*,
  with the condition under which it would start discriminating. Every other design names
  unfalsifiable *design claims* in a list; only this one names unfalsifiable *assertions* at the
  point of use. → task 2(a), task 2(d).
- **2**: `pair_source` returned so the rung the ladder took is observable from outside — the only
  way to tell a correct answer from a correct-by-accident one. → D20.
- **3**: making the only mutating route a **POST**, on the ground that a media element cannot issue
  one. It replaces an assertion with a shape. → D2.
- **4**: asserting the on-screen vocabulary is **pairwise distinct**, and naming in the test what a
  collapse would make the television say. It turns "the TV says something true" from a stance into a
  failing test, and it is cheap. → task 12(e). Plus task 0 before the design, with the probe's own
  falsifier.

## Where the raw record lives

Per-agent returns: `…/subagents/workflows/wf_2d0f5045-f7e/journal.jsonl`, one `{"type":"result"}`
line per agent. Extracted per-area to `…/scratchpad/s9design/` — seven `recon-*.md`, seven
`check-*.md`, four `propose-*.md`, three `judge-*.md`, one `synthesize.md`. Those are session
scratch and will not survive; everything load-bearing from them is in this file or in the plan.
