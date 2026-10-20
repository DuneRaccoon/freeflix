# Smart TV app (LG webOS) — design

Freeflix becomes installable on the household's LG TV. The TV surface is a new **`/bigscreen`** route
group inside the existing Next.js app, driven by a remote; the
"app" on the TV is a five-file webOS shell that hands off to it. A new **device-pairing** flow gets a
session onto the TV without anyone typing a password on a D-pad.

Target device: a 75-inch 2022 LG, measured as **webOS 25 = Chromium 120**.

*(Corrected during implementation — this spec originally targeted Chromium 87 throughout, inferred
from the panel size: no 75-inch 2022 LG OLED exists, so the set had to be one of the mainstream LCD
lines (QNED / UQ / NanoCell) that LG's "Re:New" upgrade programme skipped, therefore webOS 22,
therefore Chromium 87. The stage-3 gate disproved it. The diagnostics page at `/bigscreen/diag`,
opened in the TV's own browser, reported `Chromium 120 — modern target` with every post-87 feature
probe answering yes — `oklch()`, `color-mix()`, `:has()`, container queries and `@property`
included. The set is the one upgrade-eligible exception §3.1 itself named: a 75-inch QNED99 8K. The
inference was sound and the conclusion was wrong. Every place this document argued from Chromium 87
is corrected below and marked; the **performance** constraints are untouched, because a newer engine
does not make a 2022 TV GPU faster.)*

Status: design locked 2026-09-22; engine target corrected 2026-10-06 after the on-TV gate; playback
half of the gate run 2026-10-07. Stage 3 is complete — full record in
`docs/superpowers/plans/2026-09-22-webos-tv-stage3-results.md`.
Branch `feat/webos-tv-app` (merged).

Naming note: `docs/superpowers/specs/2026-06-16-tv-support-design.md` is about **television shows**,
not televisions. This document is the only one about the device.

---

## 1. Context & problem

Freeflix today is a pointer-first web app served by Next.js to a desktop browser. Watching in the
living room means getting a laptop out. The goal is a launcher tile on the LG TV that opens a
10-foot UI, browses the same catalog, starts a title that is not downloaded yet, plays it, and shares
continue-watching with the web client.

Three things make this more than "add a stylesheet":

1. **The existing UI is a pointer-first, GPU-hungry design, and the TV is neither.** *(Corrected
   during implementation — this point originally read "the web engine is frozen at Chromium 87",
   because Tailwind v4 requires Chrome 111+ and wraps its output in `@layer`, which Chromium 87
   would discard wholesale, leaving an unstyled page. The set turned out to be Chromium 120, so
   Tailwind v4 **would** render on it.)* What survives is the reason that was always load-bearing:
   every interaction is hover- and pointer-driven, nothing is reachable by a D-pad, and the
   atmosphere and player layers spend the whole frame budget on blur (§9). A 2022 television's GPU
   cannot afford them at any engine version.
2. **Auth has no door a remote can open.** The session is an HttpOnly, SameSite=Lax, same-origin
   cookie with no bearer-token path anywhere; the owner is password-only and members are
   magic-link-only. Neither credential is enterable on a D-pad, and the cookie expires absolutely at
   30 days with no refresh.
3. **The byte path has never met a TV media pipeline.** Four defects in the range handling are
   invisible to Chrome and immediately fatal on a TV (§4.2). *(Updated after the 2026-10-07 playback
   run — it has now met one, and survived: a 1080p H.264 MKV with a DDP5.1 track direct-played off a
   torrent that was still downloading at ~26%, with scrubbing inside the downloaded region. The one
   part of the byte path still unmet by a TV is a **range request past the download point** — the
   `503` + `Retry-After` response of §7.4 has unit tests and has never been observed from the set.)*

---

## 2. Locked decisions

