# webOS TV — stage 7 player: device readings

Run: **NOT TAKEN.** Replace this line with the date (or dates) when the readings are taken,
as `2026-09-22-webos-tv-stage3-results.md` does, and say which sitting produced which rows.

Deliverable named in `docs/superpowers/plans/2026-10-10-tv-stage7-player.md`, task 10, whose
thirteen rows are enumerated in that plan's **"On the television"** section (rows 14 and 15 came
later, from the whole-branch review). Instrument:
`/bigscreen/diag` (`frontend/src/app/(bigscreen)/bigscreen/diag/page.tsx`), hardened by the
same task **before** these readings were taken, for the reason in the next paragraph.

> **How to read this document.**
>
> 1. **Every cell is either a string transcribed verbatim off the television, or the words
>    "not taken".** Nothing here may be inferred from a model number, a vendor table, a
>    desktop browser, or a jsdom test. Where a row says "not taken" it is followed by what is
>    therefore still unknown and what it blocks.
> 2. **A blank cell is a failure, not a pass.** That is why every cell below already reads
>    **not taken**: there is no state this document can be in where an unanswered question
>    looks answered. Do not delete a row you did not take; do not write "ok", "works" or
>    "as expected" — those are summaries, and a summary is what was lost last time.
> 3. **Transcribe the raw string.** `keyCode=461` and "Back works" are not the same reading.
>    The key log prints a line per press that is already in the right form: copy it character
>    for character, including `[keydown]`/`[keyup]`, `t=`, `code=""` and `REPEAT`.
> 4. **This document has no test, deliberately.** Its failure mode is a visible blank, and
>    a test asserting that a markdown table is filled in would be a test about markdown. The
>    *instrument* is tested (`bigscreen/diag/page.test.tsx`, twelve tests added by task 10);
>    those tests prove the log cannot be lost, not that any particular key exists.
> 5. **Measurement vs assumption** is called out per row and summarised at the end. Six
>    merged TV stages currently rest on exactly **one** device key number, 461 for Back,
>    which is an assumption carried from platform documentation, not a reading.

**Why this document exists at all.** `_focus/useBackKey.ts:8-11`: the key log at
`/bigscreen/diag` **was run on this television during the stage-3 sitting and what it showed
was never written down.** The stage-3 results document records the outcome as "displayed
remote key codes as expected" and transcribes none of them. That is the failure this sheet and
the task that hardened the instrument exist to stop recurring — which is why the instrument was
fixed first: the log is now persisted to `sessionStorage`, logs `keyup` as well as `keydown`,
timestamps every line, and keeps sixty lines instead of twelve. **Pressing Back can no longer
destroy the line that pressing Back produced.**

---

## The fifteen rows

| # | Reading | Gates "done"? | Where | Status |
| --- | --- | --- | --- | --- |
| 1 | `ff_session` on `<video>` range requests, with auth on | **YES — gate 1** | real player, `AUTH_ENABLED=true` | **not taken** |
| 2 | `video.load()` resets `networkState`, zeroes `currentTime`, re-issues the Range | **YES — gate 2** | real player | **not taken** |
| 3 | Far-seek probe readout (`Probe far seek (HTTP)`) | **YES — gate 3** | `/bigscreen/diag` | **not taken** |
| 4 | Key codes, **keydown**: Back, OK, Play, Pause, Stop, RW, FF, arrows | no | `/bigscreen/diag` | **not taken** |
| 5 | Key codes, **keyup**: the same buttons | no | `/bigscreen/diag` | **not taken** |
| 6 | Does a held arrow auto-repeat, and at what rate | no | `/bigscreen/diag` | **not taken** |
| 7 | Is `e.repeat` set on those repeats | no | `/bigscreen/diag` | **not taken** |
| 8 | Do media buttons reach the page, or go to `mediaSession` | no | `/bigscreen/diag` | **not taken** |
| 9 | Does the set issue HEAD before GET | no | backend log, during playback | **not taken** |
| 10 | Is a **backward** seek inside the downloaded region reliable | no | `/bigscreen/diag` | **not taken** |
| 11 | Does `<video>` report a finite `duration` for an in-progress stream | no | `/bigscreen/diag` | **not taken** |
| 12 | Does the band's `opacity` transition hold frame over decoding 1080p | no | real player | **not taken** |
| 13 | Does `isolation: isolate` keep the focus ring **visible** over the video | no | real player | **not taken** |
| 14 | With the controls **hidden**, do the set's own keys (Home, Exit, Guide, colours) still work on the first press | no | real player | **not taken** |
| 15 | Is 5s the right quiet period before the controls go, and 15s the right seek margin | no | real player | **not taken** |

