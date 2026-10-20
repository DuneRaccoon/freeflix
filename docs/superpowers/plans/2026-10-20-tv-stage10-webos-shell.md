# Stage 10 — the webOS shell, the IPK, and the root exit Back has never had

**Branch:** `feat/tv-stage9-subtitles` continues, or a new `feat/tv-stage10-shell` off it once
stage 9 merges. Stage 9's verification is complete (backend 1715; `test:tv` 15×1575; full
3×2536; `tsc` clean; `next build` compiles; the D1 sign holds — `test_skip_non_video.py` is
byte-identical to master; C1's three load-bearing mutations RED 4 each).

**Scope.** Five files under `webos/`, the `?from=app` contract that tells the TV surface it is
inside the app, the root-screen exit that parked finding 13 and `bigscreen/page.tsx:77-80` both
say stage 10 owes a real answer, two `make` targets, and the README's fallback + renewal notes.
Spec §5.2, §3.3, §3.4, §3.5, and row 10 of §14 ("cheapest step, deliberately last").

**What this stage is not.** No `webOSTV.js`, no luna-send, no iframe shell: `location.replace`
escapes the `file://` origin entirely, which is spec decision 2, and nothing after the redirect
is a local app any more. No bearer auth — the redirect lands on a normal http origin, so the
existing cookie session works unchanged. No repackaging to change the Pi's address.

---

## Corrections to the spec, measured before writing any code

### S1 — §5.2 step 2 probes a URL that does not exist on the origin it is probing

The spec says `fetch(serverUrl + '/health')`. **There is no `/health` on the Next origin.**
`next.config.ts:80-83` rewrites `/_backend/:path*` → `${backendUrl}/:path*`; the backend's
handler is `main.py:373` and the only same-origin spelling that reaches it is
**`/_backend/health`**. `serverUrl + '/health'` is a Next 404 page, which `res.ok === false`
would report as "Can't reach Freeflix" on a box where everything is running.

**Decision: the probe is `GET {serverUrl}/_backend/health`.** It is also the better probe on the
merits — it is the one request that proves the whole chain the viewer needs (Next up, the
rewrite configured, FastAPI up, `torrent_manager` constructible), which is exactly what the
failure card claims. A probe of the Next origin alone would show the card only when the box is
off.

**It needs no session, and that is load-bearing because the shell runs before any sign-in.**
`/health` is an `@app.get` decorator rather than a router route, so the router-level `GATED`
dependency does not apply to it — `main.py:81-83` says so in its own words. Verified by reading
the decorator, not by assuming the comment.

### S2 — `serverUrl` is the Next origin, and its port is 3001, not 3000

`docker-compose.yml:93-94` maps host **3001** → container 3000. The README's "3000" is stale
(CLAUDE.md records this). The setup screen prefills `3001`; the port is a field, not a constant,
because `make prod` without the override is a different mapping and a remote cannot type a URL.

---

## Decisions

**D1. The address lives in `localStorage`, the shell-ness in `sessionStorage`.** The address is a
property of this *device* and must survive a cold start; `?from=app` is a property of this *app
session*. `location.replace` keeps the tab, so a sessionStorage flag written on first load
survives every in-app navigation and dies with the session — which is what stops a desktop
browser tab, opened later against the same origin, from believing it can call `window.close()`.

**D2. `?from=app` is read once and persisted, because a query param does not survive `router.push`.**
The TV surface navigates between routes constantly; the param is present only on the first
document. The layout reads it once and writes `sessionStorage['bs:shell'] = '1'`. Nothing else
reads the param.

**D3. Back at the root tries to exit and SAYS SO WHEN IT CANNOT.** `window.close()` on a document
the script did not open is blocked in standard Chromium; whether webOS permits it for an app's
own window is **not known on this set** — no reading exists. So the handler calls
`window.close()` and then, if the document is still here on the next tick, puts a visible line
on screen ("Press Home to leave Freeflix") instead of swallowing the press. A press that does
nothing and says nothing is the state `bigscreen/page.tsx:70-76` already refuses for the
non-shell case; it must not be reintroduced for the shell case. **Outside the shell, Back at the
root keeps today's behaviour exactly** — claimed, not handed to the browser, because walking out
of `(bigscreen)` into the web app is unrecoverable with a remote.

