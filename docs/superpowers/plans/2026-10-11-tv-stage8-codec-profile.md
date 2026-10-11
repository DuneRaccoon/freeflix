# Stage 8 — codec-aware selection, the `lg-webos22-floor` profile, and the 4K opt-in

Branch `feat/tv-stage8-codec-profile`, off `master` at `6227e71` (the stage 7 merge).

Spec: `docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` — stage 8 is "codec-aware
selection + the profile + the 4K opt-in", detailed in §7.2, §7.3, §3.2 (the LG AV tables),
§11.2 (the selector test) and §14 (the sequence row).

**Read `2026-10-11-tv-stage8-design-notes.md` first.** It is the design record: a seven-area
recon of the real source, each area adversarially re-checked against its own citations, then
four competing designs scored by three judge panels. Every claim there carries a `file:line`,
and its header lists what was re-verified a second time before this plan was written, plus three
corrections to the synthesis itself.

**This stage is unlike 4, 6 and 7 in one way that shapes every task: most of its rules rest on a
vendor document for the wrong platform version.** The seven §7.2 rules are derived from LG's
webOS **22** AV table; the set measured as webOS **25**. The spec is explicit that stage 8 must
decide which table it models and *name it accordingly*, so **the profile name is a deliverable**.
Two of the rules cannot be evaluated at all today — one has no input anywhere in the backend —
and the honest answer there is a row that says so in code, not a rule that looks enforced.

## Scope

In: a capability profile for this television, applied to the two endpoints that rank candidates;
an audio/dynamic-range/bit-depth/codec-family parser and a labelled corpus to measure it; the
per-title 4K opt-in on the TV's movie screen; disclosure of what actually arrived; and the codec
instrument plus the readings sheet that can retire the guesses.

Out, with owners: sidecar subtitles and `<track>` (**stage 9**); the webOS shell, the real root
exit and Back popping a navigation stack (**stage 10**, which also owns parked finding 13). A
real container check after metadata, a bitrate estimate, a release-title column on `Torrent`, and
the 4K cell on the show screen are named follow-ups with reasons, not oversights — §7 below.

## Verification, every task

From `frontend/`: `npx vitest run`, `npm run test:tv`, `npx tsc --noEmit`, `npm run build`.
Backend, in a **one-off container with tests mounted** (they are baked into the image, not
bind-mounted):

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest -q
```

**Never** `docker compose up`, `down`, `restart`, or anything with `-V` — recreating the running
`backend` mid-download leaves a torrent seeding at 100% with no files on disk and there is no
`force_recheck` path to recover it.

**Re-baseline all four counts at branch start and quote them in task 1's commit.** The stage-7
numbers (frontend 2277, `test:tv` 1334, backend 649) are the starting point, not a target.

**This stage adds a file the container cannot see by default.** `backend/tests/data/releases.tsv`
is test data, so it lands under `backend/tests`, which the dev override does not mount. Run the
corpus suite both ways once — with the explicit `-v` mount above, and after `make build` — and
record in task 3's commit which you used. An unmounted corpus is a **green no-op**, not an error:
there is no `[tool.pytest.ini_options]` in `backend/pyproject.toml`, so `empty_parameter_set_mark`
is the default `skip` and every parametrised row reports as skipped. Task 3's row-count test is
the thing that fails instead.

**Neither frontend guard runs in any build or in CI**, and every mutation below is manual. One
green run proves nothing here — a 24% flake passed eight agents during stage 6 — so loop the
suites before believing any of them: `test:tv` 25+ times, the full `vitest run` 5+.

## Three decisions, settled before planning

The design pass ended with three questions for the user. The standing instruction for this
project is to take the best option and keep going, so they are settled here, with the reasoning
written down so any of them can be reversed on evidence rather than re-argued from scratch.

**1. DTS at 1080p ships in shadow (R3, R4): it matches, it is reported, it reorders nothing.**
§7.2's own cell calls the rule *unverified* — LG dropped DTS decode on some model years and
which years is unknown. The cost of shadowing is that until reading 18 is taken a 1080p DTS
release is chosen exactly as it is today, so a viewer may land on a silent film; the cost of not
shadowing is that a guess reorders the whole library now with no retirement path but a reading
that may never be taken. Shadow wins because reading 18 is **cheap** (one diag clip) and the
failure it guards against is recoverable by pressing Back. Promotion is a one-cell edit to
`state`, and task 4's mutation list includes performing it.

**2. The 4K opt-in may pick a release the profile merely *costs* — only R1 and R2 refuse.**
So a 4K press can land a penalised AV1 or Dolby Vision 2160p release. Requiring tier A or B
instead would make the opt-in return nothing on most titles, because HEVC + DD/DD+ is the only
combination both §3.2's Ultra HD table and this profile like. The cell carries the untested
caveat and the watch route discloses what arrived, which is what makes permissiveness honest
rather than silent.

**3. The four diag clips and a genuine 2160p release are not in hand, and the stage ships
anyway.** Rows 16, 17, 18 and 20 need clips produced off-device with ffmpeg; row 23 needs a real
multi-gigabyte 2160p HEVC release in the library. Neither exists today and neither can be
produced from here. Consequences, accepted deliberately:

- Task 10's instrument ships with **"file not present" as a first-class rendered state**, tested,
  because a 404 and an unsupported codec both end with no picture — and the sheet carries the
  exact ffmpeg command line per clip, so producing them is one paste rather than a research task.
- The 4K cell still ships. It is a *request* with a caveat, not a promise, and every layer below
  it reports what actually happened.
- **The stage's "done" claim stays withheld**, exactly as stage 7's does. Green tests merge; rows
  16, 18 and 23 are what make the profile true, and they are untaken.

## Corrections found while implementing (read these before your task)

Seeded with what the second verification pass found against the design notes. **Append to this
section as you go** — it is the stage's shared memory, and in stage 7 six of the plan's own
prescribed tests turned out to be unfalsifiable.

**`TorrentCandidate` already carries `release_title`** (`models.py:200`, set at
`torrents_select.py:56`), so `/sources` has told clients the release name all along. The notes
imply otherwise in places. What is genuinely unavailable is which release a *started* torrent came
from: that is the `Torrent` DB row, hazard 15, and it stays out of scope.

**`_HDR` does match a bare `DV` token** — the alternation is
`\b(hdr|hdr10|dolby\s*vision|\bdv\b)\b` at `quality.py:17`. The real gap is exactly `DoVi`, `HLG`,
and dotted `Dolby.Vision` (`\s*` does not match `.`). So R5's input is **lossy, not absent**;
"no input today" overstates it and the docstring must not repeat that.

**From task 1 — two more of this plan's prescribed mutations could not fail, and the second one
exposes two pre-existing unfalsifiable tests in the repo.** Both verified independently:

- **Finding A. `_effective_bytes`'s `-1` sentinel is INERT, and `else -1` → `else 0` reddens
  nothing.** The key element at `torrents_select.py:93` is `-_effective_bytes(bytes)`, so a real
  release contributes a *negative* number and a 0-byte release contributes `+1` today, `0` mutated,
  `0` with the sentinel deleted — all three greater than every negative, so the order is identical.
  Measured: `else 0` → **45 passed**; `return byts` (sentinel gone) → **45 passed**; only a sign
  flip reddens (5 tests). The docstring's promise ("a 0-byte release must not outrank a real one")
  is already delivered by the plain `-bytes` term, and **only a negative `bytes` could tell the two
  apart**. Consequence: `test_rank_candidates.py:49` `test_bytes_tiebreak_zero_never_outranks_real_release`
  and `test_select_best_shim.py:31` `test_shim_bytes_zero_never_wins_tiebreak` **do not pin the
  sentinel they appear to guard** — two more tests-that-cannot-fail, this time pre-existing rather
  than prescribed. Task 1 retargeted at the term's *direction* instead and wrote the finding into
  the test docstring. **The sentinel stays**: the zero-diff gate forbids touching the selector in
  this stage, which here is the gate producing the right answer. Named follow-up.
- **Finding B. "delete `-seeds` → the 720p/2160p row reddens" names a row that cannot redden.**
  `_bucket_index` is consulted before `-seeds` (`torrents_select.py:90-92`), so a *cross-bucket*
  pair is decided by the bucket and never reaches the seeds term. Verified: under that mutation
  leak (b)'s `2160p@6 vs 720p@999` row stayed **green**. Only same-bucket pairs discriminate it.
- Finding C: regenerating the snapshot needs `-e PYTHONPATH=/opt/freeflix`, because the app package
  is not pip-installed in the image and running a script puts `/opt/freeflix/tests` on `sys.path`
  rather than the workdir. Recorded in the module docstring and in the JSON's own `_comment`.
- **Finding D. `test_rank_candidates.py`'s `_hit` was not reproducible across processes** —
  it derived the infohash from `abs(hash(title))`, and `PYTHONHASHSEED` is unset in the image.
  Verified: three consecutive processes gave three different values. Nothing asserted on
  `source_id`, so it never failed, but **any golden snapshot built on that helper would have been
  unstable.** Fixed to sha1 and pinned. `test_select_best_shim.py:9` has the same shape and is
  outside task 1's file list — a one-line fix for whoever owns that file.
- Finding E, a small over-claim of the plan's: the tree has **two** 2160p-for-a-1080p-ask fixtures,
  not one (`test_torrents_select.py:36-38` and `test_select_best_shim.py:20-23`). The substance
  holds — both go through `select_best`, which pre-filters and so cannot leak — and
  `test_rank_candidates.py` really does construct no 2160p hit anywhere.

**And one repo-level hazard task 1 found but correctly did not fix:** `backend/tests/test_torrent.py`
does **real network I/O during collection**. It joins the swarm for a specific film and only
terminates because that film is already complete in the bind-mounted downloads dir (1.8 GB). Proved
by counterfactual: same magnet with a temp `save_path` sat at 1.92% after 24s with `is_seeding`
still False, so the `while True:` would not exit. On a fresh clone, pruned volume or CI, `pytest`
downloads a feature film during collection; with no internet it hangs. Not stage 8's to fix, and
`conftest.py` is untouched — recorded so the next reader does not rediscover it the hard way.

**From task 2 — three of this plan's prescribed mutations could not fail, and one claim about
Python's regex engine was simply false.** Verified independently before being accepted:

- **Finding 1. Alternation order is unobservable for alternatives that start at different
  characters.** `(?:ac3|e-ac3)` and `(?:e-ac3|ac3)` **both** return `E-AC3` from
  `Movie.2020.E-AC3.5.1`, because Python tries every alternative at the leftmost position before
  advancing. The `_SOURCE` analogy at `quality.py:37` only holds for alternatives starting at the
  *same* character — `(?:web|web-?dl)` really does return `WEB` where `(?:web-?dl|web)` returns
  `WEB-DL`. So "move `ac3` before `eac3`" would have come back **green** against the obvious
  single-alternation implementation. The shipped parser makes it falsifiable by a different
  mechanism: an ordered list of per-token patterns scanned most-specific-first, refusing to
  re-read characters an earlier pattern claimed (`_scan_tokens`), with the reasoning written at
  `quality.py:62-81` so nobody simplifies it back.
- **Finding 2. "Drop the codec co-requirement from bit depth → `FLAC.24bit` reddens" is false.**
  `(?<!\d)(8|10|12)` already refuses `24` — verified: it returns `[]` on `24bit` and `['10']` on
  `10bit`. There are **two independent guards** where the plan saw one, and
  `Concert.2020.FLAC.24bit.48kHz` (`test_quality.py:22`) can discriminate **neither**: it has no
  codec *and* an out-of-domain number, which is exactly the "fixture whose values collide" shape.
  Two fixtures now, one per guard.
- **Finding 3. "Add `ts` as a container token → the telesync row reddens" is false for the title
  the plan named.** `Movie.2020.TS.XviD-GRP` reads `container_guess='avi'` with or without `ts`,
  because it names XviD. The discriminating fixture is a telesync whose codec is *not* XviD —
  `Movie.2020.TS.x264-GRP`, which reads `None`. Both rows are kept.
- Finding 4, minor: the `parse_quality` characterisation test must assert `parse_quality` **alone**.
  Written the natural way — both parsers on one string, asserting they disagree — it reddens under
  the resolution-precedence mutation and destroys the independence demonstration the plan wanted.
  Split into two tests.

Verified by direct exercise of the shipped parser: `Movie.2020.1080p.UHD.BluRay.DD5.1.x265-GRP`
buckets as **`2160p`** through `parse_quality` while `facts.resolution` reads **1080** — the
containment this stage depends on, working.

**Every `file:line` in tasks 4 through 9 was re-checked before the first agent ran**, and all of
them hold: `movies.py:70`/`:79`/`:96`/`:97`/`:115`, `tv.py:99`/`:108` (and `services/tv.py` calls
neither `set_detail` nor `set_torrents`), `cron/jobs.py:284`, `test_candidate_helpers.py:3`,
`test_cron_select_parity.py:15`, `test_sources_endpoint.py`'s nine-field `_cand`,
`config.py:138-141` (sixteen extensions, thirteen outside `.mkv/.mp4/.ts`) against
`api/streaming.py:32-49`, `title.ts:57`/`:133-140`/`:296`/`:382-385`,
`movie/[id]/page.tsx:26`/`:137`, `list/page.tsx:129-141`, `TitleScreen.tsx:9-12`,
`PrimaryAction.tsx:17`/`:144`, `bigscreen.css:672-674`/`:820-821` (and the no-`.bs-btn`-modifier
rule in four separate blocks), `types/index.ts:139-149`, `watch/[id]/page.tsx:505` (and
`chosen_quality` appears nowhere in that file), `classify.ts:27-30`, `journeys.test.tsx:907-921`,
`legacy-target.test.ts:169`/`:172`/`:552`, `diag/page.tsx:65`/`:314` (and `canPlayType` appears
nowhere under `(bigscreen)`), and the **eleven** web payload assertions, counted: five on the
download path and six on the Play path. **One correction:** the movie payload assertion in
`title.test.ts` is at `:492`, not `:491`.

**`parse_release_info` has zero production callers** (confirmed: only `test_quality.py` imports
it; `parse_quality`'s single production caller is `providers/catalog.py:69`). Widening the first
is free. Reordering the second is not, and task 2 does not.

## The layer, in one page

**One new pure module: `backend/app/services/capability.py`**, holding the rule table,
`evaluate()`, `apply_profile()`, `PROFILES` and `READINGS_ROWS`. It imports `app.models` and
`app.providers.quality` and nothing else — no DB, no HTTP, no `settings`, and **no import of
`torrents_select`**.

It is called from **two lines in `backend/app/api/torrents.py` and nowhere else**:

```python
# POST /download, after the existing rank_candidates at :87-90
candidates = apply_profile(candidates, profile_for(request.client), allow_2160p=(request.quality == '2160p'))