**Two of the fifteen are not from the plan.** Rows 14 and 15 were added by the whole-branch
review, which found two of the player's decisions resting on nothing this sheet would ever catch
(see those rows). A guess with no row here is how an assumption becomes a fact, which is the
failure this document exists to stop.

**Thirteen rows from the plan's eight clauses.** The plan names three gates plus "ten more
rows" in a list of eight clauses. Two of them are two readings each, and both splits are
load-bearing rather than arithmetic: the key-code clause says "on keydown **and** keyup", and
a button that answers on only one phase is a *different answer* with a different consequence
(see rows 4 and 5); and "whether a held arrow auto-repeats, at what rate, and whether
`e.repeat` is set" is a rate (row 6, read off the timestamps) and a flag (row 7, read off the
word `REPEAT`), which are produced by different parts of the engine and have historically
disagreed on televisions.

**When each row becomes takeable.** Rows 3-8, 10 and 11 need only `/bigscreen/diag`, which has
been on this surface since stage 3 — they can be taken today, and the key rows have been
takeable (and untaken) for four days. Gate 1 needs a paired television and `AUTH_ENABLED=true`
and nothing else: the main web app's player is enough to answer whether the media pipeline sends
the cookie, so it does **not** wait for task 9. Rows 12 and 13 are about the control band and
its focus ring, so they wait for tasks 8 and 9 to land; gate 2 is answerable on either player's
recovery ladder. Rows 14 and 15 need the real player too, and 14 is taken in the same sitting as
12 — both start by letting the band auto-hide.

**Posture (from the plan): merge on green tests, hold the "done" claim until rows 1, 2 and 3
are transcribed.** The other ten each close a named decision but none of them blocks the merge,
because every one of them has a design answer that does not depend on the reading — that is a
property the stage was shaped for, not luck.

---

## Before the sitting: two halves, and the order matters

**The two halves cannot be taken in one backend configuration, and the plan does not say so.**

- `/bigscreen/diag` is documented in its own header to be browsed with **`AUTH_ENABLED=false`**
  (`backend/app/config.py:62`), because it runs unauthenticated: with auth on, its
  `GET /api/v1/torrents/list` 401s and it cannot reach a stream at all. Rows 3-8, 10 and 11
  are taken in this half.
- **Gate 1 requires `AUTH_ENABLED=true`** and the *real* player, with the television paired
  (`/bigscreen/pair`). It is not a diag reading. Rows 1, 2, 9, 12 and 13 are taken in this
  half.

Revert `AUTH_ENABLED` to `true` when the first half is done; it is the instance's only gate.

**Take the key rows (4-8) before loading any title.** The diag player is a plain
`<video controls>`, so once it exists the television's own control UI may consume the arrows
and the transport buttons, and the log then **under-reports**: a key that works reads as a key
the set eats. The page says this on screen above the log, and a test pins that it does.

**Use the "Clear key log" control between buttons** if the lines run together. The log is now
persisted per tab, so it survives leaving the page — which also means it survives the *sitting*
and will still be there on the next visit.

---

## Gate 1 — Does the pipeline attach `ff_session` to `<video>` range requests?

**One press, and the largest blast radius in the stage.** Pair the television at
`/bigscreen/pair`, leave `AUTH_ENABLED=true`, open a title on the TV player and press Play.