**D4. The IPK is for pinning a build; `ares-launch -H` is the inner loop.** Spec §3.4. `make
tv-serve` hosts from the Mac with no packaging, `make tv-package` pins one, `make tv-install`
installs it. `@webos-tools/cli`, not the deprecated `@webosose/ares-cli`.

**D5. The three PNGs are generated at their exact declared sizes, from the TV's own tokens.**
80×80, 130×130, 1920×1080 — `--ink` ground, `--gold` mark, `--text` wordmark. A placeholder with
a TODO is how an app ships with LG's default icon.

**D6. `index.html` carries one classic `<script>` and loads nothing external.** Under `file://`,
`<script type="module">` is CORS-blocked (§3.3) and so is every cross-origin fetch of a script
or stylesheet. Inline CSS, inline JS, no fonts.

**D7. Dev-mode expiry is documentation, not code.** 1000 h (~41 days) per webosbrew, the Dev Mode
app shows "999h", LG documents uninstall-on-disable and disable after ten offline reboots, and
signing the developer account into another TV revokes the first. The widely-cited "50 hours" is
a 2022 figure and stale. README only.

---

## Tasks

### Task 1 — `webos/`: the manifest, the shell, the three assets

`appinfo.json` exactly as §5.2 lists it (`id: com.freeflix.tv`, `type: web`, `main: index.html`,
`resolution: 1920x1080`, `disableBackHistoryAPI: true`, `handlesRelaunch: true`). No `bgColor`
or `bgImage` — webOS 1.x–2.x only. No permissions field exists for third-party web apps.

`index.html`: the four steps of §5.2 with S1's corrected probe. The setup screen is four octet
fields plus a port, D-pad operable (arrow keys move, Enter commits), with the stored address
prefilled when there is one. The failure card shows the address it tried and offers Retry /
Change address. A short timeout via `AbortController` — a hung socket must not leave the viewer
on a blank splash.

**Mutate.** (a) `/health` instead of `/_backend/health` → the manifest/shell guard reddens.
(b) `type="module"` added → reddens. (c) an external `<script src>` or `<link href>` → reddens.
(d) a declared icon size that does not match the PNG's real header → reddens. (e) the timeout
removed → reddens. (f) the address baked in as a constant → reddens.

### Task 2 — the `?from=app` contract and the root exit

The layout reads the param once and writes the sessionStorage flag (D2). `bigscreen/page.tsx`'s
`stayOnHome` becomes a handler that, in the shell, attempts the exit and then tells the viewer
if it did not happen (D3); outside the shell it is byte-for-byte today's no-op.

**Mutate.** (a) the flag read from `localStorage` → reddens (a desktop tab must not inherit it).
(b) the param read on every render instead of once → reddens. (c) the exit attempted outside the
shell → reddens. (d) the fallback line never shown when `window.close()` is a no-op → reddens.
(e) Back at the root no longer claimed outside the shell → reddens (the existing rule).

### Task 3 — `make` targets and the README

