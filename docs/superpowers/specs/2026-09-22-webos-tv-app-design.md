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
| 8 | **Codec-aware torrent selection via a named client profile** (`client=webos22`). The capability table lives server-side; the TV sends a profile name, not a matrix. *(Corrected after the stage-3 gate — the device is webOS **25**, so the `webos22` name misdescribes the table it is built from; stage 8 re-decides it. See §7.2.)* |
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
   (`torrent/manager.py:1389-1401`) `return`s after a hard `cap = 300.0`, having already promised the
   full length.

Related: `.m4v`, `.ts`, `.m2ts`, `.mts`, `.vob`, `.3gp`, `.mpg`, `.mpeg` have no entry in
`VIDEO_MIME_TYPES` and fall through to `mimetypes.guess_type()` on the container's Python 3.10 —
anything it does not know becomes `application/octet-stream`, which most media stacks refuse. And
`parse_range_header` returns 416 whenever `file_size <= 0`, reachable for a torrent whose metadata
has arrived but whose file is not allocated.

### 4.3 Codec is parsed and then ignored

`providers/quality.py:12` compiles `x265|h.265|hevc|x264|h.264|av1|xvid`, but `parse_release_info` is
**display metadata only**. `services/torrents_select.py:rank_candidates` sorts on resolution bucket,
seeds and bytes and never reads `codec`. So today the selector will hand a 75-inch panel a 2160p HEVC
10-bit release with a DTS-HD track — exactly the combination §3.2 says webOS refuses at 4K. The player
never calls `canPlayType()` and surfaces no codec-specific error.

### 4.4 Subtitles do not exist, and sidecars are actively excluded

Zero occurrences of `.srt`, `.vtt`, `.ass`, `<track>`, `TextTrack` or `WebVTT` in `backend/app` or
`frontend/src`. The `subtitle` prop on `VideoPlayer` is a cosmetic text line. The CC button is
permanently `aria-disabled`. Every non-video file in a torrent gets libtorrent **priority 0**
(`torrent/manager.py:1226-1228`), so `.srt` sidecars are never downloaded.

### 4.5 The silent-401 contract is already broken

`require_session_silent` answers an expired session on the stream with a bare empty 401
(`main.py:188-191`) on the stated grounds that "the player's error handler checks the status
explicitly". **It does not.** `VideoPlayer.tsx:906-933` reads only `video.error?.code`; grep for
`401` under the player and streaming directories returns nothing. An empty 401 surfaces as
`MediaError` 2 or 4, which `:909` routes into `attemptRecovery()` whenever `downloadProgress < 100`,
and both `PatchedVideoPlayer` and the page swallow "network error"/"buffering" strings during an
active download. Result: an expired session on a downloading title is an endless silent retry.

### 4.6 Auth and transport facts

- Cookie: `ff_session`, `httponly=True`, `samesite="lax"`, `secure=settings.cookie_secure`
  (**default False**), `path="/"`, **no Domain**; `max_age` 30 days
  (`services/auth.py:455-473`, `config.py:67-69`).
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

`/torrents/sources` and `/torrents/download` accept `client=<profile>`. Profile `webos22`:

| Rule | Effect |
| --- | --- |
| Container outside `.mkv/.mp4/.ts` | heavy penalty |
| DTS / DTS-HD / TrueHD / Atmos audio at 2160p | reject (§3.2 Ultra HD table) |
| DTS at 1080p | penalty, not reject — the generic `.mkv` row lists DTS, but LG dropped DTS decode on some model years and which years is **unverified**. Step 11.5 tests one DTS file; promote to reject if it fails |
| HEVC 2160p above 60 Mbps (estimated from bytes ÷ runtime) | penalty |
| AV1 | penalty (model-dependent on 2022 LCDs) |
| H.264, or HEVC 8/10-bit, with AC3/EAC3/AAC | preferred |
| Dolby Vision in MKV | penalty |

The capability table lives server-side; the client sends only a profile name. `canPlayType()` is not
used — TV implementations under-report.

*(Corrected after the stage-3 gate — **the profile name is now inaccurate for this device.**
`webos22` is named after, and its rules are derived from, LG's webOS **22** AV table
(§3.2). The set measured as webOS **25**, two platform versions newer, and its AV table is likely
**more permissive** — so these rules are, at worst, over-conservative for this device, and the name
misdescribes what they model. Nothing is broken today: the profile does not exist yet. **Stage 8 is
where it gets built, and stage 8 must decide which AV table it is built from and name it
accordingly** — either re-derive from the webOS 25 table, or keep the 22 table as a deliberate
floor and say so in the name. What the gate did **not** settle: HEVC decode (not tested — accepted
on documentation, §12) and DTS at 1080p (not tested, untouched). Both are naturally measured during
stage 8, which needs real files to validate the profile against anyway.)*

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