| # | Decision |
| --- | --- |
| 1 | **Approach A: `/bigscreen` route group in the existing Next app + a thin webOS shell.** Not a standalone packaged app (fights Next static export on four fronts, forces bearer auth, re-sideload per UI change) and not a piggyback on Jellyfin/DLNA (loses Freeflix's UI, `content_id` progress and in-progress-torrent streaming). |
| 2 | **The shell hands off with `location.replace`**, LG's documented hosted-app pattern — not jellyfin-webos's cross-origin iframe. After handoff the origin is a normal `http://<host>:3001`, so the `/api/*` rewrite proxy, the session cookie and `<video>` credentials all work untouched. |
| 3 | **Two root layouts.** Existing routes move into `app/(web)/`, the TV surface lives in `app/(bigscreen)/`. URLs do not change. This is the only way to stop the global Tailwind v4 stylesheet — and with it the web design system's blur stacks, hover rails and atmosphere layer — reaching the TV. *(Corrected during implementation — originally justified as the only way to stop an `@layer` stylesheet Chromium 87 could not parse. The engine reads as 120, so Tailwind would render; the decision stands on the performance budget of §9 and on 10-foot layout + remote focus being different work, which it always did.)* |
| 4 | **The TV stylesheet is hand-authored plain CSS** in `public/bigscreen.css`, linked so it bypasses PostCSS entirely, reusing the FRÈ hex tokens as ordinary custom properties. Not a second Tailwind major in the repo. Bypassing PostCSS is what keeps Tailwind and the web design system off this surface; it is not an engine workaround. |
| 5 | **Device pairing (RFC 8628-shaped), not typed credentials.** TV shows a short code + QR; an already-signed-in phone approves; the TV's next poll receives `Set-Cookie`. |
| 6 | **Device sessions slide; browser sessions stay absolute.** `touch_session` extends `expires_at` only when `device_kind` is set. Existing browser behaviour is unchanged. |
| 7 | **No transcoding, no remuxing, no HLS.** The host is a Raspberry Pi. Progressive HTTP with byte ranges is the only transport. |
| 8 | **Codec-aware torrent selection via a named client profile** (`client=lg-webos22-floor`). The capability table lives server-side; the TV sends a profile name, not a matrix. *(Named in stage 8, 2026-10-11. The device is webOS **25** but the rules are a function of LG's webOS **22** AV table, so the name carries the table's provenance and the posture rather than the device's version: `lg` the vendor, `webos22` the table the rules are derived from, `-floor` that it is a deliberate floor. The engine was upgraded by software; the decoder silicon is 2022 — so the 22 table is the **safer** derivation for this set, not merely a conservative one. A later measured profile is a new id, never a quiet edit to this one. See §7.2.)* |
| 9 | **TV defaults to 1080p; 2160p is opt-in per title.** 4K is where LG's audio restrictions bite, where the 60 Mbps HEVC ceiling sits, and where a Pi feeding a partial torrent is likeliest to stall. |
| 10 | **Fast-forward/rewind and speed control are removed on TV**, because the webOS pipeline does not support them. Discrete ±10s/±60s jumps replace them. |
| 11 | **Subtitles v1 is sidecar-only**, with acknowledged partial coverage. Embedded MKV tracks stay out of reach. |
| 12 | **Install channel: Developer Mode, with a documented browser-bookmark fallback.** Dev Mode uninstalls the app when its session lapses; the same URL in the TV browser never expires. |
| 13 | **Scope is "watch + request".** Browse, search, continue-watching, start an undownloaded title, play, switch profile. No admin surfaces on TV. |

---

## 3. Platform facts (outside the repo, verified)

These were researched and then independently fact-checked; four initial claims were corrected in the
process. Everything below is what survived.

### 3.1 Engine version — inferred as 87, measured as 120

| webOS TV | Year | Engine | UA fragment | |
| --- | --- | --- | --- | --- |
| 6.x | 2021 | Chromium 79 | `Chrome/79.0.3945.79` | |
| 22 | 2022 | Chromium 87 | `Chrome/87.0.4280.88` | *(originally assumed)* |
| 23 | 2023 | Chromium 94 | `Chrome/94.0.4606.128` | |
| 24 | 2024 | Chromium 108 | `Chrome/108.0.5359.211` | |
| **25** | **2025** | **Chromium 120** | `Chrome/120.0.6099.270` | ← **this set** |

Source: <https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine>.
The platform token in the UA is `Web0S` with a **digit zero**; app UAs end in `WebAppManager`.

**The inference, recorded because it was wrong in an instructive way.** LG's "Re:New" upgrade
programme covered the 2022 OLED lineup plus the 2022 **QNED Mini LED 8K (QNED99/95)** — not the
mainstream 2022 QNED/NanoCell/UQ LCD lines. Since there is no 75-inch 2022 OLED (sizes were
42/48/55/65/77/83/97), a 75-inch 2022 LG is an LCD. The one upgrade-eligible exception at that size
is a 75-inch QNED99 8K. This spec concluded "almost certainly webOS 22 = Chromium 87" and told the
implementation to **build for Chromium 87 and treat anything newer as a bonus, never as a plan**.

*(Corrected after the stage-3 gate.* The exception is the set. `navigator.userAgent` read on the
television reports **Chromium 120 = webOS 25**, and the diagnostics page's feature probes all answer
yes: `oklch()`, `color-mix()`, `:has()`, container queries, `@property`, and the JS entries below.
So the engine is **not** the hard constraint this section claimed; the frame budget of §9 is. The
constructs listed as unavailable — `@layer` (99), `:has()` (105), container queries (105),
`color-mix()` / `oklch()` / `oklab()` (111), `@property` (111 for full support), CSS nesting (112),
and in JS `Array.prototype.at` (92), `Object.hasOwn` (93), `structuredClone` (98), top-level `await`
(89) — are all available and no longer forbidden. The method below was right, and is the only reason
the mistake was caught before stage 4.*)

**Verify before writing CSS; do not infer the engine from the model.** Settings → Support → TV
Information shows *firmware only*, never the engine. The authoritative read is `navigator.userAgent`:
either point the TV's built-in browser at a UA echo page on the LAN (`/bigscreen/diag` is now that
page), or sideload a throwaway app and use `ares-inspect --device myTV --app <id> --open`.

### 3.2 Media support is better than desktop Chrome, with sharp edges

Source: <https://webostv.developer.lge.com/develop/specifications/video-audio-220> and
<https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm>.

- `.mkv` is a **supported container**, carrying MPEG-2, MPEG-4, H.264, VP8, VP9, HEVC and AV1.
  HEVC 4K is `3840x2160@60P Main/Main10@L5.1, maximum 60 Mbps`, Ultra HD models only.
- **A stricter Ultra HD table applies at 3840x2160**: only `.mkv/.mp4/.ts`, only H.264/HEVC video,
  and only **Dolby Digital / Dolby Digital Plus / AAC** audio. So **DTS, DTS-HD MA, TrueHD and Atmos
  are out of spec at 4K**, even though DTS appears in the generic `.mkv` row. Dolby Vision Profile 8
  in MKV is a known direct-play failure.
- Protocols: **HTTP/HTTPS progressive and HLS (v7) only.** No DASH. MSE and EME are present on
  webOS 22. The docs state that unmentioned formats "are not supported or not recommended".
- **`Seek: Supported`. `Fast Forward & Reverse: Not supported`. `Playback speed other than 1.0: Not
  supported.`** These are platform limits, not app choices.
- Known defect: `jellyfin/jellyfin-webos#355` — if an MKV's first `SeekHead` does not itself name
  `Cues`, LG's player behaves as though the file had no index. Reproduced on webOS 4.10.2, **not**
  confirmed on 22. It bites files whose headers were edited in place (mkvpropedit), less so files
  muxed once by mkvmerge. The field fix is a server-side HLS remux, which is unavailable here.
  *(Updated after the 2026-10-07 run — one once-muxed 1080p H.264 MKV (`-FLUX`) direct-played and
  scrubbed on this set with no symptom. That is the less-affected case the paragraph above predicts,
  so the defect is **not** disproven in general — it is simply not blocking this library's typical
  release.)*
- Seeking into a not-yet-downloaded region is generic HTTP-range behaviour, not a webOS quirk. No
  LG source addresses it. *(Still true, and still **unmeasured on the TV** as of 2026-10-07 — §11.5
  and §12.)*

### 3.3 The app format, and the `file://` origin trap

Source: <https://webostv.developer.lge.com/develop/references/appinfo-json>,
<https://webostv.developer.lge.com/develop/getting-started/web-app-types>.

- `appinfo.json` `main` **must be a relative path to a local HTML file** — it can never be a URL.
  This is the mechanical reason hosted webOS apps exist at all.
- A **hosted** app is a local dummy app whose `index.html` navigates to remote content by meta
  refresh or `location.href`. LG documents it as a first-class type and ships
  `ares-generate -t hosted_webapp`.
- Inside a **packaged** app the document origin is a `file://`-scheme opaque origin. Consequences:
  `<script type="module">` is CORS-blocked; `Origin: null` means credentialed CORS is structurally
  impossible; `document.cookie` is unusable.
- **But webOS does not enforce same-origin against local apps.** `jellyfin-webos` sets
  `contentFrame.src` to a remote server and then reads `contentFrame.contentDocument` to inject
  `window.AppInfo` — which standard Chromium forbids. This is shipping, store-approved code. So an
  iframe shell *is* viable; we simply do not need it, because `location.replace` escapes the
  `file://` origin entirely (decision 2).
- Useful fields: `id` (reverse-DNS, lowercase; `com.palm`/`com.webos`/`com.lge` prefixes forbidden),
  `title`, `icon` (80×80), `largeIcon` (130×130), `splashBackground` (1920×1080),
  `resolution` (`1920x1080`), `disableBackHistoryAPI`, `handlesRelaunch`, `version` (X.Y.Z).
  `bgColor`/`bgImage` are webOS 1.x–2.x only — dead weight here. There is **no permissions field**
  for third-party web apps; LAN access needs nothing declared.

### 3.4 Toolchain

`@webosose/ares-cli` is **deprecated**. Current install is `npm install -g @webos-tools/cli`
(<https://webostv.developer.lge.com/develop/tools/cli-installation>). Most tutorials are stale on
this point.

```
ares-setup-device --add myTV -i "host=<tv-ip>" -i "port=9922" -i "username=prisoner"
ares-launch -H ./webos -d myTV        # hosts from the Mac, no packaging — the inner loop
ares-package --no-minify ./webos      # only to pin a build
ares-install --device myTV ./com.freeflix.tv_0.1.0_all.ipk
ares-launch --device myTV com.freeflix.tv
ares-inspect --device myTV --app com.freeflix.tv --open
```

### 3.5 Developer Mode expiry

Source: <https://webostv.developer.lge.com/develop/getting-started/developer-mode-app>,
<https://www.webosbrew.org/devmode/>.

LG documents: "After Developer Mode is disabled, the installed apps that you were using on Developer
Mode are uninstalled." Disabled on session expiry, and **after the TV reboots ten times while not
connected to a network**. LG states no hour figure; webosbrew documents 1000 hours (~41 days) and the
current Dev Mode app shows "999h". Per LG staff, signing the same developer account into another TV
also revokes the first. An older widely-cited "50 hours" figure is from 2022 and predates the app
update that raised the session — it is stale.

Rooting is not a realistic escape: RootMyTV never worked on sets that shipped with webOS 22, and
faultmanager-autoroot states webOS 5+ firmware is "almost all patched".

**Therefore: the browser-bookmark fallback is part of the deliverable, not an afterthought.**

---

## 4. Non-negotiable constraints discovered in the codebase

Violating any of these silently breaks something.

### 4.1 Nothing in the frontend can be reused as-is above the service layer

| Layer | Verdict |
| --- | --- |
| `services/*.ts`, `lib/*`, `utils/*`, `types/index.ts` | **Reuse verbatim.** Thin typed axios wrappers and pure logic, ~85 colocated tests. |
| `context/*` (Session, User, Progress, Watchlist) | **Reuse with small edits.** Backend-backed; exactly one localStorage key between them (`currentUserId`). `ThemeContext` is a 30-line no-op stub. |
| Rails (`Row`, `RankedRow`, `FeaturedRail`, `ContinueWatchingRow`, `CastRow`) | **Rebuild.** Mouse-wheel `overflow-x-auto` carousels with `focus:outline-none` on the focusable container and arrow *buttons* that are `max-sm:hidden`. |
| `PosterCard` | **Rebuild.** Four focus stops per tile (poster link + Play + My List + Info); the outer `<article onClick>` has no `tabIndex` and no key handler. |
| App shell (`TopNav`, `BottomTabBar`) | **Rebuild.** `TopNav` reacts to `window.scrollY` and its nav links are `md:+` only; `BottomTabBar` is `md:hidden`. Neither is TV chrome. |
| `VideoPlayer.tsx` (1809 lines) | **Rebuild the control surface, keep the stall/recovery logic.** |

`scrollIntoView` appears **zero times** in the repo. Nothing ever calls `.focus()`, so a remote does
nothing until something is focused by accident.

### 4.2 Four range-handling defects that a TV hits and Chrome does not

`backend/app/api/streaming.py:62-64` is
`ranges = range_header.replace('bytes=','').split('-')`.

1. **Suffix ranges are silently wrong.** `Range: bytes=-500` ("the last 500 bytes", which media
   pipelines issue to locate a container index at EOF) parses to `start=0, end=500` and returns **the
   first 501 bytes with a 206 claiming `bytes 0-500/size`**. Wrong data handed to a decoder, no error.
2. **Multipart ranges 500.** `bytes=0-99,200-299` → `int('99,200')` raises inside the `try` at `:118`,
   caught at `:170-172`, returned as a **JSON 500** which `<video>` feeds to the decoder as corrupt
   media. Any non-numeric range does the same. Both must be **ignored** (200, full body) — see §7.1.
3. **HEAD is answered with 405.** *(Corrected during implementation — an earlier draft of this
   spec said a HEAD probe ran the GET handler and could block for 300s. It does not.* Starlette's
   `Route.__init__` does call `self.methods.add("HEAD")`, but FastAPI's `APIRoute.__init__`
   overrides it entirely — it never calls `super().__init__()` and sets
   `self.methods = {method.upper() for method in methods}` directly. Verified against the pinned
   fastapi 0.104.1 / starlette 0.27.0.*) So `HEAD /{id}/video` matches no route's method and falls
   through to a bare **405**. Milder than the original claim, but still wrong for the target: a TV
   media pipeline that probes with HEAD before GET gets a refusal instead of the size and type it
   asked for, and may not fall back.
4. **The 300s cap truncates below `Content-Length`.** `stream_file_range`
   (`torrent/manager.py:1778`) `return`s after a hard `cap = 300.0` — the cap at `:1864`, the
   `return` at `:1876` — having already promised the full length.
   *(Citation re-resolved 2026-10-20, stage 9 task 16: the range this bullet used to cite had
   drifted out of the function entirely. The defect is unchanged and still live — the
   `piece_timeout` parameter that would replace the flat 300 s is never passed by any production
   caller.)*

Related: `.m4v`, `.ts`, `.m2ts`, `.mts`, `.vob`, `.3gp`, `.mpg`, `.mpeg` have no entry in
`VIDEO_MIME_TYPES` and fall through to `mimetypes.guess_type()` on the container's Python 3.10 —
anything it does not know becomes `application/octet-stream`, which most media stacks refuse. And
`parse_range_header` returns 416 whenever `file_size <= 0`, reachable for a torrent whose metadata
has arrived but whose file is not allocated.

### 4.3 Codec is parsed and then ignored

`providers/quality.py:35` (`_CODEC`) compiles `x265|h.265|hevc|x264|h.264|av1|xvid`, but `parse_release_info` is
**display metadata only**. `services/torrents_select.py:rank_candidates` sorts on resolution bucket,
seeds and bytes and never reads `codec`. So today the selector will hand a 75-inch panel a 2160p HEVC
10-bit release with a DTS-HD track — exactly the combination §3.2 says webOS refuses at 4K. The player
never calls `canPlayType()` and surfaces no codec-specific error.

### 4.4 Subtitles do not exist, and sidecars are actively excluded

**As found, 2026-09-22 — and all nine terms were still zero at the stage-8 merge, re-measured.**
Zero occurrences of `.srt`, `.vtt`, `\.ass\b`, `.ssa`, `<track>`, `TextTrack`, `WebVTT`,
`text/vtt` or `::cue` in `backend/app` or `frontend/src`. **Anchor the `.ass` term as
`\.ass\b`** or the grep is not an instrument: the naive spelling returned **20** in-scope hits at
that merge and every one was a false positive (15 `.assign`, 3 `.asset`, 2 `.assets`). The
`subtitle` prop on `VideoPlayer` is a cosmetic text line and the web CC button is permanently
`aria-disabled` — both still true after stage 9, which declined the web half (stage 10). Stage 9
put every one of the nine terms into the tree deliberately, so the grep is no longer zero: the
naive `.ass` spelling now answers **58** lines, of which **35** are real `\.ass\b` occurrences and
23 are still `.assign`/`.asset`/`.assets`.

**Two file-priority selectors zero every non-video file, and this section used to cite neither.**
The citation that stood here resolved into `get_completed_video_file_info`'s docstring and named
no selector at all. The gated one is `skip_non_video_files` (`torrent/manager.py:1629-1644`,
which builds the vector at `:1637-1640` and applies it at `:1642`), run once on
`metadata_received` and only behind `settings.content_guard_enabled` (`:704-709`). The ungated one
is `prioritize_video_files` (`torrent/manager.py:1646`, which appends a `0` for every non-video
file at `:1695-1697` and applies the vector at `:1701`), which nothing gates and which
`api/streaming.py:280` re-applies on every stream setup. So `.srt` sidecars are never downloaded
by default — and **stage 9 changed neither selector**: it admits a sidecar's PIECES on demand and
leaves the file priority at 0 (plan D1; `backend/tests/test_skip_non_video.py:31` survives that
stage unmodified). Every line number in this paragraph was read on `feat/tv-stage9-subtitles` at
`4ec439a`.

### 4.5 The silent-401 contract is already broken

`require_session_silent` answers an expired session on the stream with a bare empty 401
(the `bare_401` handler, `main.py:205-208` — re-resolved 2026-10-20 on
`feat/tv-stage9-subtitles`; the `:188-191` that stood here was stale, and at the stage-8 merge
the handler was at `:193-196`) on the stated grounds that "the player's error handler checks the status
explicitly". **It does not.** `VideoPlayer.tsx:1032-1059` reads only `video.error?.code`; grep for
`401` under the player and streaming directories returns nothing. An empty 401 surfaces as
`MediaError` 2 or 4, which `:1035` routes into `attemptRecovery()` whenever `downloadProgress < 100`,
and both `PatchedVideoPlayer` and the page swallow "network error"/"buffering" strings during an
active download. Result: an expired session on a downloading title is an endless silent retry.

### 4.6 Auth and transport facts

- Cookie: `ff_session`, `httponly=True`, `samesite="lax"`, `secure=settings.cookie_secure`
  (**default False**), `path="/"`, **no Domain**; `max_age` 30 days
  (`cookie_kwargs`, `services/auth.py:485-503`; `max_age` at `api/auth.py:133-136`; `config.py:67-69`).
- `create_session` sets an **absolute** `expires_at`; `touch_session` slides only `last_seen_at`.
  No refresh, no rotation, no re-issue endpoint.
- `dependencies/auth.py:91-93` reads the cookie and **nothing else** — there is no `Authorization`
  path anywhere in the backend.
- `cors_origins` defaults to `["http://localhost:3001", "http://localhost:3000"]` with
  `allow_credentials=True`; `*` is deliberately unavailable. Starlette does exact string matching.
- **CORS middleware ordering hazard:** `error_handling_middleware` is installed at position 0, i.e.
  *outside* `CORSMiddleware`, so its `JSONResponse(500)` carries no `Access-Control-Allow-Origin`.
  A cross-origin client sees every 500 as an opaque network failure. Decision 2 avoids this entirely.
- No discovery, no pairing, no device concept exists. `AuthToken.purpose` has exactly four values.
  `AuthSession` has `user_agent` but no device columns and no per-device revoke.
- Tokens must never appear in a URL **path**: `middleware/error_handler.py:30` logs
  `request.method` + `request.url.path` to stdout and to a 7-day file in the persisted `logs` volume.
  Query strings and bodies are not logged.
- An auth dependency must **never** declare `Depends(get_db)`; it opens its own session with
  `with get_db() as db:`. Endpoints use `Annotated[Session, Depends(get_db)]` + `with db as session:`
  entered exactly once. `api/schedules.py` gets this wrong today — do not copy it.
- A new table is created by `create_all` **only if imported in
  `app/database/models/__init__.py`**. New nullable columns are added by `sync_columns` on startup.
- The rate limiter is in-process and single-worker (`serve.py` pins `workers=1`), keyed on normalised
  email, never IP.

### 4.7 Deployment reality

No TLS, reverse proxy or tunnel exists anywhere in the repo. Prod compose publishes `8000:8000`
(backend) and `3001:3000` (frontend); `COOKIE_SECURE` defaults `false`. `BACKEND_INTERNAL_URL` is a
**build ARG** (`frontend/Dockerfile:18-20`) because `next build` bakes rewrite destinations into
`routes-manifest.json`. A LAN device reaches the app at `http://<host>:3001`. Host is a Raspberry Pi;
`main.py` caps active downloads to 2 on ARM.

### 4.8 The FRÈ redesign is not a collision risk

`feat/fre-frontend-redesign` is **fully merged into master** (0 unmerged commits). The Editorial-Noir
token set lives in `frontend/src/app/(web)/globals.css:8-28` as **plain hex** (moved there by stage 2), which is why the
hand-authored TV stylesheet can reuse the values directly without resolving Tailwind's `@theme`.
Source-level modern CSS is modest — 9 `color-mix()` in 4 files, 3 `:has()` in 1 file, 0 `oklch`,
0 `@property`, 0 `@layer`. The 85 `color-mix()` / 83 `oklab()` / 65 `@property` / 4 `@layer` in the
built CSS are **emitted by Tailwind v4 itself**. *(Corrected during implementation — this paragraph
read "which is why a Chromium-87 stylesheet can reuse it directly". The engine is Chromium 120
(§3.1), so none of these counts is a compatibility problem any more. Plain hex is still what lets
`public/bigscreen.css` stay outside PostCSS, which is what keeps Tailwind off the TV.)*

---

## 5. Architecture

### 5.1 Route groups

```
frontend/src/app/
  (web)/              <- every existing route moves here, unchanged URLs
    layout.tsx        <- today's root layout; imports globals.css
    page.tsx  movies/  tv/  search/  streaming/  settings/  ...
    link/             <- NEW: the pairing approval screen (phone/laptop)
  (bigscreen)/
    layout.tsx        <- own <html>/<body>; <link rel="stylesheet" href="/bigscreen.css">
    bigscreen/
      page.tsx              home
      diag/page.tsx         diagnostics — the stage-3 instrument, kept as a permanent
                            field tool because a TV has no devtools without Dev Mode
      pair/page.tsx         pairing
      profiles/page.tsx     who's watching
      search/page.tsx       grid keyboard + results
      movie/[id]/page.tsx   detail
      show/[id]/page.tsx    detail + season/episode picker
      watch/[id]/page.tsx   player
      list/page.tsx         my list
```

`(bigscreen)/error.tsx` is the surface's error boundary: on a device with no console an uncaught
render error is otherwise a blank screen.

A route group alone does not escape `app/layout.tsx`; two **root** layouts require that no
`app/layout.tsx` exists and every route sits in a group. The alternative — branching the root layout
on pathname — needs `headers()`, which would force dynamic rendering for the entire app.

Root `not-found.tsx` and `loading.tsx` move with `(web)`.

### 5.2 The webOS shell

```
webos/
  appinfo.json
  index.html          one classic <script>; NO type="module" (CORS-blocked under file://)
  icon.png            80x80
  largeIcon.png       130x130
  splash.png          1920x1080
```

`appinfo.json`:

```json
{
  "id": "com.freeflix.tv",
  "version": "0.1.0",
  "vendor": "Freeflix",
  "type": "web",
  "main": "index.html",
  "title": "Freeflix",
  "icon": "icon.png",
  "largeIcon": "largeIcon.png",
  "splashBackground": "splash.png",
  "resolution": "1920x1080",
  "disableBackHistoryAPI": true,
  "handlesRelaunch": true
}
```

`index.html` logic, in order:

1. Read `serverUrl` from `localStorage`. If absent, render a local D-pad setup screen (octet fields
   + OK) and store it. **The address is never baked into the IPK** — a changed Pi IP must not mean
   repackaging.
2. `fetch(serverUrl + '/health')` with a short timeout.
3. On success: `location.replace(serverUrl + '/bigscreen?from=app')`.
4. On failure: render a local "Can't reach Freeflix" card with the stored address and a Retry /
   Change-address choice — not a raw Chromium error page.

After step 3 the local shell is gone. That is intended: the origin becomes a normal http origin, so
cookies, the `/api/*` proxy and fullscreen video behave, and the Next app serves its own back-key
handling. `?from=app` tells the bigscreen layout it is inside the TV app, so it binds keyCode **461**
and exits with `window.close()` at the root screen instead of navigating.

Operational requirement: a **DHCP reservation** for the Pi.

### 5.3 CSS and build target

- `public/bigscreen.css`, hand-authored, linked with `<link>` from `(bigscreen)/layout.tsx` so it
  never enters PostCSS. Tokens copied from `globals.css:8-28` as plain custom properties.
- Permitted: everything Chromium 120 parses, which is everything we would reach for — custom
  properties, flexbox, CSS grid, `transform`, `opacity`, `transition`, `position: sticky`,
  `object-fit`, media queries, and also `aspect-ratio`, `:has()`, `@container`, `oklch()`,
  `color-mix()`, `@property` and native nesting.
- **Forbidden, on performance grounds only:** `backdrop-filter`, `mix-blend-mode` /
  `background-blend-mode`, `filter: blur()`, SVG filters (`feTurbulence`, `feGaussianBlur`,
  `filter: url()`). These are banned by the frame budget of §9, not by the engine: the 2022 panel's
  compositor cannot afford a per-frame readback-and-blur, least of all over a decoding 1080p surface.
  A newer engine does not change this, so **do not delete these because "Chromium 120 supports it"**.
- No framer-motion, no `globals.css`, no `@/components` import inside `(bigscreen)`. Same rationale:
  keep the pointer-first web tree and its blur stacks off TV silicon.
- A lint-style guard (a test that greps the bigscreen tree for the forbidden list) is cheaper than
  remembering: `frontend/src/app/(bigscreen)/legacy-target.test.ts`, run by `npm run test:tv`.
- *(Corrected after the stage-3 gate — this section forbade `@layer`, `@property`, `oklch()`,
  `oklab()`, `color-mix()`, `:has()`, `@container`, native nesting and `aspect-ratio`, and had
  `frontend/package.json` gain `"browserslist": ["chrome 87"]` to downlevel SWC output app-wide
  "for a few KB on the web bundle". The engine is Chromium 120 (§3.1), so those nine bans were
  obsolete and the browserslist pin was paying a measured app-wide cost — `/downloads` 4.45 → 8.71 kB,
  `/members` 4.55 → 8.8 kB, `/streaming/[id]` 20.2 → 24.6 kB — for nothing. The pin is reverted and
  the engine-driven bans are dropped; the performance-driven ones above are kept and are now
  commented in the guard with their reason, so the next engine reassessment does not take them with
  it.)*

---

## 6. Device pairing

### 6.1 Flow

| Step | Actor | Call |
| --- | --- | --- |
| 1 | TV | `POST /api/v1/auth/device/start` (public, no body) |
| 2 | TV | display `user_code` + QR to `http://<host>:3001/link?code=…` |
| 3 | TV | poll `POST /api/v1/auth/device/poll` `{device_code}` |
| 4 | Phone | open `/link`, see device name + code, Approve |
| 5 | Phone | `POST /api/v1/auth/device/approve` `{user_code, device_name}` (session required) |
| 6 | TV | next poll returns `Set-Cookie: ff_session=…`; pairing row consumed |

`POST /auth/device/start` returns
`{ device_code, user_code, verification_uri, expires_in: 600, interval: 2 }`.

- `device_code`: `secrets.token_urlsafe(32)`, **sha256-only at rest**, returned in a JSON body and
  never placed in a URL path (§4.6).
- `user_code`: 8 characters from `BCDFGHJKLMNPQRSTVWXZ23456789` — vowel-free so it cannot spell
  anything, and free of `0/O/1/I` so it cannot be misread off a couch. Rendered `XXXX-XXXX`.

### 6.2 Why this is safe

The secret that receives the session is the `device_code`; it never leaves the TV. The `user_code` is
only an index into a pending request — guessing one lets an attacker approve *someone else's* TV,
which requires them to already hold a valid account and gains them nothing. The genuine risk in any
device grant is social engineering: persuading a signed-in user to approve a device that is not
theirs. Mitigations: the approve screen names the device and shows the code to compare, the TTL is
10 minutes, and `approve` gets a wrong-code budget per account mirroring the global wrong-code budget
`/claim` already uses (`instance.py:63-65`).

**The two entrances are untouched.** All three enforcement points (§13 of
`2026-09-18-instance-claim-design.md`) stand unmodified, and `_bad_credentials()` is not touched.
Pairing is a third way for an existing, already-authenticated account to place a session on a device
it owns. It cannot create accounts, cannot bypass owner-password or member-magic-link, and mints a
session only for `approved_account_id`, whose `STATUS_ACTIVE` is re-checked at poll time.

### 6.3 Schema

New table `auth_device_pairings` (**must be imported in
`app/database/models/__init__.py`** or `create_all` skips it):

| Column | Notes |
| --- | --- |
| `id` | PK |
| `device_code_hash` | sha256, unique |
| `user_code` | indexed. Uniqueness among live rows is enforced in application code (generate, check, retry on collision) — a partial unique index is not expressible through `sync_indexes` |
| `status` | `pending` / `approved` / `denied` / `consumed` |
| `device_name` | set by the approver |
| `approved_account_id` | nullable FK → `accounts.id` |
| `created_at`, `expires_at`, `consumed_at` | 10-minute TTL |
| `poll_count`, `approve_attempts` | abuse counters |

New nullable columns on `auth_sessions` (added by `sync_columns`): `device_name`, `device_kind`.

### 6.4 Sliding device sessions

`touch_session` extends `expires_at` **only when `device_kind` is not NULL**; device sessions get
`device_session_ttl_days` (default 180). Browser sessions keep today's absolute 30-day expiry with no
refresh. The asymmetry is deliberate — it is a behaviour change, and it applies only where wanted.

### 6.5 Revocation

- `GET /api/v1/auth/devices` → the caller's sessions with `device_name`, `device_kind`,
  `last_seen_at`, `created_at`.
- `DELETE /api/v1/auth/devices/{session_id}` → revoke one.

Today only self-signout and account-wide revoke exist. A living-room TV that cannot be revoked
independently is a liability.

### 6.6 Client-side consequences

- `api-client.ts:64-71` `handleUnauthorized` hard-navigates to `/signin?next=…`. It must branch: a
  pathname under `/bigscreen` goes to `/bigscreen/pair`.
- `PUBLIC_PATH_PREFIXES` gains `/bigscreen/pair`.
- The TV player must distinguish **401 → re-pair** from **still buffering** (§4.5), which means the
  stream request has to be probed for status rather than inferred from `MediaError`.

---

## 7. Playback

### 7.1 Backend fixes (prerequisites)

1. `parse_range_header` handles suffix ranges (`bytes=-N`) correctly.
2. Multipart and malformed ranges are **ignored** — 200 with the full body, never 500 and not
   416. RFC 7233 §3.1 requires an invalid `Range` to be ignored, and §4.4 reserves 416 for a range
   that is *unsatisfiable*; a 416 here invites a client to give up rather than retry with a single
   range. (Corrected during planning — an earlier draft of this spec said 416.)
3. `HEAD` on the video route returns headers only — full-file `Content-Length`, `Content-Type`,
   `Accept-Ranges`, empty body — instead of 405. It must do no `Range` parsing, no piece waiting,
   no `prioritize_video_files` and no `force_start_for_stream`, and it must be registered **above**
   the GET route so it cannot be shadowed if FastAPI's method handling ever changes.
4. The dead-swarm path returns a definite error rather than truncating below a promised
   `Content-Length`. (`await_pieces_async` and `_adaptive_piece_timeout` already exist and are tested
   but are not wired into `stream_file_range` — wiring them is the natural fix.)
5. `VIDEO_MIME_TYPES` gains explicit entries for `.m4v`, `.ts`, `.m2ts`, `.mts`, `.vob`, `.3gp`,
   `.mpg`, `.mpeg` so nothing degrades to `application/octet-stream`.

### 7.2 Codec-aware selection

`/torrents/sources` and `/torrents/download` accept `client=<profile>`. The only profile is
`lg-webos22-floor`, implemented in `backend/app/services/capability.py`; the client sends a name
and nothing else.

**Three states, because a table of rules that all look enforced is a table that lies.** Every rule
below carries one, and the words mean exactly this:

- **IN FORCE** — the rule matches, is reported, and **changes the order**. A reject is never
  auto-chosen; a cost sinks a candidate within its health group.
- **SHADOW** — the rule matches and is **reported**, and **reorders nothing**. It ships inert on
  purpose, with a named reading that promotes it. `evaluate` returns every rule that matched
  *including* the shadowed ones with their state, so a rule that deliberately changes nothing is
  still observable rather than invisible.
- **NOT IMPLEMENTED** — the predicate and the plumbing exist, the row exists, and **there is no
  input**. Its effect is NONE and its reason is non-empty. It is a row rather than a paragraph so
  that a `grep` which hits it cannot be misread as an enforced ceiling.

Only two rules may REJECT, and their bases are `product` and `lg-table` — the two provenances
strong enough to refuse a file. `lg-doc`, `inferred` and `guess` may cost only; `no-input` forces
NONE. That ceiling-per-basis is asserted by the module's own integrity tests.

| # | Rule | Condition | State | Effect | Basis | Settled by |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | `withheld-2160p` | a 2160p candidate when the ask is **not** 2160p | **IN FORCE** | **reject** (`withheld`) | `product` (§7.3, decision 9) | n/a — it is the opt-in, not an AV claim |
| R2 | `dts-family-at-2160p` | DTS / DTS-HD MA / TrueHD **carrier** on a 2160p candidate | **IN FORCE** | **reject** (`incapable`) | `lg-table` (§3.2 Ultra HD) | reading **24** |
| R3 | `dts-at-1080p` | a DTS track at 1080p | **SHADOW** | cost | `guess` | reading **18** |
| R4 | `dtshd-truehd-at-1080p` | DTS-HD MA / TrueHD at 1080p | **SHADOW** | cost, own weight | `guess` | reading **19** |
| R5 | `dolby-vision` | a Dolby Vision token (`DV`, `DoVi`, `Dolby.Vision`) | **IN FORCE** | cost | `lg-doc` | reading **21** |
| R6 | `av1` | an AV1 video token | **IN FORCE** | cost | `inferred` | reading **20** |
| R7 | `container-proxy-xvid-divx` | a positively identified `xvid`/`divx` token | **IN FORCE** | cost, **strictly larger** than R3-R6 | `inferred` | reading **22** |
| R8 | `preferred-measured` | `h264` + any of `{ac3, eac3, aac}` | **IN FORCE** | bonus, tier **A** | `measured` + `lg-table` | n/a |
| R9 | `documented-ok` | `hevc` 8/10-bit + `{ac3, eac3, aac}` | **IN FORCE** | bonus, tier **B**, strictly below A | `lg-table`, decode **unmeasured** | readings **16, 17, 23** |
| R10 | `hevc-2160p-over-60mbps` | HEVC 2160p above 60 Mbps | **NOT IMPLEMENTED** | **NONE**, with a reason | `no-input` | reading **25** |

**R10 is NOT IMPLEMENTED, and the reason is structural rather than an omission.** §3.2's HEVC 4K
row is `maximum 60 Mbps`, and the estimate the old table described — bytes ÷ runtime — **has no
runtime at the decision point**. `rank_candidates` receives `List[TorrentHit]`, which carries
`bytes` and no duration; `resolve_title_year`'s cache-hit branch reads `CatalogItemCache`, which
has no runtime column; `catalog_items.detail_json` does hold `MovieDetail.runtime`, but
`set_detail` is skipped when `with_qualities=False` — the mode the TV's own detail load uses — and
`services/tv.py` never calls it at all, so TV rows have no `detail_json` ever. On top of that, a
season pack's `bytes` cover N episodes while the only runtime available is one episode's,
`bytes == 0` is a real value the selector already distrusts, and minutes-read-as-seconds is a 60x
error in the **rejecting** direction. The row therefore ships with
`effect=NONE, basis='no-input'` and the reason *"bytes ÷ runtime: no runtime reaches the selector;
see row 25"*, and a test injects a non-`None` bitrate to prove the rule **fires** — the predicate
is complete and only the input is absent. **Reading 25 reinstates it**
(`docs/superpowers/plans/2026-10-11-tv-stage8-device-readings.md`), and the one-line follow-up that
supplies the input is written down in that row. Until then, **with 4K opted in there is no bitrate
ceiling**: a DD+ 4K remux at 80 Mbps passes every rule here, and the only cover is R2 catching most
UHD remuxes for entirely the wrong reason.

**R2 rejects the carrier, not the word "Atmos" — a deliberate deviation from LG's own wording.**
The earlier version of this table said "DTS / DTS-HD / TrueHD / **Atmos** audio at 2160p", which
reads a marketing name as a codec. Atmos is metadata that rides **on** a carrier: on **E-AC3**
(streaming), which §3.2's Ultra HD table explicitly **permits** at 4K, or on **TrueHD** (disc),
which it **forbids**. So a literal reading of the old row would reject a perfectly legal
`DDP5.1.Atmos` 2160p release while a `TrueHD.Atmos` release and a bare `TrueHD` release — which
fail for the same reason — were treated as two different rules. The profile therefore vetoes the
**carrier** and records `atmos` as a flag beside it, never as a codec of its own.

**The two DTS-at-1080p rules ship in SHADOW (R3, R4): they match, they are reported, they reorder
nothing.** This cell used to say "penalty, not reject … promote to reject if it fails", which
understated the problem: the rule's basis is a `guess`. The generic `.mkv` row lists DTS, but LG
dropped DTS decode on some model years and **which years is unverified**. Shipping the penalty
would reorder the whole library on that guess with no retirement path; shipping nothing would lose
the rule. Shadow keeps it visible and inert, and **reading 18 is one diag clip** — so the
retirement path is cheap and real. Promotion is a one-cell edit to `state`. **Reading 18 also asks
the question that decides which way it goes, and no other document in this repo asks it:** whether
a DTS failure on this set is a **silent-but-playing picture** or a hard `MediaError`. Silence
promotes R3 to IN FORCE; a hard failure argues for a reject, which also requires upgrading its
basis out of `guess`. And R3 and R4 are **two rules, not one**, because this section says only
"DTS" at 1080p while §3.2 lumps four codecs at 2160p, and nothing states which the 1080p rule
covers — one merged rule would silently decide that question.

The capability table lives server-side; the client sends only a profile name. **`canPlayType()` is
not used, and may not be:** TV implementations under-report, so a `""` from it is not evidence of
anything. `/bigscreen/diag`'s codec section prints one `canPlayType` row per clip, labelled
ADVISORY, and a test asserts that it **gates nothing** — the clip mounts whatever the row says.

*(Name corrected in stage 8 — **`lg-webos22-floor`, and the `22` is the table's provenance, not a
device match.** Three facts in one identifier: vendor and platform family (`lg`), the AV table the
rules are a function of (LG's webOS **22**, §3.2), and the posture (`-floor`). The earlier note
here argued that the rules were merely "over-conservative" because the set measured as webOS 25,
two platform versions newer, and that a re-derivation from the newer table was the natural fix.
**That rationale is withdrawn, and replaced by the silicon argument.** The engine was upgraded by
software; **the decoder silicon is 2022.** `legacy-target.test.ts:21-24` already states the
principle for CSS — a newer browser engine does not make a TV GPU faster — and CLAUDE.md repeats
it. LG's webOS 25 AV table describes 2025 model-year hardware; applying it to a Re:New-upgraded
2022 panel would claim decoders this panel may never have had. **So the webOS 22 table is the
*safer* derivation for this specific set, not merely a conservative one** — and nobody on this
project has read LG's webOS 25 AV table in any form, while "webOS 25" is itself an inference from
the measured Chromium 120 through §3.1's mapping, with the model SKU and the verbatim user agent
both still untranscribed (reading **26**). Not `webos25`, then, and not bare `webos22`, which reads
as a device match. A later **measured** profile is a new id (`lg-qned99-measured`), never a quiet
edit to this one's rules. What the stage-3 gate did **not** settle is unchanged: HEVC decode is
accepted on documentation (reading **16**), and DTS at 1080p is untested (reading **18**) — which is
why one ships as a tier-B bonus and the other ships in shadow.)*

### 7.3 Quality policy

TV requests **1080p** by default. The detail screen offers a per-title "4K" choice, which switches the
profile to allow 2160p. Rationale in decision 9.

### 7.4 Seeking

- No fast-forward/rewind, no speed control (§3.2). Left/Right give ±10s; the remote's Rewind and
  Fast-Forward buttons are rebound to ±60s **jumps** (not continuous scan, which the platform does
  not support); the scrub bar commits on OK.
- `/streaming/{id}/info` gains a **contiguous-available-bytes** figure (and derived seekable seconds)
  from data `torrent_manager` already holds.
- The TV scrub bar draws that boundary and **refuses to seek past it**. Prevention over a better error
  message: today a forward seek past the downloaded region holds the socket open silently for up to
  300s and a TV simply times out with a generic failure.
- **The TV player must honour the `503` + `Retry-After` the stream endpoint now returns when the
  first chunk is not yet available.** Stage 1 made that failure retryable; nothing retries it yet.
  Nothing in the frontend keys on `503` today, and the existing recovery path classifies by
  `MediaError.code`, not HTTP status — so without this the 503 degrades into the same opaque
  playback failure it was introduced to replace. This is a stage-7 requirement, surfaced by the
  stage-1 review.

### 7.5 Subtitles (v1, sidecar only)

- **Sidecar priority — stage 9 deliberately did NOT do what this bullet asked, and the mechanism
  is the reason.** The bullet said to stop zeroing priority for `.srt`/`.ass`/`.ssa`/`.vtt`
  sidecars. Two selectors zero them and **neither changed**. The gated one is
  `skip_non_video_files` (`torrent/manager.py:1629-1644`), which runs behind
  `settings.content_guard_enabled`. The ungated one is `prioritize_video_files`
  (`torrent/manager.py:1646`), which `api/streaming.py:280` re-applies on every stream setup.
  Measured: a **file**-level admission is undone the next time the ungated
  selector runs, and it takes `_prioritize_window`'s raised playhead window with it, while a
  **piece**-level one survives. So a sidecar is admitted at piece level on demand, and once its
  span is held one `file_priority(idx, 1)` flushes the bytes out of libtorrent 2.0's
  `.<infohash>.parts` file into the save path before the priority goes back to 0. Plan **D1** and
  correction **C1** of `docs/superpowers/plans/2026-10-20-tv-stage9-subtitles.md`.
- **The cost is pieces, not "(kilobytes)"** — that word was wrong by orders of magnitude and is
  replaced here by the arithmetic. The marginal cost of admitting one sidecar is
  `extra_pieces × piece_length`: measured **0** extra pieces on an unpadded v1 torrent and **one
  whole piece per sidecar** on a pad-aligned one (libtorrent 2.0's own `create_torrent` pads by
  default, as does qBittorrent, and every v2/hybrid torrent must). A 20-language `Subs/` tree at
  an 8 MiB piece is `20 × 8 MiB` = **160 MiB** of pieces for ~600 KB of text, and ~1.6 GiB needs
  ~200 sidecars — a 20-language × ~10-episode season pack. `subtitle_admit_max_pieces` (4) bounds
  the span of **one** admission, not the total.
- `GET /api/v1/streaming/{id}/subtitles` lists sidecars (language from an exact filename-token
  match, never a substring) in an **envelope** carrying `coverage` and `source`, never a bare
  array, and takes an optional **`?file_index=N`** so that a season pack answers for the episode
  on screen. `coverage` has exactly three values — `listed`, `none`, `unknown` — and `none`
  covers both "this release ships no sidecar" and "every sidecar was excluded".
- `POST /api/v1/streaming/{id}/subtitles/{index}/fetch` admits that sidecar's pieces and answers
  **202** immediately. It is the only mutating route in the stage.
- `GET /api/v1/streaming/{id}/subtitles/{index}` serves **WebVTT** (`text/vtt; charset=utf-8`,
  hard-coded), converting from SRT on the fly (pure-Python, no ffmpeg). It refuses rather than
  emits: `503` while bytes are missing, `415 {"reason": ...}` for a refusal waiting cannot fix.
- **`.ass`/`.ssa` are listed and never converted.** They ship as a visible row with
  `convertible: false` and the picker says the format out loud; the VTT route answers
  `415 {"reason": "unsupported-format"}` for such a row **unconditionally**, from the format
  alone, before the file is ever opened.
- The TV player renders them with a native `<track>` — exactly one, enabled by `default`.
- **Acknowledged gaps**, and there are four. (1) Embedded MKV subtitle tracks are unreachable
  because nothing demuxes the container, and many releases ship embedded-only. (2) **Bigger than
  that one, and this spec did not mention it: nothing already in the library gets subtitles,
  ever.** Admission needs a live handle; `_refresh_active_torrents` evicts a `finished` torrent
  mid-session and `find_loadable_on_startup` never re-adds it, and an evicted torrent's file list
  is not enumerable at all because every resume blob this application writes carries no `info`
  dict (the stage-7 `save_info_dict` follow-up). So `coverage: "unknown"` and the television reads
  `Subtitles · unavailable` — permanently, for every title downloaded before this stage. (3) A
  cue may sit **behind the transport band** for the ~5 s it is up: `.bs-player__bar` is
  `position: relative` with no `z-index` and paints above both `z-index: -1` layers. Stage 9 fades
  the scrim with the band, which clears the state the feature lives in, and ships no fix for the
  band itself — reading **29b** of
  `docs/superpowers/plans/2026-10-20-tv-stage9-device-readings.md` scopes that, and it is stage
  10's. (4) A sidecar that is neither UTF-8 nor cp1252 is **refused, not served**, with
  `SUBTITLE_ENCODING` as the owner's override: mojibake is invisible as a fault and visible as
  nonsense for two hours.
- **"ASS/SSA styling is dropped to plain text" is DECLINED, with grounds — not merely contradicted
  by §13.** Shipping it means a `Format:`-line parser written from recalled grammar with no `.ass`
  file anywhere in this repository to test against, whose measured failure mode is stacked
  overlapping junk over the picture and whose worst outcome is a 200 whose body is `WEBVTT\n\n` —
  which a `<track>` reports as a **successful load with no event at all**. A bad ASS converter is
  strictly worse than none, because its failure is unobservable. Reading **37** (what this
  household's releases actually carry) decides whether it is worth a stage-10 task.

### 7.6 Player element

`preload="metadata"`, not `"auto"` — the current setting invites the TV to buffer a multi-GB file.
Keep the stall detection, `attemptRecovery` backoff ladder and health logic from `VideoPlayer.tsx`;
replace the control surface entirely.

---

## 8. Navigation & focus

### 8.1 Focus library

~~`@noriginmedia/norigin-spatial-navigation`~~ **Decided during stage 4: hand-rolled, and the
library was rejected on its merits rather than on compatibility.**

*(This row read: "`@noriginmedia/norigin-spatial-navigation` — hooks-based, in production on
webOS/Tizen/Vizio. **Its React 19 peer range is unverified and is task one.** Fallback: a
hand-rolled roving-tabindex manager (~150 lines), genuinely viable because we own every component
on this surface."*

**The compatibility question was answered and it is a non-issue**: version 3.3.0 declares
`react: ">=16.8.0"` (on its `-react` sub-package rather than the installed meta-package), which
React 19.0.0 satisfies with no peer conflict. So the "task one" spike was unnecessary and the §12
risk row below is void.

**It lost on three design facts instead**, each read out of its `dist/index.mjs`:

1. It installs its **own `window` keydown listener and calls `preventDefault` + `stopPropagation`
   on every arrow and Enter** unless `shouldUseNativeEvents: true`. §8.3 requires the opposite:
   arrows must seek only when the transport bar holds focus, and must not be claimed globally.
   Opting out of its event handling leaves us handling events ourselves, which is the thing the
   dependency was supposed to provide.
2. Without `shouldFocusDOMNode: true` it **never moves real DOM focus** — it tracks focus in its own
   store. Every focus style on this surface is a CSS `:focus` selector, and `bigscreen.css` calls
   the ring "the whole navigation model on a remote". Its default mode silently turns that off.
3. It has **no concept of a Back key**, so webOS `461` needs a hand-written `window` listener
   whatever else is used.

A strict rail grid also does not need geometric nearest-neighbour search. Explicit row and column
indices are more predictable, and they are what make the load-bearing rule expressible: **vertical
movement skips any row with zero focusable items**, because every catalog call in this codebase is
`.catch(() => emptyPage)` and a still-loading or empty rail is the normal case. Landing focus on a
skeleton is unrecoverable on a device with no Tab key and no pointer.

The implementation is `(bigscreen)/_focus/` — a pure model plus a `useFocusGrid` hook — built in
`docs/superpowers/plans/2026-10-09-tv-stage4-navigation.md`.

### 8.2 Rules

- **One focus stop per card.** OK opens the detail screen; Play / My List live there. Today a
  20-item rail is ~80 D-pad presses.
- **`scrollIntoView({ block: 'nearest', inline: 'center' })` on every focus change.** Zero calls
  exist today.
- **A visible focus ring** — 4px gold outline plus a modest scale. Never `focus:outline-none`.
- **Something is focused on mount**, always.
- Vertical moves between rails, horizontal within a rail. Focus memory per rail so returning from a
  detail screen lands where you left.

### 8.3 Player controls

- No window-level `preventDefault` on arrows. Arrows seek only when the transport bar holds focus;
  otherwise they move between controls. (Today `VideoPlayer.tsx:642-745` claims all four arrows
  globally and the scrubber adds a second overlapping handler.)
- Controls reveal on **any** keypress; auto-hide after ~5s; never `pointer-events-none` while a
  descendant has focus.
- Back (461): collapse controls → leave player → exit app.
- Removed: volume slider (the TV owns volume), fullscreen (already fullscreen), PiP, speed.
- The resume prompt is rebuilt — `ui/fre/Modal.tsx` traps Tab and closes on Escape, neither of which
  a remote has.

### 8.4 Text entry

An on-screen grid keyboard for search, modelled on `shell/PasscodePrompt.tsx` (a 3×3 button keypad,
already remote-friendly). The Magic Remote's gyro cursor does fire real mouse events, so hover-based
UI half-works — a trap. Build for the D-pad; treat the pointer as a bonus.

### 8.5 Layout

1920×1080 CSS pixels regardless of panel resolution. Safe-area inset **96px horizontal, 54px
vertical** (5%); no interactive element or text outside it. Body text ≥24px, titles 40–56px, focus
targets ≥60px tall.

*(Added during stage 4, because "body text ≥24px" turned out to be under-specified the first time
a real card was styled, and **restated once more after the first version of this amendment
contradicted the stylesheet it was written to govern**.* The useful distinction is not two tiers
but three, by **how** a viewer takes the text in:

| Tier | Floor | What belongs | Shipped |
| --- | --- | --- | --- |
| **Read** — prose a viewer parses to decide | **≥ 24px** | a card's title, a hero's overview, any sentence | `.bs-card__label` 24px, `.bs-hero__overview` 24px |
| **Glanced** — a short token recognised by shape and position, not read word by word | **≥ 20px** | a year, a short status pill ("Up next"), an episode label | `.bs-card__sub` 22px, `.bs-card__badge` 20px |
| **Decorative** — carries no information the screen does not carry elsewhere | **≥ 20px** | the uppercase letter-spaced eyebrow over a rail, whose 40px title holds the meaning | `.bs-rail__eyebrow` 20px |

A card's **title takes the Read floor**: it is the name of the thing being chosen, from ten feet.
A year and a pill do **not** — which an earlier draft of this paragraph got exactly backwards by
saying they "do not qualify", a reading that would have required 24px for both and which nothing
in the implementation ever followed. They are decision *information* (a year is how a viewer tells
two films of the same name apart; the pill changes what pressing OK does), and that is why stage 4
moved them **up**, from 20px and 18px. But they are four characters in a fixed position, not prose:
a viewer recognises them without reading them. Hence 20px rather than 24px.

When in doubt the test is not "is this small text" but **"does the viewer have to read it, or only
notice it"**.)*

---

## 9. Performance budget

| Item | Today | On TV |
| --- | --- | --- |
| `CinematicAtmosphere` | 3 full-viewport layers: 60vw radial glow with `filter: blur(20px)` on a 42s loop, inset vignette, `feTurbulence` at `mix-blend-mode: overlay` | **Not mounted** |
| Player veils | 8 `backdrop-filter: blur()` layers + a second `feTurbulence` over live video | Solid/gradient scrims only |
| Hero | 40s Ken-Burns transform with `will-change` | Static |
| Animation | framer-motion 12 | CSS transform/opacity only |
| Home requests | 16 catalog calls + 1 TMDB detail per continue-watching card + a 15s `/activity/count` poll | Trimmed; no activity poll |
| Backdrop | TMDB `w1280` full-bleed (~3× upscale on 4K) | `w1920`/original for the hero |
| Off-screen rails | All rendered | Not rendered until near-visible |

---

## 10. Consolidated backend changes

| Area | Change |
| --- | --- |
| `api/streaming.py` | suffix ranges; malformed/multipart ranges ignored rather than 500; 416 for unsatisfiable only; HEAD short-circuit; MIME table additions; available-bytes in `/info`. **Not** the subtitle routes: they went on a new router (next row) |
| `api/subtitles.py` | **new router** (stage 9), mounted under the streaming prefix and behind the same stream gate, so the bodiless 401 is inherited rather than invented: subtitle list envelope, the `fetch` POST, the WebVTT route |
| `torrent/manager.py` | wire `await_pieces_async` / `_adaptive_piece_timeout` into `stream_file_range`; expose contiguous-available bytes; **and *not* "stop zeroing subtitle sidecars"** — two selectors zero them, the gated `skip_non_video_files` and the ungated `prioritize_video_files`, and stage 9 changed **neither** (§4.4 names both sites). What it adds instead is piece-level admission, a flush and a budgeted retraction (§7.5, plan D1) |
| `services/torrents_select.py` | read `codec`; apply a named client capability profile |
| `providers/quality.py` | expose parsed codec/audio to the selector (already parsed, currently display-only) |
| `api/auth.py` | `device/start`, `device/poll`, `device/approve`, `GET/DELETE /devices` |
| `services/auth.py` | pairing issue/consume; `touch_session` slides `expires_at` for device sessions |
| `database/models/accounts.py` | `auth_device_pairings` table; `device_name` + `device_kind` on `auth_sessions` |
| `database/models/__init__.py` | **import the new model** |
| `config.py` | `device_session_ttl_days`; any new `.env` key needs its `Settings` field first (`extra='forbid'`) |

---

## 11. Testing & verification

**This section is a flat numbered list and has no subsections — there is no §11.2.** Citations of
the form "§11.2" or "§11.5(d)", here and in §12, mean **point 2** and **point 5(d)** of the list
below. Noted because two documents have cited a §11.2 that does not exist as a heading.

1. **Backend, pytest, TDD.** Every §7.1 fix gets a failing test first: `bytes=-500` returns the real
   last bytes; `bytes=0-99,200-299` and a malformed range both return 200 with the full body; a
   range starting past EOF returns 416; HEAD returns metadata headers rather than 405
   without entering the generator; a dead swarm returns an error rather than a short body. Note
   `backend/tests` is **not** bind-mounted — new files need `make build` or
   `-v "$(pwd)/backend/tests:/opt/freeflix/tests"`.

   **The SRT→VTT converter is tested here, in pytest, and not in vitest** *(moved from point 4 in
   stage 9: the converter is pure Python in `backend/app/subtitles/`, and point 4 had it filed
   under the frontend suite, where none of it exists)*. And the limit that shapes every one of
   those tests: **no suite in this repository can execute a WebVTT parser.** jsdom 25.0.1 has no
   `TextTrack`, `TextTrackList`, `TextTrackCue` or `VTTCue`, `video.textTracks` is a plain
   zero-length array with a `<track default>` child present, and the backend image has no browser
   binaries (`pyproject.toml` declares playwright; `backend/Dockerfile` never runs
   `playwright install`). So the emitter is the acceptance criterion: every assertion names a cue
   **count** and a cue's **text**, and "200 and the body starts with `WEBVTT`" is forbidden by
   name — a signature-valid zero-cue body loads at `readyState 2` and fires **no event at all**,
   which makes it the one failure the television cannot report. Whether a cue paints is reading
   **27a** of `docs/superpowers/plans/2026-10-20-tv-stage9-device-readings.md`, and it is untaken.
2. **Selector, pytest.** Profile `lg-webos22-floor` rejects 2160p+DTS-HD, prefers 1080p
   H.264+**E-AC3** (and AC3), penalises AV1 — as a table test over synthetic candidates.
   *(AC3 → E-AC3 corrected in stage 8: §11.5(d) asked for AC3 but the 2026-10-07 run delivered
   DDP5.1, i.e. E-AC3, so **plain AC3 is no more measured than HEVC**. "Penalises AV1" is left
   standing deliberately, which is why that rule reorders from day one instead of shadowing.)*
3. **Pairing, pytest.** Happy path; expired code; wrong `user_code` budget; replay of a consumed
   `device_code`; approval by a non-ACTIVE account; that a `login` token cannot be used here and a
   pairing code cannot reach `/auth/verify`.
4. **Frontend, vitest.** Focus manager (roving tabindex, focus memory, `scrollIntoView` called);
   bigscreen reducers; a guard test that greps `(bigscreen)` for the forbidden CSS/JS list.
   *(SRT→VTT conversion moved to point 1 in stage 9 — it is pure Python.)* Note that neither
   `npx vitest run` nor `npm run test:tv` runs in any build or in CI, and `test:tv` is a
   **directory glob** over `src/app/(bigscreen)`, so a guard test placed outside that directory is
   silently absent from it.
5. **The real gate is the TV, and it comes early.** Before any shell work: read `navigator.userAgent`
   off the set, then load `/bigscreen` in the **built-in browser** and confirm (a) the stylesheet
   renders, (b) a real MKV/HEVC file from the library direct-plays, (c) seeking works, including
   into a still-downloading region, (d) an AC3 track outputs audio. This costs twenty minutes, needs
   no LG account, and is the only thing that can invalidate the design.

   **Run, 2026-10-06 — and it did invalidate part of it.** `/bigscreen/diag` in the TV's own browser
   reported `Chromium 120 — modern target`, every feature probe yes, all ten colour tokens distinct,
   remote key codes as expected (the individual codes were *not* transcribed, so **461 for Back is
   still an assumption**). Verdict per the plan's gate: **"Proceed, simplified"** — the design
   survives, the Chromium-87 assumption does not. §3.1, §4.8, §5.3, §12 and §14 are corrected
   accordingly and the `browserslist` pin is reverted.

   **Playback half run, 2026-10-07.** On the TV, through the **main web app**, playing a real
   library title (`The Boys S01E01 … 1080p AMZN WEB-DL DDP5 1 H 264-FLUX.mkv`, `video/x-matroska`)
   while its torrent was **still downloading at ~26%**:

   - **(a) rendering — passed, and better than (a) asked.** Not only does the hand-authored
     stylesheet render; the **existing Tailwind v4 web app renders correctly on the TV**.
   - **(b) MKV direct play — passed.** Matroska demuxed and played natively. This was the single
     biggest unknown: desktop Chrome cannot demux Matroska at all, and §3.2's whole "the TV's
     pipeline is better than the browser's" premise rested on it. **HEVC was not part of (b)'s
     result — the tested file is H.264.** HEVC decode is **not tested** and is carried as an
     accepted documentation-backed risk (§12).
   - **(c) seeking — half passed.** Scrubbing **within already-downloaded regions** works. Seeking
     **past the download point** into a not-yet-downloaded region was **not tested**, and neither
     was the "Probe far seek (HTTP)" readout. The `503` + `Retry-After` path (§7.4) has unit tests
     and has **never been observed from the TV**.
   - **(d) audio — passed, on a better case than AC3.** **DDP5.1 (Dolby Digital Plus / E-AC3)**
     output correctly — a path the library's YTS AAC releases never exercise. **DTS at 1080p
     remains untouched** (§7.2).
   - Also passed, not in the original checklist: **streaming from an in-progress torrent at ~26%**
     — the piece-gated generator, sequential download and HTTP range handling end to end on real
     data.

   Full record, including everything deliberately marked *not tested*:
   `docs/superpowers/plans/2026-09-22-webos-tv-stage3-results.md`.

   **One caveat that reshapes stage 4.** "It works perfectly on the TV" was observed **through the
   Magic Remote, which is a pointer** — §8.4 already called that a trap, and it is. Real mouse
   events mean hover rails and click-to-play overlays behave as on a desktop. It does **not** follow
   that the UI works on the **D-pad**, nor that 24px body text is readable at viewing distance.
   Both remain untested.

---

## 12. Risks & mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| ~~Engine is Chromium 87, not 120~~ **Resolved: the engine is Chromium 120** | — | *(Corrected after the stage-3 gate — this row read "Likelihood: High. Assumed. Design targets 87 throughout." It was backwards: the risk that materialised was the **inference itself**, not the engine. `navigator.userAgent` on the set reads Chromium 120 / webOS 25. The mitigation that actually worked was sequencing the twenty-minute on-TV read before stage 4, so the cost of being wrong was one `browserslist` line and one guard list, not a rebuilt UI. Generalised lesson: when a constraint is inferred from a product SKU rather than measured, treat the measurement as a gate, not a confirmation.)* |
| ~~MKV does not direct-play / MKV seeking hits the `Cues`/`SeekHead` defect~~ **Partly resolved** | — | *(Updated after the 2026-10-07 playback run.* **MKV direct play: retired.** A real 1080p H.264 Matroska file with a DDP5.1 track direct-played on the set, and seeking **within downloaded regions** worked — no `Cues`/`SeekHead` symptom on this file. Note the file was muxed once (`-FLUX`), which §3.2 says is the less-affected case, so the defect is retired for files like this one, not proven absent. **HEVC: not retired, and not measured.** The tested file is H.264. Accepted on documentation by owner decision: LG's AV table lists HEVC Main/Main10 for webOS **22** and this set is webOS **25**, two platform versions newer, so its table is at least as permissive. **That is an accepted risk with a rationale, not a result.** If it fails in the field the lever is torrent selection (§7.2); an HLS remux is unavailable on a Pi.) |
| **Seeking past the download point into a not-yet-downloaded region** | **Unknown — still open** | *(Added after the 2026-10-07 run, which did **not** cover it.* The title under test was at ~26% and the far seek was never attempted, nor was the "Probe far seek (HTTP)" readout taken. The stage-1 first-chunk precheck and the `503` + `Retry-After` response exist and have unit tests, but **have never been observed from the TV**, and a `<video>` element reports only `MediaError.code`, so the status is unobservable there without the probe. Mitigations as designed: the available-bytes seek boundary (§7.4) prevents the seek rather than handling it, and stage 7 must make the player honour the 503. **Settle this with the HTTP probe before stage 7 ships.**) |
| Pi cannot sustain 1080p off a partial torrent to the TV | ~~Medium~~ **Lowered — one successful observation** | *(Updated after the 2026-10-07 run.* 1080p H.264 streamed to the TV **from a torrent still downloading at ~26%**, played and scrubbed. That is one title, one session, no duration or rebuffer count recorded — it is evidence the path works, not a throughput measurement. Mitigations unchanged: 1080p default; available-bytes seek boundary; the ARM cap limiting concurrent downloads to 2.) |
| ~~`norigin-spatial-navigation` rejects React 19~~ **Void — it accepts React 19** | — | *(Settled during stage 4: 3.3.0 declares `react: ">=16.8.0"`, which React 19.0.0 satisfies. The library was still rejected, but for its global arrow `preventDefault`, its need for `shouldFocusDOMNode` to move real focus at all, and its absence of any Back concept — see §8.1. The hand-rolled manager shipped as a deliberate choice, not as a fallback.)* |
| Dev Mode lapses and the tile vanishes | Certain, ~every 41 days | Browser-bookmark fallback is a documented deliverable; renewal routine noted in the README. |
| Subtitle coverage disappoints (embedded-only releases) | High — **and wider than this row said** | Stated up front. Sidecar-only is v1; embedded extraction is out of scope. *(Widened in stage 9, with the four exclusions named so none of them is discovered on the set. (1) **Nothing already in the library gets subtitles, ever** — admission needs a live handle, a `finished` torrent is evicted mid-session and never re-added, and its file list is not enumerable because every resume blob this application writes carries no `info` dict; `coverage: "unknown"` and the cell reads `Subtitles · unavailable`, permanently, for every title downloaded before stage 9. That is the **biggest** coverage limit in the feature, bigger than the embedded-MKV gap this row was written about. (2) **`.ass`/`.ssa` are listed and never converted** — zero captions for anime and most fansub output; declined with grounds in §7.5 rather than contradicted by §13. (3) **A sidecar that is neither UTF-8 nor cp1252 is refused, not served**, with `SUBTITLE_ENCODING` as the owner's one lever: a Cyrillic or Greek library gets nothing until it is set, because mojibake is invisible as a fault and visible as nonsense for the length of a film. (4) **A cue may sit behind the transport band** for the ~5 s it is up, which stage 9 ships unsolved — reading 29b of `docs/superpowers/plans/2026-10-20-tv-stage9-device-readings.md` scopes it and it is stage 10's. How much of this matters is reading **37**: a read-only `list_sidecars` pass over a week of real downloads, and the expectation on today's library is close to zero sidecars.)* |
| Two root layouts regress a web route | Low | Mechanical move; the existing ~85 colocated tests plus a route-by-route smoke pass. |
| A 4K opt-in picks an unplayable release | Low | Profile rules still apply at 2160p; failure is a rejected candidate, not a black screen. |

---

## 13. Out of scope

- Samsung Tizen, Android TV, Fire TV, tvOS. Nothing here transfers; only the web UI would.
- LG Content Store submission.
- Rooting the TV.
- Transcoding, remuxing, HLS or DASH.
- Embedded (in-container) subtitle tracks; PGS image subtitles; ASS/SSA styling.
- Casting (AirPlay/Chromecast/DLNA) as a primary path.
- Admin surfaces on TV: `/members`, `/schedules`, `/settings` system panel, `/downloads` batch actions.
- Adding a `device` account role — a paired TV authenticates as an existing account.
- HTTPS/TLS for the instance. Everything here assumes plain http on the LAN, which is also why
  `COOKIE_SECURE` must stay `false`.
- Offline/PWA behaviour. Plain http is not a secure context, so no service worker.

---

## 14. Implementation sequence

Ordered so the cheapest thing that can invalidate the design happens first.

This is too large for one implementation plan. It becomes **multiple plan documents** under
`docs/superpowers/plans/`, following the convention the FRÈ redesign already used (one file per
phase). Stages 1–3 are the first plan, because stage 3 can invalidate everything after it.

| # | Stage | Why here |
| --- | --- | --- |
| 0 | Read `navigator.userAgent` off the TV; confirm model | One fact, decides the CSS target. **Done 2026-10-06: Chromium 120 / webOS 25**, not the Chromium 87 this spec assumed — see §3.1. In practice stage 0 was folded into stage 3, because `/bigscreen/diag` is what reads the UA. |
| 1 | Backend range/HEAD fixes + MIME table, TDD | Prerequisite for any playback, valuable to the web client too |
| 2 | Two root layouts; empty `/bigscreen` + `bigscreen.css` skeleton | Smallest thing loadable on the TV |
| 3 | **Load it in the TV's built-in browser.** Verify CSS, direct play, seek, AC3 | The gate. Stop and re-plan if this fails. **Complete.** Engine/rendering half run 2026-10-06 → **"Proceed, simplified"**: everything rendered, engine is Chromium 120, so the engine-driven CSS/JS bans and the `browserslist: ["chrome 87"]` pin were dropped. Playback half run 2026-10-07: **MKV direct play, DDP5.1 audio, streaming from a torrent at ~26% and seeking inside downloaded regions all passed**; **seeking past the download point, the far-seek HTTP probe, HEVC decode and DTS-at-1080p were not tested**. Full record: `docs/superpowers/plans/2026-09-22-webos-tv-stage3-results.md`. Stages 4–10 are otherwise unchanged. |
| 4 | Focus manager (+ React 19 check), rails, cards, home | The bulk of the UI. *(Justification narrowed after the stage-3 gate — this stage used to be argued partly from the Chromium-87 CSS problem, i.e. that the web UI could not render on the TV at all. It renders fine. What stage 4 is now for is **D-pad navigation** — the web UI's browse surface has no focus management — it never calls `scrollIntoView` or `.focus()`, and a `PosterCard` has four focus stops — and **10-foot legibility**: type scale, safe-area insets, a visible focus ring. The "it works perfectly on the TV" observation was made through the **Magic Remote, which is a pointer** (§8.4), so it says nothing about either. This is a materially smaller job than this spec originally assumed.)* |
| 5 | Device pairing: backend, `/link`, `/bigscreen/pair` | Unblocks using it without a keyboard. **Complete — merged 2026-10-07 (merge commit `529c44c`, 22 commits, plan `docs/superpowers/plans/2026-10-07-tv-device-pairing.md`), and verified end to end on the television on 2026-10-09: the TV showed the code and QR, the phone scanned and approved, and the approval was reflected back on the TV screen.** One honest limitation shipped with it: `_DEVICE_START_LIMIT` sits on a single global unkeyable bucket (per-IP keying is impossible while `/api/*` is proxied by the Next.js server), so a burst of ~241 starts in 15 minutes still locks every television out of pairing for the window. |
| 6 | Detail screens, season/episode picker, search keyboard, my list | Completes "watch + request" |
| 7 | TV player: controls, 461, seek boundary, 401 handling | Depends on 1 and 5 |
| 8 | Codec-aware selection + `lg-webos22-floor` profile + 4K opt-in | Needs a real player to validate against. **Which AV table the profile is derived from is now settled** — LG's webOS 22 table, named in the profile id, because the engine was upgraded by software while the decoder silicon is 2022 (§7.2). The other two things the stage-3 gate left unmeasured are carried forward and **still unmeasured**: **HEVC decode** (readings 16/17/23) and **DTS at 1080p** (reading 18), which is why the DTS-at-1080p rules ship in SHADOW. Plan: `docs/superpowers/plans/2026-10-11-tv-stage8-codec-profile.md`. |
| 9 | Subtitles: sidecar priority, WebVTT endpoint, `<track>` | Independent; last because coverage is partial |
| 10 | `webos/` shell, IPK, `make tv-install`; README fallback + renewal notes | Cheapest step, deliberately last |