`tv-serve`, `tv-package`, `tv-install`, `tv-inspect`, each a thin wrapper that names the device
alias. The README gains: the `ares-setup-device` line, the four targets, the DHCP-reservation
requirement (§5.2), the fallback path when the app is gone (open `http://<pi>:3001/bigscreen` in
the TV's own browser), and D7's renewal notes with their sources.

---

## Corrections found while implementing

### C1 — `webos/` is packaged whole, so the asset generator could not live in it

`ares-package ./webos` packages the entire directory into the IPK and installs it on the
television. `make-tv-assets.py` sat there for one commit and would have shipped. It is
`tools/make-tv-assets.py` now, and `webosShell.test.ts` pins the directory's contents to exactly
the five names rather than describing them, because the next helper dropped in there would go
the same way with nothing to say so.

### C2 — jsdom's `window.close()` is not a no-op; it tears the window down

The first version of the exit rows called Back inside the shell without spying on `close`, on
the written assumption that "jsdom's `close` is a no-op, which is exactly the refused case."
It is not: the call destroyed the jsdom window and the next four tests in the file failed with
`Cannot read properties of undefined (reading 'body')`. **Every row in that block now spies on
`close`, including the two that assert it was NOT called** — an unspied call in a row that
expects no call is still a loaded gun if the production code ever makes one. The comment records
the measurement rather than the assumption.

### C3 — three production changes, 1588 green rows, nothing that could see them

Same shape as stage 9's task 18, and worth recording a second time because it is the stage's
recurring sign: after the layout mount, the exit handler and the note were in place, the whole
TV suite was green and **no row in it could observe any of them**. The tests were written
afterwards, which is the wrong order; what makes it safe is that the mutations were run against
the finished pair.

**16 mutations, 16 RED.** The probe reverted to the spec's `/health` (1); a module script (1); an
external `<script src>` (1); `location.href` instead of `replace` (1); the timeout removed (1); a
literal address added (1); `?from=app` dropped (1); `icon` declared as the 130px file (1);
`disableBackHistoryAPI: false` (1); the flag moved to `localStorage` (**6**); the flag cleared
when the parameter is absent (1); any `from=` value accepted (2); the shell check bypassed
(**40**, cascading — the browser case then really calls `close()` and takes the jsdom window with
it, which is C2 again from the other side); the fallback note never shown (1); `useBackKey`
removed (9).

**One mutation had to be redone.** "Back no longer claimed" was first written as
`useBackKey(leaveApp, { enabled: false } as never)` and came back GREEN — but `useBackKey`'s
signature is `(onBack: () => void)`, so the second argument was ignored and the mutation was a
**no-op, not a surviving defect**. Removing the call reddens 9 rows. A green mutation is a claim
about the tests only once you have checked it is a mutation at all.

### C4 — the exit note was dead in development, and only a StrictMode render could see it

The handler defers its fallback by a tick, so it needs to know the component is still mounted.
The obvious ref — `useRef(true)` plus a cleanup that sets it false — is **wrong under
`reactStrictMode: true`**, which `next.config.ts` sets. React then runs every effect mount →
unmount → mount in development, so that first simulated unmount leaves the ref `false` with
nothing to set it back, and the note is dead for the whole dev session.

**Every row in the block stayed green**, because RTL does not render under `StrictMode` unless a
row asks it to, and none did. The fix is to set the ref in the effect BODY as well as clearing
it in the cleanup; the instrument is one row that renders `<StrictMode><HomePage /></StrictMode>`
and presses Back. Measured: reverting the fix reddens that row and nothing else, 1 of 112.

This is the stage's third instance of the same thing — a correct-looking change that no existing
row could observe (C3, and stage 9's task 18 before it). The guard is not a better review; it is
asking, every time, *which row would go red*, and writing it when the answer is none.

## The device readings this stage adds

| # | Question | Blocks? | Instrument | Status |
| --- | --- | --- | --- | --- |
| 39 | Does `window.close()` actually close the app's window on this set, from an http origin reached by `location.replace` from a packaged app? | no — D3 degrades | Back at the root inside the installed app | **not taken** |
| 40 | Is `461` what the set sends for Back *inside the app*, as opposed to in the browser? `useBackKey.ts:7-20` records 461 as an assumption. | no | `/bigscreen/diag` → Remote key codes, inside the app | **not taken** |
| 41 | Does the splash render at 1920×1080 without letterboxing, and does the 80×80 icon appear in the launcher at all? | no | the launcher | **not taken** |
| 42 | Verbatim `navigator.userAgent` inside the app vs in the browser — a packaged app can carry a different UA string. | no | `/bigscreen/diag` → Device, inside the app | **not taken** |

## What no test can settle

Everything above. jsdom has no webOS, no launcher and no `window.close()` semantics; the shell's
`index.html` is tested as a *document* (its text, its structure, its one script) and never as a
running app. The IPK is not built in any suite — `ares-package` is not a dependency of this
repository and must not become one.