# GET /sources, around the three service returns at :146-148
return apply_profile(await ..._candidates(tmdb_id, quality), profile_for(client), allow_2160p=(quality == '2160p'))
```

**`git diff --stat master -- backend/app/services/torrents_select.py` must print nothing.** Not a
test — a merge gate, checked mechanically. Nothing in the selector changes: not the four-tuple,
not `classify_health`, not `available_qualities`, not `select_best`, not the private
`_source_id`/`_is_season_pack` that `test_candidate_helpers.py:3` imports by name. No service
signature changes either, so `test_sources_endpoint.py`'s fixed-arity fakes stay out of the blast
radius. Every contract already pinned keeps holding **without restatement**, because the function
those tests describe is unchanged.

**Why not inside `rank_candidates`.** It has five call sites, and the fifth is the reason:
`api/torrents.py:87`, `services/movies.py:115`, `services/tv.py:99`, `services/tv.py:108`, and
`torrents_select.py:110` inside `select_best`, whose only production caller is the headless
scheduler at `cron/jobs.py:284`. Anything placed in the ranking function reaches cron whether it
is wanted there or not, and a defaulted parameter is a weaker guarantee than never handing it the
parameter at all. `select_best` gains nothing, so **cron is unreachable by construction** and the
unguarded `ranked[0]` can never `IndexError`. No defensive `if not ranked: return None` is added:
while nothing is filtered the branch is unreachable, and an unreachable guard is one no test can
fail.

**The ordering.** `apply_profile` annotates each candidate and runs a **second, stable sort** over
the already-ranked list, keyed `(rejected, health_rank, capability_cost)`. Because
`rank_candidates` already ordered by `(health, bucket, seeds, bytes)`, because `health_rank` is
the first element of both keys, and because Python's sort is stable, the capability term lands
**exactly between health and the quality bucket** — where it has to sit — and bucket/seeds/bytes
order inside each group survives byte-for-byte. No weight tuning, no arithmetic bound, no fifth
tuple element in the selector.

`rejected` is **outermost**, so a reject is never auto-chosen whatever its swarm. Penalties sit
**below** health deliberately: a penalty means "worse, but it will play", and a release under
`min_seeds` will not start at all.

**The 4K opt-out must therefore be a reject, not a cost.** `health_rank` precedes `_bucket_index`
and `bucket_order` makes 2160p the *first* downgrade target for a 1080p ask, so no cost term below
health can reach it — a 2160p at bucket index 1 with the maximum cost still beats a 720p at index
2. `evaluate` takes `allow_2160p` for exactly this reason. Without it the stage merges green and
still hands the television a 2160p DTS-HD release for a 1080p ask.

**Nothing is filtered.** Rejected candidates are partitioned last and **marked**, never dropped.
`/sources` always returns a full list, so the web's alternatives modal
(`MovieDetailView.tsx:281`, guarded on `candidates.length > 0`) and the in-player switcher
(`VideoPlayer.tsx:1834`) keep working — an empty list would make the web *play anyway with no
warning*, i.e. tighten the rule by removing the safety net. `/download`'s auto-pick skips
rejected rows and refuses with a distinct 404 only when nothing survives. **The list is advisory;
the download is a commitment.**

**Capability never touches `health`.** That field drives the web's badges and its `hasHealthierAlt`
gate, which selects on `c.health === 'healthy' && c.quality !== resolved` — so a capability cost
folded into health would make a device-rejected release the alternative the modal actively
*recommends*, and accepting it calls `streamCandidate`, which ships a magnet and takes the
verbatim bypass.

**The absent-profile default is structural, three ways.** (1) `apply_profile(candidates, None,
...)` returns `return candidates` — the *same list object*, unannotated, asserted `is`, not `==`.
(2) Zero-diff on the selector: the unprofiled path is literally today's code. (3) A hostile-table
identity test: monkeypatch the registry with a profile that rejects everything at maximum penalty,
call with `client=None` and again with the argument omitted, and assert byte-identical order
against task 1's golden snapshot.

### The name: `lg-webos22-floor`

Three facts in one identifier: vendor and platform family, the table the rules are a function of,
and the posture.

Not `webos25`: nobody on this project has read LG's webOS 25 AV table in any form, and "webOS 25"
is itself an inference from the measured Chromium 120 via §3.1's mapping — the model SKU and the
verbatim user agent are **both still untranscribed** since stage 3. Not bare `webos22`: it reads
as a device match rather than a table provenance. Not device-shaped (`lg-qned99`): that ties a
conservative floor to one SKU and blocks reuse by any older LG.

**And the repo's own argument for keeping the 22 derivation, which needs no internet:** the engine
was upgraded by software; the decoder silicon is 2022. `legacy-target.test.ts:21-24` already
states the principle for CSS — a newer browser engine does not make a TV GPU faster — and
CLAUDE.md repeats it. LG's webOS 25 table describes 2025 model-year hardware; applying it to a
Re:New-upgraded 2022 panel claims decoders this panel may never have had. **So the 22 table is the
*safer* derivation for this specific set, not merely a conservative one.** That goes in the module
docstring so the next reader does not re-litigate it from a version number. A later *measured*
profile is a **new id** (`lg-qned99-measured`), never a quiet edit to this one's rules.

**Rename cost, in full: seven occurrences across two files** — spec `:72`, `:539`, `:555`, `:742`,
`:846`, plus `2026-09-22-webos-tv-stage3-results.md:13` and `:203`. **Six of the seven are done**
(commits `ad465cf` and this branch's doc commit); the seventh is the §7.2 corrected-note paragraph
at spec `:556`, which task 10 rewrites wholesale.

**The merge gate, stated correctly — and the obvious phrasing of it is wrong.** "`grep -rn webos22`
returns nothing" cannot be the gate, for two reasons: `lg-webos22-floor` *contains* `webos22` as a
substring, so the gate would forbid the very name it is enforcing; and the stage-3 results document
and this plan both legitimately *record* the old name as history, which is the opposite of a defect.
The gate is therefore:

```bash
grep -rn webos22 backend/app frontend/src | grep -v lg-webos22-floor   # must be empty
```

plus, in `docs/`, every surviving bare `webos22` must be inside prose that is explicitly recording
the decision or its history — never a live wire value. Checked by eye against that list, once, at
the branch review.

## The rules table

Every rule is `(id, when, effect, cost, basis, state, settled_by, why)`. `basis` is a **closed
set** — `measured` | `lg-table` | `lg-doc` | `inferred` | `guess` | `no-input` | `product` — and
each value **licenses a ceiling**: only `lg-table` and `product` may REJECT; `lg-doc`, `inferred`
and `guess` may cost only; `no-input` forces effect NONE with a non-empty reason. `state` is
`in_force` | `shadow` | `skipped`. `evaluate` is **total**: it returns the worst in-force effect
plus `matched`, naming *every* rule that matched including shadowed and skipped ones with its
state — so a rule that deliberately reorders nothing is still observable.

| # | Rule | Basis | Effect | Settled by |
|---|---|---|---|---|
| R1 | `withheld-2160p` — a 2160p candidate when the ask is not 2160p | `product` (§7.3, decision 9) | **reject** (`withheld`) | n/a |
| R2 | `dts-family-at-2160p` — DTS / DTS-HD / TrueHD on a 2160p candidate | `lg-table` (§3.2 Ultra HD) | **reject** (`incapable`) | 24 |
| R3 | `dts-at-1080p` | `guess` | cost, **shadow** | **18** |
| R4 | `dtshd-truehd-at-1080p` | `guess` | cost, **shadow**, own weight | **19** |
| R5 | `dolby-vision` | `lg-doc` | cost, in force | **21** |
| R6 | `av1` | `inferred` | cost, in force | **20** |
| R7 | `container-proxy-xvid-divx` | `inferred` | cost, **strictly larger** than R3–R6 | **22** |
| R8 | `preferred-measured` — `h264` + any of `{ac3, eac3, aac}` | `measured` + `lg-table` | bonus, tier **A** | n/a |
| R9 | `documented-ok` — `hevc` 8/10-bit + `{ac3, eac3, aac}` | `lg-table`, decode unmeasured | bonus, tier **B**, strictly below A | **16, 17, 23** |
| R10 | `hevc-2160p-over-60mbps` | `no-input` | **NONE**, with a reason | **25** |

Each rule's reasoning, in the order a reader will ask:

**R1 is not an AV claim** — it is the opt-in, and it must be a reject for the arithmetic reason
above.

**R2 is the only AV reject, and the only rule with a published table row behind it.** It fires
only when 4K was opted into. It rejects on the **carrier**, not on the word "Atmos": Atmos rides
on E-AC3 (streaming, which §3.2 permits at 4K) or TrueHD (disc, which it forbids), so a literal
reading of §7.2 would reject a legal `DDP5.1.Atmos` 4K release. **Recorded as a deliberate
deviation from LG's own wording**, in the rule's `why` and in the §7.2 edit.

**R3 and R4 are separate rules, not one.** §7.2's 1080p cell says only "DTS" while §3.2 lumps
four codecs at 2160p, and nothing states which the 1080p rule covers. One merged rule silently
decides that question. §11.2 names no DTS-at-1080p test, so shadowing contradicts nothing.

**R5 drops the `in MKV` qualifier**, with a note: the container is unknowable at selection time,
so applying it unconditionally is strictly more conservative. It needs a `dynamic_range` field —
`_HDR` today matches bare `DV` but misses `DoVi`, `HLG` and dotted `Dolby.Vision`, so the input is
lossy rather than absent (see Corrections).

**R6 stays in force rather than shadowed** even though its own §7.2 parenthetical scopes itself to
"2022 LCDs", a class this QNED99 is not in — because §11.2, the one written definition of this
stage's selector test, requires the profile to "penalise AV1", and a non-reordering term would
contradict it. `av1` is already in `_CODEC`, so its input works today. The weakness is recorded in
the rule's comment, not in its effect.

**R7 is named a codec proxy, not a container rule**, because the real container is not knowable
here: the provider returns seven keys and no file list, a season pack's torrent name is a
directory name, and nothing in the image can probe a file before the decision. It fires only on a
positively identified `xvid|divx` token — **`container_guess is None` is always free.** This is
the minimal honest recovery of §7.2's "heavy penalty" magnitude, which a flat cost tier otherwise
flattens: it gets a strictly larger cost than the three within-bucket guesses, with a
strict-ordering test.

**R8 and R9 are split, with a strict-ordering test between their bonuses.** If H.264 and HEVC
share one "preferred" tier, the project's only *reading* scores identically to the combination
without one and becomes invisible in the ordering. R8's docstring carries the measured list
verbatim **with its caveats**: `.mkv`/Matroska, H.264, E-AC3 (DDP5.1), streamed off a ~26%-complete
torrent, scrubbed inside downloaded bytes — and that the resolution was **never transcribed**
(`videoWidth x videoHeight` was not copied, so even "1080p" is a release-name claim), the codec
and audio were read off the release *name*, and §11.5(d) asked for AC3 while the run delivered
E-AC3, so **plain AC3 is no more measured than HEVC**. R9 admits HEVC despite it being unmeasured,
deliberately: it is the only 4K video codec besides H.264 that §3.2's Ultra HD table allows, so
discouraging it would make the 4K opt-in return nothing.

### R10: present in code, inert, and provably plumbed

It ships as a real row with `effect=NONE`, `basis='no-input'`, and the reason
`"bytes ÷ runtime: no runtime reaches the selector; see row 25"`. A row, not a paragraph in the
spec, so a grep that hits it cannot be misread as an enforced ceiling.

Why there is no input, in both directions. `rank_candidates` receives `List[TorrentHit]`, which
carries `bytes` and no duration. `resolve_title_year`'s **cache-hit** branch reads
`CatalogItemCache`, which has no runtime column, so runtime is reachable only on the uncached
15-second TMDB branch. `catalog_items.detail_json` does hold `MovieDetail.runtime`, but
`set_detail` has one caller (`movies.py:96`) and is skipped when `with_qualities=False` — the mode
the TV's own detail load uses — and `services/tv.py` never calls it at all, so TV rows have no
`detail_json` ever and `episode_run_time` is never read anywhere in the repo. On top of that a
season pack's `bytes` cover N episodes while the only runtime available is one episode's;
`bytes == 0` is a real value the selector already distrusts; and minutes-read-as-seconds is a 60×
error in the *rejecting* direction. Five ways to be silently wrong.

**And the proof that it is a deferral rather than code nobody wrote:** a fixture injects a
non-`None` `facts.bitrate_mbps`, and the rule must **fire** and change the verdict. The predicate
and the plumbing are complete; only the input is absent.

The named follow-up, so the next reader does not re-derive it: `movies.detail` calls
`tmdb.movie_details` **unconditionally** at `:70`, before the `with_qualities` branch at `:79`,
and already upserts at `:86-94` via `upsert_list_item(**fields)`, which `setattr`s anything
passed. A nullable `runtime` Integer on `catalog_items` (auto-added by `sync_columns`) plus
`runtime=base.runtime` is a one-line, **zero-extra-HTTP** write on the exact call the TV already
makes. Movies only; TV needs its own cache write. **A dedicated column rather than a read of
`detail_json`, deliberately:** stage 4's parked finding 10 established that reading `detail_json`
is a trap, because `available_qualities` is derived from the **live** torrent search and serving the
blob from cache would silently stale the detail screen's quality list — which is very likely why
nobody ever read it. A nullable `runtime` Integer carries one scalar and inherits none of that.
Also recorded: `tmdb.movie_details` returns `None` without `TMDB_API_KEY`, that key is commented
out in this repo's `.env`, and compose passes that file — so even when implemented the rule cannot
fire on this box until the key is set.

**What the television loses in the meantime, stated:** no bitrate ceiling with 4K opted in. There
is partial cover and **it is an accident, not a design** — UHD remuxes are overwhelmingly DTS-HD
MA or TrueHD, so R2 rejects most of them for entirely the wrong reason, and a DD+ 4K remux at 80
Mbps passes every rule in the profile. No real container check at selection, and
`settings.video_extensions` admits sixteen containers, thirteen outside `.mkv/.mp4/.ts`, each
served with a real MIME type by `api/streaming.py:32-49`. No bit-depth gate, so a 12-bit HEVC is
treated as 10-bit. And the 4K opt-in rests entirely on an unmeasured HEVC decode.

### Integrity tests — the mechanism that makes a dishonest table red

1. Every rule's `basis` is in the closed set.
2. `settled_by` is required **iff** `basis ∈ {inferred, guess, no-input}`, and must name an id
   present in a frozen `READINGS_ROWS` tuple **in Python** — nothing parses markdown.
3. Both directions: every `READINGS_ROWS` entry is claimed by at least one rule, or flagged
   `standalone` (rows 22, 26).
4. Exactly **two** rules may REJECT, and their bases are `product` and `lg-table`.
5. R10's effect is NONE and its reason is non-empty.
6. Tier A's bonus is strictly greater than tier B's; R7's cost is strictly greater than R3–R6's.
7. `test_every_rule_is_observable`: for each rule, `evaluate` on its matching fixture must differ
   from `evaluate` on its non-matching fixture in `effect` **or** in `matched`. An unsatisfiable
   predicate, or a row whose effect is already fully implied by another row, fails here instead of
   sitting in the table forever looking enforced.

The three states also surface in **§7.2's own table** as a vocabulary — **IN FORCE / SHADOW / NOT
IMPLEMENTED** — because a six-month reader opens the spec, not `capability.py`.

---

## Task 1 — Baseline, the golden snapshot, both leaks characterised, one broken fixture repaired

**Files:** `backend/tests/test_selector_baseline.py`, `backend/tests/data/rank_snapshot.json`,
`backend/tests/test_rank_candidates.py`, `backend/tests/test_torrents_select.py`,
`backend/tests/conftest.py`

Capture and quote four counts in the commit. Record what `backend/tests/test_torrent.py` and
`test_torrent_alternate.py` do — both match pytest's default collection pattern and are
module-level libtorrent scripts (`lt.session()`, `session.listen_on`, `while True:`) with no
`__main__` guard, and there is no `[tool.pytest.ini_options]` in `backend/pyproject.toml`. One
recon measured 649 passing in 134s with a 10.9s collect, i.e. **no hang**; confirm or refute, and
if it hangs add a `collect_ignore` in `conftest.py`. **Attribute nothing to stage 8 either way.**

Then the **golden snapshot**, generated from unmodified code at the branch base and committed as
data. The fixture matrix is load-bearing: every ask in `{2160p, 1080p, 720p, 480p, ''}` crossed
with every bucket **including the unparsed `''` bucket** at seeds 0/2/30, plus at least one pair
that straddles the health-versus-maximum-bucket-distance boundary (a healthy `''`-bucket hit
against a low-health exact-bucket hit). Fixtures derive a **distinct magnet per
(title, seeds, bytes)**.

Then **characterise both leak mechanisms** as the before-picture, docstringed as such and naming
the task that inverts them:

- (a) health outranks bucket — a healthy 2160p is chosen for a 1080p ask when the only 1080p is
  low-health;
- (b) **the bucket term alone leaks, with no health mismatch** — among equally healthy hits with
  no exact 1080p, a 6-seed 2160p beats a 999-seed 720p, and for a 720p ask 2160p outranks 1080p.

No fixture in `test_rank_candidates.py` constructs a 2160p hit at all, and the tree's only
2160p-for-a-1080p-ask fixture goes through `select_best`, which pre-filters and therefore cannot
leak — **so the exact hole this stage exists to close is pinned in neither direction today.**

Then repair `test_torrents_select.py`'s `_hit`, which passes `magnet="magnet:x"` for every hit;
`_source_id` falls back to `sha1(magnet)` (`:21`), so `by_id` collapses to the last matching hit
and `by_id.get(top_id, matching[0])` hides it. **Both of its ordering tests pass on input order
alone.**

- [ ] **Step 1:** counts, the two script-shaped files, the snapshot, the two leaks, the fixture repair.

**Mutate.** Demonstrate the fixture defect *before* fixing it: reverse the input lists with the old
helper and watch both ordering tests redden with no production change; restore distinct magnets
and reverse again — green. Against production: swap `health_rank` and `_bucket_index` in the key →
snapshot reddens; negate `-seeds` → reddens; **flip the sign of the bytes term**
(`-_effective_bytes(...)` → `+`) → reddens — **not** `else -1` → `else 0`, which cannot redden
anything, because the sentinel is inert (Corrections finding A); delete `-seeds` → a **same-bucket**
seeds row reddens, **not** the cross-bucket 720p/2160p row, which `_bucket_index` decides before
`-seeds` is ever consulted (finding B); reorder `_ORDER` to put 2160p last → leak
(b) reddens **while (a) stays green**, separating the two mechanisms. Two meta-mutations:
regenerate the golden file from a deliberately mutated run and confirm the test then **passes**,
proving the file is read; restore with `cp` from a copy, never `git checkout --`, which cannot
restore an untracked file and destroys a tracked one you are editing.

**Does not:** change any production file; fix the two script-shaped test files beyond an exclusion
if they hang.

**Depends on:** nothing.

---

## Task 2 — `parse_release_facts`: audio, dynamic range, bit depth, codec family, a container proxy, its own resolution

**Files:** `backend/app/providers/quality.py`, `backend/tests/test_release_facts.py`,
`backend/tests/test_quality.py`

A new frozen dataclass beside the existing functions: `audio: frozenset[str]`,
`video_family: 'h264'|'hevc'|'av1'|'xvid'|None`, `bit_depth: 8|10|12|None`,
`dynamic_range: 'dv'|'hdr10'|'hlg'|None`, `container_guess: str|None`, `remux: bool`,
`resolution: int|None`, `bitrate_mbps: float|None` (always `None` in stage 8).
`parse_release_info` keeps its four keys and its assertions untouched — it has **zero production
callers**, so widening is free but renaming costs edits for nothing.

Each addition is shaped by a measured defect rather than by copying the house style:

- **Audio is a set**, because a title names tracks and often two
  (`REMUX.HEVC.DTS-HD.MA.TrueHD.7.1.Atmos`). Every pattern needs `[-. _]?` separators and
  digit-tolerant boundaries: `\bdd\b` misses `DD5.1` but **matches** `DD+5.1`; `\bddp\b` misses
  `DDP5.1` (the AMZN/NTb standard); `\baac\b` misses `AAC2.0`; `\bdts\b` misses `DTSHD.MA`.
  Order is load-bearing in **two different ways**, and a single alternation only enforces one of
  them (see Corrections, finding 1): two tokens starting at the *same* character (`DD+`/`DDP`
  before `DD`, `DTS-HD` before `DTS`) are ordered exactly as `web-?dl|webrip|web` already is at
  `:14` — but `ac3` matches *inside* `E-AC3`, because the hyphen supplies its left boundary, and
  **no alternation order can fix that**. The shipped answer is a list of per-token patterns scanned
  most-specific-first that refuses to re-read characters an earlier pattern claimed. `atmos` is
  recorded as a flag beside its carrier, never as a codec.
- **`dynamic_range` is written from scratch**, not split off `hdr`. `_HDR` matches a bare `DV` but
  misses `DoVi`, `HLG` and dotted `Dolby.Vision` (`\s*` does not match `.`). Needs `dovi`,
  `dolby[-. ]?vision`, `dv[-. ]?p?8`, `profile[-. ]?8`, `hlg`.
- **Bit depth** constrained to 8/10/12 **and** co-required with a video codec token, plus
  `Hi10P`. A naive `(\d+)\s*bit` matches `24bit` in `Concert.2020.FLAC.24bit.48kHz` — a string
  already at `test_quality.py:22`, under a comment defending `parse_quality` against exactly this
  family.
- **Codec family** absorbs `AVC` and `Hi10P`, which both parse as `None` today — and AVC remuxes
  are §7.2's most *preferable* class.
- **`container_guess` is a declared proxy**: `xvid|divx` only, `None` otherwise. **`\bts\b` is not
  a container token** — `Movie.2020.TS.XviD-GRP` is a telesync.
- **`remux` is its own `search`**, never a read of `source`:
  `Movie.2016.2160p.UHD.BluRay.REMUX.HEVC…` parses `source='BluRay'` because `re.search` is
  leftmost-match.
- **`resolution` is owned here**, with explicit-`NNNNp`-token precedence.

**`parse_quality` is deliberately NOT changed.** `_QUALITY_PATTERNS` tries `\b(2160p|4k|uhd)\b`
first, so `Movie.2020.1080p.UHD.BluRay.DD5.1.x265-GRP` buckets as `2160p`. Reordering it would
move releases between buckets for **every desktop user** — regrouping the `SourcePicker` pill,
changing the downgrade-walk position, and changing which bucket a 2160p cron schedule's
exact-bucket filter matches. Instead the defect is **contained**: every profile rule keys on
`facts.resolution`, so the misfire is gone (a `1080p.UHD` encode is no longer withheld as
un-opted-in 4K, nor hit by R2) while the pre-existing misplacement in the selector's bucket
remains, pinned as a characterisation test with a named follow-up. The existing
`test_parse_quality_4k_and_uhd_map_to_2160p` stays green, unedited.

- [ ] **Step 1:** the dataclass and the parser, one defect at a time.

**Mutate**, one per measured defect: restore `\b` on the DD pattern → the `DD5.1` row reddens while
`DD+5.1` stays green (the measurement that the house style is wrong in the direction that
matters); move `ac3` before `eac3` in the scan order → every `E-AC3` row reports `ac3` and reddens (this
one is only falsifiable because of the scan mechanism, **not** because of alternation order —
finding 1); widen the bit-depth domain from `(8|10|12)` to `(\d+)` → the `24bit` row reddens
(**not** "drop the codec co-requirement", which that fixture cannot see — finding 2); drop the
codec co-requirement → a `10Bit`-with-no-codec row reddens, which is a *second* fixture for a
*second* guard; remove `avc` → the AVC remux row reddens;
remove `dovi` → the DoVi row reddens **while `hdr` stays green**; delete the standalone remux
`search` → the leftmost-BluRay row reddens; add `ts` as a container token → a telesync row **whose codec is not XviD** reddens
(`Movie.2020.TS.x264-GRP`; the plan's original `Movie.2020.TS.XviD-GRP` reads `avi` either way and
cannot discriminate — finding 3); drop explicit-token precedence in `resolution` → `1080p.UHD` reports 2160 and reddens
**while the `parse_quality` characterisation row stays green**, proving the two are independent.

Plus two anti-vacuity guards. A **meta-test** asserting every member of the audio and container
enums appears in at least one positive *and* one negative fixture row — a pattern with no fixture
is a pattern nobody tested, and a member added later with no row fails here rather than silently
never matching. And every existing selector fixture title (`M.2020.1080p.A` and friends, which
name no container, codec or audio) must parse to an **empty** audio set, `container_guess is None`
and `video_family is None` — the shape that makes "unknown is free" testable.

**Does not:** touch `parse_quality`; reuse `hdr` for DV; rename any existing key; parse a real
container; compute a bitrate.

**Depends on:** nothing (runs in parallel with task 1).

---

## Task 3 — The frozen corpus and per-rule confusion counts

**Files:** `backend/tests/data/releases.tsv`, `backend/tests/test_release_corpus.py`,
`backend/scripts/harvest_release_titles.py`

**Why it is not optional.** Every §7.2 rule bottoms out in a regex over a scene name, because
`normalize_hit` (`providers/catalog.py:59-70`) keeps seven upstream keys — title, seeds, peers,
bytes, magnetUrl, hash, source — and the upstream `api=torrents` response carries no file list,
while libtorrent's file list only exists *after* the torrent has been added, i.e. after the
decision. **At selection time the title is all there is.** So parser precision *is* the profile's
accuracy, and §11.2's "a table test over synthetic candidates" measures the engine, not the parser.

**Shape.** A committed TSV: one row per title, one column per label the parser emits —
`resolution`, `audio` (a sorted, pipe-joined set), `video_family`, `bit_depth`, `dynamic_range`,
`container_guess`, `remux`. **300–800 de-duplicated titles**, with a floor of **40 rows each** for
the three naming shapes (movie, `SxxExx`, season pack).

**Where the titles come from.** Two honest sources, neither hand-written.

1. **`catalog_item_cache.torrents_json`**, free via `make db`. Written for every movie detail page
   ever opened with qualities. **Movies only** — `set_torrents` has exactly one caller
   (`services/movies.py:97`) and `services/tv.py` never calls it, so the two shapes that matter
   most for the television are structurally absent from the cache. Note that both `torrents_json`
   and `detail_json` are **write-only caches: nothing in the backend reads either** (stage 4's
   parked finding 10, verified by grep). So harvesting from them is a `psql` read for corpus
   material and **does not** oblige this task to write a reader — do not add one.
2. **A live harvest**, `backend/scripts/harvest_release_titles.py`, calling
   `catalog.torrents(f"{show} S01E01")` and `f"{show} S01"` across 60–100 titles chosen for shape
   coverage: 4K-era blockbusters, catalogue films, single episodes, season packs.
   **Unconditionally required** for the TV half.

**Labels are written by hand, once, and never regenerated with the parser under test.** A corpus
produced by the parser proves only that the parser is deterministic.

**How precision and recall are pinned: exact confusion counts, per field and per direction**,
asserted as integers with the offending titles in the assertion message —
`audio contains dtshd: tp=41 fp=0 fn=2`, naming both false negatives. **Import the token spellings
from `quality.py` (`AUDIO_TOKENS`, `CONTAINER_TOKENS`, `VIDEO_FAMILIES`, `DYNAMIC_RANGES`,
`BIT_DEPTHS`) rather than re-spelling them here** — they are hyphen-free (`dtshd`, `truehd`,
`eac3`) and `container_guess` emits `'avi'`, not `'xvid'`. **Never an aggregate
ratio.** The two error directions have opposite costs: a missed 2160p-DTS reject is a black screen
on the television; an over-eager one silently discards a playable release. A percentage can absorb
a regression in either, and a future parser change then produces a judgement call instead of a
diff.

- [ ] **Step 1:** harvest, hand-label, then the counts.

**Mutate — four guards, each with its own.** (1) **A minimum-row-count test, and it is the first
mutation target:** `git mv` the TSV aside and `test_corpus_min_rows` must **FAIL**, while every
parametrised row merely reports as *skipped* — `empty_parameter_set_mark` is the default `skip`,
so an absent or unmounted corpus otherwise makes the whole suite a **green no-op**. Run it both
ways (with the `-v` tests mount, and after `make build`) and record which. (2) A label-coverage
assertion: at least N rows for every value each label column can take — without it, "0 false
negatives on DTS" can be reported from a corpus containing no DTS rows. (3) **Flip one hand label
in the TSV** → the matching count assertion reddens, proving the numbers are compared against the
*file* and not recomputed from the parser. (4) **Loosen one audio pattern by one character** → a
specific `fp` count rises and that exact-count assertion reddens.

**What it deliberately does not prove, written in the test file:** the labels are labels about
*titles*, not about files. A title names tracks — often several — and the MKV it describes may
carry a compatibility AC3 track the set plays happily, so rejecting on the presence of DTS
discards playable files while accepting on the presence of DD accepts files whose default track is
DTS. The title cannot settle it and nothing in the image can probe the file. **That is also
exactly the confidence the selector will ever have**, which is why it is the right thing to
measure — but it must be labelled.

**Does not:** regenerate labels from the parser; report a ratio; claim anything about files.

**Depends on:** task 2 for the parser; land it after task 4 if the counts are grouped by rule id.

---

## Task 4 — `capability.py`: the table, `evaluate`, and the integrity tests

**Files:** `backend/app/services/capability.py`, `backend/tests/test_capability_table.py`,
`backend/tests/test_capability_evaluate.py`, plus the seven-occurrence rename across
`docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` and
`docs/superpowers/plans/2026-09-22-webos-tv-stage3-results.md`

The rule table and `evaluate(facts, *, allow_2160p) -> Verdict(rejected, reason, cost, matched)`
exactly as the rules table above specifies. No sort, no I/O, no selector import, no title parsing.
The module docstring carries the silicon argument for the `-floor` name.

- [ ] **Step 1:** the table, `evaluate`, the seven integrity tests, the rename.

**Proved by** the seven integrity tests, plus a table test per rule using a **pair of fact-dicts
differing in exactly one token**, so no verdict can be produced by another rule.

**Mutate, per rule rather than per module:** flip R2 from reject to cost → its verdict row reddens
*and* the exactly-two-rejects test reddens; flip R3's `state` from `shadow` to `in_force` → the
"a shadow rule never changes `effect`" row reddens for that rule *and* task 5's ordering test
reddens (**this is the exact one-cell promotion reading 18 will perform** — do it once, confirm
what goes red, revert); delete any rule → its verdict row and `test_every_rule_is_observable` both
redden; give R10 a cost → the `no-input` test reddens; **inject a non-`None` `bitrate_mbps`** →
R10 fires and the verdict changes, proving the plumbing is complete and only the input is absent;
drop `settled_by` from a `guess` rule → the provenance test reddens; point `settled_by` at an id
absent from `READINGS_ROWS` → the cross-reference reddens; set tier A's bonus equal to tier B's →
the strict-ordering test reddens; veto on the bare word `atmos` instead of the carrier → the legal
`DDP5.1.Atmos` 4K row reddens; make R7 fire on `container_guess is None` → every "unknown is free"
row reddens.

**Does not:** import the selector, `settings` or any provider; decide where the verdict sits in
the ordering; implement a bitrate estimate or a real container check.

**Depends on:** task 2 (the facts shape).

---

## Task 5 — `apply_profile`: the stable second sort, and the absent-profile guarantee

**Files:** `backend/app/services/capability.py`, `backend/app/models.py`,
`frontend/src/types/index.ts`, `backend/tests/test_apply_profile.py`

`apply_profile(candidates, profile, *, allow_2160p)`. `profile is None` → `return candidates`, the
same object, unannotated. Otherwise annotate and stable-sort on
`(rejected, health_rank, capability_cost)`; rejects partitioned last and marked;
`len(out) == len(candidates)` always. `_HEALTH_ORDER` is defined here (the real map is a local
inside `rank_candidates`) and carries a drift pin parametrised over seeds 0/1/4/5/100 against
`classify_health`. `TorrentCandidate` gains two **defaulted** fields —
`device_verdict: Optional[str] = None`, `device_reasons: List[str] = []` — so
`test_sources_endpoint.py:13-17`'s nine-field construction still constructs; mirror them by hand
at `frontend/src/types/index.ts:139-149`.

- [ ] **Step 1:** the sort and the `None` guarantee.
- [ ] **Step 2:** the feature rows — and note **today's red test is the opt-OUT**.

**Proved by** fixtures that can discriminate. Every cost fixture holds health, bucket, seeds **and**
bytes equal, differing only in the penalised token — `-seeds` is a near-unique integer, so a term
placed after it is never reached and a weight mutation cannot discriminate at all. Every
reordering test asserts the **pre-profile order explicitly in the same function**, so the reversal
is visible to the reader; a fixture where health or seeds already agree with the capability order
proves nothing and is rejected in review. The discriminating pair: a healthy 2160p HEVC+DTS-HD at
900 seeds against a healthy 2160p HEVC+E-AC3 at 10 seeds.

"With 4K on, a 2160p can win" passes with **zero code written** — it is not evidence. The honest
assertions, all red today: with the profile and an asked 1080p, a healthy 999-seed 2160p ranks
**below** a low-health 1080p *and* below a healthy 720p, carrying `device_verdict='withheld'`;
among equally-healthy hits with no exact 1080p it also ranks below the 720p (leak (b)); with an
asked 2160p it ranks first; with an asked 2160p and a DTS-HD track it is last with
`device_verdict='incapable'` while a 1080p H.264+E-AC3 release wins.

**Mutate:** drop the capability element and rely on stability alone → the reordering test reddens
(**the mutation the stage lives or dies on**); move capability *before* `health_rank` → "a
penalised healthy release still outranks an unpenalised dead one" reddens; fold the cost into
`health` → "capability never changes health" reddens (a penalised healthy candidate must still
report `health == 'healthy'`); drop `rejected` from the key → the R1/R2 rows redden; change the
`None` path to `sorted(candidates, key=...)` → the **identity** test reddens even though the
output is equal; replace the early return with `[c for c in candidates if True]` → **still**
reddens; annotate on the `None` path → "every candidate has `device_verdict is None`" reddens;
drop a reject instead of partitioning → length preservation reddens; add a fourth value to
`_HEALTH_ORDER` → the drift pin reddens; mutate R1 from reject to cost → the opt-out rows redden,
which is the arithmetic demonstration that the gate cannot be a weight.

**And the hostile-table identity test**: a registry monkeypatched to reject everything at maximum
penalty, called with `client=None` and with the argument omitted, byte-identical to task 1's
golden snapshot.

**Does not:** filter; touch `health`, `select_best`, `classify_health` or `available_qualities`;
rename `_source_id` or `_is_season_pack`; change the no-profile ordering by one element. **Re-check
the zero-diff gate on `torrents_select.py` here.**

**Depends on:** tasks 1 and 4.

---

## Task 6 — `client=<profile>` on the wire, and the refusal the television can read

**Files:** `backend/app/api/torrents.py`, `backend/app/models.py`,
`backend/tests/test_client_profile_endpoints.py`, `backend/tests/test_sources_endpoint.py`

`TorrentRequest` gains `client: Optional[Literal['lg-webos22-floor']] = None` **and
`model_config = ConfigDict(extra='forbid')`**. Both halves are load-bearing and catch different
failures: the Literal catches a bad *value*; the forbid catches a bad *key*, because the model
declares no config today (`models.py:373`) and pydantic v2's default `extra='ignore'` **silently
drops** an undeclared `client` — so a TV build shipped ahead of the backend would get unprofiled
ranking with a 200 and no signal, **the quietest possible way for the whole profile to be absent
while looking present**. Every shipped caller passes a typed `CatalogTorrentRequest` whose fields
are all declared, so forbidding extras is safe; a hand-rolled client would break, which is the
point. `/sources` gains the same Literal as `Query(None)` — `quality` there is a bare `str`, so an
unvalidated `client` would accept any name.

`/download`'s auto-pick skips rejected rows:
`chosen = next((c for c in candidates if not c.device_verdict), None)`. On `None`, 404 with two
distinct details, both of which **must contain "no torrents"** so they degrade safely through
`title.ts:382-385`:

- every candidate `withheld`-only → `"Only 4K sources exist for this title — no torrents this
  television can play in HD"` (it names an action the viewer can take, so it wins a mixed case);
