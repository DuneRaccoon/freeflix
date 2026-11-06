# Profile lock, per-account downloads, autovacuum and a global next-episode threshold — design

Date: 2026-11-06 · Status: draft for approval

Four changes, agreed in one conversation. Each section separates **what the user decided**
from **calls made by the designer** (marked *[designer's call]*) so either can be revisited.
Code references are to the tree at `8fc6fe3`.

---

## 0. Why

- **Profile lock.** The household shares accounts; each person has a profile. The point of a
  passcode is that nobody else can sit down on your profile and watch something you are part
  way through (wrecking your Continue Watching / progress). Today a passcode exists, but the
  unlock is remembered for the whole browser/TV session, so after it is entered once (or just
  set) switching away and back never asks again. The user tried exactly that and it did not
  ask. That is the bug this fixes.
- **Downloads.** The page exists to (a) show the status of media being watched and (b) clear
  out old media. Today every signed-in account sees and can remove *everyone's* downloads, and
  the rows jump around every 2 s poll.
- **Autovacuum.** Stop the drive filling with things that were watched (or started and never
  watched) long ago, without the owner having to clear them by hand.
- **Next-episode threshold.** The "start downloading the next episode at 80%" behaviour should
  be one owner-controlled global setting with a slider, and should work in the web player too,
  not only on the TV.

## 1. Goals, non-goals, anti-goals

**Goals**
1. A locked profile asks for its code **every time it is chosen** from "Who's watching?", on web
   and TV, and the server refuses its data until then.
2. Members see and manage only the downloads their account started; the owner sees all, plus
   who watched each one.
3. The Downloads page stops moving under the cursor.
4. An owner-controlled autovacuum deletes untouched media on the rules below.
5. One global, owner-controlled next-episode prefetch switch + threshold slider, honoured by
   both players.

**Non-goals**
- Redesigning the Downloads page. The user said the current design with buttons is fine: make
  it read more clearly and stop the jumping. **Don't overengineer it.**
- Per-profile control of next-episode prefetch (removed, not extended).
- A TV settings screen beyond what §2.7 needs.
- Changing content-maturity restrictions (`maturity_restriction` stays as is).

**Anti-goals (would make this a failure even if it "works")**
- A lock that a person holding an already-open profile can simply switch off without the code.
- A passcode failure path that leaks whether a code is right through a different status/timing
  than today's 403 (keep the existing single shape).
- Autovacuum or Remove deleting **another download's files** (see §4.5 — the current
  `rmtree(save_path)` does exactly this when two downloads share a title).
- Autovacuum deleting something someone is watching right now.
- A member seeing another account's viewing history through the downloads list.
- Breaking playback for members: pressing Play must still start/stream a download for everyone.

---

## 2. Profile lock

### 2.1 Behaviour (user-decided)
- Per profile, opt-in. Whoever is on a profile can turn on a lock for it. Other profiles are
  unaffected.
- The code is **4–6 digits**, set with a **numpad**: enter, then enter again to confirm. No typed
  password fields.
- **Every pick asks.** Choosing a locked profile from "Who's watching?" always shows the numpad
  (web and TV). The unlock lasts only while that profile is the active one in this session;
  switching to any other profile relocks it.
- **Refresh / reopening the app while still on your own profile does not ask again.** Only
  choosing it from the picker does.
- **Changing or removing the code requires entering the current code first.**
- **"Forgot code?"** on the numpad: whoever holds the account's sign-in can reset it — the
  owner by re-entering their account password; a member by a fresh emailed link.
- Server-enforced: without the code, the profile's progress, Continue Watching, list, settings,
  and playback-as-that-profile are refused (today's 423 on `{user_id}` routes).
- Built into bigscreen (TV) as well as web.

### 2.2 Root cause of today's behaviour
- `AuthSession.unlocked_profiles` (`database/models/accounts.py:205`) only ever grows
  (`services/auth.py:443` `mark_profile_unlocked`); nothing removes an id until the session ends.
- There is no server-side "active profile". Selection is client-only
  (`localStorage['currentUserId']` on web, `localStorage['bs-profile']` on TV). "Switch profile"
  (`UserContext.logout()`, TV header link) tells the server nothing.
- Saving settings with the lock on auto-unlocks the saving session (`api/users.py:344-355`).
- The web picker only prompts if `selectUser(id)` (no code) comes back 423 — which it never does
  for an id already in `unlocked_profiles`.

### 2.3 Server model
- **Make the session hold at most one unlocked profile: the active one.** Introduce an explicit
  select step:
  - `POST /api/v1/users/{user_id}/select` with optional `{ passcode }`. Ownership checked as
    `unlock` does today (not behind `require_profile`).
    - Profile **unlocked** (no lock): sets the session's unlocked set to `[]` (relocking whatever
      was open) and succeeds.
    - Profile **locked**: requires a correct passcode **every time, regardless of current unlock
      state**; on success sets the session's unlocked set to `[user_id]`. Wrong → 403, throttled
      → 429, exactly as `/unlock` responds today (same throttle key, limit and reset-on-success).
  - `POST /api/v1/users/deselect` (session-scoped, no profile): clears the unlocked set. Called
    when the user goes to the picker ("Switch profile", TV header link, web `logout()`), so the
    browser Back button cannot return to an open locked profile.
  - *[designer's call]* Keep `/unlock` as a thin alias of `select` for one release (the TV and
    web both call it today), or migrate both callers and delete it — builder's choice, but no
    caller may keep the "append" semantics.
- `resolve_profile`'s 423 check (`dependencies/auth.py:198-204`) is unchanged — it already reads
  `unlocked_profiles`; the fix is in what gets written there.
- **Remove the auto-unlock-on-save** behaviour? No — keep it, but as "the session that just set
  a code stays unlocked *for that profile only*", i.e. it writes `[user_id]`, not an append.
- Two browser tabs on the same session on different profiles will relock each other. Accepted.

### 2.4 Setting, changing, removing the code
*[designer's call]* **The lock is on exactly when a code is stored.** The separate
`require_passcode` toggle stops being user-facing: setting a code turns the lock on; removing
the code turns it off. The server keeps `require_passcode` in step with `passcode_hash` (the
column cannot be dropped — `sync_columns` is additive).

**Existing rows with a code but the lock off** (`passcode_hash` set, `require_passcode = false`
— today's toggle-off leaves the hash behind): *[designer's call]* an idempotent startup pass
**clears those stale hashes**. The person had switched the lock off; locking them on the next
boot with a code they may have forgotten would be the worse surprise.

Server rules on `PUT /users/{id}/settings` (or a dedicated `PUT /users/{id}/passcode` —
builder's choice; dedicated is cleaner because it keeps passcode logic out of the generic
`setattr` loop at `api/users.py:302-307`):
- New codes: digits only, **4–6** (today 4–8, `api/users.py:318`).
  *[designer's call]* An existing stored 7–8-digit code keeps unlocking (the keypad already
  draws `passcode_len` dots); only new codes are limited to 4–6.
- **Setting a first code:** no current code needed (there is none).
- **Changing or removing an existing code:** requires `current_passcode`; wrong → 403 with the
  same throttle as select. The 423 on the route still applies too (you must be on the profile).
- The response never carries the code or hash (unchanged).

### 2.5 Forgot code
- The numpad shows **"Forgot code?"**.
- **Owner account:** a password field (on web) → `POST /users/{id}/passcode/reset {password}`.
  Verified against the owner account's `password_hash` with the existing constant-time pattern
  (`_DUMMY_PASSWORD_HASH`), rate-limited. On success the profile's code is cleared (lock off) and
  the session is left on that profile, unlocked, so they can set a new code immediately.
- **Member account:** `POST /users/{id}/passcode/reset-link` mails the account's address a link
  with a new token purpose `passcode_reset` (bound to the profile id). The link lands on a
  **frontend** page (`/auth/reset-passcode?token=…`); that page POSTs the token in a JSON body
  (tokens never in a backend URL path — CLAUDE.md). Consuming it clears that profile's code. It
  **mints no session** (the account is already signed in wherever they are; the link may be
  opened on a phone). `/auth/verify` must refuse this purpose, like it refuses `password_reset`.
- Who can reset: anyone holding the account's credential, which by design covers every profile
  on that account. Accepted by the user.

### 2.6 Web UI
- A **"Profile lock"** section in Settings, separate from Restrictions (the current toggle label
  "Require passcode for restricted content" is wrong and goes). States:
  - No code → "Set a passcode" → numpad: enter, confirm.
  - Code set → "Change passcode" (numpad: current → new → confirm) and "Remove lock"
    (numpad: current).
- A shared **numpad component** (`components/ui/fre/` has none; `PasscodePrompt` has a 3×4
  keypad inline). It should accept physical digit keys / Backspace too.
- `ProfileGate` → always goes through `select`; a locked profile always opens the numpad.
  "Forgot code?" lives on that numpad.
- "Switch profile" (`ProfileMenu` → `logout()`) calls `deselect`.
- Boot restore (`UserContext` boot, `:141-170`): restoring the stored profile does **not** call
  `select` (that would ask every refresh); it just reads data. If the server says 423 (e.g. the
  session was relocked from elsewhere), land on the picker, which opens the numpad for that
  profile.

### 2.7 TV (bigscreen)
- Picker (`bigscreen/profiles/page.tsx`) uses `select` for every choice; a locked profile always
  shows the existing D-pad `Keypad`. Header "Switch profile" calls `deselect` before routing to
  the picker.
- `useTvProfile.restore` behaves like web boot restore: no `select` on restore.
- **"Forgot code?"** on the TV keypad: for a member account it sends the reset email (one
  press; "Check your email"); for the owner account it shows "Reset it from Settings → Profile
  lock on your phone or computer" (typing a password with a D-pad is not acceptable).
- **The TV only ever enters a code** (user-decided): the keypad appears only when the chosen
  profile has an active lock. Setting, changing and removing the code are web-only; the TV gets
  no new settings screen.
- TV constraints hold: no `@/components`, plain CSS in `public/bigscreen.css`, `npm run test:tv`,
  and `journeys.test.tsx`'s rule that every profile-reading screen has a lock case.

---

## 3. Downloads

### 3.1 Visibility (user-decided)
- Everyone signed in can open Downloads.
- A **member** sees only downloads **their account** started, and can watch / pause / resume /
  remove those. The **owner** sees all. Enforced on the server, not just the page.
- Every download records the **account** that started it. Downloads from before this change
  (NULL) **count as the owner's**. *[designer's call]* Schedule-cron downloads
  (`cron/jobs.py:293`) also record no account and so are the owner's.
- **Reuse:** if a member presses Play on a title that already has a usable download, that
  download is reused and stays the original starter's; it does not appear in the second
  member's list. The starter's Remove deletes it even if someone else is watching it.
- **"Who watched"** on each row, **owner only**: the profiles with progress on that download.
- The "all" buttons act only on what the caller can see.

### 3.2 Server
- New nullable column `torrents.account_id` (String; index/FK by hand like
  `sync_auth_schema` does for `users.account_id`, or no FK — builder's choice). Written from
  `AuthContext.account_id` in `POST /torrents/download` → `add_torrent` (`manager.py:907`,
  needs a parameter). `torrents.user_id` (a *profile* FK, always NULL) stays unused.
- Scope rule `visible(row, ctx) = ctx.is_owner or row.account_id == ctx.account_id`.
  - **Scoped:** `GET /list`, `POST /batch`, `DELETE /{id}`, `POST /action/{id}` with
    `pause`/`stop`. A non-visible id → 404 (not 403, so ids of others' downloads are not
    confirmed).
  - **Not scoped (play path):** `POST /download`, `GET /sources`, `GET /status/{id}`,
    `POST /{id}/prioritize`, `POST /action/{id}` with `resume` (the TV resumes a paused
    download on Play, `_data/title.ts:508`), and all `/streaming/*` routes.
  - `GET /activity/count` (TopNav pill): scoped to visible rows. *[designer's call]*
- **Server-side reuse in `POST /download`.** Today it always inserts a new row (no dedup
  anywhere server-side; the TV dedups client-side by listing *all* torrents, `title.ts:374-411`,
  which stops working once `/list` is scoped). New rule: when the request has **no explicit
  `magnet`** (i.e. not the source-picker switch), if a non-error row already covers the same
  `(tmdb_id, media_type, season, episode)` **at the requested quality** — a season pack (`episode`
  NULL) covers an episode of its season, mirroring `title.ts covers()` — return that row (resuming
  it if paused) instead of adding. *[designer's calls]*:
  - **Quality must match** (the row's `quality` vs the request's). "Download 2160p" next to an
    existing 1080p copy starts a new download; this also keeps the TV from being handed a row its
    capability profile would have refused. Several copies of a title can therefore coexist under
    one `save_path`, which is why §4.5's file-ownership rule is mandatory.
  - **A pack only covers an episode it actually contains:** check `precomputed_episodes`. If that
    is NULL (metadata not yet arrived), reuse optimistically — a second download of the same
    pack would be worse. Once metadata shows the episode is missing, the next request starts a
    new download (otherwise that episode could never be fetched). The TV's `titleStateFor` needs a lookup that is not account-scoped; *[designer's
  call]* add `GET /torrents/for-title?tmdb_id&media_type&season&episode` returning the covering
  rows' `TorrentStatus` (status only), and point `titleStateFor` at it instead of `/list`.
- `TorrentStatus` gains: `size_bytes`, `added_at`, `finished_at`, `last_touched_at`,
  `vacuum` (see §4.6), and — **only when the caller is the owner** — `watched_by:
  [{profile_id, display_name, avatar, percent}]` (per profile; for a pack, the §4.3 average).
  Source: `UserStreamingProgress` rows with `torrent_id == row.id` joined to `users`. Known
  limitation: `upsert_progress` overwrites `torrent_id` when content is re-played from another
  download (`progress_upsert.py:48`), so the older download loses that viewer. Accepted.
- `GET /torrents/disk` (or a field on the list response): `{ used_by_downloads_bytes,
  free_bytes, total_bytes }` from `shutil.disk_usage(default_download_path)` plus the sum of
  `size_bytes`. *[designer's call]* shown to everyone (it is not personal data).
- `size_bytes`: persisted when known (libtorrent `total_wanted` once metadata arrives); today
  only a human string exists in `sizes`/`meta_data`.

### 3.3 Timestamps (needed by §3 and §4)
`Model.created_at` / `updated_at` (`database/mixins.py:128-129`) are evaluated **once at import**
(`default=datetime.now(...)`, a value not a callable), so every row holds the process start time.
Do not rely on them. Add explicit nullable columns on `torrents`, each set in code:
- `added_at` — set in `add_torrent`.
- `finished_at` — set when the row first reaches finished/seeding (all three places:
  `manager.py:556-567`, `650-672`, `762-796`), only if NULL.
- `last_touched_at` — set on add, on finish, and on every progress write for that download
  (both `POST /streaming/progress/{user_id}` — TV — and `PUT …/{progress_id}` — web heartbeat;
  `api/streaming.py:508-597`).
- **Legacy rows:** *[designer's call]* a one-off idempotent startup pass (in the `startup`
  event, not `init_db()`) stamps NULL `added_at`/`last_touched_at` with "now", so existing media
  gets a full grace period rather than being deleted on the first vacuum run. Finished legacy
  rows also get `finished_at = now`.
- Fixing the mixin default itself is out of scope (it touches every table); note it, don't fix.

### 3.4 The page (user-decided: keep the current design and buttons)
- Clearer, not redesigned. Each row: title (with SxxEyy or "Season N" for TV), state badge,
  quality, progress, ↓/↑ speed, peers, ETA; plus **size** and **added date**; plus the
  autovacuum line (§4.6); plus "Watched by" (owner only). Header: **disk used / free** total.
- **Stop the jumping:**
  - Stable order: newest `added_at` first, id as tiebreak — never server order (`get_all` has no
    ORDER BY).
  - Stats in fixed-width, `tabular-nums`, non-wrapping slots; a slot shows "—" instead of
    disappearing (ETA especially; also the stale `eta` in `meta_data` should be cleared when not
    downloading, `manager.py:502-506`).
  - Buttons always rendered in the same positions; inapplicable ones disabled, not removed.
    Pause/Resume share one slot (a single toggle button) so the swap doesn't shift Remove.
  - Error text in a reserved line or replacing the stats line, not pushing the row taller.
- Filter pills and the four "all" buttons stay (user: buttons are fine), acting on the visible
  set.
- *[designer's call — flagged for the user to check]* The Remove dialog's default flips to
  **"Delete everything"** (files too), because the page's job is clearing old media; today it
  defaults to keeping files, which frees nothing.

---

## 4. Autovacuum

### 4.1 Settings (owner only, user-decided)
| Setting | Default |
| --- | --- |
| Autovacuum on/off | **off** |
| Days untouched before deleting | **30** |
| Only delete once watched past __% (on/off) | **on** |
| … threshold | **80%** |

Stored on the `Instance` singleton as nullable columns (NULL = default; `sync_columns` adds
them). **Owner-only read and write.** Note `PUT /instance/settings` (`api/instance.py:535-548`)
currently returns the *public* `InstanceStatusResponse` — the new settings must not be added to
that shape; give the owner settings their own response model / endpoint.

UI: an owner-only "Storage & playback" section in web Settings (hidden for members), holding the
autovacuum settings and the §5 next-episode settings.

### 4.2 The clock (user-decided)
Every download has a date: `last_touched_at` = latest of **added**, **finished downloading**, and
**anyone playing it**. Every play resets the countdown, for movies and TV alike. A download
expires when `now - last_touched_at >= days`.

### 4.3 The watched gate (user-decided)
When the gate is on, a download additionally needs to be "watched enough":
- The profiles that **started** it = profiles with a progress row for it with `percentage > 0`.
- **Nobody started it** → the gate does not apply; it expires on days alone (counting from when
  it finished downloading, via `last_touched_at`). Nothing sits on the drive forever.
- **Somebody started it** → it qualifies only when **every** profile that started it has passed
  the threshold.
- **Movie:** a profile's percent = its progress `percentage` (or 100 if `completed`).
- **Season pack (same logic, one download as the unit):** a profile's percent = the average over
  **all** episodes in the pack (episodes it never opened count 0). Three of ten episodes watched
  → 30%. Episode count = `len(precomputed_episodes)`; *[designer's call]* if that is empty
  (metadata never arrived), fall back to the number of distinct `file_index` values seen, or
  treat as 1.
- Single-episode downloads behave like movies.

### 4.4 Never touched by the vacuum
- A download actively progressing (live download rate > 0).
- A download being streamed right now. There is no stream registry today; *[designer's call]*
  use "any progress write for it in the last 10 minutes" (web heartbeat is 30 s), or a counter
  in `stream_file_range` — builder's choice.
- Everything else is eligible: paused, stopped, errored and stalled downloads count down from
  `last_touched_at` like anything else, so a dead torrent doesn't sit on the drive forever.

### 4.5 What deleting does
- Deletes the download's **own files** and its row; watch history (progress rows) is kept
  (`torrent_id` goes NULL, as today), so pressing Play later re-downloads.
- **Must not delete another download's files.** Today `remove_torrent(…, delete_files=True)`
  runs `safe_rmtree(row.save_path)` (`manager.py:1041-1071`, `storage.py:26`), and `save_path`
  is `downloads/<title>` — shared by every download of the same title/season. Deletion must be
  limited to what that torrent owns (its top-level name inside `save_path`, per the resume
  blob / torrent info — see memory note *completed-download-recovery*), and leave `save_path`
  itself only if empty. This fix applies to the manual Remove button too.
- Runs **once a day in the early morning** — *[designer's call]* 04:00 in the container's local
  time (UTC unless `TZ` is set), as its own asyncio task started from the `startup` event
  (independent of `cron_enabled`; does nothing while the setting is off). Not in `init_db()` or
  any import-time constructor.
- **Logs one line per deletion** (title, id, reason, last touched, size freed).

### 4.6 Visibility on the Downloads page (user-decided)
Finished rows show the vacuum outcome, computed by the same function the job uses:
- "Deletes in 12 days" / "Deletes tonight"
- "Kept: not everyone has finished it" (gate blocking)
- nothing (or "Autovacuum off") when disabled.
Unfinished/paused rows also show their countdown, since they are eligible too.

---

## 5. Next-episode auto-download

### 5.1 Behaviour (user-decided)
- **One global switch and a threshold slider**, owner only, next to the autovacuum settings.
  Slider **50–95% in 5% steps, default 80%**. Switch default **on** (today's per-profile default
  is on).
- The **per-profile switch goes away** (TV `AutoNextToggle` on the show screen; the column
  `user_settings.auto_next_episode` stays in the DB, ignored).
- **Both players honour it.** The web player gains the TV's behaviour: once past the threshold,
  the next episode starts downloading in the background. The web **Up Next card still shows**.

### 5.2 Reading the setting
Both players are signed-in sessions; *[designer's call]* expose
`GET /api/v1/instance/playback` (any session; returns `{ auto_next_enabled, auto_next_pct }`)
separate from the owner-only settings read. TV currently mounts no `SessionProvider` and calls
neither `/instance/status` nor `/auth/me`, so it fetches this itself (allowed: `@/services`).
If the read fails, the prefetch does not fire (today's `settled` gate semantics).

### 5.3 TV
- `pastAutoNextPoint` takes the threshold as a parameter instead of the `AUTO_NEXT_AT = 0.8`
  constant (`_data/nextEpisode.ts:284-291`); the watch page prefetch effect
  (`watch/[id]/page.tsx:894-915`) reads the global setting instead of `useAutoNext(userId)` and
  adds the threshold to its deps.
- Remove `AutoNextToggle` from the show screen (focus row `ACTION_CELLS = 2` → 1; its CSS rule
  `bigscreen.css:1000`).
- The test at `nextEpisode.test.ts` asserting `shortest*(1-AUTO_NEXT_AT) > END_PROMPT_S` must be
  re-expressed for the slider's worst case (95%).

### 5.4 Web
- In `app/(web)/streaming/[id]/page.tsx`: once past the threshold on a TV episode,
  - if the next episode is **in the same torrent** (season pack), do nothing — the whole pack
    already downloads (`prioritize_video_files`, `manager.py:2045-2100`);
  - otherwise find the next episode (TMDB `getSeason`, falling back to the next season, as
    `findNextEpisode` does) and `POST /torrents/download` for it — the §3.2 server-side reuse
    makes repeats safe. Fire once per content id.
- Share the pure next-episode logic between web and TV (move the pure parts of
  `_data/nextEpisode.ts` somewhere both may import, e.g. `@/lib`), rather than writing it twice.
- **Up Next card:** today it only appears inside a multi-file torrent (`page.tsx:235`).
  *[designer's call]* It also appears for a single-episode torrent when a next episode exists;
  "Play next" goes to that episode's download (reused or the one just prefetched). Within a pack
  it keeps today's `?file=N` behaviour. Its 15 s countdown autoplay is unchanged (the
  "Does NOT autoplay" comment at `page.tsx:233` is stale — fix the comment).

---

## 6. Constraints the builder must respect (from the repo)
- Backend: SQLAlchemy 1.4; `get_db()` pattern (`with db as session:` once; auth deps open their
  own `with get_db()`); new columns nullable, added by `sync_columns`; no Alembic.
- No auth token in a backend URL path; passcode-reset email link → frontend page → JSON POST.
- Password-failure paths keep the single `_bad_credentials()` shape; passcode failures keep
  today's single 403.
- Startup-time writes go in the `startup` event, never `init_db()` (import-time).
- TV: plain CSS, no `@/components`/Tailwind/framer-motion, `npm run test:tv`, journey lock cases.
- Backend tests run on SQLite, baked into the image (mount `backend/tests` or rebuild); importing
  `app.torrent.manager` starts libtorrent at import.
- Don't recreate the `backend` container mid-download.

## 7. Open for the user
None. (Resolved: the TV only enters a code; setting/changing/removing is web-only.)

## 8. Left to the builder
Endpoint names and exact shapes; whether passcode changes use a dedicated endpoint; how the
numpad component is factored; the exact "currently streaming" signal; the precise file-ownership
logic for deletion (must satisfy §4.5); test layout; migration order of callers off `/unlock`.