- `manager.py:1226-1228` stops zeroing priority for `.srt`/`.ass`/`.ssa`/`.vtt` sidecars (kilobytes).
- New `GET /api/v1/streaming/{id}/subtitles` lists sidecars (language guessed from filename).
- New `GET /api/v1/streaming/{id}/subtitles/{index}` serves **WebVTT**, converting from SRT on the
  fly (pure-Python, no ffmpeg).
- The TV player renders them with a native `<track>`.
- **Acknowledged gap:** embedded MKV subtitle tracks are unreachable because nothing demuxes the
  container, and many releases ship embedded-only. Some titles will have no captions. ASS/SSA styling
  is dropped to plain text.

### 7.6 Player element

`preload="metadata"`, not `"auto"` — the current setting invites the TV to buffer a multi-GB file.
Keep the stall detection, `attemptRecovery` backoff ladder and health logic from `VideoPlayer.tsx`;
replace the control surface entirely.

---

## 8. Navigation & focus

### 8.1 Focus library

`@noriginmedia/norigin-spatial-navigation` — hooks-based, in production on webOS/Tizen/Vizio. **Its
React 19 peer range is unverified and is task one.** Fallback: a hand-rolled roving-tabindex manager
(~150 lines), genuinely viable because we own every component on this surface.

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
| `api/streaming.py` | suffix ranges; malformed/multipart ranges ignored rather than 500; 416 for unsatisfiable only; HEAD short-circuit; MIME table additions; available-bytes in `/info`; subtitle list + WebVTT endpoints |
| `torrent/manager.py` | wire `await_pieces_async` / `_adaptive_piece_timeout` into `stream_file_range`; stop zeroing subtitle sidecars; expose contiguous-available bytes |
| `services/torrents_select.py` | read `codec`; apply a named client capability profile |
| `providers/quality.py` | expose parsed codec/audio to the selector (already parsed, currently display-only) |
| `api/auth.py` | `device/start`, `device/poll`, `device/approve`, `GET/DELETE /devices` |
| `services/auth.py` | pairing issue/consume; `touch_session` slides `expires_at` for device sessions |
| `database/models/accounts.py` | `auth_device_pairings` table; `device_name` + `device_kind` on `auth_sessions` |
| `database/models/__init__.py` | **import the new model** |
| `config.py` | `device_session_ttl_days`; any new `.env` key needs its `Settings` field first (`extra='forbid'`) |

---

## 11. Testing & verification

1. **Backend, pytest, TDD.** Every §7.1 fix gets a failing test first: `bytes=-500` returns the real
   last bytes; `bytes=0-99,200-299` and a malformed range both return 200 with the full body; a
   range starting past EOF returns 416; HEAD returns metadata headers rather than 405
   without entering the generator; a dead swarm returns an error rather than a short body. Note
   `backend/tests` is **not** bind-mounted — new files need `make build` or
   `-v "$(pwd)/backend/tests:/opt/freeflix/tests"`.
2. **Selector, pytest.** Profile `webos22` rejects 2160p+DTS-HD, prefers 1080p H.264+AC3, penalises
   AV1 — as a table test over synthetic candidates.
3. **Pairing, pytest.** Happy path; expired code; wrong `user_code` budget; replay of a consumed
   `device_code`; approval by a non-ACTIVE account; that a `login` token cannot be used here and a
   pairing code cannot reach `/auth/verify`.
4. **Frontend, vitest.** Focus manager (roving tabindex, focus memory, `scrollIntoView` called);
   bigscreen reducers; SRT→VTT conversion; a guard test that greps `(bigscreen)` for the forbidden
   CSS/JS list.
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
| `norigin-spatial-navigation` rejects React 19 | Medium | Hand-rolled focus manager fallback, scoped as task one. |
| Dev Mode lapses and the tile vanishes | Certain, ~every 41 days | Browser-bookmark fallback is a documented deliverable; renewal routine noted in the README. |
| Subtitle coverage disappoints (embedded-only releases) | High | Stated up front. Sidecar-only is v1; embedded extraction is out of scope. |
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
| 5 | Device pairing: backend, `/link`, `/bigscreen/pair` | Unblocks using it without a keyboard |
| 6 | Detail screens, season/episode picker, search keyboard, my list | Completes "watch + request" |
| 7 | TV player: controls, 461, seek boundary, 401 handling | Depends on 1 and 5 |
| 8 | Codec-aware selection + `webos22` profile + 4K opt-in | Needs a real player to validate against. Also carries three things the stage-3 gate left unmeasured: **HEVC decode**, **DTS at 1080p**, and **which AV table the profile is derived from** (the device is webOS 25, the name says 22 — see §7.2). |
| 9 | Subtitles: sidecar priority, WebVTT endpoint, `<track>` | Independent; last because coverage is partial |
| 10 | `webos/` shell, IPK, `make tv-install`; README fallback + renewal notes | Cheapest step, deliberately last |