- any candidate `incapable` → `"No torrents this television can play"`.

Genuinely empty hits keep the **unchanged** `"No torrents found"`.

**Two bypasses stay live, in a code comment with the reason.** `if request.magnet:`
(`api/torrents.py:81-84`) never calls `rank_candidates` at all and is pinned as intended by
`test_download_explicit_magnet_used_verbatim` (`tests/test_download_select.py:63`); and an unmatched `source_id` falls through to
`candidates[0]` with a 200 — unreachable from any current client, because both web pickers send
`magnet` **and** `source_id` together and the TV sends neither. Drop the two unused imports
(`select_best`, `available_qualities`) while in the file.

- [ ] **Step 1:** the wire, the skip, the two details.

**Proved by** response-level assertions, not mocks: with `client` set on `/sources`, every
candidate carries a non-null `device_verdict`; without it, every one is null. On `/download` with
a 2160p-DTS-only hit set plus `client` and `quality='2160p'`, the 404 detail is the `incapable`
string; with `client=None` the same hit set 200s and `client.state.added[-1].magnet` is the 2160p
one — **what is proved is which multi-gigabyte file was actually started.** The season-pack
`/sources` path gets its **first** endpoint test.

**Mutate:** misspell the field name in `TorrentRequest` → the forbid test reddens (without it, the
profile-actually-ran assertion would silently pass unprofiled); replace either Literal with `str`
and send a garbage name → the 422 rows redden on both endpoints; delete the reject skip → "a
rejected top candidate is not the one downloaded" reddens; change a 404 detail to anything without
"no torrents" → task 9's copy test reddens; swap the mixed-case precedence → the mixed row reports
the wrong detail.

