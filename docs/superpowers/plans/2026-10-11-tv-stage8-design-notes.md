# Stage 8 design notes — codec-aware selection, the capability profile, the 4K opt-in

Design record behind `2026-10-11-tv-stage8-codec-profile.md`. Produced 2026-10-11 from a
seven-area recon of the real source (`selector`, `parser`, `runtime-bitrate`, `tv-optin`,
`profile-table`, `web-regression`, `validation`), each area adversarially re-checked against its
own citations, then four competing designs (`scoring-layer`, `filter-before`, `profile-module`,
`honesty-first`) scored by three judge panels (epistemic honesty / blast radius / TV fitness)
and synthesised. 22 agents, 0 errors.

Kept because the citations are the valuable part: every claim below carries a `file:line`, and
several correct the spec. **Where this document and the spec disagree, this document was checked
against the code and the spec was not.**

Independently re-verified before the plan was written, in this working tree:
`torrents_select.py:88-95` (the four-tuple, health before bucket), `:7` and `:71` (2160p is the
first downgrade target for a 1080p ask), `:114` (`ranked[0]`, unguarded), `:21` (the
`sha1(magnet)` fallback), `quality.py:5-10` (`2160p|4k|uhd` tried before `1080p`), `:12` and
`:17` (no audio pattern, no container pattern, and `_HDR` misses `DoVi`/`HLG`/dotted
`Dolby.Vision`), `models.py:373-383` (`TorrentRequest`, no `model_config`) and `:190-200`
(`TorrentCandidate`, nine fields), `title.ts:84` and `:434`, `movie/[id]/page.tsx:137`,
`test_torrents_select.py:5-7` (`magnet="magnet:x"` for every hit), `legacy-target.test.ts:467`
(`@/services/*` allowed on the TV), `users.default_quality` served from `api/auth.py:183` and
`api/users.py:83`/`:102` and honoured by no download path, seven `webos22` occurrences across
two documents, `client=` nowhere in `backend/app` or `frontend/src`, and fifteen numbered rows
in the stage-7 readings sheet.

**Three corrections to the synthesis below**, found during that re-verification and carried into
the plan:

- `parse_release_info` has **zero production callers** — confirmed. `parse_quality` has exactly
  one (`providers/catalog.py:69`). So widening the former is free and reordering the latter is not.
- **`TorrentCandidate` already carries `release_title`** (`models.py:200`, set at
  `torrents_select.py:56`). The synthesis treats the release name as unavailable to a client; it
  is available on `/sources` today. What is unavailable is which release a *started* torrent came
  from — hazard 15 is about the `Torrent` DB row, not the candidate.
- `_HDR`'s alternation does contain `\bdv\b`, so a bare `DV` token **does** match. The gap is
  exactly `DoVi`, `HLG`, and dotted `Dolby.Vision` — narrower than "no input", and the plan says so.

---

# Stage 8 — Codec-aware selection, the `lg-webos22-floor` capability profile, and the per-title 4K opt-in

**Branch** `feat/tv-stage8-codec-profile`, off master at `6227e71`. House style: `docs/superpowers/plans/2026-10-10-tv-stage7-player.md`.
**Posture, inherited from stage 7: merge on green tests; hold the "done" claim until readings rows 16, 18 and 23 carry verbatim strings.**

Everything below that names a line was re-opened in this session. Confirmed directly: the sort key is `(health_rank, _bucket_index, -seeds, -_effective_bytes)` with **health first and bucket second** (`torrents_select.py:88-95`); `_ORDER = ["2160p","1080p","720p","480p"]` with `bucket_order += [q for q in _ORDER if q != quality]`, so **2160p is the first downgrade target for a 1080p ask** (`:7`, `:71`); `select_best`'s `ranked[0]` is unguarded (`:114`); `_source_id` falls back to `sha1(magnet)` (`:22`); `parse_quality` tries `\b(2160p|4k|uhd)\b` **before** `1080p` (`quality.py:5-10`); `TorrentRequest` has **no `model_config`** and `TorrentCandidate` has exactly nine fields (`models.py:373-383`, `:190-200`); `webos22` and `client=` appear **nowhere** in `backend/app` or `frontend/src`; `QUALITY = '1080p' as const` at `title.ts:84` with a dedupe key that **omits quality** at `:434`; row 0 is the literal `[profile ? 2 : 1]` at `movie/[id]/page.tsx:137`; `users.default_quality` **is** read and served (`api/auth.py:183`, `api/users.py:83`,`:102`); and the stage-7 readings sheet has exactly **fifteen** numbered rows, so stage 8's begin at 16.

---

## 1. The layer decision, settled

### Where it lives

**One new pure module: `backend/app/services/capability.py`.** It contains the rule table, `evaluate()`, `apply_profile()`, `PROFILES` and `READINGS_ROWS`. It imports only `app.models` (for `TorrentCandidate`) and `app.providers.quality` (for `ReleaseFacts`). No DB, no HTTP, no `settings` read, no import of `torrents_select`.

**It is called from two lines in `backend/app/api/torrents.py` and nowhere else:**

```python
# POST /download, after the existing rank_candidates at :87-90
candidates = apply_profile(candidates, profile_for(request.client), allow_2160p=(request.quality == '2160p'))

# GET /sources, around the three service returns at :146-148
return apply_profile(await ..._candidates(tmdb_id, quality), profile_for(client), allow_2160p=(quality == '2160p'))
```

### `torrents_select.py` has a zero-line diff, as a merge condition

`git diff --stat master -- backend/app/services/torrents_select.py` must print nothing. Not a test — a gate, checked mechanically before merge. Nothing in the selector changes: not the four-tuple key, not `classify_health`, not `available_qualities`, not `select_best`'s signature, not the private `_source_id`/`_is_season_pack` that `test_candidate_helpers.py:3` imports by name. **No service signature changes either**, so `test_sources_endpoint.py`'s fixed-arity fakes and the endpoint-untested `season_candidates` path stay out of the blast radius entirely.

Consequence: every contract already pinned continues to hold **without restatement**, because the function those tests describe is unchanged — the seven `test_rank_candidates.py` rows (including `test_dead_only_still_returned`, a deliberate "a caller always has options" contract), the four `select_best` rows, `test_classify_health.py`'s boundary rows, `test_selection_config.py`, and `test_cron_select_parity.py:15`'s `assert cron_select_best is select_best` symbol-identity assertion.

### How every caller gets it — and the one that cannot

`rank_candidates` has **five** call sites, and the fifth is the reason the logic is not inside it: `api/torrents.py:87`, `services/movies.py:115`, `services/tv.py:99`, `services/tv.py:108`, and `torrents_select.py:110` inside `select_best`, whose only production caller is `cron/jobs.py:284`. Anything placed in the ranking function reaches the headless scheduler whether it is wanted there or not, and only a defaulted parameter would keep it out — a weaker guarantee than never giving it the parameter at all. **`select_best` gains nothing**, so cron is unreachable by construction, and the unguarded `ranked[0]` can never `IndexError`. No defensive `if not ranked: return None` is added: while nothing is filtered the branch is unreachable, and an unreachable guard is one no test can fail.

### The absent-profile default is structural, three ways

1. **Early return, object identity.** `apply_profile(candidates, None, ...)` returns `return candidates` — the *same list object*, unannotated. Asserted `result is candidates`, not `==`. The mutation that proves it is not vacuous: replace the early return with `[c for c in candidates if True]`, which admits every element and **still fails**.
2. **Zero-diff.** The unprofiled path is literally the code a desktop user hits today.
3. **Hostile-table identity test** (grafted from proposal 1): monkeypatch the registry with a profile that rejects everything and applies every maximum penalty; call with `client=None`, and separately with the argument omitted; assert byte-identical order against the task-1 golden snapshot. Non-vacuous precisely because the table it defends against is absurd.

### The ordering, and why it closes the hole

`apply_profile` annotates each candidate and runs a **second, stable sort** over the already-ranked list, keyed:

```
(rejected, health_rank, capability_cost)
```

Because `rank_candidates` already ordered by `(health, bucket, seeds, bytes)` and `health_rank` is the first element of both keys, and because Python's sort is stable, the capability term lands **exactly between health and the quality bucket** — where the dossier's own analysis says it must sit — and bucket/seeds/bytes order inside each group is preserved byte-for-byte. No weight tuning, no reliance on an arithmetic bound, no fifth tuple element inside the selector.

`rejected` is the **outermost** element, so a reject is never chosen whatever its swarm. Penalties sit **below** health, deliberately: a penalty means "worse, but it will play", and a release with `seeds < min_seeds` will not start at all.

**This is where proposal 3 was broken and is fixed.** A capability *cost* below health cannot stop a healthy 2160p beating a low-health 1080p — I confirmed `health_rank` precedes `_bucket_index`. So the 4K opt-out is **a reject**, `withheld`, keyed on the asked bucket (§2 below, R1). `evaluate` therefore takes `allow_2160p`. Without that the stage merges green and still hands the television a 2160p DTS-HD release for a 1080p ask.