**What it closes.** Whether an authenticated TV can stream at all. `dependencies/auth.py`
short-circuits to `_DEV_CONTEXT` when auth is off, and diag's own instructions say to turn it
off — so it is entirely possible that **playback on this set has only ever been observed with
the gate disabled**, including the successful 2026-10-07 MKV run. The cookie is `HttpOnly`,
`SameSite=Lax`, `Path=/` (`services/auth.py:485-503`), which is correct for a same-origin
subresource; the risk is not the cookie's attributes but that a television's media pipeline may
be a **separate process with its own cookie jar**, in which case the browser's session never
reaches the Range request.

**How to read it.** `make logs s=backend` during the press.
`middleware/error_handler.py:29,37` logs every request twice — on entry as
`METHOD /path`, and on completion as `Request completed in Xs: METHOD /path - STATUS`. So the
status is readable without devtools. Query strings are **not** logged, by design.

| Fact | Reading |
| --- | --- |
| Status of `GET /api/v1/streaming/{id}/video` with auth on | **not taken** |
| Did the picture start? | **not taken** |
| `MediaError.code` if it did not (the player's status line) | **not taken** |

**If negative:** task 5's `classify.ts` `{kind:'session'}` verdict becomes **unreachable** —
harmless, since it fires only on a 401 that never arrives, and it must then be labelled as dead
rather than quietly shipped as a working branch. The real problem becomes "how does a television
get an authenticated stream at all", which is a **stage-10 shell** concern, not a player one.
Say that here; do not re-plan the player around it.

---

## Gate 2 — Does `video.load()` reset `networkState`, zero `currentTime` and re-issue the Range?

**The entire recovery ladder rests on this contract and it has never run on this set.**
`_player/recovery.ts` recovers from a stalled stream by capturing the playhead, calling
`v.load()`, and restoring the position on a one-shot `loadedmetadata`. If `load()` does not
re-fetch on this engine, the ladder is a no-op.

**How to take it.** On the real player, during playback, with `make logs s=backend` open: force
a recovery (the simplest trigger is pulling the title's peers to zero mid-stream, or stopping
the torrent so the stream stalls) and watch for a **second** `GET /api/v1/streaming/{id}/video`
line after the attempt.

| Fact | Reading |
| --- | --- |
| A new `GET …/video` appears in the backend log after `load()` | **not taken** |
| The playhead returned to where it was (not 0:00) | **not taken** |
| Lines logged between the stall and the recovery, verbatim | **not taken** |

**If negative:** the ladder is a no-op here exactly as it was in the browser before the web
fix. The stall path's suspension makes that a visible spinner rather than a silent loop, which
is the right failure — but `recovery.ts`'s bound and `useStallWatch`'s escalation would then be
decoration, and that must be written down rather than assumed.

---

## Gate 3 — The far-seek probe readout

`/bigscreen/diag` → list torrents → pick a title **early in its download** → `Probe far seek
(HTTP)`. The probe (`probeFarRange`, deliberately unchanged by task 10) HEADs for the length,
then GETs `Range: bytes=<90% of file>-` and prints the raw status. It never drains the body: on
a 206 the body is the rest of the film.

**What it closes.** Three things at once: whether a seek past the download point produces the
**503**, whether the set honours **`Retry-After`** on its own, and whether the probe works from
this browser at all. A `<video>` element reports only `MediaError.code`, so without this readout
the status is unobservable on a device with no devtools. This is also stage 3's **highest-value
open follow-up** (its "Follow-ups discovered", item 1), still unanswered.

**Transcribe the whole `<pre>` block, all five lines:**

```
HEAD -> …                      not taken
GET Range: bytes=…- -> …       not taken
Retry-After=…                  not taken
Content-Range=…                not taken
VERDICT: …                     not taken
```

| Fact | Reading |
| --- | --- |
| Download percentage of the title probed | **not taken** |
| Did the picture recover by itself after the refusal? | **not taken** |

**If the pipeline double-retries** — i.e. the set re-issues the Range on its own after
`Retry-After` — then the player's ladder is a **second** layer and the two must not fight. That
changes the seek margin task 6 builds (`_player/seekBoundary.ts`'s `MARGIN_S`) and possibly
`recovery.ts`'s attempt bound, and is the one outcome here that edits shipped code.

---

## Row 4 — Key codes, keydown

`/bigscreen/diag`, **before loading a title.** Press each button once and copy its
`[keydown]` line verbatim.

| Button | `[keydown]` line, verbatim |
| --- | --- |
| Up | **not taken** |
| Down | **not taken** |
| Left | **not taken** |
| Right | **not taken** |
| OK / Enter | **not taken** |
| Back | **not taken** |
| Play | **not taken** |
| Pause | **not taken** |
| Stop | **not taken** |
| Rewind | **not taken** |
| Fast-Forward | **not taken** |

**What it closes.** Every recognition list on the surface, each of which is currently generous
because nothing is known: `_focus/useFocusGrid.ts` (arrows, `37/38/39/40` plus `Arrow*` names),
`_focus/useBackKey.ts` (`BACK_KEYS`, six names; `BACK_KEY_CODES`, `461/8/27/166`), and
`_focus/useMediaKeys.ts` (`MEDIA_KEYS`, sixteen names; `MEDIA_KEY_CODES`, `415/19/413/412/417` —
**recalled platform documentation, not a reading**, and that header says so).

**What a reading buys.** Narrowing. A `key` name the device never sends is inert, but a wrong
`keyCode` is worse than inert, because the numeric namespace is shared with ordinary keys. Once
these lines exist, the lists can be narrowed to what the set actually sends — a one-line edit to
two arrays. **Until they exist, narrow nothing.**

**Note the `code=` field too.** The instrument prints `code=""` when the engine supplies none;
an empty `code` alongside `key="Unidentified"` is the "legacy numeric only" shape five of this
repo's test fixtures already assume, and confirming it is what makes those fixtures honest.

---

## Row 5 — Key codes, keyup

The same buttons, their `[keyup]` lines.

| Button | `[keyup]` line, verbatim, or "keyup only" / "keydown only" |
| --- | --- |
| Up / Down / Left / Right | **not taken** |
| OK / Enter | **not taken** |
| Back | **not taken** |
| Play / Pause / Stop | **not taken** |
| Rewind / Fast-Forward | **not taken** |

**What it closes.** Whether a button exists at all. Before task 10 this page listened on
`keydown` only, so **a transport key delivered only on keyup read as "the television eats
it"** — the wrong conclusion, and the one most likely to be drawn from a silent log. Every hook
on this surface listens on `keydown`; a button that answers only on `keyup` is a hook that must
change, not a key that is missing. Both phases are now logged and labelled, and a test pins
that the `[keyup]` label can be told from the `[keydown]` one.

A button that logs **neither** phase is row 8's question, not this row's.

---

## Row 6 — Does a held arrow auto-repeat, and at what rate?

Hold Right down for about two seconds. Every line carries `t=<ms since load>`; the rate is the
difference between two consecutive lines.

| Fact | Reading |
| --- | --- |
| Does it repeat at all? | **not taken** |
| Three consecutive `[keydown]` lines, verbatim (for the `t=` deltas) | **not taken** |
| Derived interval, ms | **not taken** |

**What it closes.** Whether ±10s needs acceleration, or the held-key latch
`bigscreen/list/page.tsx` already uses. It also bounds the cost of the per-press design
decisions: `_focus/useFocusGrid` has **no `e.repeat` guard**, so a held arrow moves the ring
once per repeat, and the scrub cell task 8 builds does pending-position arithmetic rather than
seeking per press precisely so that a held arrow is not a storm of Range requests re-anchoring
the backend's deadline window. (`bigscreen/list/page.tsx:210-217` is the existing latch.)

**`t=` is why this row is fillable.** The pre-task-10 log had no timestamp and this reading
could not be taken from this screen at all.

---

## Row 7 — Is `e.repeat` set on those repeats?

From the same held press: does the word `REPEAT` appear on the second and later lines?

| Fact | Reading |
| --- | --- |
| `REPEAT` present on repeat lines | **not taken** |
| `REPEAT` absent on the first line | **not taken** |

**What it closes.** `useBackKey` and `useMediaKeys` both claim a held key but **act once**, on
the strength of `e.repeat`. If this engine never sets it, a held Back walks the whole escalation
in one press — collapse, then leave — and both hooks need a different latch. Separate from row 6
because a set can repeat without flagging, which is the dangerous combination and the reason
these are two rows.

---

## Row 8 — Do media buttons reach the page, or go to `mediaSession`?

Read the key log (rows 4-5) **together with** the two `Feature probes` rows task 10 added:

| Probe | Reading |
| --- | --- |
| `JS: navigator.mediaSession (where media keys may go instead)` | **not taken** |
| `JS: mediaSession.setActionHandler` | **not taken** |
| Did Play/Pause/Stop/RW/FF log any line at all? | **not taken** |

**What it closes.** The difference between "the set eats the button" and "the set delivered it
somewhere this page is not listening". Present + nothing logged means the buttons exist and are
routed to the Media Session API, so the shortcut is a **stage-10 shell job**, not an
unrecognised key code — a materially different follow-up. Absent + nothing logged means the
platform consumes them in its own player and there is nothing to bind.

**Either way it changes nothing in stage 7.** Every media-key action has a focusable on-screen
twin in the transport row, enforced by a test, so an unrecognised media key is a missing
shortcut and never a missing feature. The probe is **presence only** — registering a handler
would claim the buttons from the platform, which is not a measurement this stage is allowed to
take.

---

## Row 9 — Does the set issue HEAD before GET?

Readable from the backend log during **one** playback: `make logs s=backend`, then start a
title and watch the method of the first two lines for `/api/v1/streaming/{id}/video`.

| Fact | Reading |
| --- | --- |
| First two log lines for `…/video`, verbatim | **not taken** |
| Methods, in order | **not taken** |

**What it closes.** Whether `classify.ts`'s **HEAD-only** probe shares a path the pipeline
already exercises. Every `GET /video` runs `prioritize_video_files` + `force_start_for_stream`
(a DB write) and then re-deadlines 32 pieces at the file head every 250ms, **even on a complete
torrent**, so a "cheap" `Range: bytes=0-0` probe would hijack libtorrent's deadline queue away
from the live playhead. `head_video` touches only `os.path.getsize`. If the set HEADs first,
that classifier is measuring the same request the player already makes; if it does not, the
probe is an extra request and its cost is the HEAD route's, which is near zero either way.

The log prints no query string and no `Range` header, so the **offsets** are not readable here.
Only the methods and the statuses are.

---

## Row 10 — Is a backward seek inside the downloaded region reliable?

`/bigscreen/diag`, with a title playing: press `-10s` several times, from various positions
inside the downloaded region.

| Fact | Reading |
| --- | --- |
| Did the picture resume each time? | **not taken** |
| Any `ERROR MediaError.code=…` from the status line, verbatim | **not taken** |
| Position(s) attempted, and the download percentage | **not taken** |

**What it closes.** Whether task 6's `clampSeek` needs a **lower** bound as well as an upper
one. It is specified to refuse forward seeks only, and to raise its ceiling to the playhead
because for a pack episode the contiguous run can legitimately sit *behind*
`currentTime`. If a backward seek into already-downloaded bytes is unreliable on this pipeline,
that asymmetry is wrong and the clamp owes a floor.

Stage 3 recorded "scrubbing worked" at ~26% downloaded but **recorded no offsets**, which is why
this is still open: a reading with no number is the failure mode this document exists to fix.

---

## Row 11 — Does `<video>` report a finite `duration` for an in-progress stream?

`/bigscreen/diag`, on a title that is **still downloading**. The page prints the metadata line
itself: `metadata: <w>x<h>, duration <n>s`.

| Fact | Reading |
| --- | --- |
| The metadata line, verbatim | **not taken** |
| Download percentage at the time | **not taken** |
| `duration` finite? | **not taken** |

**What it closes.** Whether the scrub row exists at all. Task 8's scrub cell is rendered on
`hasFiniteDuration` and its row count comes from the same condition, so an `Infinity` or `NaN`
duration means the player is **transport-only** — a shape nobody has seen on this set and whose
focus arithmetic is therefore untested in the field. It also decides whether task 6's
bytes→seconds conversion has a denominator at all.

---

## Row 12 — Does the band's `opacity` transition hold frame over decoding 1080p?

Real player, during playback: let the controls auto-hide, then reveal them, several times.

| Fact | Reading |
| --- | --- |
| Does the fade look smooth, or does it step/jank? | **not taken** |
| Does the **picture** stutter during the fade? | **not taken** |

**What it closes.** Whether task 8's hide-by-paint decision survives on hardware. The band is
~1728px wide over a decoding 1080p surface, and the whole `(bigscreen)` surface exists because a
2022 TV GPU cannot afford the web player's eight stacked `backdrop-filter` layers. `opacity` on
a composited layer should be free; "should be" is the phrase this document is here to replace.

This is a judgement, not a number, and it is the weakest row on the sheet. Record what was seen,
in words, and say that it is an impression.

---

## Row 13 — Does `isolation: isolate` keep the focus ring visible over the video?

Real player at 1920×1080: move the ring onto every transport cell and the scrub bar, with the
picture behind it.

| Fact | Reading |
| --- | --- |
| Ring visible on every transport cell | **not taken** |
| Ring visible on the full-width scrub cell | **not taken** |

**What it closes.** The one thing a stylesheet test cannot. Task 8 gives `.bs-player`
`isolation: isolate` because absolutely positioned children paint **over** their parent's own
outline — a defect that already cost this stylesheet its one full-bleed focus stop, and which
was found by rendering it in a browser at 1920×1080, not by reading the CSS. The `test:tv` rule
it adds asserts the declaration is **present**; only a television proves the ring is
**visible**. A ring nobody can see is a surface a remote cannot use.

---

## Row 14 — With the controls hidden, do the set's own keys still work on the first press?

Real player, during playback. Let the band auto-hide (five seconds of no presses), then press,
one at a time and each from the hidden state: **Home**, **Exit** / **Back-to-live**, **Guide**,
and one **colour** button. After each, say whether the television did its usual thing on the
FIRST press, or whether it took two.

| Button | Did the set act on the first press (hidden)? | On the second press? |
| --- | --- | --- |
| Home | **not taken** | **not taken** |
| Exit | **not taken** | **not taken** |
| Guide | **not taken** | **not taken** |
| A colour button | **not taken** | **not taken** |

**What it closes.** `_focus/useRevealOnKey.ts:84-94` calls `preventDefault()` **and**
`stopPropagation()` on every keydown except Back while the band is hidden — which is the steady
state five seconds into every film. That is deliberate and argued in the hook's header (the first
press must mean only "wake up", never "wake up and also seek"), and it is the opposite of the rule
the other three key hooks state for themselves: `useBackKey.ts:35` — *"`preventDefault()` on a key
this does not act on is how Back stops working on a device nobody can attach a debugger to."* The
difference is that this hook DOES act on every key, by revealing. But nobody has pressed Home
inside the player on this television. If the set routes its platform keys through the page, this
swallows the first press of each of them for most of the film.

**If a key needs two presses**, the fix is a one-line exemption list beside Back's in
`useRevealOnKey`, and the hook's header already says so. If the set handles those keys before the
page sees them at all, write that down: it is the answer that makes this row stop mattering.

---

## Row 15 — Are the two timing guesses right?

Real player, during playback. Both of these are **self-declared guesses in the source**, which is
why they have a row: nothing on this set informed either number.

| Fact | Reading |
| --- | --- |
| `REVEAL_HIDE_MS` is 5s: too short, too long, or about right? | **not taken** |
| Did the band ever hide while you were still deciding? | **not taken** |
| `SEEK_MARGIN_S` is 15s: after a clamped forward seek, did playback continue without stalling? | **not taken** |
| If it stalled, how long before the picture came back | **not taken** |

**What it closes.** `useRevealOnKey.ts:5-9` says of the first in as many words: *"A guess, not a
measurement — no reading from the set informs it"*, and it is a named constant the caller may
override precisely so this row can change it. `_player/seekBoundary.ts`'s `SEEK_MARGIN_S = 15` is
reasoned from the backend's 1 MiB chunk reads and a 1080p bitrate — which is arithmetic over two
estimates, not a measurement — and gate 3 only covers the far-seek *refusal*, not whether a seek
the clamp **allowed** actually keeps playing. A margin that is too small is a 300-second
mid-stream hold with the status code already spent (hazard 9); too large and the last minutes of a
downloading title are needlessly unreachable.

Like row 12 this is partly a judgement. Record it in words and say so.

---

## Verdict

**→ NOT REACHED.** Fill this in as stage 3's results document does, and state which of the
three gates were transcribed. Until rows 1, 2 and 3 carry real strings, the honest statement is:

> Stage 7 merged on green tests. The player has **not** been observed working on the
> television. Rows 1, 2 and 3 are untaken, so "the stage works" is not claimed.

---

## Measurements and assumptions, so a reader six months from now can tell them apart

**Measured on this television (from the stage-3 sitting, 2026-10-06/07):** Chromium **120**
from `navigator.userAgent`; every feature probe on the diag page answered yes; MKV/Matroska
direct play; DDP5.1 (E-AC3) audio; streaming from an in-progress torrent at ~26%; scrubbing
inside the downloaded region (with no offsets recorded); the Magic Remote emits real mouse
events; the Tailwind web app renders.

**Assumptions still carried, none of them a reading:**

| Assumption | Where it is relied on | What would settle it |
| --- | --- | --- |
| `461` is Back | `_focus/useBackKey.ts:20` (and five names beside it) | Row 4 |
| `415/19/413/412/417` are the transport codes | `_focus/useMediaKeys.ts:63-69`, which labels itself as recalled documentation | Rows 4-5 |
| The engine populates `e.key` for a media button at all | the same file's header calls this a guess | Rows 4-5 |
| webOS **25** | inferred from the measured Chromium 120, per spec §3.1 — an inference from a measurement, which is the only one of its kind here | the model SKU, still untranscribed |
| HEVC / H.265 decodes | stage 8's codec profile | a real HEVC file; accepted risk on documentation |
| DTS at 1080p | the same profile's penalty term | a real DTS file; untouched |
| The `<video>` pipeline sends cookies | the whole authenticated TV path | **Gate 1** |
| `load()` re-fetches | the whole recovery ladder | **Gate 2** |
| A far seek answers 503, once | `MARGIN_S`, the attempt bound | **Gate 3** |

**What jsdom proves about any of this: nothing.** The instrument's own suite asserts that the
log survives a remount, that `keyup` is recorded and labelled, that twenty lines are twenty
lines, that the `mediaSession` probe cannot take the feature table down with it, and that the
far-seek probe still cancels a 206 body instead of draining the film. Those are properties of
the **instrument**. Every value it will print is a property of the **engine it runs on**, and in
a test that engine is jsdom.

---

## Follow-ups this sheet will create

1. **Narrow the recognition lists** once rows 4-5 exist — `BACK_KEY_CODES`, `MEDIA_KEY_CODES`,
   and the names beside them. Until then, generous is correct.
2. **Stage 3's device facts are still untranscribed** — model SKU, firmware, verbatim UA,
   `innerWidth`/`innerHeight`, `devicePixelRatio`. All five are on the diag page's Device table;
   none is load-bearing now the engine is measured, but copy them while you are there.
3. **`_focus/useMediaKeys.ts:24` attributes this instrument to "stage 10".** It is stage 7,
   task 10, and it already exists. Fix the comment when that file is next touched.
4. **If gate 1 is negative**, open a stage-10 item: an authenticated media path for a
   television, and mark `classify.ts`'s `session` branch as unreachable rather than working.