**No existing backend test file is edited by this task**, including `test_sources_endpoint.py`,
which needs no edit because no service signature changes — re-run it to confirm.
`test_cron_select_parity.py` stays green untouched.

**Depends on:** task 5.

---

## Task 7 — The television's ask: a second value out of `title.ts`, and a dedupe key that carries it

**Files:** `frontend/src/app/(bigscreen)/_data/title.ts`, `frontend/src/types/index.ts`,
`frontend/src/services/torrents.ts`,
`frontend/src/app/(bigscreen)/_data/title.test.ts`

`requestTitle` / `startDownload` take `fourK?: boolean`; the body sends
`quality: fourK ? '2160p' : '1080p'` and **`client: TV_PROFILE` on every TV request**, not only
the 4K one — the profile is what makes the 1080p ask honest too. `TorrentRequest.quality` is
already `Literal['720p','1080p','2160p']` (`models.py:375`), so the 4K value needs no model change.

The in-flight dedupe key at `:434` **gains the flag**. It is
`${mediaType}:${tmdbId}:${season}:${episode}` and the window is a full provider search wide, so a
1080p press followed by a 4K press returns the first press's promise and the 4K ask is silently
dropped — **the control would lie by returning someone else's result.**

`client` is **optional** on `CatalogTorrentRequest` and `SourcesParams`: those types have at least
ten non-TV call sites, eight of them web POSTs to `/download`, five funnelling through
`utils/streaming.ts:46`. Rewrite the two doc comments that assert the 1080p-everywhere property as
design fact (`title.ts:57`, `movie/[id]/page.tsx:26`) in the same change that makes them false.