### Nothing is filtered

Rejected candidates are partitioned **last and marked**, never dropped. `/sources` always returns a full list, so the web's alternatives modal (guarded on `candidates.length > 0`, `MovieDetailView.tsx:281`) and the in-player switcher (`sources.length > 0`, `VideoPlayer.tsx:1834`) keep working — an empty list would make the web *play anyway with no warning*, i.e. tighten the rule by removing the safety net. `/download`'s auto-pick skips rejected rows and refuses with a distinct 404 only when nothing survives. **The list is advisory; the download is a commitment.**

`TorrentCandidate` gains two **defaulted** fields — `device_verdict: Optional[str] = None`, `device_reasons: List[str] = []` — so `test_sources_endpoint.py:13-17`'s nine-field construction still constructs. Mirrored by hand at `frontend/src/types/index.ts:139-149` (no drift guard exists; see §7).

**Capability never touches `health`.** That field drives the web's badges and its `hasHealthierAlt` gate, which selects on `c.health === 'healthy' && c.quality !== resolved` — so a capability cost folded into health would make a device-rejected release the alternative the modal actively *recommends*, and accepting it calls `streamCandidate`, which ships a magnet and takes the verbatim bypass.

### Justified against the three lenses

- **Epistemic honesty.** A standalone module makes each rule a table test over a fact dict, so provenance can be *enforced* (§2) rather than asserted in prose. The parser's defects stay in the parser's tests instead of entangling with the ordering's.
- **Blast radius.** One mechanically-checkable artifact (zero diff) plus one identity assertion plus one hostile-table test. Cron unreachable by construction. No service signature touched.
- **TV fitness.** `rejected` outermost means a device refusal becomes a *named* refusal (`withheld` / `incapable`) that reaches both the 404 detail and the candidate, which is what lets §5 and §9 say true things.

### What we trade away

1. **Two call sites, and only one is the television's.** The TV never calls `/sources` — its single `getSources` reference under `(bigscreen)` is a `vi.fn()` at `journeys.test.tsx:129`. So `client` on `/sources` serves the web picker; the TV's whole profiled path is the POST body of `/download`.
2. **Three paths stay profile-blind, on the record.** The explicit-magnet branch (`api/torrents.py:81-84`) never calls `rank_candidates` at all and is pinned as intended behaviour by `test_download_explicit_magnet_used_verbatim`; the raw-hits endpoints (`api/movies.py:55`, `api/tv.py:55`,`:62`) are unranked; and `available_qualities` is untouched — the web's 2160p pill comes from the raw-hits endpoint via `SourcePicker.tsx:142`, not from that function, so filtering it would remove no pill. **The server can refuse to honour a 2160p ask; it cannot stop the web asking.** Each hole gets a characterisation test so it is documented rather than discovered.
3. **A rejected release stays listed**, so a client that ignores `device_verdict` can hand its magnet to `/download` and have it honoured. "Reject" means *never auto-chosen*, not unreachable.
4. **No "heavy penalty" vs "penalty" magnitude.** §7.2 draws that distinction and a stable-sort cost tier flattens it. Recovered minimally: the container proxy gets a strictly larger cost than the three within-bucket guesses, with a strict-ordering test (§2).
5. **`capability_cost` below health** means a rejected *healthy* release loses to an acceptable *dead* one, so `candidates[0]` can be a 0-seed swarm and the viewer sits on "Preparing… 0%". The `/download` refusal only covers the all-rejected case. Recorded in the code with its reasoning so a later reader can reverse it on evidence.

---

## 2. The rules table, rule by rule

**Mechanism.** Every rule is `(id, when, effect, cost, basis, state, settled_by, why)`. `basis` is a **closed set** — `measured` | `lg-table` | `lg-doc` | `inferred` | `guess` | `no-input` | `product` — and each value **licenses a ceiling**: only `lg-table` and `product` may REJECT; `lg-doc`/`inferred`/`guess` may cost only; `no-input` forces effect NONE with a non-empty reason. `state` is `in_force` | `shadow` | `skipped`. `evaluate` is **TOTAL**: it returns the worst in-force effect plus `matched`, naming *every* rule that matched including shadow and skipped ones with its state — so a rule that deliberately reorders nothing is still observable.