- [ ] **Step 1:** the argument, the body, the dedupe key, the two comments.

**Proved by** the two exact-equality `toHaveBeenCalledWith` payload assertions in `title.test.ts`
(`:469-475` tv, `:492` movie), which are both the intended edit **and** the tripwire: **if they
pass unchanged, the TV is not sending the profile.** New row: press 1080p, then 4K before the
first resolves → **two** distinct POSTs with distinct qualities.

**The eleven web payload assertions must stay unedited** — five on the download path
(`MovieDetailView.test.tsx:329`, `EpisodeList.test.tsx:364`/`389`,
`ShowDetailView.test.tsx:392`/`425`) and six on the Play path through
`handleCatalogStreamingStart` (`MovieDetailView.test.tsx:276`/`309`,
`EpisodeList.test.tsx:253`/`296`/`319`, `ShowDetailView.test.tsx:347`). **If any one needs
editing, `client` has leaked into a shared path and the implementation is wrong, not the test.**
Note `EpisodeList.test.tsx:389` already asserts `quality: '2160p'`, so the web exercises a 4K
request end to end today.

**Mutate:** revert the dedupe key → the two-presses row reddens; drop `client` from the body →
both payload rows redden; default `client` in `torrentsService` or an axios interceptor → **the
eleven web assertions redden, which is exactly what they are for.** `npm run test:tv` would **not**
catch that: `legacy-target.test.ts:467` explicitly pins `@/services/*` as allowed. Make `client`
required on `CatalogTorrentRequest` → `npx tsc --noEmit` fails at eight web call sites, the type
system itself proving the field must stay optional.

**Does not:** persist the choice; call `/sources`; touch the show screen.

**Depends on:** task 6 (the wire contract).

---

## Task 8 — The 4K cell: a derived row 0, appended last, and the rescue that screen never had

**Files:** `frontend/src/app/(bigscreen)/bigscreen/movie/[id]/page.tsx`,
`frontend/public/bigscreen.css`,
`frontend/src/app/(bigscreen)/bigscreen/movie/[id]/page.test.tsx`

**Movie screen only.** `rowCounts: [profile ? 2 : 1]` (`page.tsx:137`) becomes a **derived cell-id
array** on the house pattern (`actionCellsFor`, `list/page.tsx:129-141`), rendered by mapping that
array so the declared count cannot drift from what it renders:

```ts
type ActionCell = 'primary' | 'list' | 'fourk';
const cells: ActionCell[] = ['primary',
  ...(profile ? (['list'] as const) : []),
  ...(state.action.kind === 'play' ? (['fourk'] as const) : [])];
const grid = useFocusGrid({ rowCounts: [cells.length] });
```

**Appended last** — col 2 with a profile, col 1 without. The grid calls `go` only when the clamped
target changes, so growth at the end never refocuses; a cell inserted at or before the focused
column leaves DOM focus on the element that just became col+1 while the model still points at the
old column, and the next press appears to do nothing. The rule is written down twice in this
codebase (`TransportBar.tsx:30-33`, remedy at `LoadStatus.tsx:26-27`) and pinned by
`TransportBar.test.tsx:165-182`.

**Rendered only when `action.kind === 'play'`.** A control that cannot act is a focus stop whose
press does nothing, which this surface's rules forbid (`list/page.tsx:132-135`), and `play` is the
only kind that may start a download (`PrimaryAction.tsx:17`).

**And it gets the focus rescue the movie screen has never had.** `TitleScreen.tsx:9-12` states that
anything passed as `actions` must never unmount while it holds focus, because an unmounted focused
control drops DOM focus to `<body>` with nothing on a remote to bring it back — and a press that
turns `play` into `preparing` unmounts this cell. The rescue **clamps to the last existing cell**,
not to `{row:0,col:0}`; hard-coding col 0 would park the ring on Play even though the viewer was
at the right-hand end.

**Dress:** an `aria-pressed` toggle reusing `.bs-list__toggle[aria-pressed="true"]`
(`bigscreen.css:820-821`). **No new `.bs-btn` modifier** — that stylesheet forbids one in three
blocks. Keep it **narrow, deliberately**: `.bs-title__actions` is `flex-wrap: wrap` with
`.bs-title__action` at `max-width: 640px` (`:672-673`), so a third cell can wrap to a second visual
line while the focus model still calls it row 0 and Right appears to move the ring *downward*.
`npm run test:tv` cannot see this.

What it says, in every state:

| State | What the viewer sees |
|---|---|
| `play`, not pressed | **"Ask for 4K"** — a request, never a result. The screen fetches `getDetail(id, { withQualities: false })`, so `available_qualities` is `[]` here and it **cannot know whether a 2160p release exists**; answering that would cost the cold provider search this screen exists to avoid, and would be health-blind anyway. |
| `play`, pressed | `aria-pressed="true"`, plus a note on the cell: **"Not tested on this television. 4K may not play."** `.bs-title__note` inside the flex-column `.bs-title__action` already exists to hold it. This is the only pre-press truth available, and it is about decode risk, not availability. |
| anything but `play` | **Absent.** Not disabled. |
| 4K asked, HD arrived | The watch route says so once on arrival (task 9). Because health outranks the bucket, this is the **common** path, not the edge case. |
| the panel refuses it | The player's `decode` verdict (`_player/classify.ts:27-30`), now naming the bucket: "this 4K file". |
| device-rejected, nothing playable | 404 with task 6's `incapable` detail → "No sources found for this title yet." via `reasonFor`'s existing branch, which the detail is worded to keep matching. |