| # | Rule | Tag | Effect | Reason | Settled by |
|---|---|---|---|---|---|
| R1 | `withheld-2160p` — a 2160p-resolution candidate when the ask is not 2160p | **PRODUCT** (spec §2 decision 9, §7.3) | **reject** (`withheld`) | Not an AV claim: it is the opt-in. Must be a reject because `health_rank` precedes `_bucket_index`, and `bucket_order` makes 2160p the *first* downgrade target for a 1080p ask — so no cost term below health can reach it, and a 2160p at bucket index 1 with the maximum cost still beats a 720p at index 2. | n/a |
| R2 | `dts-family-at-2160p` — DTS, DTS-HD, or TrueHD on a 2160p candidate | **DOCUMENTED** (`lg-table`, §3.2 Ultra HD: only DD / DD+ / AAC at 4K) | **reject** (`incapable`) | The only AV reject in the profile, and the only rule with a published table row behind it. Fires only when 4K was opted into. Rejects on the **carrier**, not on the word "Atmos": Atmos rides on E-AC3 (streaming, which §3.2 permits at 4K) or TrueHD (disc, which it forbids), so a literal reading of §7.2 would reject a legal `DDP5.1.Atmos` 4K release. Recorded as a decision taken against LG's own wording. | 24 |
| R3 | `dts-at-1080p` | **GUESS** (`guess` — §7.2's own cell says *unverified*; LG dropped DTS decode on some model years and which years is unknown) | cost, **shadow** | Matches and is reported; does not reorder. Promotion is a one-cell edit to `state` once row 18 is transcribed. §11.2 names no DTS-at-1080p test, so shadowing contradicts nothing. | **18** |
| R4 | `dtshd-truehd-at-1080p` | **GUESS** (`guess`) | cost, **shadow**, own weight | Separate rule because §7.2's 1080p row says only "DTS" while §3.2 lumps four codecs at 2160p, and nothing states which the 1080p rule covers. One merged rule silently decides that question. | **19** |
| R5 | `dolby-vision` | **INFERRED** (`lg-doc` — LG documents the Profile-8-in-MKV direct-play failure, undated and version-less) | cost, in force | The `in MKV` qualifier is **dropped**, with a note: the container is unknowable at selection time, so applying it unconditionally is strictly more conservative. Needs a `dynamic_range` field — the shipped `_HDR` returns **False** for `DoVi`, for `HLG`, and for dotted `Dolby.Vision`, so this rule has *no input today*, not a lossy one. | **21** |
| R6 | `av1` | **GUESS** (`inferred` at best; the rule's own parenthetical scopes itself to "2022 LCDs", a class this QNED99 8K is not in) | cost, **in force** | Kept in force, not shadowed, because §11.2 — the one written definition of this stage's selector test — requires the profile to "penalise AV1", and a non-reordering term would contradict it. `av1` is already in `_CODEC`, so its input works today. The weakness is in the rule's comment. | **20** |
| R7 | `container-proxy-xvid-divx` | **INFERRED** (`inferred`) | cost, **strictly larger** than R3–R6 | Named a **codec proxy**, not a container rule, because the real container is not knowable here: the provider returns seven keys and no file list, a season pack's torrent name is a directory name, and nothing in the image can probe a file. Fires only on a positively identified token — `container_guess is None` is **always free**. | **22** |
| R8 | `preferred-measured` — `h264` + any of `{ac3, eac3, aac}` | **DOCUMENTED + MEASURED**, tier **A** | bonus | The one point of the AV matrix with a reading. Docstring carries the measured list verbatim *with its caveats*: `.mkv`/Matroska, H.264, E-AC3 (DDP5.1), streaming off a ~26%-complete torrent, scrubbing inside downloaded bytes — and that the resolution was **never transcribed** (`videoWidth x videoHeight` was not copied, so even "1080p" is a release-name claim), the codec and audio were read off the release *name*, and §11.5(d) asked for AC3 while the run delivered E-AC3, so **plain AC3 is no more measured than HEVC**. | n/a |
| R9 | `documented-ok` — `hevc` 8/10-bit + `{ac3, eac3, aac}` | **DOCUMENTED** (`lg-table`), decode unmeasured | bonus, tier **B**, strictly below A | Split from R8 with a strict-ordering test. If H.264 and HEVC share one "preferred" tier, the project's only reading scores identically to the one without and becomes invisible in the ordering. HEVC is **admitted** despite being unmeasured, deliberately: it is the only 4K video codec besides H.264 that §3.2's Ultra HD table allows, so discouraging it would make the 4K opt-in return nothing. | **16, 17, 23** |
| R10 | `hevc-2160p-over-60mbps` | **NO-INPUT** | **effect NONE**, with a reason string | See below. | **25** |

### The 60 Mbps rule: present in code, inert, and provably plumbed

It ships as a real row with `effect=NONE`, `basis='no-input'`, and the reason `"bytes ÷ runtime: no runtime reaches the selector; see row 25"`. Not a paragraph in the spec — a row, so a grep that hits `effect=NONE, basis='no-input'` cannot be misread as an enforced ceiling.

Why there is no input, in both directions: `rank_candidates` receives `List[TorrentHit]`, which carries `bytes` and no duration. `resolve_title_year`'s **cache-hit** branch reads `CatalogItemCache`, which has no runtime column, so runtime is reachable only on the uncached 15-second TMDB branch. `catalog_items.detail_json` does hold `MovieDetail.runtime`, but `set_detail` has one caller (`movies.py:96`) and is skipped when `with_qualities=False` — the mode the TV's own detail load uses — and `services/tv.py` never calls it at all, so TV rows have no `detail_json` ever and `episode_run_time` is never read anywhere in the repo. On top of that a season pack's `bytes` cover N episodes while the only runtime available is one episode's; `bytes == 0` is a real value the selector already distrusts; and minutes-read-as-seconds is a 60× error in the *rejecting* direction. Five ways to be silently wrong.

**And the proof that it is a deferral rather than code nobody wrote** (grafted from proposal 3): a fixture injects a non-`None` `facts.bitrate_mbps`, and the rule must **fire** and change the verdict. The predicate and the plumbing are complete; only the input is absent. Mutating the rule's effect to a cost reddens the `no-input` integrity test.

The named follow-up, so the next reader does not re-derive it: `movies.detail` calls `tmdb.movie_details` **unconditionally** at `:70`, before the `with_qualities` branch at `:79`, and already upserts at `:86-94` via `upsert_list_item(**fields)`, which `setattr`s anything passed. A nullable `runtime` Integer on `catalog_items` (auto-added by `sync_columns`) plus `runtime=base.runtime` is a one-line, **zero-extra-HTTP** write on the exact call the TV already makes. Movies only; TV needs its own cache write. Also recorded: `tmdb.movie_details` returns `None` without `TMDB_API_KEY`, that key is commented out in this repo's `.env`, and compose passes that file — so even when implemented the rule cannot fire on this box until the key is set.

### What the television loses in the meantime, stated

No bitrate ceiling with 4K opted in. There is partial cover and **it is an accident, not a design**: UHD remuxes are overwhelmingly DTS-HD MA or TrueHD, so R2 rejects most of them for entirely the wrong reason — a DD+ 4K remux at 80 Mbps passes every rule in the profile. No real container check at selection, and `settings.video_extensions` admits sixteen containers, thirteen outside `.mkv/.mp4/.ts`, each served with a real MIME type by `api/streaming.py:32-49`. No bit-depth gate, so a 12-bit HEVC is treated as 10-bit. And the 4K opt-in rests entirely on an unmeasured HEVC decode.

### The name: `lg-webos22-floor`

Three facts in one identifier: vendor and platform family (`lg`), the table the rules are a function of (`webos22`), and the posture (`-floor`).

- **Not `webos25`.** Nobody on this project has read LG's webOS 25 AV table in any form; it is not in the repo. And "webOS 25" is itself an inference from the measured Chromium 120 via the mapping table in §3.1 — the model SKU and the verbatim user-agent are both **still untranscribed** since stage 3.
- **Not `webos22` bare.** It reads as a device match rather than a table provenance.
- **Not device-shaped** (`lg-qned99`). That ties a conservative floor to one SKU and blocks reuse by any older LG.
- **I will not make the argument that "the device's identity is recorded elsewhere, so name it for the table."** It is recorded nowhere durable. The honest argument is simply that the rules are a function of the table, and the table version is what a reader needs in order to re-check them.

**And the repo's own strongest argument for keeping the 22 derivation, which needs no internet:** the engine was upgraded by software; the decoder silicon is 2022. `legacy-target.test.ts:21-24` already states the principle for CSS — "a newer browser engine does not make a TV GPU faster" — and CLAUDE.md repeats it. LG's webOS 25 AV table describes 2025 model-year hardware; applying it to a Re:New-upgraded 2022 panel claims decoders this panel may never have had. **So the 22 table is the *safer* derivation for this specific set, not merely a conservative one.** That sentence goes in the module docstring so the next reader does not re-litigate it from a version number. Note also that in this repo §3.2 is two prose AV bullets (lines 126 and 128 — the other four are protocols, seek limits, the Cues defect and HTTP ranges) paraphrasing a URL slugged `-220`; the docstring says so.

A later *measured* profile is a **new id** (`lg-qned99-measured`), never a quiet edit to this one's rules.

**Rename cost, today, in full: seven occurrences across two files** — spec `:72` (the §2 locked-decision row, which names the wire value), `:539`, `:555`, `:742` (§11.2, the test spec), `:846` (the §14 sequence row), plus `2026-09-22-webos-tv-stage3-results.md:13` and `:203`. `grep -rn webos22 docs/ backend/ frontend/src` must return nothing after the rename — a merge condition.

### Integrity tests (the mechanism that makes a dishonest table red)

1. Every rule's `basis` is in the closed set.
2. `settled_by` is required **iff** `basis ∈ {inferred, guess, no-input}`, and must name an id present in a frozen `READINGS_ROWS` tuple **in Python** — nothing parses markdown.
3. Both directions: every `READINGS_ROWS` entry is claimed by at least one rule, or flagged `standalone` (rows 26, 22).
4. Exactly **two** rules may REJECT, and their bases are `product` and `lg-table`.
5. R10's effect is NONE and its reason is non-empty.
6. Tier A's bonus is strictly greater than tier B's; R7's cost is strictly greater than R3–R6's.
7. `test_every_rule_is_observable` (grafted from proposal 3): for each rule, `evaluate` on its matching fixture must differ from `evaluate` on its non-matching fixture in `effect` **or** in `matched`. An unsatisfiable predicate, or a row whose effect is already fully implied by another row, fails here instead of sitting in the table forever looking enforced.

The three states also surface in **§7.2's own table** as a vocabulary — **IN FORCE / SHADOW / NOT IMPLEMENTED** — because a six-month reader opens the spec, not `capability.py`.

---

## 3. The task breakdown

### Task 1 — Baseline, the golden snapshot, both leaks characterised, and one broken fixture repaired

**Files** `backend/tests/test_selector_baseline.py`, `backend/tests/data/rank_snapshot.json`, `backend/tests/test_rank_candidates.py`, `backend/tests/test_torrents_select.py`, `backend/tests/conftest.py`

Capture and quote four counts in the commit: backend pytest, `npx vitest run`, `npm run test:tv`, `npx tsc --noEmit`. Record what `backend/tests/test_torrent.py` and `test_torrent_alternate.py` do — both match pytest's default collection pattern and are module-level libtorrent scripts (`lt.session()`, `session.listen_on`, `while True:`) with no `__main__` guard, and there is no `[tool.pytest.ini_options]` in `backend/pyproject.toml`. One proposal measured 649 passing in 134s with a 10.9s collect, i.e. **no hang**; confirm or refute, and if it hangs add a `collect_ignore` in `conftest.py`. Attribute nothing to stage 8 either way.

Then the **golden snapshot**, generated from unmodified code at the branch base and committed as data. The fixture matrix is load-bearing: every ask in `{2160p, 1080p, 720p, 480p, ''}` crossed with every bucket **including the unparsed `''` bucket** at seeds 0/2/30, plus at least one pair that straddles the health-versus-maximum-bucket-distance boundary (a healthy `''`-bucket hit against a low-health exact-bucket hit). Fixtures derive a **distinct magnet per (title, seeds, bytes)**.

Then **characterise both leak mechanisms** as the before-picture, docstringed as such and naming the task that inverts them: (a) health outranks bucket — a healthy 2160p is chosen for a 1080p ask when the only 1080p is low-health; (b) **the bucket term alone leaks, with no health mismatch** — among equally healthy hits with no exact 1080p, a 6-seed 2160p beats a 999-seed 720p, and for a 720p ask 2160p outranks 1080p. No fixture in `test_rank_candidates.py` constructs a 2160p hit at all, and the tree's only 2160p-for-a-1080p-ask fixture goes through `select_best`, which pre-filters and therefore cannot leak — **so the exact hole this stage exists to close is pinned in neither direction today.**

Then repair `test_torrents_select.py`'s `_hit`, which passes `magnet="magnet:x"` for every hit; `_source_id` falls back to `sha1(magnet)` (confirmed at `:22`), so `by_id` collapses to the last matching hit and `by_id.get(top_id, matching[0])` hides it. Both of its ordering tests pass on **input order alone**.

**Proved by mutation.** Demonstrate the fixture defect *before* fixing it: reverse the input lists with the old helper and watch both ordering tests redden with no production change; restore distinct magnets and reverse again — green. Against production: swap `health_rank` and `_bucket_index` in the key → snapshot reddens; negate `-seeds` → reddens; change `_effective_bytes`'s `else -1` to `else 0` → reddens. Delete `-seeds` → the 720p/2160p row reddens. Reorder `_ORDER` to put 2160p last → leak (b) reddens while (a) stays green, separating the two mechanisms. Two meta-mutations: regenerate the golden file from a deliberately mutated run and confirm the test then **passes**, proving the file is read; restore with `cp` from a copy, never `git checkout --`, which cannot restore an untracked file.

**Does not** change any production file. Does not fix the two script-shaped test files beyond an exclusion if they hang.

---

### Task 2 — `parse_release_facts`: audio tracks, dynamic range, bit depth, codec family, a container proxy, and its own resolution

**Files** `backend/app/providers/quality.py`, `backend/tests/test_release_facts.py`, `backend/tests/test_quality.py`

A new frozen dataclass beside the existing functions: `audio: frozenset[str]`, `video_family: 'h264'|'hevc'|'av1'|'xvid'|None`, `bit_depth: 8|10|12|None`, `dynamic_range: 'dv'|'hdr10'|'hlg'|None`, `container_guess: str|None`, `remux: bool`, `resolution: int|None`, `bitrate_mbps: float|None` (always `None` in stage 8). `parse_release_info` keeps its four keys and its assertions untouched — it has **zero production callers**, so widening is free but renaming costs edits for nothing.

Each addition is shaped by a measured defect rather than by copying the house style:

- **Audio is a set**, because a title names tracks and often two (`REMUX.HEVC.DTS-HD.MA.TrueHD.7.1.Atmos`). Every pattern needs `[-. _]?` separators and digit-tolerant boundaries: `\bdd\b` misses `DD5.1` but **matches** `DD+5.1`; `\bddp\b` misses `DDP5.1` (the AMZN/NTb standard); `\baac\b` misses `AAC2.0`; `\bdts\b` misses `DTSHD.MA`. Alternation **order** is load-bearing — `\bac3\b` matches *inside* `E-AC3` because the hyphen supplies the boundary — so E-AC3/DDP/DD+ before AC3/DD, and DTS-HD/TrueHD before DTS, exactly as `web-?dl|webrip|web` already is at `:14`. `atmos` is recorded as a flag beside its carrier, never as a codec.
- **`dynamic_range` is written from scratch**, not split off `hdr`: the shipped `_HDR` returns False for `DoVi`, for `HLG`, and for dotted `Dolby.Vision`. Needs `dovi`, `dolby[-. ]?vision`, `dv[-. ]?p?8`, `profile[-. ]?8`.
- **Bit depth** constrained to 8/10/12 **and** co-required with a video codec token, plus `Hi10P`. A naive `(\d+)\s*bit` matches `24bit` in `Concert.2020.FLAC.24bit.48kHz` — a string already at `test_quality.py:22`, under a comment defending `parse_quality` against exactly this family.
- **Codec family** absorbs `AVC` and `Hi10P`, which both parse as `None` today — and AVC remuxes are §7.2's most *preferable* class.
- **`container_guess` is a declared proxy**: `xvid|divx` only, `None` otherwise. **`\bts\b` is not a container token** — `Movie.2020.TS.XviD-GRP` is a telesync.
- **`remux` is its own `search`**, never a read of `source`: `Movie.2016.2160p.UHD.BluRay.REMUX.HEVC…` parses `source='BluRay'` because `re.search` is leftmost-match.
- **`resolution` is owned here**, with explicit-`NNNNp`-token precedence.

**`parse_quality` is deliberately NOT changed.** Confirmed: `_QUALITY_PATTERNS` tries `\b(2160p|4k|uhd)\b` first, so `Movie.2020.1080p.UHD.BluRay.DD5.1.x265-GRP` buckets as `2160p`. Reordering it would move releases between buckets for **every desktop user** — regrouping the `SourcePicker` pill, changing the downgrade-walk position, and changing which bucket a 2160p cron schedule's exact-bucket filter matches. Instead the defect is **contained**: every profile rule keys on `facts.resolution`, so the misfire is gone (a `1080p.UHD` encode is no longer withheld as un-opted-in 4K, nor hit by R2) while the pre-existing misplacement in the selector's bucket remains, pinned as a characterisation test with a named follow-up. The existing `test_parse_quality_4k_and_uhd_map_to_2160p` stays green, unedited.

**Proved by mutation**, one per measured defect: restore `\b` on the DD pattern → the `DD5.1` row reddens while `DD+5.1` stays green (the measurement that the house style is wrong in the direction that matters); move `ac3` before `eac3` → every `E-AC3` row reports `ac3` and reddens; drop the codec co-requirement from bit depth → `FLAC.24bit` reddens; remove `avc` → the AVC remux row reddens; remove `dovi` → the DoVi row reddens while `hdr` stays green; delete the standalone remux `search` → the leftmost-BluRay row reddens; add `ts` as a container token → the telesync row reddens; drop explicit-token precedence in `resolution` → `1080p.UHD` reports 2160 and reddens **while the `parse_quality` characterisation row stays green**, proving the two are independent.

Plus two anti-vacuity guards. A **meta-test** asserting every member of the audio and container enums appears in at least one positive *and* one negative fixture row — a pattern with no fixture is a pattern nobody tested, and a member added later with no row fails here rather than silently never matching. And every existing selector fixture title (`M.2020.1080p.A` and friends, which name no container, codec or audio) must parse to an **empty** audio set, `container_guess is None`, and `video_family is None` — the shape that makes "unknown is free" testable.

**Does not** touch `parse_quality`, reuse `hdr` for DV, rename any existing key, parse a real container, or compute a bitrate.

---

### Task 3 — The frozen corpus and per-rule confusion counts

**Files** `backend/tests/data/releases.tsv`, `backend/tests/test_release_corpus.py`, `backend/scripts/harvest_release_titles.py` — see §4.

---

### Task 4 — `capability.py`: the table, `evaluate`, and the integrity tests

**Files** `backend/app/services/capability.py`, `backend/tests/test_capability_table.py`, `backend/tests/test_capability_evaluate.py`, and the seven-occurrence rename across the spec and the stage-3 results doc

The rule table and `evaluate(facts, *, allow_2160p) -> Verdict(rejected, reason, cost, matched)` exactly as §2 specifies. No sort, no I/O, no selector import, no title parsing.

**Proved by** the seven integrity tests of §2, plus a table test per rule using a **pair of fact-dicts differing in exactly one token**, so no verdict can be produced by another rule.

**Mutations, per rule rather than per module:** flip R2 from reject to cost → its verdict row reddens *and* the exactly-two-rejects test reddens; flip R3's `state` from `shadow` to `in_force` → the "a shadow rule never changes `effect`" row reddens for that rule *and* task 5's ordering test reddens (the exact one-cell promotion row 18 will perform); delete any rule → its verdict row and `test_every_rule_is_observable` both redden; give R10 a cost → the `no-input` test reddens; **inject a non-`None` `bitrate_mbps`** → R10 fires and the verdict changes, proving the plumbing is complete and only the input is absent; drop `settled_by` from a `guess` rule → the provenance test reddens; point `settled_by` at an id absent from `READINGS_ROWS` → the cross-reference reddens; set tier A's bonus equal to tier B's → the strict-ordering test reddens; veto on the bare word `atmos` instead of the carrier → the legal `DDP5.1.Atmos` 4K row reddens; make R7 fire on `container_guess is None` → every "unknown is free" row reddens.

**Does not** import the selector, `settings` or any provider; decide where the verdict sits in the ordering; implement a bitrate estimate or a real container check.

---

### Task 5 — `apply_profile`: the stable second sort, and the absent-profile guarantee

**Files** `backend/app/services/capability.py`, `backend/app/models.py`, `frontend/src/types/index.ts`, `backend/tests/test_apply_profile.py`

`apply_profile(candidates, profile, *, allow_2160p)`. `profile is None` → `return candidates`, the same object, unannotated. Otherwise annotate and stable-sort on `(rejected, health_rank, capability_cost)`; rejects partitioned last and marked; `len(out) == len(candidates)` always. `_HEALTH_ORDER` is defined here (the real map is a local inside `rank_candidates`) and carries a drift pin parametrised over seeds 0/1/4/5/100 against `classify_health`. `TorrentCandidate` gains the two defaulted fields; mirror them in the hand-written TS interface.

**Proved by** fixtures that can discriminate. Every cost fixture holds health, bucket, seeds **and** bytes equal, differing only in the penalised token — `-seeds` is a near-unique integer, so a term placed after it is never reached and a weight mutation cannot discriminate at all. Every reordering test asserts the **pre-profile order explicitly in the same function**, so the reversal is visible to the reader; a fixture where health or seeds already agree with the capability order proves nothing and is rejected in review. The discriminating pair: a healthy 2160p HEVC+DTS-HD at 900 seeds against a healthy 2160p HEVC+E-AC3 at 10 seeds.

**Mutations:** drop the capability element and rely on stability alone → the reordering test reddens (**this is the mutation the stage lives or dies on**); move capability *before* `health_rank` → "a penalised healthy release still outranks an unpenalised dead one" reddens; fold the cost into `health` → "capability never changes health" reddens (a penalised healthy candidate must still report `health == 'healthy'`); drop `rejected` from the key → the R1/R2 rows redden; change the `None` path to `sorted(candidates, key=...)` → the **identity** test reddens even though the output is equal; replace the early return with `[c for c in candidates if True]` → still reddens; annotate on the `None` path → "every candidate has `device_verdict is None`" reddens; drop a reject instead of partitioning → length preservation reddens; add a fourth value to `_HEALTH_ORDER` → the drift pin reddens.

**Then the feature itself, and note today's red test is the opt-OUT.** "With 4K on, a 2160p can win" passes with zero code written. The honest assertions, both red today: with the profile and an asked 1080p, a healthy 999-seed 2160p ranks **below** a low-health 1080p *and* below a healthy 720p, carrying `device_verdict='withheld'`; among equally-healthy hits with no exact 1080p it also ranks below the 720p (leak (b)); with an asked 2160p it ranks first; with an asked 2160p and a DTS-HD track it is last with `device_verdict='incapable'` while a 1080p H.264+E-AC3 release wins. Mutate R1 from reject to cost → the opt-out rows redden, which is the arithmetic demonstration that the gate cannot be a weight.

**And the hostile-table identity test** of §1.

**Does not** filter; touch `health`, `select_best`, `classify_health` or `available_qualities`; rename `_source_id` or `_is_season_pack`; change the no-profile ordering by one element. Zero-diff on `torrents_select.py` is re-checked here.

---

### Task 6 — `client=<profile>` on the wire, and the refusal the television can read

**Files** `backend/app/api/torrents.py`, `backend/app/models.py`, `backend/tests/test_client_profile_endpoints.py`, `backend/tests/test_sources_endpoint.py`

`TorrentRequest` gains `client: Optional[Literal['lg-webos22-floor']] = None` **and `model_config = ConfigDict(extra='forbid')`**. Both halves are load-bearing and catch different failures: the Literal catches a bad *value*; the forbid catches a bad *key*, because the model declares no config today and pydantic v2's default `extra='ignore'` **silently drops** an undeclared `client` — so a TV build shipped ahead of the backend would get unprofiled ranking with a 200 and no signal, the quietest possible way for the whole profile to be absent while looking present. Every shipped caller passes a typed `CatalogTorrentRequest` whose fields are all declared, so forbidding extras is safe; a hand-rolled client would break, which is the point. `/sources` gains the same Literal as `Query(None)` — `quality` there is a bare `str`, so an unvalidated `client` would accept any name.

`/download`'s auto-pick skips rejected rows: `chosen = next((c for c in candidates if not c.device_verdict), None)`. On `None`, 404 with two distinct details, both of which **must contain "no torrents"** so they degrade safely through `title.ts:382-385`: `"Only 4K sources exist for this title — no torrents this television can play in HD"` when every candidate is `withheld`-only (it names an action the viewer can take, so it wins a mixed case), and `"No torrents this television can play"` when any is `incapable`. Genuinely empty hits keep the **unchanged** `"No torrents found"`.

**Two bypasses stay live, in a code comment with the reason.** `if request.magnet:` is pinned as intended by `test_download_explicit_magnet_used_verbatim`; and an unmatched `source_id` falls through to `candidates[0]` with a 200 — unreachable from any current client, because both web pickers send `magnet` **and** `source_id` together, and the TV sends neither. Drop the two unused imports (`select_best`, `available_qualities`) while in the file.

**Proved by** response-level assertions, not mocks: with `client` set on `/sources`, every candidate carries a non-null `device_verdict`; without it, every one is null. On `/download` with a 2160p-DTS-only hit set plus `client` and `quality='2160p'`, the 404 detail is the `incapable` string; with `client=None` the same hit set 200s and `client.state.added[-1].magnet` is the 2160p one — **what is proved is which multi-gigabyte file was actually started.** The season-pack `/sources` path gets its **first** endpoint test.

**Mutations:** misspell the field name in `TorrentRequest` → the forbid test reddens (without it, the profile-actually-ran assertion would silently pass unprofiled); replace either Literal with `str` and send a garbage name → the 422 rows redden on both endpoints; delete the reject skip → "a rejected top candidate is not the one downloaded" reddens; change a 404 detail to anything without "no torrents" → task 9's copy test reddens; swap the mixed-case precedence → the mixed row reports the wrong detail.

**No existing backend test file is edited by this task except `test_sources_endpoint.py`**, which needs no edit at all because no service signature changes — re-run it to confirm. `test_cron_select_parity.py` stays green untouched.

---

### Task 7 — The television's ask: a second value out of `title.ts`, and a dedupe key that carries it

**Files** `frontend/src/app/(bigscreen)/_data/title.ts`, `frontend/src/types/index.ts`, `frontend/src/services/torrents.ts`, `frontend/src/app/(bigscreen)/_data/title.test.ts`

`requestTitle` / `startDownload` take `fourK?: boolean`; the body sends `quality: fourK ? '2160p' : '1080p'` and **`client: TV_PROFILE` on every TV request**, not only the 4K one — the profile is what makes the 1080p ask honest too. `TorrentRequest.quality` is already `Literal['720p','1080p','2160p']` (confirmed), so the 4K value needs no model change.

The in-flight dedupe key at `:434` **gains the flag**. Confirmed: it is `${mediaType}:${tmdbId}:${season}:${episode}` and the window is a full provider search wide, so a 1080p press followed by a 4K press returns the first press's promise and the 4K ask is silently dropped — the control would lie by returning someone else's result.

`client` is **optional** on `CatalogTorrentRequest` and `SourcesParams`: those types have at least ten non-TV call sites, eight of them web POSTs to `/download`, five funnelling through `utils/streaming.ts:46`. Rewrite the two doc comments that assert the 1080p-everywhere property as design fact (`title.ts:57`, `movie/[id]/page.tsx:26`) in the same change that makes them false.

**Proved by** the two exact-equality `toHaveBeenCalledWith` payload assertions in `title.test.ts` (`:469-475` tv, `:491` movie), which are both the intended edit **and** the tripwire: if they pass unchanged, the TV is not sending the profile. New row: press 1080p, then 4K before the first resolves → **two** distinct POSTs with distinct qualities.

**The eleven web payload assertions must stay unedited** — five on the download path (`MovieDetailView.test.tsx:329`, `EpisodeList.test.tsx:364`/`389`, `ShowDetailView.test.tsx:392`/`425`) and six on the Play path through `handleCatalogStreamingStart` (`MovieDetailView.test.tsx:276`/`309`, `EpisodeList.test.tsx:253`/`296`/`319`, `ShowDetailView.test.tsx:347`). **If any one needs editing, `client` has leaked into a shared path and the implementation is wrong, not the test.** Note `EpisodeList.test.tsx:389` already asserts `quality: '2160p'`, so the web exercises a 4K request end to end today.

**Mutations:** revert the dedupe key → the two-presses row reddens; drop `client` from the body → both payload rows redden; default `client` in `torrentsService` or an axios interceptor → the eleven web assertions redden, which is exactly what they are for. `npm run test:tv` would **not** catch that: `legacy-target.test.ts:467` explicitly pins `@/services/*` as allowed. Make `client` required on `CatalogTorrentRequest` → `npx tsc --noEmit` fails at eight web call sites, the type system itself proving the field must stay optional.

**Does not** persist the choice, call `/sources`, or touch the show screen.

---

### Task 8 — The 4K cell: a derived row 0, appended last, and the rescue that screen never had

**Files** `frontend/src/app/(bigscreen)/bigscreen/movie/[id]/page.tsx`, `frontend/public/bigscreen.css`, `frontend/src/app/(bigscreen)/bigscreen/movie/[id]/page.test.tsx` — see §5.

---

### Task 9 — Say what actually arrived

**Files** `frontend/src/app/(bigscreen)/_data/title.ts`, `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx`, and the two test files

Two things. The `reasonFor` 404 branch for task 6's details, **placed and tested before** the `/no torrents/i` branch (so the ordering is deliberate) while the details also still *match* that regex (so losing the branch degrades to "No sources found for this title yet." rather than to the outright lie "The box doesn't recognise this title.") — belt and braces, because each alone is a single point of failure.

And disclosure on the watch route, which needs no new fetch: the whole row already reaches the player as `status={arrival.status}` at `:505` and is read field-wise by the message builder at `:955`/`:971`. Two strings: the `decode` verdict names the bucket ("this 4K file…"), and a 4K press that produced a non-2160p row says so once on arrival. Use **`status.quality`**, which `to_status()` carries on every poll — **not** `chosen_quality`, which is set only on the download response and is null on every poll, as `title.ts:296` already records.

**Proved by** a `reasonFor` table with one row per 404 detail including both existing ones, and two watch-route rows. **Mutations:** read `chosen_quality` instead → the disclosure is empty on every poll and both rows redden (**the mutation that matters, because `chosen_quality` is the field whose name says what you want and whose value is always null**); drop the bucket from the decode string → the verdict row reddens; hard-code the disclosure line → the non-vacuity row reddens, i.e. **a 1080p press landing 1080p must say nothing**; move the new 404 branch after `/no torrents/i` → it reddens iff the detail contains those words, recorded in the test file so the ordering reads as deliberate; change a backend detail string → the frontend row reddens, the contract asserted on both sides of the wire.

**Does not** claim success beside the control: `run` navigates on a successful press (`PrimaryAction.tsx:144`) and stays busy through it, and `describeAction` is a pure two-arg exhaustive switch whose table is pinned, so a pre-press *result* claim would need a third parameter. Does not add a column, a `RequestResult` field, a picker, or a client-side filename regex.

---

### Task 10 — The codec instrument, the readings sheet, and three spec edits

**Files** `frontend/src/app/(bigscreen)/bigscreen/diag/page.tsx` + its test, `frontend/public/samples/` (gitignored), `docs/superpowers/plans/2026-10-11-tv-stage8-device-readings.md`, the stage-7 sheet, the spec

**The instrument.** There is no codec probe anywhere: `canPlayType`/`isTypeSupported` appear nowhere under `(bigscreen)`, the probe list is CSS/JS features plus `MediaSource present` and two mediaSession rows, and the diag player can only play a torrent (`:314`). **Four clips** in `frontend/public/samples/`, served by Next.js static at `http://<host>:3001/samples/…` with no torrent, no backend, no auth gate and no ARM download cap — one variable each: 1080p HEVC Main 8-bit + AC3; HEVC Main10 + AC3; H.264 + DTS 5.1; and **1080p H.264 + E-AC3 as the control**, reproducing the one measured combination, so a red row there means the instrument is wrong rather than the panel. Each row prints `MediaError.code`, `videoWidth x videoHeight`, `duration` and `readyState` **verbatim**, plus an **operator-typed yes/no for "did sound come out of the television"** — a DTS track the set cannot decode is *silent* and raises no error, so a code-only readout would log a pass on a silent film. The readout persists to `sessionStorage` on the house `bs-diag:` prefix, every access in try/catch. Clips are gitignored; binaries do not belong in this repo. `canPlayType` may be added as **one clearly-labelled advisory row** and may gate nothing — §7.2 is right that TV implementations under-report.

**Proved by** instrument tests: a missing clip renders an explicit "file not present" state rather than a silent nothing (**the distinction is the whole value, because a 404 and an unsupported codec both end with no picture**); an `error` event surfaces its raw numeric code; the operator's audio answer is part of the persisted record; the readout survives a remount; the `@allow-legacy-probes` opt-out set stays pinned by equality. **Mutations:** render an empty `<video>` on 404 → the not-present row reddens; swallow the error → the code row reddens; drop the persistence → the survive-a-remount row reddens (**the mutation that pins the actual lesson: stage 3 ran the key log on this television and wrote none of it down**); remove the `@allow-legacy-probes` marker → three `legacy-target.test.ts` assertions redden.

**The sheet** — §6. **No test, deliberately**: its failure mode is a visible blank, and a test asserting a markdown table is filled in is a test about markdown. The integrity check lives in `READINGS_ROWS` and task 4's cross-reference, both directions.

**Three spec edits.** §7.2's table rewritten to IN FORCE / SHADOW / NOT IMPLEMENTED with the Atmos-carrier deviation stated, R10 marked NOT IMPLEMENTED with its reason and row 25, and the "over-conservative because webOS 25 is newer" rationale **replaced** by the silicon argument. §11.2's "prefers 1080p H.264+**AC3**" fixture becomes **E-AC3** (or AC3 *and* E-AC3), since §11.5(d) asked for AC3 while the run delivered DDP5.1 — plain AC3 is no more measured than HEVC; "penalises AV1" survives untouched, which is why R6 is in force. And the seven-occurrence rename, with `grep -rn webos22` returning nothing as a merge condition.

**Does not** take any reading, fill any cell, or claim the stage works.

---

**Dependency order:** 1 and 2 in parallel → 3 (needs 2 for the parser, 4's table for the grouping, so land it after 4 if the counts are grouped by rule) → 4 → 5 → 6 → 7 → 8 → 9. Task 10's instrument is independent of 5–9 and can run in parallel from task 4 onward (its rows reference the rule ids).

---

## 4. The parser corpus

**Why it is not optional.** Every §7.2 rule bottoms out in a regex over a scene name, because `normalize_hit` (`providers/catalog.py:59-70`) keeps seven upstream keys — title, seeds, peers, bytes, magnetUrl, hash, source — and the upstream `api=torrents` response carries no file list, while libtorrent's file list only exists *after* the torrent has been added, i.e. after the decision. **At selection time the title is all there is.** So parser precision *is* the profile's accuracy, and §11.2's "a table test over synthetic candidates" measures the engine, not the parser.

**Shape.** A committed TSV at `backend/tests/data/releases.tsv`: one row per title, one column per label the parser emits — `resolution`, `audio` (a sorted, pipe-joined set), `video_family`, `bit_depth`, `dynamic_range`, `container_guess`, `remux`.

**Size: 300–800 de-duplicated titles**, with a floor of **40 rows each** for the three naming shapes (movie, `SxxExx`, season pack).

**Where the titles come from.** Two honest sources, neither hand-written.

1. **`catalog_item_cache.torrents_json`**, free via `make db`. Written for every movie detail page ever opened with qualities. **Movies only** — `set_torrents` has exactly one caller, `services/movies.py:97`, and `services/tv.py` never calls it. So the two shapes that matter most for the television are structurally absent from the cache.
2. **A live harvest**, `backend/scripts/harvest_release_titles.py`, calling `catalog.torrents(f"{show} S01E01")` and `f"{show} S01"` across 60–100 titles chosen for shape coverage: 4K-era blockbusters, catalogue films, single episodes, season packs. **Unconditionally required** for the TV half.

**Labels are written by hand, once, and never regenerated with the parser under test.** A corpus produced by the parser proves only that the parser is deterministic.

**How precision and recall are pinned: exact confusion counts, per field and per direction**, asserted as integers with the offending titles in the assertion message — `audio contains dts-hd: tp=41 fp=0 fn=2`, naming both false negatives. **Never an aggregate ratio.** The two error directions have opposite costs: a missed 2160p-DTS reject is a black screen on the television; an over-eager one silently discards a playable release. A percentage can absorb a regression in either, and a future parser change then produces a judgement call instead of a diff.

**How it is kept honest — four guards, each with its mutation.**

1. **A minimum-row-count test, and it is the first mutation target.** `git mv` the TSV aside: `test_corpus_min_rows` must **FAIL**, while every parametrised row merely reports as *skipped*. There is no `[tool.pytest.ini_options]` in `backend/pyproject.toml` (confirmed), so `empty_parameter_set_mark` is the default `skip` — an absent or unmounted corpus otherwise makes the whole corpus suite a **green no-op**. Compounding it: `backend/tests` is baked into the image and **not** bind-mounted, so the file is invisible in the container until `make build` or the standing `-v "$(pwd)/backend/tests:/opt/freeflix/tests"` mount. Run both ways once and record which.
2. **A label-coverage assertion:** at least N rows for every value each label column can take. Without it, "0 false negatives on DTS" can be reported from a corpus containing no DTS rows.
3. **Flip one hand label in the TSV** → the matching count assertion reddens, proving the numbers are compared against the *file* and not recomputed from the parser.
4. **Loosen one audio pattern by one character** → a specific `fp` count rises and that exact-count assertion reddens. This is the regression signal the exact counts exist to give.

**What it deliberately does not prove, written in the test file:** the labels are labels about *titles*, not about files. A title names tracks — often several — and the MKV it describes may carry a compatibility AC3 track the set plays happily, so rejecting on the presence of DTS discards playable files while accepting on the presence of DD accepts files whose default track is DTS. The title cannot settle it and nothing in the image can probe the file. **That is also exactly the confidence the selector will ever have**, which is why it is the right thing to measure — but it must be labelled.

---

## 5. The 4K opt-in on the television

**Movie screen only.** `rowCounts: [profile ? 2 : 1]` (confirmed at `movie/[id]/page.tsx:137`) becomes a **derived cell-id array** on the house pattern (`actionCellsFor`, `list/page.tsx:129-141`), rendered by mapping that array so the declared count cannot drift from what it renders:

```ts
type ActionCell = 'primary' | 'list' | 'fourk';
const cells: ActionCell[] = ['primary',
  ...(profile ? (['list'] as const) : []),
  ...(state.action.kind === 'play' ? (['fourk'] as const) : [])];
const grid = useFocusGrid({ rowCounts: [cells.length] });
```

**Appended last** — col 2 with a profile, col 1 without. The grid calls `go` only when the clamped target changes, so growth at the end never refocuses; a cell inserted at or before the focused column leaves DOM focus on the element that just became col+1 while the model still points at the old column, and the next press appears to do nothing. The rule is written down twice in this codebase (`TransportBar.tsx:30-33`, with the remedy at `LoadStatus.tsx:26-27`) and pinned by `TransportBar.test.tsx:165-182`.

**Rendered only when `action.kind === 'play'.`** A control that cannot act is a focus stop whose press does nothing, which this surface's rules forbid (`list/page.tsx:132-135`), and `play` is the only kind that may start a download (`PrimaryAction.tsx:17`).

**And it gets the focus rescue the movie screen has never had.** `TitleScreen.tsx:9-12` states that anything passed as `actions` must never unmount while it holds focus, because an unmounted focused control drops DOM focus to `<body>` with nothing on a remote to bring it back — and a press that turns `play` into `preparing` unmounts this cell. The rescue **clamps to the last existing cell**, not to `{row:0,col:0}`; hard-coding col 0 would park the ring on Play even though the viewer was at the right-hand end. The show screen has **two** hard-coded `{row:0,col:0}` resets (`show/[id]/page.tsx:302-305` and `:332`, the second after every non-navigating episode press), which is one of the two reasons the cell is not added there.

**Dress:** an `aria-pressed` toggle reusing `.bs-list__toggle[aria-pressed="true"]` (`bigscreen.css:820-821`). **No new `.bs-btn` modifier** — that stylesheet forbids one in three blocks. Keep it **narrow, deliberately**: `.bs-title__actions` is `flex-wrap: wrap` with `.bs-title__action` at `max-width: 640px` (`:672-673`), so a third cell can wrap to a second visual line while the focus model still calls it row 0 and Right appears to move the ring *downward*. `npm run test:tv` cannot see this.

### What it says, in every state

| State | What the viewer sees |
|---|---|
| `play`, not pressed | **"Ask for 4K"** — a request, never a result. The screen fetches `getDetail(id, { withQualities: false })`, so `available_qualities` is `[]` here and it **cannot know whether a 2160p release exists**; answering that would cost the cold provider search this screen exists to avoid, and would be health-blind anyway, so "2160p exists" still would not be "2160p will be chosen". |
| `play`, pressed | `aria-pressed="true"`, plus a note on the cell: **"Not tested on this television. 4K may not play."** `.bs-title__note` inside the flex-column `.bs-title__action` already exists to hold it. This is the only pre-press truth available, and it is about decode risk, not availability. |
| anything but `play` | **Absent.** Not disabled. |
| **no 2160p release exists** | The press 404s with task 6's `withheld` detail → **"Only 4K sources exist in HD for this title yet."** Wait — precisely: the `withheld` 404 fires when *only* 2160p exists and 4K was **not** asked. When 4K **was** asked and no 2160p release exists, there is no refusal at all: the ranked list simply contains no 2160p candidate and the server downgrades, which is why the arrival disclosure below is mandatory. |
| **4K asked, HD arrived** | The watch route says so once on arrival, from `status.quality`. **Without this the defect cannot even be detected, let alone disclosed** — and `unresolvedEpisode` exists as its own `TitleAction` kind solely because "playing something other than what was asked for, without a word, is the same defect class as a control whose label lies." A 4K press answered with 1080p and no word is that defect, and because health outranks the bucket it is the **common** path. |
| **the panel refuses it** | The player's `decode` verdict, which `_player/classify.ts:27-30` already records as honest rather than a guess *precisely because* HEVC and DTS at 1080p are unverified — now naming the bucket: "this 4K file". |
| device-rejected, nothing playable | 404 with the `incapable` detail → **"No sources found for this title yet."** via `reasonFor`'s existing branch, which the detail is worded to keep matching. |

### Does the choice persist? No.

It is the current press, held as component state, and **nothing is stored.**

- `covers()` compares **identity fields only** (`title.ts:133-140`), so for a movie any covering row makes `play` unreachable — the cell is correctly absent on the second visit, and a remembered "4K: on" would sit beside a control that cannot honour it. Making `covers()` quality-aware would mint a second multi-gigabyte download per press on a box capped at two.
- **`users.default_quality` is explicitly not reused.** Confirmed live: the ORM column (`users.py:85`), both Pydantic shapes (`models.py:525`,`:546`), served by `api/auth.py:183` and `api/users.py:83`/`:102`, and user-editable on the web settings screen. **No download path honours it**, so wiring it would retroactively change behaviour for anyone who set 2160p months ago. Spec decision 9 says per title.

### How it composes with the decode verdict

Three layers, each the honest statement available at that moment, and the only one that is a *promise* is the last: a **request** before the press ("Ask for 4K", plus the untested caveat); the **truth about what arrived** on the watch route, from a field the row already carries on every poll; and the **decode verdict** when the recovery ladder exhausts while HEAD still says 200, now naming the bucket. Nothing in that chain claims the panel will play a 4K file, because nothing in this repo knows that yet.

### Show screen: deliberately not done, with both mechanisms

An episode request is often satisfied by a **season pack**, so a per-episode 4K flag asks for a 2160p *season* — tens of gigabytes on a Pi capped at two concurrent downloads — and a pack already on disk makes the flag inert for every other episode of that season. Plus the two hard-coded `setFocus({row:0,col:0})` calls. §7.3 says "per title" and does not say what a title is for a series. Recorded as a follow-up with both reasons, not as an oversight.

**Proved by** per-**transition** focus tests, because `journeys.test.tsx:907-921` checks one-ring-per-screen only in each screen's *initial* state, so a mid-life count drift ships green: profile present/absent; `play → preparing` after a press **with the ring on the 4K cell**, asserting exactly one rendered cell holds the ring and `document.activeElement` is not `<body>`; `blocked → play` after a recheck. Extend the existing Right/Left table (`page.test.tsx:332-344`) and the one-cell no-profile case (`:464-473`).

**Mutations:** declare the cell in `rowCounts` while rendering it conditionally → the one-ring row reddens at the `preparing` transition ("a count one too high parks the ring on a cell no element claims, which looks identical to nothing being focused"); insert at col 1 instead of appending → the "DOM focus stayed put" row reddens; delete the rescue → the unmount-while-focused row reddens; hard-code the rescue to col 0 → the "ring lands on the last cell, not Play" row reddens; render for every kind → the forbidden-no-op row reddens; **have the toggle flip local state without reaching `requestTitle`'s argument → the "press the toggle, then Play, sends `quality: '2160p'`" row reddens, with `aria-pressed` the only other thing that changed** — the mutation that proves the cell is wired rather than decorative.

---

## 6. What must be settled on the television

The stage-7 sheet has exactly **fifteen** numbered rows (confirmed). Stage 8's are numbered **16 onward** so the numbering is globally continuous and unique — but they live in a **new sheet**, `docs/superpowers/plans/2026-10-11-tv-stage8-device-readings.md`, cross-linked both ways. Not appended into the stage-7 file: that sheet's verdict is a *stage-7* verdict gated on its rows 1–3 and is still **NOT REACHED**, and mixing stage-8 rows in would let one verdict answer for two stages and an untaken stage-7 gate be masked by a taken stage-8 reading.

Four reading rules inherited verbatim: a verbatim string or the words "not taken"; **a blank is a failure, not a pass**; transcribe the raw string, never "ok", "works" or "as expected"; measurement versus assumption called out per row. Every cell pre-filled "not taken".

| # | Reading | Gating | Instrument | Promotes / demotes |
|---|---|---|---|---|
| **16** | HEVC Main 8-bit at 1080p direct-plays | **YES** | diag clip 1 | Confirms **R9**. Failure **inverts** it: HEVC becomes a reject at every resolution and the 4K opt-in is withdrawn. |
| 17 | HEVC Main10 at 1080p direct-plays | no | diag clip 2 | Confirms R9's 10-bit half. A different decoder profile from Main; §7.2 names both in one breath. |
| **18** | DTS at 1080p — **and whether a failure is a silent-but-playing picture or a hard `MediaError`** | **YES** | diag clip 3 + the operator's audio answer | Promotes **R3** from `shadow` to `in_force` (silence) or to **reject** (hard failure). The second half is the half that decides it and **no document in this repo currently asks it**. |
| 19 | DTS-HD MA and TrueHD at 1080p | no | real file | Promotes or retires **R4**. |
| 20 | AV1 at 1080p | no | real file | Retires or re-justifies **R6**, whose own scope excludes this panel. |
| 21 | A Dolby Vision MKV — or **"no sample in this library"** recorded as such | no | real file | Retires or confirms **R5**. |
| 22 | A `.mp4` and a `.ts` from the library play | no | real files | **R7**'s premise. Only `.mkv` is measured, and `settings.video_extensions` admits thirteen containers outside the allow-list. *Standalone* — tied to no rule's `settled_by`. |
| **23** | One genuine 2160p HEVC release plays **end to end off a still-downloading torrent** | **YES** | real release, tens of GB, ARM cap of two | Gates the 4K opt-in's "done" claim and nothing else. The one row no clip can fake, and the only test of the Pi-throughput risk that was lowered on a single 1080p observation. |
| 24 | DTS or TrueHD at 2160p | no | real release | Confirms **R2** — the only AV reject, documentation-only today. |
| 25 | Sustained bitrate of a 2160p title that plays versus one that stalls, **stating which it measured** | no | real releases | Reinstates **R10**. The row must say it cannot separate decoder refusal from Pi throughput. |
| 26 | Model SKU and verbatim `navigator.userAgent` | no | `/bigscreen/diag` | *Standalone.* Untranscribed since stage 3, and the only facts that could ever justify re-deriving from the webOS 25 table. |

Plus **two edits to the stage-7 sheet**: its assumptions table says "a real HEVC file" and "a real DTS file" in prose; both become pointers to rows **16** and **18**. A "what would settle it" cell containing prose is how an assumption becomes a fact one document later.

### Mergeable without the set

Tasks 1–9 in full: the parser, the corpus and its confusion counts, the capability module and its integrity tests, the ordering and the absent-profile guarantee, the wire, the 4K cell, and the disclosure. Task 10's instrument ships too. What is **not** claimable: that HEVC decodes, that DTS at 1080p plays, that a 2160p release streams off a partial torrent, or that the profile is *correct about files* rather than about titles.

**One sequencing constraint on the sitting, which no other document states:** nothing in stages 4, 6 or 7 has run on this television and stage 7's three gates are untaken — gate 1 raising the live possibility that playback has only ever been observed with `AUTH_ENABLED=false`. So a failed row 16 could be an HEVC fact *or* a player fact. **Take stage 7's rows 1–3 first.** And a reading taken through the main web app, as the 2026-10-07 sitting was, measures nothing about selection: the web app sends no profile.

---

## 7. The hazard list

### The four rules-engine vacuity traps, each with its named countermeasure

1. **A penalty invisible because another sort term dominates it.** `-seeds` is a near-unique integer, so a cost placed after it is never consulted and a weight mutation cannot discriminate at all. **Countermeasure:** the stable second sort places capability between health and bucket by construction, not by weight; every cost fixture holds health, bucket, seeds **and** bytes equal; the mutation "drop the capability element and rely on stability alone" must redden. Two *separate* position mutations with two *separate* fixtures, because one position error is invisible to the other's fixture.
2. **A reject tested only in isolation and never through the real ranking.** A `_rejects(candidate)` helper that returns True proves nothing about what gets downloaded. **Countermeasure:** every reject is asserted through `apply_profile`'s output order **and** at the endpoint on `client.state.added[-1].magnet` — what is proved is which multi-gigabyte file was actually started. Plus characterisation tests for the three paths a reject cannot reach (magnet, raw hits, cron).
3. **A fixture that satisfies a rule for the wrong reason.** Already in the tree: `test_parse_quality_4k_and_uhd_map_to_2160p` uses `4K.UHD` and `UHD 2160p`, where both tokens agree, so it pins nothing about the mixed case in either direction. **Countermeasure:** every rule's table row is a **pair differing in exactly one token**; every reordering fixture asserts the pre-profile order in the same function and the penalised candidate must be the one that would **otherwise win**; `test_every_rule_is_observable` reddens for a row whose effect is already implied by another.
4. **A corpus that only proves the regex matches itself.** **Countermeasure:** hand labels written once, never regenerated; the minimum-row-count test that **fails** (not skips) when the file is absent; label coverage; flip-a-label and loosen-a-pattern mutations.

### Design hazards

5. **`capability_cost` below health** means a rejected *healthy* release loses to an acceptable *dead* one, so `candidates[0]` can be a 0-seed swarm and the viewer sits on "Preparing… 0%" with nothing on that screen but Back. The `/download` refusal covers only the all-rejected case, so the mostly-dead-plus-one-rejected-healthy distribution is live. Recorded in code with its reasoning.
6. **The 60 Mbps gap.** With 4K opted in there is no ceiling; the only cover is R2 rejecting DTS-HD/TrueHD, which catches most UHD remuxes **for entirely the wrong reason**. A DD+ 4K remux at 80 Mbps passes every rule.
7. **Four guessed rules reorder from day one** (R3 and R4 are shadowed; R5, R6, R7 are not). §7.2's only contemplated movement is penalty→reject, so the only retirement path is a reading that may never be taken, and a visible `device_reasons` string nobody reads is not a retirement mechanism.
8. **Shadow mode is unfalsifiable in the retiring direction.** A shadow R3 never reorders, so no release it would have demoted playing correctly can disprove it. It can only be promoted by row 18 or carried forever. Accepted for R3/R4 only, because their reading is specified; refused for R6 because §11.2 requires a real AV1 penalty.
9. **A title names tracks, not the track that plays.** Unfixable in this stage, and both directions cost: rejecting on DTS discards playable files; accepting on DD accepts files whose default track is DTS.
10. **Parsing the film's own title as metadata is already live.** `Web.of.Lies.S01.1080p.BluRay.x264` parses `source='WEB-DL'`; `Cam.2018…WEB-DL` parses `source='CAM'`. Any new field inherits the class — a film titled *Opus* would parse as Opus audio. On the television a false reject is **completely silent**: the viewer presses Play and nothing happens.
11. **`parse_quality`'s UHD bug is contained, not fixed.** Rules key on `facts.resolution`, so the misfire is gone; the selector still buckets `1080p.UHD` as 2160p, so it stays the first downgrade target and still shows as a 2160p pill on the desktop. Characterised with a named follow-up.
12. **A pydantic silent drop is the quietest possible failure.** `TorrentRequest` declares no `model_config` (confirmed), so without `extra='forbid'` a misspelled or early-shipped `client` yields a 200 with unprofiled ranking — which looks exactly like success. The Literal catches a bad value; only the forbid catches a bad key.
13. **`TorrentCandidate`'s TS mirror has no drift guard** (`frontend/src/types/index.ts:139-149`), so the two new fields can diverge from the client that renders them.
14. **A leak into the shared axios client would pass every guard.** One instance serves both surfaces, and `legacy-target.test.ts:467` explicitly pins `@/services/*` as allowed on the TV, so `npm run test:tv` would not notice. The eleven untouched web payload assertions are the only detector.
15. **Nothing persists which release the profile chose.** `Torrent` has no release-title column and `meta_data` holds five display fields, so an on-set session cannot answer "what did it pick and why" from the database. Row 23 transcribes it by hand off `/streaming/{id}/info`'s `video_file.name`. The cheap future fix — `meta_data` is a JSON column every writer merges in place, so a `profile`/`release_title` key needs no DDL — is deliberately out of scope, because an unread field is an unproved one.
16. **No post-metadata container gate.** `_block_torrent` calls `session.remove_torrent`, sets a terminal `blocked` state with no unblock path, and `safe_rmtree`s the partial download, with no column recording which client asked — so a television-only verdict would **delete a file the web player streams fine**, for every surface. Not reused.
17. **Three verification instruments run nowhere.** `npm run test:tv` is in no build and no CI, `next build` happens inside the Docker image build where a test failure must not break an image, and every mutation here is manual. **One green run proves nothing** — this project's standing note records a 24% flake passing eight agents and 20+ tests found that could not fail. Loop the suites.
18. **New test files and the corpus are invisible until `make build`** or the explicit `-v "$(pwd)/backend/tests:/opt/freeflix/tests"` mount, because the dev override mounts `backend/app` and `serve.py` only.
19. **The sitting is the schedule risk, and it is not code.** Row 23 needs a real 2160p release (tens of GB, ARM cap of two) and row 21 may have no sample in the library at all — in which case it records "no sample", not a blank.

---

## 8. Open decisions for the user

Three only. Everything else is called above.

1. **Shadow mode for DTS at 1080p — confirm or veto.** R3 and R4 match and are reported but do not reorder until row 18 is taken. The cost of shadowing: until then, a 1080p DTS release is chosen exactly as it is today, so a viewer may hit a silent film that an active penalty would have avoided. The cost of not shadowing: a guess reorders the library now, with no retirement path but a reading. **My call is shadow**, because row 18 is cheap (diag clip 3) and the failure mode it guards against is recoverable by pressing Stop. Say so if you would rather the penalty bite immediately.

2. **Is the 4K opt-in allowed to pick a release the profile merely *costs*, or only one it fully prefers?** As specified, yes — only R1 and R2 refuse, so a 4K press can land a penalised AV1 or Dolby Vision 2160p release. The alternative (4K requires tier A or B) would make the opt-in return nothing on most titles, since HEVC+DD+ is the only combination §3.2's Ultra HD table and this profile both like. **My call is to allow it**, with the untested caveat on the cell. This is a risk-appetite question, not a repo fact.

3. **Do you have, or can you make, the four diag clips and a genuine 2160p HEVC release?** Rows 16, 17, 18 and 20 depend on clips produced off-device with ffmpeg; row 23 depends on a real multi-gigabyte 2160p HEVC release existing in the library. If neither is available, tasks 1–9 and the instrument still merge, but the stage's "done" claim stays withheld indefinitely and R9 (HEVC admitted) carries an unmeasured decode into stage 9. Tell me if that changes whether the 4K cell should ship at all in this stage.