**The choice does not persist.** It is the current press, held as component state, and nothing is
stored. `covers()` compares **identity fields only** (`title.ts:133-140`), so for a movie any
covering row makes `play` unreachable — the cell is correctly absent on the second visit, and a
remembered "4K: on" would sit beside a control that cannot honour it. Making `covers()`
quality-aware would mint a second multi-gigabyte download per press on a box capped at two.
**`users.default_quality` is explicitly not reused**: the column exists (`users.py:85`), both
Pydantic shapes carry it (`models.py:525`/`:546`), it is served (`api/auth.py:183`,
`api/users.py:83`/`:102`) and editable on the web settings screen — and **no download path honours
it**, so wiring it would retroactively change behaviour for anyone who set 2160p months ago. §7.3
says per title.

- [ ] **Step 1:** the derived cells, the rescue, the dress, the copy.

**Proved by** per-**transition** focus tests, because `journeys.test.tsx:907-921` checks
one-ring-per-screen only in each screen's *initial* state, so a mid-life count drift ships green:
profile present/absent; `play → preparing` after a press **with the ring on the 4K cell**,
asserting exactly one rendered cell holds the ring and `document.activeElement` is not `<body>`;
`blocked → play` after a recheck. Extend the existing Right/Left table (`page.test.tsx:332-344`)
and the one-cell no-profile case (`:464-473`).

**Mutate:** declare the cell in `rowCounts` while rendering it conditionally → the one-ring row
reddens at the `preparing` transition (a count one too high parks the ring on a cell no element
claims, which looks identical to nothing being focused); insert at col 1 instead of appending →
the "DOM focus stayed put" row reddens; delete the rescue → the unmount-while-focused row reddens;
hard-code the rescue to col 0 → the "ring lands on the last cell, not Play" row reddens; render
for every kind → the forbidden-no-op row reddens; **have the toggle flip local state without
reaching `requestTitle`'s argument → the "press the toggle, then Play, sends `quality: '2160p'`"
row reddens, with `aria-pressed` the only other thing that changed** — the mutation that proves
the cell is wired rather than decorative.

**The show screen is deliberately not done**, with both reasons recorded as a follow-up: an
episode request is often satisfied by a **season pack**, so a per-episode 4K flag asks for a 2160p
*season* — tens of gigabytes on a Pi capped at two concurrent downloads — and a pack already on
disk makes the flag inert for every other episode of that season. Plus `show/[id]/page.tsx` has
**two** hard-coded `setFocus({row:0,col:0})` calls (`:302-305`, `:332`), the second after every
non-navigating episode press. §7.3 says "per title" and does not say what a title is for a series.

**Depends on:** task 7.

---

## Task 9 — Say what actually arrived

**Files:** `frontend/src/app/(bigscreen)/_data/title.ts`,
`frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx`, and the two test files

Two things. The `reasonFor` 404 branch for task 6's details, **placed and tested before** the
`/no torrents/i` branch (so the ordering is deliberate) while the details also still *match* that
regex (so losing the branch degrades to "No sources found for this title yet." rather than to the
outright lie "The box doesn't recognise this title.") — belt and braces, because each alone is a
single point of failure.

And disclosure on the watch route, which needs no new fetch: the whole row already reaches the
player as `status={arrival.status}` at `:505` and is read field-wise by the message builder at
`:955`/`:971`. Two strings: the `decode` verdict names the bucket ("this 4K file…"), and a 4K press
that produced a non-2160p row says so once on arrival. Use **`status.quality`**, which
`to_status()` carries on every poll — **not** `chosen_quality`, which is set only on the download
response (`api/torrents.py:124`) and is null on every poll, as `title.ts:296` already records.

- [ ] **Step 1:** the 404 branch, then the two arrival strings.

**Proved by** a `reasonFor` table with one row per 404 detail **including both existing ones**, and
two watch-route rows.

**Mutate:** read `chosen_quality` instead → the disclosure is empty on every poll and both rows
redden (**the mutation that matters, because `chosen_quality` is the field whose name says what you
want and whose value is always null**); drop the bucket from the decode string → the verdict row
reddens; hard-code the disclosure line → the non-vacuity row reddens, i.e. **a 1080p press landing
1080p must say nothing**; move the new 404 branch after `/no torrents/i` → it reddens iff the
detail contains those words, recorded in the test file so the ordering reads as deliberate; change
a backend detail string → the frontend row reddens, the contract asserted on both sides of the wire.

**Does not** claim success beside the control: `run` navigates on a successful press
(`PrimaryAction.tsx:144`) and stays busy through it, and `describeAction` is a pure two-arg
exhaustive switch whose table is pinned, so a pre-press *result* claim would need a third
parameter. Does not add a column, a `RequestResult` field, a picker, or a client-side filename
regex.

**Depends on:** tasks 6 and 8.

---

## Task 10 — The codec instrument, the readings sheet, and three spec edits

**Files:** `frontend/src/app/(bigscreen)/bigscreen/diag/page.tsx` + its test,
`frontend/public/samples/` (gitignored),
`docs/superpowers/plans/2026-10-11-tv-stage8-device-readings.md`, the stage-7 sheet, the spec

**The instrument.** There is no codec probe anywhere: `canPlayType`/`isTypeSupported` appear
nowhere under `(bigscreen)`, the probe list is CSS/JS features plus `MediaSource present` and two
mediaSession rows, and the diag player can only play a torrent (`:314`). **Four clips** in
`frontend/public/samples/`, served by Next.js static at `http://<host>:3001/samples/…` with no
torrent, no backend, no auth gate and no ARM download cap — one variable each:

1. 1080p HEVC Main 8-bit + AC3
2. 1080p HEVC Main10 + AC3
3. 1080p H.264 + DTS 5.1
4. **1080p H.264 + E-AC3 as the control**, reproducing the one measured combination, so a red row
   there means the instrument is wrong rather than the panel.

Each row prints `MediaError.code`, `videoWidth x videoHeight`, `duration` and `readyState`
**verbatim**, plus an **operator-typed yes/no for "did sound come out of the television"** — a DTS
track the set cannot decode is *silent* and raises no error, so a code-only readout would log a
pass on a silent film. The readout persists to `sessionStorage` on the house `bs-diag:` prefix,
every access in try/catch. Clips are gitignored; binaries do not belong in this repo, and **the
sheet carries the exact ffmpeg command line per clip** so producing them is one paste.
`canPlayType` may be added as **one clearly-labelled advisory row** and may gate nothing — §7.2 is
right that TV implementations under-report.

**On producing the clips, and what is recalled rather than verified.** The command lines go in the
sheet, and each one is **labelled with whether it was run or only written down** — none can be run
from here, so all four ship as written-down. Three encoder facts to check with `ffmpeg -encoders`
before trusting them (recalled, not measured): ffmpeg's DTS encoder is `dca`, is marked
experimental and so needs `-strict -2`, and produces **DTS core only** — which is exactly what
reading 18 wants, and is also why reading 19 (DTS-HD MA / TrueHD) is listed as needing a real file
rather than a clip. E-AC3 is `eac3` and AC3 is `ac3`. HEVC Main10 needs both
`-pix_fmt yuv420p10le` and an explicit `profile=main10`, because the pixel format alone does not
set the profile tag a decoder reads. If any of those turns out wrong, **fix the sheet and say so in
the row** — a command line that was never run and is also wrong is worse than one labelled as
untried.

- [ ] **Step 1:** the instrument.
- [ ] **Step 2:** the sheet, pre-filled "not taken".
- [ ] **Step 3:** the three spec edits and the rename check.

**Proved by** instrument tests: a missing clip renders an explicit **"file not present"** state
rather than a silent nothing (**the distinction is the whole value, because a 404 and an
unsupported codec both end with no picture — and with decision 3 above, "not present" is the state
this box will actually be in**); an `error` event surfaces its raw numeric code; the operator's
audio answer is part of the persisted record; the readout survives a remount; the
`@allow-legacy-probes` opt-out set stays pinned by equality.

**Mutate:** render an empty `<video>` on 404 → the not-present row reddens; swallow the error → the
code row reddens; drop the persistence → the survive-a-remount row reddens (**the mutation that
pins the actual lesson: stage 3 ran the key log on this television and wrote none of it down**);
remove the `@allow-legacy-probes` marker → three `legacy-target.test.ts` assertions redden.

**The sheet gets no test, deliberately**: its failure mode is a visible blank, and a test asserting
that a markdown table is filled in is a test about markdown. The integrity check lives in
`READINGS_ROWS` and task 4's cross-reference, both directions.

**Three spec edits.** §7.2's table rewritten to **IN FORCE / SHADOW / NOT IMPLEMENTED** with the
Atmos-carrier deviation stated, R10 marked NOT IMPLEMENTED with its reason and row 25, and the
"over-conservative because webOS 25 is newer" rationale **replaced** by the silicon argument.
§11.2's "prefers 1080p H.264+**AC3**" fixture becomes **E-AC3** (or AC3 *and* E-AC3), since
§11.5(d) asked for AC3 while the run delivered DDP5.1 — plain AC3 is no more measured than HEVC;
"penalises AV1" survives untouched, which is why R6 is in force. And the last of the seven rename
occurrences (spec `:556`, this paragraph itself), after which the merge gate in "The name" section
above — `grep -rn webos22 backend/app frontend/src | grep -v lg-webos22-floor` empty, and every
surviving bare `webos22` in `docs/` being explicit history — is checked once by eye.

**Does not:** take any reading, fill any cell, or claim the stage works.

**Depends on:** task 4 (the rule ids the rows reference). Independent of tasks 5–9 and can run
alongside them.

---

**Dependency order:** 1 ∥ 2 → 4 → 5 → 6 → 7 → 8 → 9, with 3 after 4 (its counts group by rule id)
and 10 alongside anything from 4 onward.

## On the television

Stage 8's rows are numbered **16 onward** so the numbering is globally continuous and unique — but
they live in a **new sheet**, `2026-10-11-tv-stage8-device-readings.md`, cross-linked both ways.
Not appended into the stage-7 file: that sheet's verdict is a *stage-7* verdict gated on its rows
1–3 and is still NOT REACHED, and mixing stage-8 rows in would let one verdict answer for two
stages and an untaken stage-7 gate be masked by a taken stage-8 reading.

Four reading rules inherited verbatim: a verbatim string or the words "not taken"; **a blank is a
failure, not a pass**; transcribe the raw string, never "ok", "works" or "as expected";
measurement versus assumption called out per row.

| # | Reading | Gating | Instrument | Promotes / demotes |
|---|---|---|---|---|
| **16** | HEVC Main 8-bit at 1080p direct-plays | **YES** | diag clip 1 | Confirms **R9**. Failure **inverts** it: HEVC becomes a reject at every resolution and the 4K opt-in is withdrawn. |
| 17 | HEVC Main10 at 1080p direct-plays | no | diag clip 2 | Confirms R9's 10-bit half — a different decoder profile from Main, which §7.2 names in the same breath. |
| **18** | DTS at 1080p — **and whether a failure is a silent-but-playing picture or a hard `MediaError`** | **YES** | diag clip 3 + the operator's audio answer | Promotes **R3** from `shadow` to `in_force` (silence) or to **reject** (hard failure). The second half decides it and **no document in this repo currently asks it**. |
| 19 | DTS-HD MA and TrueHD at 1080p | no | real file | Promotes or retires **R4**. |
| 20 | AV1 at 1080p | no | real file | Retires or re-justifies **R6**, whose own scope excludes this panel. |
| 21 | A Dolby Vision MKV — or **"no sample in this library"** recorded as such | no | real file | Retires or confirms **R5**. |
| 22 | A `.mp4` and a `.ts` from the library play | no | real files | **R7**'s premise. Only `.mkv` is measured, and `settings.video_extensions` admits thirteen containers outside the allow-list. *Standalone.* |
| **23** | One genuine 2160p HEVC release plays **end to end off a still-downloading torrent** | **YES** | real release, tens of GB, ARM cap of two | Gates the 4K opt-in's "done" claim and nothing else. The one row no clip can fake, and the only test of the Pi-throughput risk that was lowered on a single 1080p observation. |
| 24 | DTS or TrueHD at 2160p | no | real release | Confirms **R2** — the only AV reject, documentation-only today. |
| 25 | Sustained bitrate of a 2160p title that plays versus one that stalls, **stating which it measured** | no | real releases | Reinstates **R10**. The row must say it cannot separate decoder refusal from Pi throughput. |
| 26 | Model SKU and verbatim `navigator.userAgent` | no | `/bigscreen/diag` | *Standalone.* Untranscribed since stage 3, and the only facts that could ever justify re-deriving from the webOS 25 table. |

Plus **two edits to the stage-7 sheet**: its assumptions table says "a real HEVC file" and "a real
DTS file" in prose; both become pointers to rows **16** and **18**. A "what would settle it" cell
containing prose is how an assumption becomes a fact one document later.

**One sequencing constraint on the sitting, which no other document states:** nothing in stages 4,
6 or 7 has run on this television and stage 7's three gates are untaken — gate 1 raising the live
possibility that playback has only ever been observed with `AUTH_ENABLED=false`. So a failed row 16
could be an HEVC fact *or* a player fact. **Take stage 7's rows 1–3 first.** And a reading taken
through the main web app, as the 2026-10-07 sitting was, measures nothing about selection: the web
app sends no profile.

**Mergeable without the set:** tasks 1–9 in full, plus task 10's instrument. **Not claimable:**
that HEVC decodes, that DTS at 1080p plays, that a 2160p release streams off a partial torrent, or
that the profile is *correct about files* rather than about titles.

## Hazards

**The four rules-engine vacuity traps, each with its named countermeasure.**

1. **A penalty invisible because another sort term dominates it.** `-seeds` is a near-unique
   integer, so a cost placed after it is never consulted and a weight mutation cannot discriminate
   at all. **Countermeasure:** the stable second sort places capability between health and bucket
   by construction, not by weight; every cost fixture holds health, bucket, seeds **and** bytes
   equal; "drop the capability element and rely on stability alone" must redden. Two *separate*
   position mutations with two *separate* fixtures, because one position error is invisible to the
   other's fixture.
2. **A reject tested only in isolation and never through the real ranking.** A
   `_rejects(candidate)` helper that returns True proves nothing about what gets downloaded.
   **Countermeasure:** every reject is asserted through `apply_profile`'s output order **and** at
   the endpoint on `client.state.added[-1].magnet`. Plus characterisation tests for the three paths
   a reject cannot reach (magnet, raw hits, cron).
3. **A fixture that satisfies a rule for the wrong reason.** Already in the tree:
   `test_parse_quality_4k_and_uhd_map_to_2160p` uses `4K.UHD` and `UHD 2160p`, where both tokens
   agree, so it pins nothing about the mixed case in either direction. **Countermeasure:** every
   rule's table row is a **pair differing in exactly one token**; every reordering fixture asserts
   the pre-profile order in the same function and the penalised candidate must be the one that
   would **otherwise win**; `test_every_rule_is_observable` reddens for a row already implied by
   another.
4. **A corpus that only proves the regex matches itself.** **Countermeasure:** hand labels written
   once, never regenerated; the row-count test that **fails** (not skips) when the file is absent;
   label coverage; flip-a-label and loosen-a-pattern mutations.

**Design hazards.**

5. **`capability_cost` below health** means a rejected *healthy* release loses to an acceptable
   *dead* one, so `candidates[0]` can be a 0-seed swarm and the viewer sits on "Preparing… 0%" with
   nothing on that screen but Back. The `/download` refusal covers only the all-rejected case, so
   the mostly-dead-plus-one-rejected-healthy distribution is live. Recorded in code with its
   reasoning so a later reader can reverse it on evidence.
6. **The 60 Mbps gap.** With 4K opted in there is no ceiling; the only cover is R2 rejecting
   DTS-HD/TrueHD, which catches most UHD remuxes **for entirely the wrong reason**. A DD+ 4K remux
   at 80 Mbps passes every rule.
7. **Four guessed rules reorder from day one** (R3/R4 shadowed; R5, R6, R7 not). §7.2's only
   contemplated movement is penalty→reject, so the only retirement path is a reading that may never
   be taken, and a `device_reasons` string nobody reads is not a retirement mechanism.
8. **Shadow mode is unfalsifiable in the retiring direction.** A shadow R3 never reorders, so no
   release it would have demoted playing correctly can disprove it. It can only be promoted by
   reading 18 or carried forever. Accepted for R3/R4 because their reading is specified; refused
   for R6 because §11.2 requires a real AV1 penalty.
9. **A title names tracks, not the track that plays.** Unfixable in this stage, and both directions
   cost: rejecting on DTS discards playable files; accepting on DD accepts files whose default
   track is DTS.
10. **Parsing the film's own title as metadata is already live.** `Web.of.Lies.S01.1080p.BluRay.x264`
    parses `source='WEB-DL'`; `Cam.2018…WEB-DL` parses `source='CAM'`. Any new field inherits the
    class — a film titled *Opus* would parse as Opus audio. On the television a false reject is
    **completely silent**: the viewer presses Play and nothing happens.
11. **`parse_quality`'s UHD bug is contained, not fixed.** Rules key on `facts.resolution`, so the
    misfire is gone; the selector still buckets `1080p.UHD` as 2160p, so it stays the first
    downgrade target and still shows as a 2160p pill on the desktop. Characterised with a named
    follow-up.
12. **A pydantic silent drop is the quietest possible failure.** `TorrentRequest` declares no
    `model_config` (`models.py:373`), so without `extra='forbid'` a misspelled or early-shipped
    `client` yields a 200 with unprofiled ranking — which looks exactly like success. The Literal
    catches a bad value; only the forbid catches a bad key.
13. **`TorrentCandidate`'s TS mirror has no drift guard** (`frontend/src/types/index.ts:139-149`),
    so the two new fields can diverge from the client that renders them.
14. **A leak into the shared axios client would pass every guard.** One instance serves both
    surfaces, and `legacy-target.test.ts:467` explicitly pins `@/services/*` as allowed on the TV,
    so `npm run test:tv` would not notice. The eleven untouched web payload assertions are the only
    detector.
15. **Nothing persists which release the profile chose.** `Torrent` has no release-title column and
    `meta_data` holds five display fields, so an on-set session cannot answer "what did it pick and
    why" from the database. Reading 23 transcribes it by hand off `/streaming/{id}/info`'s
    `video_file.name`. The cheap future fix — `meta_data` is a JSON column every writer merges in
    place, so a `profile`/`release_title` key needs no DDL — is deliberately out of scope, because
    an unread field is an unproved one. (Note `TorrentCandidate.release_title` **does** exist, so
    `/sources` has the name; it is the *started* torrent that forgets.)
16. **No post-metadata container gate.** `_block_torrent` calls `session.remove_torrent`, sets a
    terminal `blocked` state with no unblock path, and `safe_rmtree`s the partial download, with no
    column recording which client asked — so a television-only verdict would **delete a file the
    web player streams fine**, for every surface. Not reused.
17. **Three verification instruments run nowhere.** `npm run test:tv` is in no build and no CI,
    `next build` happens inside the Docker image build where a test failure must not break an
    image, and every mutation here is manual. **One green run proves nothing.** Loop the suites.
18. **New test files and the corpus are invisible until `make build`** or the explicit
    `-v "$(pwd)/backend/tests:/opt/freeflix/tests"` mount, because the dev override mounts
    `backend/app` and `serve.py` only.
19. **The sitting is the schedule risk, and it is not code.** Reading 23 needs a real 2160p release
    (tens of GB, ARM cap of two) and reading 21 may have no sample in the library at all — in which
    case it records "no sample", not a blank. Decision 3 above says the stage ships regardless.

## Notes for whoever runs this

**Never `git add -A`.** A blanket add has already swept another agent's edits into an unrelated
commit in this repo. Stage by explicit path.

**`git checkout -- <file>` is not a mutation undo** — destructive on a tracked file you are
editing, a no-op on an untracked one. Snapshot with `cp` and restore from the snapshot.

**When a prescribed mutation comes back green, suspect the test before the code, and suspect this
plan before either.** Six of stage 7's plan-prescribed tests could not fail; twenty-odd have been
found in this repo. If no fixture can discriminate, keep the branch when it is load-bearing for a
future caller, write the reason on the function, retarget the test at the real property, and record
it in Corrections — do **not** leave a green test standing in for coverage.

**Attribution.** Commits end with `Co-Authored-By: Claude Opus 5 (1M context)
<noreply@anthropic.com>`.
