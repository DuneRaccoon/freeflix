# Profile lock, per-account downloads, autovacuum and next-episode threshold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locked profile asks for its code every time it is picked, on web and TV, and the server refuses its data until then. Members see and manage only their own account's downloads, and the owner sees all of them plus who watched each one. The Downloads page stops jumping. An owner-controlled autovacuum deletes untouched media. One global, owner-controlled next-episode switch and threshold apply to both players.

**Architecture:**
- **Profile lock.** The session row's `unlocked_profiles` holds at most the active profile. It is written only by `set_active_profile`, through `POST /users/{id}/select` and `POST /users/deselect`. Setting, changing and removing a code go through a dedicated `PUT /users/{id}/passcode`. "Forgot code?" works by the owner's account password, or by a member's emailed link that is consumed in a JSON body.
- **Downloads.** New nullable columns on `torrents` record who started each download (`account_id`) and its clock (`added_at`, `finished_at`, `last_touched_at`, `size_bytes`).
  - Management routes are scoped by `services/torrent_scope.py`. The play path is not scoped.
  - `POST /download` reuses a download that already covers the request, under a per-key lock, and touches it.
  - Deleting removes only the torrent's own content.
- **Autovacuum.** One pure evaluator, `services/vacuum.py`, feeds both the Downloads row line and a daily 04:00 asyncio task started from the `startup` event.
- **Next episode.** `Instance` gains six NULL-means-default settings, with an owner-only read/write endpoint and a session-level `GET /instance/playback`. The pure next-episode logic moves to `@/lib/nextEpisode`, and both players read the threshold through `@/lib/usePlaybackSettings`.

**Tech Stack:**
- Backend: FastAPI, SQLAlchemy 1.4, pydantic v2 and pydantic-settings, libtorrent 2.0.11, PostgreSQL 16 in production and SQLite in tests, pytest.
- Frontend: Next.js 15 (App Router), React 19, TypeScript, Tailwind v4 (web only), Vitest and Testing Library.
- The TV is plain CSS at `public/bigscreen.css`.

**Spec:** `docs/superpowers/specs/2026-11-06-profile-lock-downloads-autovacuum-design.md`

**Execution order:** Part A, then B, C, D and E. A later part builds on an earlier part's result, never the reverse.

## Global Constraints

**Profile lock and passcodes**
- New passcodes are 4–6 digits matched by `[0-9]`, never `str.isdigit()`. Stored 7–8 digit codes still verify, change and remove.
- The lock is on exactly when a hash is stored. `require_passcode` is kept in step with it by `set_passcode` and `clear_passcode`.
- Select, change and remove share one throttle: key `unlock:{user_id}`, `_UNLOCK_LIMIT = 5`, `_UNLOCK_WINDOW = 300` s, reset on success.
  - A wrong code returns 403 `"Incorrect passcode"`. A throttled attempt returns 429.
  - A codeless select on a locked profile counts as a wrong code.
- Owner reset (`POST /users/{id}/passcode/reset`):
  - Every failure is one fresh 403 `"Incorrect password"`.
  - It always pays for the KDF, falling back to `auth_service.DUMMY_PASSWORD_HASH`.
  - Throttle: `passcode-reset:{account_id}`, 5 per 15 min.
- Member reset link (`POST /users/{id}/passcode/reset-link`):
  - Members only. An owner gets 400 `"Use your account password"`.
  - It always answers `{ok: true}`. Throttle: `passcode-reset-link:{account_id}`, 3 per 15 min.
- The member reset token:
  - Token purpose is `passcode_reset` and the mail template id is `passcode-reset`.
  - The link goes to the frontend page `/auth/reset-passcode?token=…`, which POSTs the token in a JSON body.
  - It mints no session, and `/auth/verify` refuses it.
- Every password failure path keeps the single `_bad_credentials()` shape. Passcode failures keep the single 403.
- No auth token ever appears in a backend URL path, because paths are logged and query strings are not.

**Downloads**
- Visibility rule: `visible(row, ctx) = ctx.is_owner or row.account_id == ctx.account_id`. NULL `account_id` (legacy and schedule-cron rows) belongs to the owner, and reuse never adopts it.
  - A download the caller cannot see answers 404 with the route's existing not-found detail, byte-identical to "does not exist".
- **Scoped:** `GET /list`, `POST /batch`, `DELETE /{id}`, `POST /action/{id}` with pause or stop, and `GET /activity/count`.
- **Unscoped:** `POST /download`, `GET /sources`, `GET /status/{id}`, `POST /{id}/prioritize`, `POST /action/{id}` with resume, `GET /for-title` and every `/streaming/*` route.
- `GET /torrents/disk` is shown to everyone. `watched_by` is sent only to the owner. A member gets `null`, and `[]` means nobody watched.
- Reuse applies only to a request with no `magnet`. It needs the same `(tmdb_id, media_type, season, episode)` at the same `quality`, in a state other than `error` or `blocked`.
  - A pack covers an episode when `precomputed_episodes` contains it or is NULL. `{}` means the episode is missing.
- Every new timestamp is naive UTC from `torrent_touch.utcnow()`. The one exception is `VacuumInfo.deletes_at`, which is aware UTC with a `Z`.
- Never rely on the mixin columns `created_at` and `updated_at`: they hold the process start time.
- Deleting a download whose resolved `save_path` no other row shares removes that whole directory (leftovers included). When another row shares it, deleting removes only the torrent's own `save_path/<content name>` and its `.<v1hex>.parts`, then removes `save_path` only if empty; when its own content can't be identified, it deletes nothing and logs a WARNING. This applies to Remove, the vacuum and the content guard.

**Settings, autovacuum and next episode**
- `Instance` settings are NULL until chosen.
  - Defaults: autovacuum off, 30 days, watched gate on, gate at 80%, next-episode on, next-episode at 80%.
  - Bounds: days 1–365, watched percent 10–100, next-episode percent 50–95 in multiples of 5.
  - Unknown keys return 422.
- Owner settings are owner-only at `GET/PUT /instance/owner-settings`, and `/instance/playback` is readable by any session. `/instance/status` and `PUT /instance/settings` keep their public shape.
- The autovacuum runs daily at 04:00 container-local time (UTC unless `TZ` is set). It is its own asyncio task started from the `startup` event, independent of `cron_enabled`.
  - Within `RECENT_PLAY_WINDOW = 10 min` of a progress write, or with a live handle `download_rate > 0`, a download is never deleted.
  - The rate comes from the live handle, never from `meta_data`.
  - Each deletion logs one line.
- If the playback read fails, the next-episode prefetch does not fire. The prefetch fires at most once per content id. `AUTO_NEXT_AT` is deleted.

**Backend rules**
- Use the SQLAlchemy 1.4 API.
- Endpoints take `db: Annotated[Session, Depends(get_db)]` and enter `with db as session:` exactly once.
- Auth dependencies and services open their own `with get_db() as db:`. They never declare `Depends(get_db)`.
- Leave the `with db` block before calling any `torrent_manager` method.
- New columns are nullable and are added by `sync_columns`. There is no Alembic and no FK on the new columns.
- Startup-time writes go in the `startup` event, never in `init_db()`, which runs at import time.

**TV rules**
- The TV uses plain CSS in `public/bigscreen.css`. No `@/components`, no Tailwind, no `framer-motion`, and no GPU-expensive CSS.
- Run `npm run test:tv` by hand. It includes `legacy-target` and `noDeadExports`.
  - Every service member needs a production caller, or a `DECLARED_TEST_ONLY` line that the task wiring it deletes.
- `journeys.test.tsx` keeps a lock case for every profile-reading screen.

**Tests, containers and commits**
- Backend tests:
  - Run them with `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest …`.
  - Pass `--ignore=tests/test_torrent.py --ignore=tests/test_torrent_alternate.py`. Those two files join a real swarm during collection.
- Never recreate the `backend` container mid-download. This plan adds no npm dependency.
- Loop suites before claiming green (memory: verify-suites-by-looping), and run each prescribed mutation by hand. Confirm the mutation landed with `grep` first.
- Commits use Conventional Commits and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These are the five input classes most likely to hurt a household that no task's tests covered before this cross-check. Each is now pinned.
1. **Two tabs on one session, each on a different profile.** Picking in one tab must relock only *locked* profiles. Two tabs on unlocked profiles must never 423 each other.
   - Pinned by **A2** `test_two_tabs_on_unlocked_profiles_never_relock_each_other`, alongside A2's existing relock tests for locked profiles.
   - A web tab relocked mid-session drops to the picker with the numpad open: pinned by **B2b**.
2. **The 04:00 vacuum versus Play pressed just before it on the same title.** Reuse must touch `last_touched_at`, so a download reused at 03:59 is not due at 04:00 before the player's first progress write.
   - Pinned by **C6** `test_reuse_counts_as_a_play_and_resets_the_clock`.
   - Pinned by **D4** `test_a_download_played_moments_before_the_run_is_kept`, which checks that the vacuum reads this run's `last_touched_at` and not `added_at` or `finished_at`.
3. **Two Play presses for one episode racing.** Examples: the TV's threshold prefetch and the end-prompt Play, or two devices, while the first request is still searching providers. They must start one download, not two.
   - Pinned by **C6** `test_two_identical_presses_racing_start_one_download`, using a per-key `_download_lock` around find, search and add.
4. **Legacy rows (pre-upgrade).** They must stay the owner's when a member's Play reuses them, and the first vacuum after the upgrade must give them a full grace period.
   - Pinned by **C6** `test_a_member_reusing_a_legacy_row_does_not_adopt_it`.
   - Pinned by **D4** `test_legacy_rows_get_a_full_grace_period_after_the_startup_stamp`, which runs C3's stamp, then a vacuum at +29 days that keeps the row and at +30 days that deletes it.
5. **A season pack with NULL or incomplete `precomputed_episodes`.** The TV's `/for-title` answer and the server's reuse must agree about whether a pack contains an episode. Play next must open the server-picked file, and must never open `?file=undefined`.
   - Pinned by **C6** `test_pack_contains` and `test_for_title_and_reuse_agree_on_a_pack_without_the_episode`.
   - Pinned by **C7** `test_watched_by_on_a_pack_is_the_season_average`.
   - Pinned by the two **E4** "Play next into a reused pack…" and "…metadata is not in yet…" rows.

## Lead's decisions on reviewer questions

- **Mid-session relock on the web:** handled (B2b). A tab whose profile was relocked returns to the picker with the numpad open; its stored profile is kept.
- **Orphan files:** an unshared `save_path` is wholly the download's, so the last owner out removes it, leftovers included (C4). Owned-only deletion applies only while a sibling shares the directory.
- **Added date:** shown in the viewer's local day, not UTC (C9).
- **Per-key download lock (C6):** kept.
- **Reset-passcode role check (A7):** kept. A link minted before an ownership change returns 410, like `/auth/verify`.
- **Remove defaults to "Delete everything":** confirmed when the user approved the spec.
- **Accepted as-is:** a member on an instance with no mail provider can't reset a forgotten code by email (the profile can still be deleted). The TV may show a stale lock until the picker is re-entered. The vacuum's delete runs on the event loop, like the manual Remove does today.

## Task order

1. A1 — `set_active_profile` replaces `mark_profile_unlocked`
2. A2 — `POST /users/{id}/select`, `POST /users/deselect`, and `/unlock` as an alias
3. A3 — `PUT /users/{id}/passcode` (set, change and remove), with settings no longer touching the lock
4. A4 — The startup pass clears stale hashes
5. A5 — Forgot code, owner (`POST /users/{id}/passcode/reset` with the account password)
6. A6 — The `passcode-reset` email template
7. A7 — Forgot code, member (emailed link, `POST /auth/reset-passcode`, and `/auth/verify` refusing it)
8. B1 — `Numpad` component (fre)
9. B2 — `UserContext`: select every time, restore without selecting, deselect on Switch profile
10. B2b — A web tab relocked mid-session goes back to the picker
11. B3 — PasscodePrompt on Numpad with "Forgot code?"; ProfileGate asks on every locked pick
12. B4 — Settings → Profile lock section; passcode leaves Restrictions
13. B5 — `/auth/reset-passcode` page and `authService.resetPasscode`
14. B6 — TV picker: select every pick, relock on arrival, Forgot code?
15. C1 — Lifecycle columns and the widened `TorrentStatus` wire shape
16. C2 — Stamp added / finished / size, and record the starting account in `add_torrent`
17. C3 — Every play touches its download; legacy rows get a grace stamp at startup
18. C4 — Deleting a download deletes only what that torrent owns
19. C5 — Downloads are per-account: scope the management routes, record the starter
20. C6 — Server-side reuse in `POST /download`, `GET /for-title`, and the web opens the right file
21. C7 — Who watched each download (owner only) and the disk totals
22. C8 — Frontend `getForTitle`, and the TV asks `for-title` instead of listing everything
23. C9 — Downloads page: stable rows, fixed slots, size/date/disk (with `getDisk`), watched-by, delete-by-default
24. D1 — Instance settings columns and `effective_settings`
25. D2 — `GET/PUT /instance/owner-settings` and `GET /instance/playback`
26. D3 — Vacuum rules (`vacuum_info`, `is_due`, `next_run_at`)
27. D4 — `run_vacuum` and `fill_vacuum`, one shared evaluator
28. D5 — Daily 04:00 task, started from `startup` whatever `cron_enabled` is
29. D6 — Fill `TorrentStatus.vacuum` in `/torrents/list` and `/torrents/status/{id}`
30. D7 — Frontend `instanceService` owner-settings and playback calls
31. D8 — Owner-only "Storage & playback" section in web Settings
32. D9 — Downloads row shows the autovacuum line
33. E1 — Move the pure next-episode logic to `@/lib/nextEpisode` and give `pastAutoNextPoint` a threshold
34. E2 — `usePlaybackSettings`, and the TV prefetch reads the global setting
35. E3 — Remove the per-profile auto-next toggle from the TV show screen
36. E4 — `useUpNextEpisode`, the web's lookup, prefetch and Play next
37. E5 — Wire it into the web streaming page; Up Next for single-episode downloads
38. E6 — Backend: retire `auto_next_episode` from the profile-settings API (the column stays)


---

# Part A — Profile lock, backend (spec §2.1–2.5)

Code references are to the tree at `f02fce9` (branch `feat/profile-lock-downloads-autovacuum`).
All backend paths are relative to `backend/`. Every test command runs from the repo root:

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file>.py -v
```

## Contract deviations

1. **Mail template id is `passcode-reset`, not `passcode_reset`.** Every existing id is hyphenated
   (`password-reset`, `magic-link`, `claim-verify`: `services/mailer.py:35-40`, `route.ts:32-37`).
   Both ends of the id are written in this part, so nothing downstream sees the difference. The
   **token purpose** keeps the contract's spelling, `PURPOSE_PASSCODE_RESET = "passcode_reset"`.
2. **The signature is `mailer.send_passcode_reset(*, to: str, token: str, profile_name: Optional[str], expires_in_minutes: int)`.**
   The contract had `(to, url)`. Every sibling helper takes the token and builds its own link
   (`mailer.py:65-74`), so the "token goes in a frontend query string" rule lives in one place:
   the new `passcode_reset_url(token)`.
3. **The reset token binds its profile in a new nullable `auth_tokens.profile_id` column.**
   `AuthToken` has no free-form field (`database/models/accounts.py:163-177`). The column is a
   plain `String` with **no FK**. On an upgraded database `sync_columns` adds only a bare column,
   so declaring an FK would put it on fresh installs alone. It would also make CLAUDE.md's "five
   FK constraints point at `users.id`" false. If the profile has been deleted,
   `/auth/reset-passcode` returns 410 instead.
4. **`PUT /users/{id}/settings` ignores `passcode` and `require_passcode`, and does not 422.**
   Both fields are removed from `UserSettingsUpdate`, and pydantic's default `extra='ignore'`
   drops them. Today's web Restrictions form sends `require_passcode` on every save
   (`SettingsView.tsx:440-443`). A 422 would break the maturity setting until Part B replaces
   that form.
5. **Additions the contract did not name.** Part A also adds:
   - `auth_service.DUMMY_PASSWORD_HASH`, moved from `api/auth.py:129` so `api/users.py` can share it;
   - `accounts_service.set_passcode(row, code)` and `accounts_service.clear_passcode(row)`, the
     only two writers of the lock, which keep `require_passcode` in step with `passcode_hash`;
   - `accounts_service.clear_stale_passcodes(session) -> int` and
     `MigrationReport.stale_passcodes_cleared`;
   - `issue_auth_token(..., profile_id=None)`;
   - `/auth/reset-passcode` also 410s when the token's account is no longer a member (an
     ownership transfer after the link was sent), mirroring `/auth/verify`'s owner refusal.
6. **Contract shapes kept as written:**
   - `/users/deselect` returns `OkResponse` (`{"ok": true}`).
   - `/auth/reset-passcode` takes the existing `VerifyTokenRequest{token}` and returns
     `OkResponse`.

**Notes for Part B. These are decided here, so don't re-derive them.**
- **A select with no passcode on a locked profile is a wrong code.** It returns 403
  `{"detail":"Incorrect passcode"}` and spends one of the 5 attempts. Never probe `select`
  without a code to learn whether a profile is locked; read `settings.require_passcode` from
  `GET /users` instead.
- **Only one passcode-reset link per account is live.** Requesting one burns the account's
  earlier link, including one sent for a different profile.
- **Every failure of `/passcode/reset` is one response,** 403 `{"detail":"Incorrect password"}`.
  That covers a throttled attempt too, so the UI cannot say "too many attempts".
- **`/unlock` still works for one release.** It now replaces the session's open profile like
  `select` does; it no longer appends.

---

### Task A1: `set_active_profile` replaces `mark_profile_unlocked`

**Files:**
- Modify: `app/services/auth.py:443-453`: delete `mark_profile_unlocked` and add `set_active_profile`.
- Modify: `app/api/users.py:355` and `:403`: the only two callers.
- Modify: `app/database/models/accounts.py:205-206`: the comment on `unlocked_profiles` becomes
  "at most one profile id: the session's active profile, written only by `set_active_profile`".
- Test: `tests/test_auth_service.py:256-268`: replace `test_unlocked_profiles_are_reassigned_not_mutated`.

**Interfaces:**
- Produces: `set_active_profile(session: Session, row: AuthSession, profile_id: Optional[str]) -> None`.
  It always assigns a **new list**: `[profile_id]`, or `[]` when `profile_id is None`. It never
  appends and never mutates in place, because SQLAlchemy does not track changes inside a plain
  JSON column. Keep the existing docstring's paragraph about that.

- [ ] **Step 1: Write the failing test.** Replace the old test, which pins the append semantics:

```python
def test_the_session_holds_exactly_one_open_profile(db_session, session_factory):
    account = _account(db_session)
    _, row = auth_service.create_session(db_session, account)
    db_session.commit()

    def stored():
        fresh = session_factory()
        try:
            return fresh.query(AuthSession).filter(AuthSession.id == row.id).one().unlocked_profiles
        finally:
            fresh.close()

    auth_service.set_active_profile(db_session, row, "profile-1")
    db_session.commit()
    assert stored() == ["profile-1"]

    auth_service.set_active_profile(db_session, row, "profile-2")
    db_session.commit()
    assert stored() == ["profile-2"]

    auth_service.set_active_profile(db_session, row, None)
    db_session.commit()
    assert stored() == []
```
  Mutations this test catches:
  - Append semantics: the second read becomes `["profile-1","profile-2"]`.
  - An in-place `row.unlocked_profiles[:] = [...]` or `.append`: never flushed, so the read
    returns the old value. The read uses a **separate** session for this reason.
  - Writing `None` instead of `[]`: the third assertion fails.

- [ ] **Step 2: Run it.** `... pytest tests/test_auth_service.py -v -k one_open_profile`. Expected
  FAIL: `AttributeError: module 'app.services.auth' has no attribute 'set_active_profile'`.
- [ ] **Step 3: Implement.** Add `set_active_profile`, delete `mark_profile_unlocked`, and replace
  both calls in `api/users.py` with `auth_service.set_active_profile(session, auth_row, user_id)`.
  `grep -rn mark_profile_unlocked backend` must print nothing.
- [ ] **Step 4: Run** `... pytest tests/test_auth_service.py tests/test_profile_scoping.py -v`.
  Expected PASS. The scoping file's unlock tests still pass: they open one profile at a time.
- [ ] **Step 5: Commit.**
```bash
git add backend/app/services/auth.py backend/app/api/users.py backend/app/database/models/accounts.py backend/tests/test_auth_service.py
git commit -m "refactor(auth): a session holds one open profile, not an ever-growing set

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A2: `POST /users/{id}/select`, `POST /users/deselect`, and `/unlock` as an alias

**Files:**
- Modify: `app/models.py:685-689`: delete `PasscodeUnlockRequest` and `PasscodeUnlockResponse`, add
  the two schemas below, and change the `/unlock` mention in `UserSettingsResponse`'s docstring
  (`:652-653`) to `/select`.
- Modify: `app/api/users.py`:
  - change the imports (`:35-43`);
  - change the module docstring (`:18-21`), which names `/unlock`, to `select`;
  - add `deselect` directly after `create_user` (`:168-192`), so it is declared before any
    `/{user_id}` route;
  - replace `unlock_profile` (`:361-405`) with `select_profile`, the `unlock_profile` alias and
    the shared helper.
- Modify: `tests/test_profile_scoping.py:210-249`:
  - `test_locked_profile_is_refused_until_unlocked`: post to `/select` instead of `/unlock`;
  - `test_wrong_passcode_does_not_unlock`: post to `/select` instead of `/unlock`;
  - `test_unlock_is_refused_for_another_accounts_profile`: parametrize over
    `path in ("select", "unlock")`, and assert `== 403` (the vault exists, so 404 is not a valid
    answer any more).
- Create: `tests/test_profile_lock.py`, the fixture below plus this task's tests. A3, A5 and A7
  add tests to it.
- Modify: `docs/ARCHITECTURE.md`: add a `### Profile lock` subsection after "Where the gate
  lives" (`:142-153`).

**Interfaces:**
- Consumes: `auth_service.set_active_profile` (A1); `_owned_profile` and `ensure_settings` (`api/users.py:57,115`).
- Produces:
  - `ProfileSelectRequest(BaseModel)`: `passcode: Optional[str] = None`.
  - `ProfileSelectResponse(BaseModel)`: `ok: bool`.
  - `_session_row(session: Session, ctx: AuthContext) -> Optional[AuthSession]`. It returns
    `None` when `ctx.session_id` is falsy, which is dev mode. A3 and A5 reuse it.
  - `_select(session: Session, user_id: str, passcode: Optional[str], ctx: AuthContext) -> None`.
    Steps:
    1. `_owned_profile`, then `ensure_settings`.
    2. If `row.require_passcode`, which is the same predicate `resolve_profile`'s 423 uses at
       `dependencies/auth.py:199`:
       - `rate_limiter.check(f"unlock:{user_id}", limit=_UNLOCK_LIMIT, window_seconds=_UNLOCK_WINDOW)`.
         On `False`, return 429 with the existing detail.
       - `verify_passcode(passcode or "", row.passcode_hash)`. On `False`, return 403
         `"Incorrect passcode"`.
       - `rate_limiter.reset(f"unlock:{user_id}")`.
       - `set_active_profile(..., user_id)`.
    3. Otherwise, `set_active_profile(..., None)`.
    4. Do no length check here: a legacy 7–8-digit code must still verify.
  - `POST /users/deselect`: `response_model=OkResponse`, with `require_session` only. If there is
    a session row, it calls `set_active_profile(..., None)`.
  - `POST /users/{user_id}/select`: `response_model=ProfileSelectResponse`. The body is
    `payload: Optional[ProfileSelectRequest] = None`, declared **last** so that no body is legal.
    It is not behind `require_profile`.
  - `POST /users/{user_id}/unlock`: the same signature, and calls `_select`. Its docstring says
    "alias of /select for one release".

- [ ] **Step 1: Write the fixture and failing tests** in `tests/test_profile_lock.py`. Copy the
  `os.environ.setdefault("DB_PATH", "/tmp/test_profile_lock.db")` header and imports from
  `test_profile_scoping.py:16-28`, and add `from types import SimpleNamespace`. Fixture:

```python
OWNER_PASSWORD = "correct-horse-battery"

def _fresh(db):
    db.rollback()
    db.expire_all()
    return db

@pytest.fixture
def home(db_session, override_get_db, auth_enabled, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "log_path", tmp_path)
    monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)
    owner = Account(email="owner@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE,
                    password_hash=auth_service.hash_password(OWNER_PASSWORD))
    member = Account(email="member@example.com", role=ROLE_MEMBER, status=STATUS_ACTIVE)
    db_session.add_all([owner, member]); db_session.flush()

    def profile(account, name, code=None):
        row = User(username=name, display_name=name, account_id=account.id)
        db_session.add(row); db_session.flush()
        cfg = UserSettings(user_id=row.id)
        if code:
            cfg.require_passcode = True
            cfg.passcode_hash = auth_service.hash_passcode(code)
            cfg.passcode_len = len(code)
        db_session.add(cfg); db_session.flush()
        return row.id

    ids = dict(plain=profile(owner, "plain"), plain2=profile(owner, "plain2"),   # Review Focus 1
               vault=profile(owner, "vault", "4821"),
               legacy=profile(owner, "legacy", "48213579"),       # 8 digits: pre-change code
               kid=profile(member, "kid", "1357"),
               kid2=profile(member, "kid2", "8642"))   # A7: a reset must clear only its own profile
    tok = lambda acct: {settings.cookie_name: auth_service.create_session(db_session, acct)[0]}
    cookies = dict(owner=tok(owner), owner2=tok(owner), member=tok(member))
    db_session.commit()
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, db=db_session, owner_id=owner.id,
                              member_id=member.id, **ids, **cookies)
    app.dependency_overrides.clear()

def select(h, pid, code=None, who="owner", path="select"):
    body = {} if code is None else {"passcode": code}
    return h.client.post(f"/api/v1/users/{pid}/{path}", json=body, cookies=getattr(h, who))

def opened(h, pid, who="owner"):
    return h.client.get(f"/api/v1/users/{pid}", cookies=getattr(h, who)).status_code
```
  Tests. Pin these exact values:
  - `test_a_locked_profile_asks_on_every_pick[select|unlock]`:
    1. `select(vault,"4821")` → 200 `{"ok": True}`, and `opened(vault)` → 200.
    2. `select(vault)` with no code → 403 `{"detail": "Incorrect passcode"}`.
    3. `select(vault,"4821")` → 200 again.

    *Catches the mutation that skips the code check when the profile is already open.*
  - `test_picking_another_profile_relocks_the_open_one[select|unlock]`:
    1. `select(vault,"4821")`.
    2. `select(plain)` → 200.
    3. `opened(vault)` → **423**, and `opened(plain)` → 200.

    *Catches append semantics surviving in either endpoint (the spec's "no caller keeps
    append"), and an unlocked pick that does not clear.*
  - `test_picking_a_second_locked_profile_relocks_the_first`:
    1. `select(vault,"4821")`.
    2. `select(legacy,"48213579")` → 200.
    3. `opened(legacy)` → 200, and `opened(vault)` → 423.

    *Also pins that an 8-digit legacy code still verifies; it catches a 4–6 length check
    added to the verify path.*
  - `test_two_tabs_on_unlocked_profiles_never_relock_each_other` (**Review Focus 1**: one cookie
    is one browser, so two tabs share it):
    1. `select(plain)` → 200, then `select(plain2)` → 200 (the second tab's pick).
    2. `opened(plain)` → **200** and `opened(plain2)` → 200.
    3. `h.client.get(f"/api/v1/users/{h.plain}/settings", cookies=h.owner)` → 200.

    *Catches an implementation of "one active profile" that 423s every profile except the last
    pick, locked or not (for example, gating `resolve_profile` on `user_id in unlocked_profiles`
    without the `require_passcode` condition). In a household where nobody uses a lock, that
    turns every second open tab into a wall of 423s. The relock spec §2.3 accepts is for
    **locked** profiles only; `test_picking_another_profile_relocks_the_open_one` pins that half.*
  - `test_deselect_relocks`:
    1. `select(vault,"4821")`.
    2. `POST /api/v1/users/deselect` with the owner cookie → 200 `{"ok": True}`.
    3. `opened(vault)` → 423.

    *Catches a no-op deselect, and a route the router resolves to some other endpoint.*
  - `test_select_takes_no_body_for_an_unlocked_profile`:
    `h.client.post(f"/api/v1/users/{h.plain}/select", cookies=h.owner)` with **no** `json=` → 200.
  - `test_the_sixth_attempt_is_throttled_even_with_the_right_code`:
    1. Five `select(vault,"0000")` → each 403.
    2. `select(vault,"4821")` → 429.
  - `test_a_right_code_resets_the_budget`:
    1. Four `select(vault,"0000")`.
    2. `select(vault,"4821")` → 200.
    3. Five more `select(vault,"0000")` → **every one 403**, never 429.

    *Catches a missing `rate_limiter.reset`: without it, the first of the five returns 429.*
  - `test_select_checks_ownership_before_the_code`:
    - `select(vault,"4821",who="member")` → 403 `{"detail": "Not your profile"}`.
    - `POST /api/v1/users/no-such-id/select` → 404.

    *Catches dropping `_owned_profile`: the endpoint would then answer 200.*
- [ ] **Step 2: Run** `... pytest tests/test_profile_lock.py -v`. Expected FAIL: 404 on `/select`
  and `/deselect`. The `unlock` rows fail too: today's `PasscodeUnlockRequest.passcode` is
  required, so every `{}` body (`select(plain, path="unlock")`, `select(vault, path="unlock")`)
  returns **422**, not 200 or 403.
- [ ] **Step 3: Implement** the interfaces above, then the `test_profile_scoping.py` edits listed
  under **Files**.
- [ ] **Step 4: Write the docs.** Add `### Profile lock` to ARCHITECTURE.md. Five sentences:
  1. The session row's `unlocked_profiles` holds at most the active profile.
  2. `POST /users/{id}/select` writes it: `[id]` after a correct code for a locked profile,
     `[]` for an unlocked one, and a code is required on every pick.
  3. `POST /users/deselect` clears it when the UI returns to "Who's watching?".
  4. `resolve_profile` returns 423 for any locked profile that is not in the list.
  5. `/unlock` survives one release as an alias.
- [ ] **Step 5: Run** `... pytest tests/test_profile_lock.py tests/test_profile_scoping.py -v`. Expected PASS.
- [ ] **Step 6: Commit.**
```bash
git add backend/app/models.py backend/app/api/users.py backend/tests/test_profile_lock.py backend/tests/test_profile_scoping.py docs/ARCHITECTURE.md
git commit -m "feat(users): picking a locked profile asks for its code every time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A3: `PUT /users/{id}/passcode` (set, change and remove), with settings no longer touching the lock

**Files:**
- Modify: `app/services/auth.py`: add `PASSCODE_MIN_LEN = 4` and `PASSCODE_MAX_LEN = 6` beside
  `hash_passcode` (`:130`).
- Modify: `app/services/accounts.py`: add `set_passcode` and `clear_passcode`.
- Modify: `app/models.py`:
  - in `UserSettingsUpdate` (`:628-644`), delete `require_passcode` and `passcode`, and rewrite
    the docstring to say the lock lives at `PUT /users/{id}/passcode`;
  - add `PasscodeChangeRequest`.
- Modify: `app/api/users.py`:
  - in `update_user_settings` (`:297-355`), delete the passcode block (`:303`, `:309-328`), the
    422 for "require without hash" (`:335-342`) and the auto-unlock (`:344-355`). Keep
    `row.passcode = None` (`:330-333`);
  - add `import re` and `change_passcode`.
- Modify: `tests/test_profile_scoping.py`:
  - `test_non_numeric_or_out_of_range_passcode_is_refused` (`:291-299`): PUT
    `/users/{owner_profile}/passcode` with `{"new_passcode": bad}`, and add `"1234567"` and
    `"12345678"` to the cases. Both were valid before this change.
  - `test_setting_a_passcode_does_not_lock_out_the_session_that_set_it` (`:302-315`): PUT
    `/passcode` with `{"new_passcode": "4821"}`.
  - `test_turning_the_lock_off_still_requires_the_passcode` (`:327-335`): add a second assertion,
    PUT `/users/{vault}/passcode` with `{"current_passcode": "4821"}` → 423.
- Test: `tests/test_profile_lock.py`.

**Interfaces:**
- Consumes: `_select`'s throttle key and constants, plus `_session_row` (A2).
- Produces:
  - `accounts_service.set_passcode(row: UserSettings, code: str) -> None`. Sets
    `passcode_hash = hash_passcode(code)`, `passcode_len = len(code)`, `require_passcode = True`
    and `passcode = None`.
  - `accounts_service.clear_passcode(row: UserSettings) -> None`. Sets `passcode_hash`,
    `passcode_len` and `passcode` to `None`, and `require_passcode = False`.

    These two are the only request-path writers of the lock (lock on ⇔ hash stored). A4, A5
    and A7 call `clear_passcode`. The one other writer, the boot-time
    `_migrate_plaintext_passcode` (`services/accounts.py:146-160`), sets a hash without touching
    `require_passcode`; A4's pass runs after it and clears whatever it leaves stale.
  - `PasscodeChangeRequest(BaseModel)`: `current_passcode: Optional[str] = None`,
    `new_passcode: Optional[str] = None`.
  - `PUT /users/{user_id}/passcode`: `response_model=UserSettingsResponse`,
    `dependencies=[Depends(require_profile)]`. Steps, in this order:
    1. `new = (payload.new_passcode or "").strip()`. If `new` is non-empty and does not satisfy
       `re.fullmatch(r"[0-9]{%d,%d}" % (PASSCODE_MIN_LEN, PASSCODE_MAX_LEN), new)`, return 422
       `"Passcode must be 4 to 6 digits"`. Use `[0-9]`, **not `str.isdigit()`**, which accepts
       `"١٢٣٤"` (a code the keypad cannot type).
    2. If `row.passcode_hash` is set:
       - run the same throttle check as `_select` on `unlock:{user_id}` (429);
       - `verify_passcode(payload.current_passcode or "", row.passcode_hash)`, or 403
         `"Incorrect passcode"`;
       - reset the throttle.
    3. If `new` is non-empty: `set_passcode`, then `set_active_profile(..., user_id)` on the
       session row. If it is empty: `clear_passcode`.
    4. Return `profile_response(session, profile).settings`.

    The validation in step 1 runs before step 2, so a malformed new code never spends an attempt.

- [ ] **Step 1: Write the failing tests** in `test_profile_lock.py`. Add a helper:
  `put_code(h, pid, who="owner", **body)` → `h.client.put(f"/api/v1/users/{pid}/passcode", json=body, cookies=getattr(h, who))`.
  - `test_a_first_code_turns_the_lock_on_and_keeps_this_session_on_it`:
    1. `put_code(plain, new_passcode="2468")` → 200, with body `require_passcode is True`,
       `has_passcode is True` and `passcode_len == 4`.
    2. `opened(plain)` → 200.
    3. `opened(plain, who="owner2")` → **423**.

    *Catches a missing `require_passcode=True` (owner2 would get 200) and a missing
    `set_active_profile` (owner would get 423).*
  - `test_setting_a_code_relocks_whatever_else_was_open`:
    1. `select(vault,"4821")`.
    2. `put_code(plain, new_passcode="2468")` → 200.
    3. `opened(vault)` → 423.

    *Catches an append.*
  - `test_changing_a_code_needs_the_current_one`:
    1. `select(vault,"4821")`.
    2. `put_code(vault, new_passcode="1111")` → 403 `{"detail": "Incorrect passcode"}`.
    3. `put_code(vault, current_passcode="0000", new_passcode="1111")` → 403.
    4. `put_code(vault, current_passcode="4821", new_passcode="1111")` → 200.
    5. Deselect, then `select(vault,"4821")` → 403 and `select(vault,"1111")` → 200.
  - `test_removing_a_code_needs_the_current_one_and_turns_the_lock_off`, parametrized over
    `body in ({"current_passcode": "4821"}, {"current_passcode": "4821", "new_passcode": ""})`:
    1. `select(vault,"4821")`.
    2. `put_code(vault, new_passcode="")` → 403.
    3. `put_code(vault, **body)` → 200, with body `require_passcode is False`,
       `has_passcode is False` and `passcode_len is None`.
    4. `opened(vault, who="owner2")` → 200.

    *Catches leaving `require_passcode` set (owner2 would get 423).*
  - `test_new_codes_are_4_to_6_digits`:
    - parametrized bad cases `["123","1234567","12345678","12a4","12 34","abcd","١٢٣٤"]`:
      `put_code(plain, new_passcode=bad)` → 422 `{"detail": "Passcode must be 4 to 6 digits"}`;
    - parametrized good cases `["1234","123456"]` → 200.

    *The Arabic-Indic case catches `isdigit()`. The two boundaries catch `<` against `<=`.*
  - `test_a_legacy_code_can_still_be_changed_and_removed`:
    1. `select(legacy,"48213579")`.
    2. `put_code(legacy, current_passcode="48213579", new_passcode="2468")` → 200, and
       `passcode_len == 4`.
    3. `put_code(legacy, current_passcode="2468")` → 200, with `has_passcode is False`.

    *Catches the 4–6 rule applied to `current_passcode` as well as `new_passcode`: an
    8-digit holder could then never change or remove their code.*
  - `test_a_wrong_current_code_spends_the_select_budget`:
    1. `select(vault,"4821")`.
    2. Five `put_code(vault, current_passcode="0000", new_passcode="1111")` → each 403.
    3. `select(vault,"4821")` → **429**.

    *Catches a separate throttle key.*
  - `test_settings_no_longer_change_the_lock`:
    1. `select(vault,"4821")`.
    2. PUT `/users/{vault}/settings` with
       `{"require_passcode": False, "passcode": "", "maturity_restriction": "pg13"}` → 200,
       and the body shows `require_passcode is True`, `has_passcode is True` and
       `maturity_restriction == "pg13"`.
    3. `opened(vault, who="owner2")` → 423.
    4. PUT `/users/{plain}/settings` with `{"require_passcode": True, "passcode": "2468"}`
       → 200, with `require_passcode is False` and `has_passcode is False`.
    5. `opened(plain, who="owner2")` → 200.
  - `test_the_passcode_response_carries_no_secret`: the keys of the 200 body from the first test
    include none of `passcode`, `passcode_hash`, `new_passcode` or `current_passcode`.

    *A pin, not a detector for the handler body: `response_model=UserSettingsResponse` strips
    unknown keys. It catches dropping the `response_model` and returning `row.to_dict()`, which
    carries `passcode_hash`.*
- [ ] **Step 2: Run** `... pytest tests/test_profile_lock.py -v -k "code or settings"`. Expected
  FAIL: **404** on `PUT /passcode` (no route has that path yet, so Starlette answers 404, not
  405), and `test_settings_no_longer_change_the_lock` fails because `has_passcode` is False
  after the remove.
- [ ] **Step 3: Implement** the interfaces and the scoping-test edits.
- [ ] **Step 4: Run** `... pytest tests/test_profile_lock.py tests/test_profile_scoping.py tests/test_auto_next_episode.py -v`.
  Expected PASS. `test_auto_next_episode.py` constructs `UserSettingsUpdate` (only with
  `auto_next_episode` and `theme`, so removing the two passcode fields leaves it green). A3 does
  **not** edit that file; Part E's Task E6 rewrites it later, on top of this task's
  `UserSettingsUpdate`.
- [ ] **Step 5: Commit.**
```bash
git add backend/app/services/auth.py backend/app/services/accounts.py backend/app/models.py backend/app/api/users.py backend/tests/test_profile_lock.py backend/tests/test_profile_scoping.py
git commit -m "feat(users): a dedicated passcode endpoint; changing or removing a code needs the current one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A4: The startup pass clears stale hashes

The startup pass clears every stored hash whose lock is off. Before this change, switching the
lock off left the hash behind.

**Files:**
- Modify: `app/services/accounts.py`:
  - add `stale_passcodes_cleared: int = 0` to `MigrationReport` (`:67-74`);
  - add `clear_stale_passcodes`;
  - in `bootstrap` (`:588-606`), add `report.stale_passcodes_cleared = clear_stale_passcodes(session)`
    **after** `migrate_users_to_accounts`.
- Modify: `app/main.py:256-262`: append `f"{report.stale_passcodes_cleared} stale passcode(s) cleared, "`
  to the bootstrap log line. (The `startup` event is edited again later: Part C's C3 adds the
  legacy torrent stamp in its own `try` block **after** this accounts-bootstrap block, and Part
  D's D5 adds the vacuum task after the torrent-manager block. A4 changes only the log line.)
- Test: `tests/test_accounts_migration.py` (unit and bootstrap) and `tests/test_profile_lock.py`
  (startup seam).

**Interfaces:**
- Consumes: `clear_passcode` (A3).
- Produces: `clear_stale_passcodes(session: Session) -> int`. It applies `clear_passcode` to every
  `UserSettings` row with `passcode_hash IS NOT NULL` and a falsy `require_passcode`, flushes,
  and returns the count. It is idempotent. It never sets `require_passcode = True` (spec §2.4).
  It runs from `bootstrap`, which only the startup event calls, and **never from `init_db()`**,
  which runs at import time.

- [ ] **Step 1: Write the failing tests.**
  - In `test_accounts_migration.py`, `test_a_stale_hash_is_cleared_and_a_live_lock_is_kept`:
    1. Create three `_legacy_profile`s with settings rows:
       - `stale`: `require_passcode=False`, `passcode_hash=hash_passcode("4821")`, `passcode_len=4`;
       - `live`: `require_passcode=True`, a hash of `"1357"`, `passcode_len=4`;
       - `bare`: `require_passcode=False`, **no hash**, but a leftover `passcode_len=4`.
    2. `clear_stale_passcodes(db_session) == 1`.
    3. For `stale`: `passcode_hash is None` and `passcode_len is None`.
    4. `live` keeps its hash and `require_passcode is True`.
    5. A second call returns `0`.

    *Catches clearing every hash (`live` loses its hash), and filtering on `passcode_len`
    instead of the hash (`bare` is counted too, so the first call returns 2).*
  - In the same file, `test_bootstrap_clears_a_legacy_plaintext_code_whose_lock_was_off`
    (takes `monkeypatch` and `tmp_path`, and sets `settings.log_path` to `tmp_path`):
    1. `_legacy_profile(db_session, "Ben", settings_kwargs={"require_passcode": False, "passcode": "4821"})`.
    2. `report = accounts_service.bootstrap(db_session)`.
    3. `report.stale_passcodes_cleared == 1`, and the row's `passcode_hash is None`.

    *Catches the pass running before the plaintext migration hashes the code (nothing is
    stale yet, so the hash survives), and `bootstrap` not calling the pass at all.*
  - In `test_profile_lock.py`, `test_the_startup_event_runs_the_pass`. It takes `db_session`,
    `override_get_db`, `monkeypatch` and `tmp_path`, and does **not** use the `home` fixture.
    1. Monkeypatch `settings.log_path` to `tmp_path`, and `"app.main.get_db"` to `override_get_db`.
    2. Add an owner `Account`, a profile, and `UserSettings(require_passcode=False,
       passcode_hash=hash_passcode("4821"), passcode_len=4)`, then commit.
    3. `with TestClient(app): pass`.
    4. `_fresh(db_session)`; the row's `passcode_hash is None`.

    *Catches the call living in `init_db()` (it would run on the real engine, not the test
    database) or being dropped from the startup event. This is the seam review cannot see.*
- [ ] **Step 2: Run** `... pytest tests/test_accounts_migration.py tests/test_profile_lock.py -v -k "stale or startup"`.
  Expected FAIL: `AttributeError: ... has no attribute 'clear_stale_passcodes'`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `-k ""` over both files. Expected PASS.
- [ ] **Step 5: Commit.**
```bash
git add backend/app/services/accounts.py backend/app/main.py backend/tests/test_accounts_migration.py backend/tests/test_profile_lock.py
git commit -m "fix(accounts): clear passcode hashes left behind by a lock that was switched off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A5: Forgot code, owner (`POST /users/{id}/passcode/reset` with the account password)

**Files:**
- Modify: `app/services/auth.py`: add `DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))`
  after `verify_password` (`:142`). Move the explaining comment from `api/auth.py:126-128` with it.
- Modify: `app/api/auth.py:126-129`: delete `_DUMMY_PASSWORD_HASH`, and make `:299` read
  `auth_service.DUMMY_PASSWORD_HASH`.
- Modify: `app/models.py`: add `PasscodeResetWithPasswordRequest`.
- Modify: `app/api/users.py`: add `_PASSCODE_RESET_LIMIT = 5`,
  `_PASSCODE_RESET_WINDOW = 15 * 60` and `reset_passcode_with_password`.
- Test: `tests/test_profile_lock.py`.

**Interfaces:**
- Consumes: `clear_passcode` (A3), and `_session_row` and `set_active_profile` (A1/A2).
- Produces:
  - `PasscodeResetWithPasswordRequest(BaseModel)`: `password: str`.
  - `POST /users/{user_id}/passcode/reset`: `response_model=OkResponse`. It is **not** behind
    `require_profile`, because it has to work on a locked profile. Steps:
    1. `_owned_profile`, which returns 404 or 403 `"Not your profile"`.
    2. Every failure after that raises a fresh 403 `"Incorrect password"`, built by a local
       factory `_bad_password()`, never a shared instance (see the `_bad_credentials` docstring).
    3. Fail before any KDF if `len(password) > auth_service.PASSWORD_MAX_LENGTH`.
    4. Fail before any KDF if
       `rate_limiter.check(f"passcode-reset:{ctx.account_id}", limit=_PASSCODE_RESET_LIMIT, window_seconds=_PASSCODE_RESET_WINDOW)`
       returns False.
    5. Load the `Account` by `ctx.account_id`.
    6. **Always** call `auth_service.verify_password(payload.password, (account.password_hash if account else None) or auth_service.DUMMY_PASSWORD_HASH)`
       through the module attribute, so tests can spy on it.
    7. Fail unless all of these hold: `account` exists, its `role == ROLE_OWNER`, it has a
       `password_hash`, and the verify returned true.
    8. On success: `clear_passcode(row)`, `set_active_profile(..., user_id)`,
       `rate_limiter.reset(f"passcode-reset:{ctx.account_id}")` and
       `rate_limiter.reset(f"unlock:{user_id}")`.

- [ ] **Step 1: Write the failing tests.** Add a helper `reset_pw(h, pid, password, who="owner")`.
  - `test_the_owner_clears_a_forgotten_code_with_the_account_password`:
    1. Five `select(vault,"0000")`, which spends the budget.
    2. `select(legacy,"48213579")` → 200.
    3. `reset_pw(vault, OWNER_PASSWORD)` → 200 `{"ok": True}`.
    4. `opened(vault)` → 200, and `opened(legacy)` → 423.
    5. `opened(vault, who="owner2")` → 200, because the lock is off.
    6. `put_code(vault, new_passcode="2468")` → 200, then deselect.
    7. `select(vault,"2468")` → **200**, not 429.

    *Catches a missing `clear_passcode`/`require_passcode` (owner2 would get 423), a missing
    `set_active_profile`, an append (legacy stays open), and a missing `unlock:` reset.*
  - `test_every_reset_failure_is_one_403`. Collect responses for each case:
    - wrong password on `vault`;
    - the member's session on `kid` with `"anything-at-all"`;
    - a 129-character password on `vault`;
    - after setting the owner's `password_hash = None` in `h.db` and committing,
      `OWNER_PASSWORD` on `vault`.

    Assert all are 403, `len({r.content for r in rs}) == 1`, and
    `rs[0].json() == {"detail": "Incorrect password"}`. Restore the hash, then assert
    `select(vault,"4821")` → 200, so no failure cleared the code.
  - `test_the_reset_always_pays_for_the_kdf`. Monkeypatch `app.services.auth.verify_password`
    with a spy that records `stored` and delegates.
    1. The member's session on `kid` → spy called once with `auth_service.DUMMY_PASSWORD_HASH`.
    2. The owner with `password_hash=None` → called once with `DUMMY_PASSWORD_HASH`.
    3. A 129-character password → spy **not** called.

    *Catches an early return before the KDF, which is the timing oracle, and hashing an
    unbounded input.*
  - `test_the_reset_is_throttled_into_the_same_403`:
    1. Five `reset_pw(vault,"wrong-password-x")` → 403.
    2. `reset_pw(vault, OWNER_PASSWORD)` → 403 with the same body.
    3. `opened(vault, who="owner2")` → 423.
  - `test_the_reset_is_refused_for_another_accounts_profile`:
    1. `reset_pw(kid, OWNER_PASSWORD)` with the owner cookie → 403 `{"detail": "Not your profile"}`.
    2. As the member, `select(kid,"1357",who="member")` → 200, so the code survived.

    *The owner's real password is what discriminates this test. Without `_owned_profile` it
    would verify and clear the member's code.*
- [ ] **Step 2: Run** `... pytest tests/test_profile_lock.py -v -k reset`. Expected FAIL: 404 on
  `POST /passcode/reset`, and `AttributeError` on `DUMMY_PASSWORD_HASH`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `... pytest tests/test_profile_lock.py tests/test_owner_password.py -v`.
  Expected PASS. The owner-password suite proves the dummy-hash move kept sign-in constant.
- [ ] **Step 5: Commit.**
```bash
git add backend/app/services/auth.py backend/app/api/auth.py backend/app/models.py backend/app/api/users.py backend/tests/test_profile_lock.py
git commit -m "feat(users): the owner clears a forgotten profile code with the account password

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A6: The `passcode-reset` email template

This task registers the template on the mail route as well.

**Files:**
- Create: `frontend/src/emails/PasscodeResetEmail.tsx`. Copy the structure of
  `PasswordResetEmail.tsx`: `EmailLayout`, one `Eyebrow`, `H1` with `Accent`, `P`, `CtaButton`,
  `FallbackLink`, `Divider`, and `Inset`/`Meta`.
- Modify: `frontend/src/app/(web)/api/internal/mail/route.ts`: import the template at `:10-13`
  and add the entry at `:32-37`.
- Modify: `frontend/src/emails/__tests__/templates.test.tsx`: add a case to `cases` (`:55-105`)
  and a `describe('passcode-reset email')` block.
- Create: `frontend/src/app/(web)/api/internal/mail/route.test.ts`.

**Interfaces:**
- Produces:
  - `export const subject = 'Reset your FRÈ profile code'`.
  - `export interface PasscodeResetEmailProps { actionUrl: string; profileName?: string | null; expiresInMinutes?: number | null }`.
  - `export const PreviewProps = { actionUrl: 'https://fre.example.com/auth/reset-passcode?token=preview-passcode-token', profileName: 'Kids', expiresInMinutes: 20 }`.
  - A default export, with `PreviewProps` attached as `PasswordResetEmail` does.
  - The `route.ts` entry `'passcode-reset': { component: PasscodeResetEmail, subject: passcodeResetSubject }`.
- Copy rules:
  - Name the profile through one `const name = profileName ?? 'your profile'`, used only
    mid-sentence (never capitalised), and spell the words "your profile" nowhere else in the
    copy. The fallback test below counts occurrences and depends on both.
  - Say plainly that opening the link **doesn’t sign you in**: it only removes the code from that
    profile.
  - State the expiry in the body (`${minutes} minutes`), as PasswordResetEmail does.
  - Use exactly one Eyebrow (`Profile code`), which is the gold-once rule.

- [ ] **Step 1: Write the failing tests.**
  - In `templates.test.tsx`, add the case
    `{ id: 'passcode-reset', subject: passcodeResetSubject, expectedSubject: 'Reset your FRÈ profile code', actionUrl: passcodeResetProps.actionUrl, node: createElement(PasscodeResetEmail, passcodeResetProps) }`.
    The whole palette, gold and CTA battery then runs on it.
  - Also in `templates.test.tsx`, the new block:
    - `it('names the profile')`: the html contains `'Kids'`.
    - `it('falls back when the profile has no name')`: render `named` with the PreviewProps and
      `anon` with `profileName: null`. Assert
      `occurrences(copyOnly(anon), 'your profile') === occurrences(copyOnly(named), 'Kids')`,
      that count is `>= 1`, `occurrences(copyOnly(named), 'your profile') === 0`, and
      `copyOnly(anon)` matches neither `/null|undefined/`.

      *A bare "contains `your profile`" would stay green with the fallback deleted if static
      copy said it anywhere. JSX renders a `null` name as nothing, so the `/null|undefined/`
      check alone cannot see that deletion either.*
    - `it('says the link is not a sign-in')`: `/doesn’t sign you in/`, plus `'20 minutes'`.
  - In `route.test.ts` (`/** @vitest-environment node */`, with
    `import { afterEach, beforeEach, describe, expect, it } from 'vitest'` as the template test does):
    - `beforeEach`: set `process.env.INTERNAL_MAIL_SECRET = 'test-secret'` and delete
      `RESEND_API_KEY`. `afterEach` restores both.
    - Import `{ POST }` from `./route`.
    - Call `POST(new Request('http://x/api/internal/mail', { method: 'POST', headers: { 'x-internal-mail-secret': 'test-secret', 'content-type': 'application/json' }, body: JSON.stringify({ template: 'passcode-reset', to: 'm@example.com', props: { actionUrl: 'https://fre.example.com/auth/reset-passcode?token=t', profileName: 'Kids', expiresInMinutes: 20 } }) }))`.
    - Expect `status === 200` and the JSON body
      `{ delivered: false, reason: 'no_api_key', actionUrl: 'https://fre.example.com/auth/reset-passcode?token=t' }`.

    *Catches the template not being registered: the route would answer 400 `unknown_template`,
    and the backend would log the mail as undelivered while every Python test stays green.*
- [ ] **Step 2: Run** from `frontend/`:
  `npx vitest run src/emails/__tests__/templates.test.tsx "src/app/(web)/api/internal/mail/route.test.ts"`.
  Expected FAIL: `Failed to resolve import "../PasscodeResetEmail"`, and status 400 from the route.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, then `npx tsc --noEmit`. Expected PASS with no type errors.
- [ ] **Step 5: Commit.**
```bash
git add frontend/src/emails/PasscodeResetEmail.tsx frontend/src/emails/__tests__/templates.test.tsx "frontend/src/app/(web)/api/internal/mail/route.ts" "frontend/src/app/(web)/api/internal/mail/route.test.ts"
git commit -m "feat(mail): passcode-reset email for a member's forgotten profile code

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A7: Forgot code, member (emailed link, `POST /auth/reset-passcode`, and `/auth/verify` refusing it)

**Files:**
- Modify: `app/database/models/accounts.py`:
  - add `PURPOSE_PASSCODE_RESET = "passcode_reset"` after `:51`, with a two-line comment: it
    clears one profile's code and never grants a session;
  - add `profile_id = Column(String, nullable=True)` to `AuthToken` (`:163-177`), without an FK
    (deviation 3). `sync_columns` adds it on startup.
- Modify: `app/services/auth.py:249-273`: add a keyword parameter `profile_id: Optional[str] = None`
  to `issue_auth_token` and store it on the row.
- Modify: `app/services/mailer.py`: add `TEMPLATE_PASSCODE_RESET = "passcode-reset"` (`:35-40`),
  `passcode_reset_url(token)` → `_public_url("/auth/reset-passcode", token=token)` (after `:74`),
  and `send_passcode_reset`.
- Modify: `app/api/users.py`:
  - add `_RESET_LINK_LIMIT = 3`, `_RESET_LINK_WINDOW = 15 * 60` and `request_passcode_reset_link`.
    This needs the imports `BackgroundTasks` and `from app.services import mailer`;
  - in `delete_user`'s docstring (`:242-251`), replace "deleting ... is the recovery path" with:
    deletion stays exempt from the passcode gate, but the forgot-code resets
    (`/passcode/reset`, `/passcode/reset-link`) are now the recovery path.
- Modify: `app/api/auth.py`: add `reset_passcode` next to `reset_password` (`:378-440`), and extend
  `verify_token`'s comment at `:458-460` to name `passcode_reset` as a refused purpose too. The
  code there is already correct: `purpose=(PURPOSE_LOGIN, PURPOSE_CLAIM_VERIFY)`.
- Modify: `CLAUDE.md:62`: after the `password_reset` sentence, add: "A `passcode_reset` token
  (a member's "Forgot code?") likewise grants no session: `/auth/verify` refuses it and
  `POST /auth/reset-passcode` is its only consumer. It clears one profile's code and sets no
  cookie."
- Modify: `docs/ARCHITECTURE.md`:
  - append the two forgot-code paths to the `### Profile lock` subsection (A2): the owner
    re-enters the account password at `/users/{id}/passcode/reset`; a member gets an emailed
    `/auth/reset-passcode?token=…` link;
  - add `passcode_reset` to the token sentence at `:114-117`.
- Test: `tests/test_profile_lock.py`.

**Interfaces:**
- Consumes: `clear_passcode` (A3); the `passcode-reset` template (A6); `issue_auth_token`,
  `invalidate_tokens_for` and `consume_auth_token` (`services/auth.py:249-344`).
- Produces:
  - `send_passcode_reset(*, to: str, token: str, profile_name: Optional[str], expires_in_minutes: int) -> MailResult`.
    It calls `_post(TEMPLATE_PASSCODE_RESET, to, {"actionUrl": passcode_reset_url(token), "profileName": profile_name, "expiresInMinutes": expires_in_minutes})`.
  - `POST /users/{user_id}/passcode/reset-link`: `response_model=OkResponse`. It is not behind
    `require_profile`. Steps:
    1. `_owned_profile`.
    2. If `ctx.is_owner`, return 400 `"Use your account password"`. Ownership is checked
       **before** the role.
    3. If `rate_limiter.check(f"passcode-reset-link:{ctx.account_id}", limit=_RESET_LINK_LIMIT, window_seconds=_RESET_LINK_WINDOW)`
       is False, return `OkResponse()` and mint nothing.
    4. Load the `Account` by `ctx.account_id`. If it exists, has an `email`, and
       `row.passcode_hash` is set:
       - `invalidate_tokens_for(session, purpose=PURPOSE_PASSCODE_RESET, account_id=account.id)`;
       - `issue_auth_token(session, email=account.email, purpose=PURPOSE_PASSCODE_RESET, account_id=account.id, profile_id=user_id)`.
    5. **After** the `with` block, `background.add_task(mailer.send_passcode_reset, to=..., token=..., profile_name=profile.display_name, expires_in_minutes=settings.magic_link_ttl_minutes)`.
       This is the module docstring rule at `api/auth.py:14-16`.
    6. Return `OkResponse()`.
  - `POST /auth/reset-passcode`: body `VerifyTokenRequest`, `response_model=OkResponse`, with **no**
    `response: Response` parameter and no cookie. Steps:
    1. `consume_auth_token(session, payload.token, purpose=PURPOSE_PASSCODE_RESET)`.
    2. Load the `User` by `row.profile_id` and the `Account` by `row.account_id`.
    3. Return 410 `"This link is no longer valid."` if the token is None, either row is missing,
       `profile.account_id != account.id`, `account.status != STATUS_ACTIVE`, or
       `account.role != ROLE_MEMBER`. The role check mirrors `/auth/verify`'s owner refusal:
       a link minted before an ownership transfer must not become an owner's mailbox path
       around the password (the owner's path is `/passcode/reset`).
    4. If `profile.settings` exists, `clear_passcode(profile.settings)` and
       `rate_limiter.reset(f"unlock:{profile.id}")`.
    5. Return `OkResponse()`.

    It touches no session's `unlocked_profiles`.

- [ ] **Step 1: Write the failing tests.** Extend the module imports with `PURPOSE_LOGIN` and
  `PURPOSE_PASSCODE_RESET` (from `app.database.models.accounts`), `MailResult` (from
  `app.services.mailer`) and `from urllib.parse import parse_qs, urlparse`. Add a fixture `outbox(monkeypatch)` that replaces
  `app.services.mailer._post` with
  `async def fake(template, to, props): sent.append((template, to, props)); return MailResult(sent=True, delivered=False)`
  and yields `sent`. Add a helper `link(h, pid, who="member")` that POSTs to
  `/api/v1/users/{pid}/passcode/reset-link`, and a helper `token_of(props)` that returns
  `parse_qs(urlparse(props["actionUrl"]).query)["token"][0]`.
  - `test_a_member_clears_a_forgotten_code_by_emailed_link`, the full seam:
    1. `link(kid)` → 200 `{"ok": True}`.
    2. `len(outbox) == 1`. Its template is `"passcode-reset"` and its recipient
       `"member@example.com"`.
    3. `props["actionUrl"].startswith(settings.app_public_url.rstrip("/") + "/auth/reset-passcode?token=")`.
    4. `props["profileName"] == "kid"` and
       `props["expiresInMinutes"] == settings.magic_link_ttl_minutes`.
    5. `h.client.cookies.clear()`, then POST `/api/v1/auth/reset-passcode` with
       `{"token": token_of(props)}` and **no** cookies → 200 `{"ok": True}`, and
       `settings.cookie_name not in r.cookies`.
    6. `opened(kid, who="member")` → 200, because the lock is off, and
       `opened(kid2, who="member")` → **423**: the member's other locked profile is untouched.
    7. The same POST again → 410.

    *Catches each of these: a wrong template id, a link to a backend path, a reset that
    clears every profile on the account instead of the bound one (`kid2` opens), a minted
    session, and a reusable token.*
  - `test_the_reset_link_is_for_members_only`: `link(vault, who="owner")` → 400
    `{"detail": "Use your account password"}`, and `outbox == []`.
  - `test_the_reset_link_refuses_another_accounts_profile`: `link(vault, who="member")` → 403, and
    `outbox == []`.

    *Without the ownership check, the member's role passes and a link to clear the owner's
    vault is mailed to the member.*
  - `test_only_the_newest_link_works`:
    1. `link(kid)` twice.
    2. The first token → 410, and the second → 200.

    *Catches a missing `invalidate_tokens_for`.*
  - `test_the_reset_link_is_throttled_and_constant`:
    1. Four `link(kid)` → all 200, with `len({r.content for r in rs}) == 1`.
    2. `len(outbox) == 3`.
  - `test_verify_refuses_a_passcode_reset_token`:
    1. Mint `raw` with `auth_service.issue_auth_token(h.db, email="member@example.com", purpose=PURPOSE_PASSCODE_RESET, account_id=h.member_id, profile_id=h.kid)`
       and commit.
    2. POST `/api/v1/auth/verify` with `{"token": raw}` → 410, and no session cookie.
    3. POST `/api/v1/auth/reset-passcode` with the same token → 200. The refusal did not burn it.

    *Catches adding the purpose to `verify`'s allowed set.*
  - `test_reset_passcode_refuses_a_login_token`: mint a `PURPOSE_LOGIN` token with
    `account_id=h.member_id` **and `profile_id=h.kid`** →
    `/auth/reset-passcode` → 410, and `select(kid,"1357",who="member")` → 200 afterwards.

    *Catches consuming without a purpose filter. The `profile_id` is what makes it
    discriminate: a login token with no profile would 410 anyway on the missing profile.*
  - `test_reset_passcode_refuses_a_token_that_does_not_match_its_profile`, parametrized over three
    cases:
    - (a) the token's `account_id=h.member_id` but `profile_id=h.vault`;
    - (b) a correct kid token, with the member's `status` set to `"revoked"` in `h.db` before
      the POST;
    - (c) a correct kid token, with the member's `role` set to `ROLE_OWNER` in `h.db` before
      the POST (an ownership transfer after the link was sent).

    Each → 410. For (a), `opened(vault, who="owner2")` → 423. For (b) and (c), re-read kid's
    settings row through `_fresh(h.db)`: its `passcode_hash` is still set.

    *Catches dropping the account-matches-profile check (any member clearing any profile with
    a token minted for themselves), the status check, and the role check.*
- [ ] **Step 2: Run** `... pytest tests/test_profile_lock.py -v -k "link or reset_passcode or verify"`.
  Expected FAIL: a **collection error** for the whole module,
  `ImportError: cannot import name 'PURPOSE_PASSCODE_RESET'`. The `-k` filter does not help;
  that is expected until Step 3.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole lock surface:
  `... pytest tests/test_profile_lock.py tests/test_profile_scoping.py tests/test_owner_password.py tests/test_claim_flow.py tests/test_auth_service.py tests/test_accounts_migration.py -v`.
  Expected PASS.
- [ ] **Step 5: Commit.**
```bash
git add backend/app/database/models/accounts.py backend/app/services/auth.py backend/app/services/mailer.py backend/app/api/users.py backend/app/api/auth.py backend/tests/test_profile_lock.py CLAUDE.md docs/ARCHITECTURE.md
git commit -m "feat(auth): a member clears a forgotten profile code by emailed link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

**Part A exit check.**
- Run the full backend suite once:
  `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/ -q`.
- Then run `tests/test_profile_lock.py` five times in a loop. The rate limiter is a process-wide
  singleton; conftest clears it per test, so any flake here is real:
  `for i in 1 2 3 4 5; do docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_profile_lock.py -q || break; done`.
- `grep -rn "mark_profile_unlocked\|PasscodeUnlockRequest\|_DUMMY_PASSWORD_HASH" backend/app` must print nothing.


---

# Part B — profile lock frontend (web + TV)

Spec §2.1, §2.5–2.7. Consumes Part A's endpoints exactly as the contract names them. Every task leaves `npx vitest run`, `npx tsc --noEmit` and `npm run test:tv` green (run all three from `frontend/`).

**Contract deviations**
1. **TV "Switch profile" relocks from the picker, not the header.** `bigscreen/profiles/page.tsx` calls `usersService.deselectProfile()` once on mount. `_components/Header.tsx` stays as it is. The reasons:
   - The header item is a `next/link` `<Link>`, so a click cannot wait for a request before it navigates.
   - `Header` has no router, and every screen test that renders it would need a new `next/navigation` mock.
   - A call on mount covers every way into the picker: the header link, `LockedRedirect`'s link, and the remote's Back key.

   Neither placement removes the ordering race (see B6), so the deselect is fire-and-forget in both clients.
2. **New names owned by Part B (the contract does not name them):**
   - `UserContext`: `lockedProfileId: string | null`, `changePasscode(...)`, `type PasscodeChangeResult`.
   - `services/users.ts`: `type PasscodeChangeRequest`.
   - `fre/Numpad.tsx`: `type NumpadProps`.
3. **`usersService.unlockProfile` is deleted from the client.** Part A keeps the backend `/unlock` alias. Once B6 lands nothing calls the client method, and `noDeadExports.test.ts` would fail on it.
4. **Removing a code sends `new_passcode: null` explicitly.** The contract allows `None`/`""`. Leaving the field out would also mean "remove", so a request built wrong would remove the lock silently.
5. **Part B writes no email.** Part A's Task A6 creates `emails/PasscodeResetEmail.tsx`, registers the `'passcode-reset'` entry in `api/internal/mail/route.ts`, and pins it with `route.test.ts`. Part A's Task A7 adds `TEMPLATE_PASSCODE_RESET = "passcode-reset"` to `mailer.py`. B5 writes only the landing page and `authService.resetPasscode`.

**Part A decisions this part relies on** (from part-A.md "Notes for Part B"; do not re-derive them)
- A select **without** a code on a locked profile is a wrong code: 403 `"Incorrect passcode"`, and it spends one of the 5 attempts.
- Every failure of `POST /users/{id}/passcode/reset` is one 403 `"Incorrect password"`, including a throttled attempt. The client never sees a 429 there.
- `POST /users/{id}/passcode/reset-link` answers 400 for an owner account and `{ok: true}` for every member call, throttled or not.
- `POST /auth/reset-passcode` needs no session cookie (A7's seam test posts with none), answers 410 for a spent, unknown or mismatched token, and sets no cookie.
- `PUT /users/{id}/settings` silently ignores `passcode` and `require_passcode`, so the old Restrictions form keeps working until B4 lands.

**Rules every task follows**
- A profile counts as locked when `u.settings?.require_passcode` is true. Part A keeps that flag in step with the stored hash and clears stale hashes at startup, so the list `GET /users` returns is the source.
- A client only sends a select **without** a code for a profile the list shows as open.
- A `403` or `423` from that codeless select means the list is stale. The client re-reads the list. It never treats the error as a wrong code. That request spent one attempt; this is accepted, because it happens only when the lock was set somewhere else after the list loaded.
- Each new web test file copies two helpers from `(bigscreen)/bigscreen/profiles/page.test.tsx`: `httpError` (`:21`) and `deferred` (`:54-59`). No shared test helper exists.
- **No new `UserSettings` fixture carries `auto_next_episode`** (it is optional today). Part E's Task E3 deletes that field from the type, and an object literal with the key would then fail `npx tsc --noEmit` in this part's test files (`UserContext.test.tsx`, `ProfileLockSection.test.tsx`, `SettingsView.test.tsx`).

---

### Task B1: `Numpad` component (fre)

**Files:**
- Create: `frontend/src/components/ui/fre/Numpad.tsx`
- Modify: `frontend/src/components/ui/fre/index.ts` (append the export)
- Test: `frontend/src/components/ui/fre/Numpad.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
interface NumpadCommon { label: string; error?: string | null; disabled?: boolean }
interface FixedNumpadProps extends NumpadCommon { length: number; onComplete: (code: string) => void }
interface VariableNumpadProps extends NumpadCommon { minLength: number; maxLength: number; onSubmit: (code: string) => void }
export type NumpadProps = FixedNumpadProps | VariableNumpadProps;   // discriminate on 'length' in props
export function Numpad(props: NumpadProps): JSX.Element;            // also the default export
```
Behaviour the tests pin:
- **Layout.** A 3×4 grid in phone order: `1`–`9`, then the bottom row. The bottom-left cell is blank in fixed mode and an **OK** key (`aria-label="OK"`) in variable mode. Then `0`, then a Delete key (`aria-label="Delete"`, `BackspaceIcon`). Reuse the key classes from `components/shell/PasscodePrompt.tsx:80-85`.
- **Dots.** Above the keys, an `aria-hidden` row of `<span data-dot>`: `length` of them in fixed mode, `maxLength` in variable mode. The first `n` carry `data-filled` and the gold fill. Use the colours from `PasscodePrompt.tsx:60-67`, including the danger border while an error shows. The Numpad owns the entry, so it is the only component that can draw these. PasscodePrompt's own dots go.
- **Fixed mode** calls `onComplete(code)` exactly once, when the entry reaches `length`. Digits beyond `length` are ignored.
- **Variable mode** caps the entry at `maxLength`. It never submits by itself. OK (or Enter) calls `onSubmit(code)` only when `entry.length >= minLength`, and OK is `disabled` below that.
- **Clearing the entry.** After a submit the Numpad keeps its entry. The parent remounts it with a new `key` to clear it. Write this on the component's doc comment.
- **Visible text.** The root is `<div role="group" aria-label={label} tabIndex={-1} onKeyDown=…>`, focused once on mount. It renders `label` as visible text in a `<p>`. It also renders an `sr-only` `<p aria-live="polite">`:
  - fixed mode: `` `${n} of ${length} digits entered` ``
  - variable mode: `` `${n} digits entered` ``

  When `error` is set **and the entry is empty**, it renders `<p role="alert">{error}</p>`. The first key pressed hides it. PasscodePrompt's existing test `'shows the error state and clears the entry…'` (`PasscodePrompt.test.tsx:35-46`) depends on this: the parent passes `error` in and has no way to learn that a key was pressed.
- **Physical keys** are handled **on the root's `onKeyDown`**, never on `window`: `0`–`9` add a digit, `Backspace` deletes, and `Enter` presses OK in variable mode. Each handled key calls `e.preventDefault()`. Without that, Enter on a focused digit button would also *click* that digit.
- **`disabled`** ignores clicks and keys, and sets `disabled` on every key.

- [ ] **Step 1: Write the failing test** `Numpad.test.tsx`. Use `render`, `screen` and `userEvent`, and a `press = (k: string) => userEvent.click(screen.getByRole('button', { name: k }))` helper.
```ts
it('fixed: completes once at length, digits in the order pressed', async () => {
  const onComplete = vi.fn();
  const { container } = render(<Numpad label="Enter your passcode" length={4} onComplete={onComplete} />);
  for (const d of '123') await press(d);
  expect(onComplete).not.toHaveBeenCalled();
  expect(container.querySelectorAll('[data-dot]')).toHaveLength(4);
  expect(container.querySelectorAll('[data-filled]')).toHaveLength(3);
  await press('4');
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledWith('1234');
  await press('5');                                   // beyond length: ignored
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(screen.getByText('4 of 4 digits entered')).toBeInTheDocument();
});
it('fixed: physical digits and Backspace', async () => {
  const onComplete = vi.fn();
  render(<Numpad label="x" length={4} onComplete={onComplete} />);
  await userEvent.keyboard('12{Backspace}345');
  expect(onComplete).toHaveBeenCalledWith('1345');    // no Backspace handling => '1234'
});
it('does not capture keys typed into a field outside it', async () => {
  const onComplete = vi.fn();
  render(<><input aria-label="other" /><Numpad label="x" length={4} onComplete={onComplete} /></>);
  await userEvent.click(screen.getByLabelText('other'));
  await userEvent.keyboard('1234');
  expect(onComplete).not.toHaveBeenCalled();          // a window listener fails this
});
it('variable: OK is disabled below minLength, never auto-submits, caps at maxLength', async () => {
  const onSubmit = vi.fn();
  render(<Numpad label="Choose" minLength={4} maxLength={6} onSubmit={onSubmit} />);
  for (const d of '123') await press(d);
  expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  for (const d of '4567') await press(d);             // 7 is past the cap
  expect(onSubmit).not.toHaveBeenCalled();
  await press('OK');
  expect(onSubmit).toHaveBeenCalledWith('123456');
});
it('variable: Enter on a focused digit submits and does not add that digit', async () => {
  const onSubmit = vi.fn();
  render(<Numpad label="Choose" minLength={4} maxLength={6} onSubmit={onSubmit} />);
  for (const d of '1234') await press(d);
  screen.getByRole('button', { name: '5' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(onSubmit).toHaveBeenCalledWith('1234');
  expect(onSubmit).toHaveBeenCalledTimes(1);
  // The two lines above pass without preventDefault too: the keydown submits '1234' before the
  // button's click. Only the click's leftover digit shows the bug.
  expect(screen.getByText('4 digits entered')).toBeInTheDocument();
});
it('variable: Enter below minLength does nothing', async () => {
  const onSubmit = vi.fn();
  render(<Numpad label="Choose" minLength={4} maxLength={6} onSubmit={onSubmit} />);
  await userEvent.keyboard('123{Enter}');
  expect(onSubmit).not.toHaveBeenCalled();
});
it('disabled ignores presses and disables every key', async () => {
  const onComplete = vi.fn();
  render(<Numpad label="x" length={4} onComplete={onComplete} disabled />);
  screen.getAllByRole('button').forEach((b) => expect(b).toBeDisabled());
  await userEvent.keyboard('1234');
  expect(onComplete).not.toHaveBeenCalled();
});
it('shows the error as an alert and the label as text', () => {
  render(<Numpad label="Enter your passcode" length={4} onComplete={() => {}} error="Incorrect passcode" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Incorrect passcode');
  expect(screen.getByRole('group', { name: 'Enter your passcode' })).toBeInTheDocument();
});
it('hides the error once the next code is started', async () => {
  render(<Numpad label="x" length={4} onComplete={() => {}} error="Incorrect passcode" />);
  await press('1');
  expect(screen.queryByRole('alert')).toBeNull();
});
```
- [ ] **Step 2: Run it and watch it fail.** `npx vitest run src/components/ui/fre/Numpad.test.tsx` should FAIL with `Failed to resolve import "./Numpad"`.
- [ ] **Step 3: Implement** `Numpad.tsx` as specified. Then append to `index.ts`:
  - `export { default as Numpad } from './Numpad';`
  - `export type { NumpadProps } from './Numpad';`
- [ ] **Step 4: Run it and watch it pass.** Run the same command, then `npx tsc --noEmit`.
- [ ] **Step 5: Commit**
```
git add frontend/src/components/ui/fre/Numpad.tsx frontend/src/components/ui/fre/Numpad.test.tsx frontend/src/components/ui/fre/index.ts
git commit -m "feat(fre): Numpad with fixed-length auto-submit and variable-length OK modes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B2: `UserContext` — select every time, restore without selecting, deselect on Switch profile

**Files:**
- Modify: `frontend/src/services/users.ts`
  - Add `selectProfile`, `deselectProfile`, `changePasscode` and `PasscodeChangeRequest`.
  - Rewrite the `has_passcode` doc at `:13-17` so it names `selectProfile()`.
  - Leave `unlockProfile` (`:113-121`) alone for now: the TV still calls it until B6.
- Modify: `frontend/src/context/UserContext.tsx`
  - `selectUser`, `:93-139`
  - boot, `:141-170`
  - `logout`, `:176-181`
  - Delete `isPasscodeRequired`: its type at `:25`, its body at `:211-234` and its `value` entry at `:289`. It has no caller (`grep -rn isPasscodeRequired src` finds only this file), and it encodes the "passcode for restricted content" meaning that spec §2.6 removes.
- Create: `frontend/src/services/users.test.ts`, `frontend/src/context/UserContext.test.tsx`

**Interfaces:**
- Consumes: Part A's `POST /users/{id}/select` `{passcode?}`, `POST /users/deselect` and `PUT /users/{id}/passcode` → `UserSettingsResponse`.
- Produces:
```ts
// services/users.ts
export interface PasscodeChangeRequest { current_passcode?: string; new_passcode?: string | null }
selectProfile(userId: string, passcode?: string): Promise<void>   // POST `/users/${id}/select`, body passcode === undefined ? {} : { passcode }
deselectProfile(): Promise<void>                                  // POST '/users/deselect', no body, no config arg
changePasscode(userId: string, body: PasscodeChangeRequest): Promise<UserSettings>  // PUT `/users/${id}/passcode`
// context/UserContext.tsx
export type PasscodeChangeResult = 'ok' | 'wrong' | 'throttled' | 'error';
lockedProfileId: string | null;            // the stored profile that boot restore found locked (423); null otherwise
changePasscode: (userId: string, body: PasscodeChangeRequest) => Promise<PasscodeChangeResult>;
logout: () => void;                         // unchanged signature
```
Semantics:
- **`selectUser(id, passcode?)`**
  1. ALWAYS `await usersService.selectProfile(id, passcode)` first.
  2. On a rejection, map `429` → `'throttled'`, `403`/`423` → `'locked'`, and anything else → the existing `'error'` path. In every one of those cases, return before fetching anything.
  3. Then run the existing `getUser` + `getUserSettings` fetch, pulled out into a private `openProfile(id)`. `openProfile` keeps today's `catch` (`:125-133`) unchanged: a 423 returns `'locked'`, and anything else sets `error`, drops a matching stored id and returns `'error'`.
  4. On success, `setLockedProfileId(null)`.
- **Boot** calls `openProfile(storedId)` only, never `selectProfile`, so a refresh does not ask again (spec §2.1). If `openProfile` returns `'locked'`, call `setLockedProfileId(storedId)` and keep the stored id.
- **`logout()`**
  1. `usersService.deselectProfile().catch((e) => console.error('Error relocking profile:', e))`, not awaited. A hung request must not trap the user on the profile, because `apiClient` sets no timeout.
  2. Then clear `currentUser`, `userSettings`, the stored id and `lockedProfileId`.
  3. `router.push('/')`.
- **`changePasscode`** calls the service.
  - On success: if `userId === currentUser?.id`, `setUserSettings(response)`; then `void loadUsers()`, so the gate badges refresh. Returns `'ok'`.
  - Maps `403` → `'wrong'`, `429` → `'throttled'`, anything else → `'error'`, leaving the settings as they were.
  - It never touches `isLoading` and shows no toast. `updateUserSettings` (`:260-277`) flips `isLoading`, and `AuthenticatedLayout.tsx:36` swaps the whole page for a spinner while that is set. That would unmount `ProfileLockSection` in the middle of its flow and lose its step.

- [ ] **Step 1: Write the failing tests**

`services/users.test.ts` follows the `services/devices.test.ts` pattern: `vi.mock('./api-client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))`.
```ts
it('select sends the code when there is one', async () => {
  post.mockResolvedValue({ data: { ok: true } });
  await usersService.selectProfile('p1', '4821');
  expect(post).toHaveBeenCalledWith('/users/p1/select', { passcode: '4821' });
});
it('select sends an empty JSON body without a code', async () => {
  // Part A accepts no body too (`payload: Optional[...] = None`); `{}` keeps one request shape.
  post.mockResolvedValue({ data: { ok: true } });
  await usersService.selectProfile('p1');
  expect(post).toHaveBeenCalledWith('/users/p1/select', {});
});
it('deselect posts with no body', async () => {
  post.mockResolvedValue({ data: { ok: true } });
  await usersService.deselectProfile();
  expect(post.mock.calls[0]).toEqual(['/users/deselect']);
});
it('changePasscode PUTs the dedicated route and returns the settings row', async () => {
  put.mockResolvedValue({ data: { id: 's', has_passcode: true } });
  const r = await usersService.changePasscode('p1', { current_passcode: '1111', new_passcode: '2222' });
  expect(put).toHaveBeenCalledWith('/users/p1/passcode', { current_passcode: '1111', new_passcode: '2222' });
  expect(r).toEqual({ id: 's', has_passcode: true });
});
```

`context/UserContext.test.tsx`:
- Mock `@/context/SessionContext` (`useSession: () => ({ account: { id: 'acct-1' }, isLoading: false })`).
- Mock `next/navigation` (`useRouter: () => ({ push })`).
- Mock `react-hot-toast` (`toast: { success: vi.fn(), error: vi.fn() }`).
- Mock `@/services/users`, with `usersService` = `vi.fn()` for each of `getUsers`, `getUser`, `getUserSettings`, `selectProfile`, `deselectProfile`, `changePasscode`, `updateUser` and `updateUserSettings`.
- Add a `Probe` that renders `currentUser?.id ?? 'none'` (`data-testid="current"`), `lockedProfileId ?? 'none'` (`data-testid="locked"`) and `String(isLoading)` (`data-testid="loading"`), and exposes the context through a `let ctx` captured in the render.
- Helpers: `P(id)` builds a `User` row, `P1 = P('p1')`, `P2 = P('p2')`, `SETTINGS` is a full `UserSettings` with `passcode_len: 4`, `renderProvider = () => render(<UserProvider><Probe /></UserProvider>)`, and `booted = () => waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))`.
- `push` is `vi.hoisted(() => vi.fn())`, so the router mock returns the same function every render.
- In `beforeEach`: `localStorage.clear()`, `vi.resetAllMocks()` (not `clearAllMocks`; see the memory note on queued `mockResolvedValueOnce`), then default resolves: `getUsers → [P1, P2]`, `getUser(id) → P(id)`, `getUserSettings → SETTINGS`, `selectProfile → undefined`, `deselectProfile → undefined`.
```ts
it('boot restore reads the stored profile and does not select it', async () => {
  localStorage.setItem('currentUserId', 'p1');
  renderProvider();
  await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p1'));
  expect(usersService.selectProfile).not.toHaveBeenCalled();     // positive control: next test
});
it('selectUser always goes through select first, even with no code', async () => {
  renderProvider(); await booted();
  await act(async () => { expect(await ctx.selectUser('p2')).toBe('ok'); });
  expect(usersService.selectProfile).toHaveBeenCalledWith('p2', undefined);
  expect(vi.mocked(usersService.selectProfile).mock.invocationCallOrder[0])
    .toBeLessThan(vi.mocked(usersService.getUser).mock.invocationCallOrder[0]);
});
it.each([[403, 'locked'], [423, 'locked'], [429, 'throttled'], [500, 'error']] as const)(
  'a %i from select is %s, and nothing is fetched', async (status, result) => {
    vi.mocked(usersService.selectProfile).mockRejectedValue(httpError(status));
    renderProvider(); await booted();
    await act(async () => { expect(await ctx.selectUser('p2', '0000')).toBe(result); });
    expect(usersService.getUser).not.toHaveBeenCalled();
    expect(screen.getByTestId('current')).toHaveTextContent('none');
  });
it('boot restore that meets a 423 lands on the picker with that profile pending its code', async () => {
  localStorage.setItem('currentUserId', 'p1');
  vi.mocked(usersService.getUser).mockRejectedValue(httpError(423));
  renderProvider();
  await waitFor(() => expect(screen.getByTestId('locked')).toHaveTextContent('p1'));
  expect(screen.getByTestId('current')).toHaveTextContent('none');
  expect(usersService.selectProfile).not.toHaveBeenCalled();
});
it('a successful select clears lockedProfileId', async () => {
  /* same 423 boot, then: */ vi.mocked(usersService.getUser).mockResolvedValue(P1);
  await act(async () => { await ctx.selectUser('p1', '4821'); });
  expect(screen.getByTestId('locked')).toHaveTextContent('none');
});
it('Switch profile deselects on the server, then clears the profile', async () => {
  localStorage.setItem('currentUserId', 'p1');
  renderProvider();
  await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p1'));
  act(() => ctx.logout());
  expect(usersService.deselectProfile).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('current')).toHaveTextContent('none');
  expect(localStorage.getItem('currentUserId')).toBeNull();
  expect(push).toHaveBeenCalledWith('/');
});
it.each([
  ['hangs', () => new Promise<void>(() => {})],
  ['fails', () => Promise.reject(new Error('x'))],
] as const)('Switch profile still clears locally when deselect %s', async (_, impl) => {
  vi.mocked(usersService.deselectProfile).mockImplementation(impl);
  localStorage.setItem('currentUserId', 'p1');
  renderProvider();
  await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p1'));
  act(() => ctx.logout());
  expect(screen.getByTestId('current')).toHaveTextContent('none');   // synchronously, not after the request
  expect(push).toHaveBeenCalledWith('/');
});
it('changePasscode applies the returned settings and refreshes the profile list', async () => {
  const saved = deferred<UserSettings>();   // the same hand-settled promise as profiles/page.test.tsx:54
  vi.mocked(usersService.changePasscode).mockReturnValue(saved.promise);
  localStorage.setItem('currentUserId', 'p1');
  renderProvider();
  await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p1'));
  expect(usersService.getUsers).toHaveBeenCalledTimes(1);
  let result!: Promise<PasscodeChangeResult>;
  act(() => { result = ctx.changePasscode('p1', { new_passcode: '12345' }); });
  // Asserted WHILE the request is out: a set-then-reset isLoading is back to false once it settles.
  expect(screen.getByTestId('loading')).toHaveTextContent('false');
  await act(async () => { saved.resolve({ ...SETTINGS, has_passcode: true, require_passcode: true, passcode_len: 5 }); });
  expect(await result).toBe('ok');
  expect(ctx.userSettings?.passcode_len).toBe(5);
  await waitFor(() => expect(usersService.getUsers).toHaveBeenCalledTimes(2));
});
it.each([[403, 'wrong'], [429, 'throttled'], [423, 'error'], [500, 'error']] as const)(
  'changePasscode maps %i to %s and leaves the settings alone', async (status, result) => {
    vi.mocked(usersService.changePasscode).mockRejectedValue(httpError(status));
    localStorage.setItem('currentUserId', 'p1');
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p1'));
    await act(async () => { expect(await ctx.changePasscode('p1', { current_passcode: '1111', new_passcode: '2222' })).toBe(result); });
    expect(ctx.userSettings?.passcode_len).toBe(SETTINGS.passcode_len);
  });
```
Mutations these catch:
- If boot calls `selectUser`, the first test fails.
- If the old "skip select without a code" behaviour comes back, the second test fails.
- If `getUser` is fetched before or alongside select (the old `Promise.all` first), the 403 row fails.
- If `logout` drops the deselect, the Switch profile test fails.
- If `logout` awaits the deselect, the hang row fails (`current` would still be `p1`).
- If `changePasscode` skips `setUserSettings`, the apply test fails.
- If `changePasscode` reuses `updateUserSettings`' `setIsLoading(true)`, the apply test's `loading` line fails.

- [ ] **Step 2: Run them and watch them fail.** `npx vitest run src/services/users.test.ts src/context/UserContext.test.tsx` should FAIL with `usersService.selectProfile is not a function` and the context assertions.
- [ ] **Step 3: Implement** the service functions and the context semantics above. Replace the comment at `UserContext.tsx:102-105` with one saying select runs on every pick and the server holds only the active profile unlocked.
- [ ] **Step 4: Run them and watch them pass.** Run the same command, then `npx vitest run src/components` (ProfileGate and ProfileMenu mock the context and must stay green), then `npx tsc --noEmit`.
- [ ] **Step 5: Commit**
```
git add frontend/src/services/users.ts frontend/src/services/users.test.ts frontend/src/context/UserContext.tsx frontend/src/context/UserContext.test.tsx
git commit -m "feat(profiles): select on every pick, restore without selecting, deselect on switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B2b: A web tab relocked mid-session goes back to the picker

*(Lead's decision: the cross-check found that a tab whose profile is relocked by another tab, which picked a different profile, gets 423s with no way back, and its progress saves fail silently. That is closed here, not accepted.)*

**Files:**
- Modify: `frontend/src/services/api-client.ts` (the response interceptor, `:125-140`)
- Modify: `frontend/src/context/UserContext.tsx`
- Test: `frontend/src/services/api-client.test.ts` (create it if absent), `frontend/src/context/UserContext.test.tsx` (from B2)

**Interfaces:**
- Consumes: B2's `lockedProfileId`, and `openProfile` / boot semantics.
- Produces:
```ts
// services/api-client.ts
export function onProfileLocked(listener: (url: string) => void): () => void  // returns an unsubscribe
```
The interceptor calls every listener with `error.config?.url ?? ''` when `error.response.status === 423`, then still rejects with the original error. 401 handling is unchanged.

- [ ] **Step 1: Write the failing tests**
  - `api-client.test.ts`, `'a 423 notifies onProfileLocked listeners and still rejects'`: mock the adapter so it returns 423 for `GET /users/p1/settings`. Assert the listener got a url containing `/users/p1/settings`, and that the request promise rejects with `response.status === 423`. Unsubscribing stops further calls. This catches an interceptor that swallows the 423, so callers would resolve with `undefined`.
  - `UserContext.test.tsx`, `'a 423 mid-session drops to the picker with that profile pending its code'`: boot onto `p1`, then fire the captured listener with `'/users/p1/progress'`. Assert `current` is empty, `ctx.lockedProfileId === 'p1'`, and `localStorage.currentUserId === 'p1'` is kept. This catches a handler that calls `logout()`, which would clear the stored id and send a deselect.
  - `'a 423 from select itself does not trigger the mid-session drop'`: with no current profile, fire the listener with `'/users/p2/select'`. Assert `lockedProfileId` stays `null`. This catches a codeless pick looping back into the prompt.
- [ ] **Step 2: Run and watch them fail.** Run `npx vitest run src/services/api-client.test.ts src/context/UserContext.test.tsx`. It should FAIL with `onProfileLocked is not a function`.
- [ ] **Step 3: Implement**
  - Add `onProfileLocked` with a module-level `Set` of listeners.
  - `UserContext` subscribes once in an effect and unsubscribes on unmount. It ignores urls ending in `/select` or `/unlock`, and ignores the event while `currentUser` is null.
  - Otherwise it sets `lockedProfileId = currentUser.id`, clears `currentUser` and `userSettings`, and keeps the stored id. It does not call `deselectProfile`.
  - `AuthenticatedLayout` then renders `ProfileGate`, which opens the numpad for `lockedProfileId`. B3 already pins that path for the boot case.
- [ ] **Step 4: Run and watch them pass.** Run the same command, then `npx vitest run src/components` and `npx tsc --noEmit`.
- [ ] **Step 5: Commit**
```
git add frontend/src/services/api-client.ts frontend/src/services/api-client.test.ts frontend/src/context/UserContext.tsx frontend/src/context/UserContext.test.tsx
git commit -m "fix(profiles): a tab relocked mid-session returns to the picker with the numpad open

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B3: PasscodePrompt on Numpad with "Forgot code?"; ProfileGate asks on every locked pick

**Files:**
- Modify: `frontend/src/services/users.ts`. Add `resetPasscodeWithPassword` and `requestPasscodeResetLink`.
- Modify: `frontend/src/components/shell/PasscodePrompt.tsx`. Rewrite the whole file: drop the inline `KEYS` keypad (`:19`, `:71-91`), the dots (`:60-67`) and the `<p>Enter your passcode</p>` subtitle (`:58`), and render `<Numpad>`. The subtitle must go: the Numpad renders the same text as its label, and two matches make the existing `findByText(/enter your passcode/i)` calls in `ProfileGate.test.tsx` throw.
- Modify: `frontend/src/components/shell/ProfileGate.tsx`
  - prompt state `:17`
  - `enter`, `:65-73`
  - the click, `:91`
  - the `PasscodePrompt` usage, `:162-178`
- Test:
  - `frontend/src/components/shell/PasscodePrompt.test.tsx`. The five existing tests stay as they are: the keys keep their accessible names `'1'`–`'9'`, `'0'` and `'Delete'`.
  - `frontend/src/components/shell/ProfileGate.test.tsx`, with the changes listed in Step 1.
  - `frontend/src/services/users.test.ts`, which gets two more tests.

**Interfaces:**
- Consumes:
  - B1 `Numpad`
  - B2 `selectUser`, `lockedProfileId`, `loadUsers`
  - Part A `POST /users/{id}/passcode/reset {password}` (every failure, a throttled one included, is 403 `"Incorrect password"`)
  - Part A `POST /users/{id}/passcode/reset-link` (constant `{ok: true}`)
  - `useSession().account.role` from `context/SessionContext.tsx`
- Produces:
```ts
// services/users.ts
resetPasscodeWithPassword(userId: string, password: string): Promise<void>  // POST `/users/${id}/passcode/reset`, { password }
requestPasscodeResetLink(userId: string): Promise<void>                    // POST `/users/${id}/passcode/reset-link`, no body
// PasscodePrompt props
interface PasscodePromptProps {
  open: boolean; profileId: string; profileName: string; length: number;
  accountRole: 'owner' | 'member' | null;
  onClose: () => void;
  onSubmit: (code: string) => Promise<boolean | string>;   // unchanged meaning
  /** Owner reset succeeded: the code is cleared server-side. */
  onReset: () => void;
}
```

**PasscodePrompt** has three modes, `'code' | 'password' | 'emailed'`. The Modal label stays `` `Enter passcode for ${profileName}` `` and the heading stays the profile name, both as `:55-57` has them today.
- **`'code'` mode.**
  - Renders `<Numpad key={attempt} label="Enter your passcode" length={length || 4} onComplete={…} error={error} disabled={checking} />`.
  - Bump `attempt` after every rejected or thrown submit. That remount is what clears the entry. The error text and the throttle string pass-through stay exactly as `:40-49` has them today.
  - Under the numpad, a text button **"Forgot code?"**:
    - Owner (`accountRole === 'owner'`) → `'password'` mode.
    - Anyone else → call `usersService.requestPasscodeResetLink(profileId)` once, then `'emailed'` mode. If it rejects, show the alert "Could not send the email. Try again." and stay in `'code'` mode.
- **`'password'` mode.**
  - `<form>` holding a `Field` labelled **"Account password"** around `<Input id="passcode-reset-password" type="password" autoComplete="current-password">`, a primary **"Reset passcode"** submit button and a ghost **"Back"** button that returns to `'code'` mode.
  - On submit, `await usersService.resetPasscodeWithPassword(profileId, password)`:
    - success → `onReset()`
    - `403` → alert "Incorrect password". Part A answers a throttled attempt with this same 403, so there is no 429 branch.
    - anything else → "Could not reset the passcode. Try again."
  - No numpad is rendered in this mode, so digits typed into the field cannot feed one.
- **`'emailed'` mode.** The text "Check your email for a link that removes this passcode." plus a primary **"Done"** button that calls `onClose`. There is no Back to the numpad: the code the person forgot is still the only thing it accepts.

**ProfileGate**
- Prompt state becomes `{ id: string } | null`, initialised with `useState(() => (lockedProfileId ? { id: lockedProfileId } : null))`. The gate mounts only after boot finishes, so an initialiser is enough.
- The prompt's user is `users.find(u => u.id === prompt.id)`. If no row matches (a stored id for a deleted profile), render no prompt. Name and length come from that row (`settings?.passcode_len || 4`). Key the `PasscodePrompt` by `` `${id}:${length}` `` so a length that changes after a list refresh remounts it.
- `onClose`: `setPrompt(null); void loadUsers();`. The code may have been removed elsewhere while the prompt was up (a member's emailed link opened on a phone), and without a fresh list the next pick reopens the numpad for a lock that no longer exists.
- `enter(u)`:
  - If `u.settings?.require_passcode`, open the prompt and make **no** call.
  - Otherwise `const r = await selectUser(u.id)`:
    - `'locked'` → open the prompt and `void loadUsers()`. The list was stale; the refresh corrects the length.
    - `'error'` or `'throttled'` → the existing `entryError`.
- `accountRole` comes from `useSession().account?.role ?? null`.
- `onReset`: `setPrompt(null); await loadUsers(); const r = await selectUser(id); if (r !== 'ok') setEntryError('Could not open that profile. Please try again.')`. This calls `selectUser` directly. Going through `enter` would read the stale `require_passcode: true` and reopen the prompt.
- Change the comment at `:65` to: every pick of a locked profile asks.

- [ ] **Step 1: Write the failing tests**

`services/users.test.ts`, two more tests:
```ts
it('resets with the password in the body', async () => {
  post.mockResolvedValue({ data: { ok: true } });
  await usersService.resetPasscodeWithPassword('p1', 'hunter22');
  expect(post).toHaveBeenCalledWith('/users/p1/passcode/reset', { password: 'hunter22' });
});
it('asks for a reset link with no body', async () => {
  post.mockResolvedValue({ data: { ok: true } });
  await usersService.requestPasscodeResetLink('p1');
  expect(post.mock.calls[0]).toEqual(['/users/p1/passcode/reset-link']);
});
```

`PasscodePrompt.test.tsx`:
- Add `const h = vi.hoisted(() => ({ reset: vi.fn(), link: vi.fn() }))` and `vi.mock('@/services/users', () => ({ usersService: { resetPasscodeWithPassword: h.reset, requestPasscodeResetLink: h.link } }))`, plus `beforeEach(() => vi.resetAllMocks())`.
- Add the new props to every render: `profileId="p1" accountRole="member" onReset={() => {}}`.
- New tests:
```ts
it('owner: Forgot code? asks for the account password and resets with it', async () => {
  h.reset.mockResolvedValue(undefined); const onReset = vi.fn();
  render(<PasscodePrompt open profileId="p1" profileName="Ben" length={4} accountRole="owner" onClose={() => {}} onSubmit={vi.fn()} onReset={onReset} />);
  await userEvent.click(screen.getByRole('button', { name: 'Forgot code?' }));
  expect(screen.queryByRole('button', { name: '1' })).toBeNull();
  await userEvent.type(screen.getByLabelText('Account password'), 'hunter22');
  await userEvent.click(screen.getByRole('button', { name: 'Reset passcode' }));
  await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
  expect(h.reset).toHaveBeenCalledWith('p1', 'hunter22');
  expect(h.link).not.toHaveBeenCalled();
});
it.each([[403, 'Incorrect password'], [500, 'Could not reset the passcode. Try again.']] as const)(
  'owner: a %i says "%s" and does not reset', async (status, text) => {
    h.reset.mockRejectedValue(httpError(status)); const onReset = vi.fn();
    // render as owner, Forgot code?, type, submit
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(onReset).not.toHaveBeenCalled();
  });
it('member: Forgot code? sends the link in one press and says to check email', async () => {
  h.link.mockResolvedValue(undefined);
  // render as member
  await userEvent.click(screen.getByRole('button', { name: 'Forgot code?' }));
  expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  expect(h.link).toHaveBeenCalledTimes(1);
  expect(h.link).toHaveBeenCalledWith('p1');
  expect(screen.queryByLabelText('Account password')).toBeNull();
  expect(h.reset).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onClose).toHaveBeenCalledTimes(1);          // render with onClose = vi.fn()
});
it('member: a failed send says so and stays on the numpad', async () => {
  h.link.mockRejectedValue(new Error('net'));
  // ...
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not send the email. Try again.');
  expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
});
it('accepts physical digit keys', async () => {
  const onSubmit = vi.fn().mockResolvedValue(true);
  // render; the Modal focuses the first key inside the numpad
  await userEvent.keyboard('4821');
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('4821'));
});
```

`ProfileGate.test.tsx`:
- Add `role`, `lockedProfileId`, `reset: vi.fn()` and `link: vi.fn()` to the hoisted `h` (`:5-30`).
- Add `vi.mock('@/context/SessionContext', () => ({ useSession: () => ({ account: { role: h.role } }) }))`.
- Add `lockedProfileId: h.lockedProfileId` to the `useUser` mock (`:32-34`).
- Add `resetPasscodeWithPassword: h.reset` and `requestPasscodeResetLink: h.link` to the `usersService` mock (`:35-37`).
- In `beforeEach` (`:41-45`), reset `h.role = 'member'` and `h.lockedProfileId = null`. They are plain fields, so `clearAllMocks` does not reset them, and the boot-locked test below would leak an open prompt into every later test.

Replace `'prompts for the passcode only when the server says the profile is locked'` (`:69-85`) with:
```ts
it('a locked profile asks for its code on every pick, without a codeless select first', async () => {
  render(<ProfileGate />);
  await userEvent.click(screen.getByRole('button', { name: /^ben$/i }));
  expect(await screen.findByText(/enter your passcode/i)).toBeInTheDocument();
  expect(h.selectUser).not.toHaveBeenCalled();            // the default mock is 'ok': a codeless select would enter
  for (const d of '123456') await userEvent.click(screen.getByRole('button', { name: d }));
  await waitFor(() => expect(h.selectUser).toHaveBeenCalledWith('1', '123456'));
  expect(h.selectUser).toHaveBeenCalledTimes(1);
});
it('a profile the list shows open but the server refuses opens the prompt and refreshes the list', async () => {
  h.selectUser.mockResolvedValueOnce('locked');
  render(<ProfileGate />);
  await userEvent.click(screen.getByRole('button', { name: /ava/i }));
  expect(await screen.findByText(/enter your passcode/i)).toBeInTheDocument();
  expect(h.selectUser).toHaveBeenCalledWith('2');
  expect(h.loadUsers).toHaveBeenCalled();
});
it('opens the numpad straight away for the profile boot restore found locked', async () => {
  h.lockedProfileId = '1';
  render(<ProfileGate />);
  expect(screen.getByRole('dialog', { name: 'Enter passcode for Ben' })).toBeInTheDocument();
});
it('an owner reset refreshes the list, then reopens the profile with no code', async () => {
  h.role = 'owner'; h.reset.mockResolvedValue(undefined);
  render(<ProfileGate />);
  await userEvent.click(screen.getByRole('button', { name: /^ben$/i }));
  await userEvent.click(await screen.findByRole('button', { name: 'Forgot code?' }));
  await userEvent.type(screen.getByLabelText('Account password'), 'pw');
  await userEvent.click(screen.getByRole('button', { name: 'Reset passcode' }));
  await waitFor(() => expect(h.selectUser).toHaveBeenCalledWith('1'));
  expect(h.loadUsers.mock.invocationCallOrder[0]).toBeLessThan(h.selectUser.mock.invocationCallOrder[0]);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('closing the prompt refreshes the list', async () => {
  render(<ProfileGate />);
  await userEvent.click(screen.getByRole('button', { name: /^ben$/i }));
  await screen.findByText(/enter your passcode/i);
  expect(h.loadUsers).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');                    // Modal's document Escape handler calls onClose
  await waitFor(() => expect(screen.queryByText(/enter your passcode/i)).toBeNull());
  expect(h.loadUsers).toHaveBeenCalledTimes(1);
});
```
- In `'keeps the prompt open when the passcode is rejected'` (`:87-100`), delete the first `mockResolvedValueOnce('locked')` (`:88`). Ben now opens the prompt with no call, so the single `'locked'` resolve is the wrong code's.
- Mutations these catch:
  - If `enter` loses its `require_passcode` check, the first test fails.
  - If the prompt ignores `lockedProfileId`, the third test fails.
  - If `onReset` goes through `enter`, the fourth test fails (it reopens the prompt and never calls `selectUser('1')`).
  - If `onClose` drops the `loadUsers()`, the close test fails.
  - If the owner and member branches are swapped, both Forgot tests in `PasscodePrompt.test.tsx` fail.
  - If `PasscodePrompt` keeps its own "Enter your passcode" subtitle, every `findByText(/enter your passcode/i)` in `ProfileGate.test.tsx` throws on two matches.
- [ ] **Step 2: Run them and watch them fail.** `npx vitest run src/components/shell src/services/users.test.ts` should FAIL: there is no "Forgot code?" button, and `selectUser` is called for Ben.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run them and watch them pass.** Run the same command, then `npx tsc --noEmit`.
- [ ] **Step 5: Commit**
```
git add frontend/src/services/users.ts frontend/src/services/users.test.ts frontend/src/components/shell/PasscodePrompt.tsx frontend/src/components/shell/PasscodePrompt.test.tsx frontend/src/components/shell/ProfileGate.tsx frontend/src/components/shell/ProfileGate.test.tsx
git commit -m "feat(profiles): ask a locked profile on every pick; Forgot code? on the web numpad

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B4: Settings → Profile lock section; passcode leaves Restrictions

**Files:**
- Create: `frontend/src/components/settings/ProfileLockSection.tsx`
- Modify: `frontend/src/components/settings/SettingsView.tsx`
  - Strip the passcode out of `RestrictionsSection` (`:401-536`).
  - Mount `<ProfileLockSection>` after `RestrictionsSection` in the `effectiveId` block (`:567-577`), **only when `canEdit`**.
  - Drop `Toggle` from the import at `:7` once nothing uses it. (Part D's D8 later re-imports `Toggle` for `StorageAndPlaybackSection` and adds a `useSession()` call plus an owner-only section before `<InstallCard />`, on top of this task's result. B4 adds no `SessionContext` mock to `SettingsView.test.tsx`; D8 adds it.)
- Modify: `frontend/src/services/users.ts`. Delete `require_passcode` and `passcode` from `UserSettingsUpdate` (`:39-49`). The read shape `UserSettings` keeps both flags, because the badge reads them.
- Test: create `frontend/src/components/settings/ProfileLockSection.test.tsx`; modify `frontend/src/components/settings/SettingsView.test.tsx`.

**Interfaces:**
- Consumes: B1 `Numpad` (both modes); B2 `useUser().changePasscode`, `PasscodeChangeResult` and `userSettings`.
- Produces: `export default function ProfileLockSection({ userId, settings }: { userId: string; settings: UserSettings | null }): JSX.Element`.

**Steps of the section.** `step: 'idle' | 'current' | 'new' | 'confirm'` and `intent: 'set' | 'change' | 'remove'`. Every numpad is keyed by step plus attempt, so each one starts empty.

| step | numpad | label |
| --- | --- | --- |
| current | fixed, `length={settings.passcode_len \|\| 4}` | "Enter your current passcode" |
| new | variable, `minLength={4} maxLength={6}` | "Choose a 4–6 digit passcode" |
| confirm | variable, `minLength={4} maxLength={6}` | "Enter it again" |

The current-code numpad uses the stored length, so a legacy 7–8 digit code still works.

**Idle**
- Heading "Profile lock".
- If `settings?.has_passcode`: the text "This profile asks for its passcode every time it is chosen." and two buttons, **"Change passcode"** and **"Remove lock"**.
- Otherwise: the text "Ask for a passcode every time this profile is chosen." and one button, **"Set a passcode"**.

**Flows**
- **set**: new → confirm → `changePasscode(userId, { new_passcode })`.
- **change**: current → new → confirm → `changePasscode(userId, { current_passcode, new_passcode })`.
- **remove**: current → `changePasscode(userId, { current_passcode, new_passcode: null })`.

**Outcomes**
- **The confirm entry does not match the new one.** Show the error "Those didn't match. Start again." and go back to `new`. Nothing is sent.
- **`'ok'`** → back to `idle`. The context has already swapped in the new settings.
- **`'wrong'`** → error "That isn't the current passcode." and go back to `current`.
- **`'throttled'`** → error "Too many attempts. Try again in a few minutes." and go back to `idle`.
- **`'error'`** → error "Could not save. Try again." and go back to `idle`.
- **Cancel.** A ghost "Cancel" button on every non-idle step goes back to `idle` and sends nothing.

The error renders through the Numpad's `error` prop while a numpad is up, and as a `role="alert"` `<p>` in idle.

**RestrictionsSection after this task**
- It keeps only the maturity `Select` and the "Save restrictions" button.
- Its patch is exactly `{ maturity_restriction: maturity }`.
- Delete `requirePasscode`, `passcode`, `confirmPasscode` and their effect lines, the two validation blocks (`:430-439`), the Toggle (`:478-483`) and the `passcode-fields` block (`:485-518`).

- [ ] **Step 1: Write the failing tests**

`ProfileLockSection.test.tsx`:
- Mock `@/context/UserContext`: `useUser: () => ({ changePasscode: h.change })`.
- Render `<ProfileLockSection userId="user-1" settings={…} />` with `OFF = { has_passcode: false, require_passcode: false, passcode_len: null }` or `ON = (len = 4) => ({ has_passcode: true, require_passcode: true, passcode_len: len })`, spread over a full `UserSettings` fixture.
- Helpers: `digits = async (s) => { for (const d of s) await userEvent.click(screen.getByRole('button', { name: d })); }` and `ok = () => userEvent.click(screen.getByRole('button', { name: 'OK' }))`.
```ts
it('no code: Set a passcode → enter → confirm saves with no current code', async () => {
  h.change.mockResolvedValue('ok');
  render(<ProfileLockSection userId="user-1" settings={OFF} />);
  expect(screen.queryByRole('button', { name: 'Remove lock' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Set a passcode' }));
  await digits('1234'); await ok();
  expect(screen.getByRole('group', { name: 'Enter it again' })).toBeInTheDocument();
  await digits('1234'); await ok();
  await waitFor(() => expect(h.change).toHaveBeenCalledWith('user-1', { new_passcode: '1234' }));
  expect(h.change).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Set a passcode' })).toBeInTheDocument();   // back to idle
});
it('a confirmation that does not match starts again and sends nothing', async () => {
  // Set a passcode, 1234 OK, 1235 OK
  expect(screen.getByRole('alert')).toHaveTextContent("Those didn't match. Start again.");
  expect(screen.getByRole('group', { name: 'Choose a 4–6 digit passcode' })).toBeInTheDocument();
  expect(h.change).not.toHaveBeenCalled();
});
it('code set: Change passcode sends current, new and confirmed new', async () => {
  h.change.mockResolvedValue('ok');
  render(<ProfileLockSection userId="user-1" settings={ON(4)} />);
  expect(screen.queryByRole('button', { name: 'Set a passcode' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Change passcode' }));
  await digits('9876');                       // fixed mode: no OK
  await digits('12345'); await ok();
  await digits('12345'); await ok();
  await waitFor(() => expect(h.change).toHaveBeenCalledWith('user-1', { current_passcode: '9876', new_passcode: '12345' }));
});
it('change: a wrong current code says so and asks for it again', async () => {
  h.change.mockResolvedValue('wrong');
  // Change passcode, 9876, 12345 OK, 12345 OK
  expect(await screen.findByRole('alert')).toHaveTextContent("That isn't the current passcode.");
  expect(screen.getByRole('group', { name: 'Enter your current passcode' })).toBeInTheDocument();
});
it('remove: asks for the current code only, then sends new_passcode null', async () => {
  h.change.mockResolvedValue('ok');
  render(<ProfileLockSection userId="user-1" settings={ON(4)} />);
  await userEvent.click(screen.getByRole('button', { name: 'Remove lock' }));
  await digits('9876');
  await waitFor(() => expect(h.change).toHaveBeenCalledWith('user-1', { current_passcode: '9876', new_passcode: null }));
});
it('the current-code numpad uses the stored length, even a legacy eight', async () => {
  h.change.mockResolvedValue('ok');
  render(<ProfileLockSection userId="user-1" settings={ON(8)} />);
  await userEvent.click(screen.getByRole('button', { name: 'Remove lock' }));
  await digits('1234');
  expect(h.change).not.toHaveBeenCalled();
  await digits('5678');
  await waitFor(() => expect(h.change).toHaveBeenCalledWith('user-1', { current_passcode: '12345678', new_passcode: null }));
});
it('throttled says so and returns to idle', async () => { /* 'throttled' → alert 'Too many attempts. Try again in a few minutes.'; 'Remove lock' visible */ });
it('Cancel returns to idle and sends nothing', async () => { /* Set a passcode, 12, Cancel → 'Set a passcode' visible; h.change not called */ });
```
Mutations these catch:
- If remove leaves out `new_passcode`, the remove test fails (exact object).
- If set sends `current_passcode: ''`, the set test fails.
- If the current-code numpad is hard-coded to length 4, the legacy-eight test fails.
- If the comparison against the confirm entry is dropped, the mismatch test fails.

`SettingsView.test.tsx`:
- Rename `'renders the three sections (Profile, Preferences, Restrictions)'` (`:108-117`) to say four sections, and add `expect(screen.getByText('Profile lock')).toBeInTheDocument()`.
- Add `changePasscode: vi.fn()` to the `useUser` mock (`:30-39`).
- **Delete** `'toggling require-passcode reveals the passcode inputs'` (`:155-170`).
- Add:
```ts
it('Restrictions saves the maturity level and nothing about a passcode', async () => {
  render(<SettingsView userId="user-1" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Save restrictions' }));
  await waitFor(() => expect(mockUpdateUserSettings).toHaveBeenCalledWith('user-1', { maturity_restriction: 'none' }));
  expect(screen.queryByText(/require passcode/i)).toBeNull();
  expect(screen.queryByTestId('passcode-fields')).toBeNull();
});
it('does not offer a profile lock for a profile that is not the current one', async () => {
  render(<SettingsView userId="someone-else" />);
  await waitFor(() => expect(screen.getByTestId('system-info')).toBeInTheDocument());
  expect(screen.queryByText('Profile lock')).toBeNull();
});
```
- [ ] **Step 2: Run them and watch them fail.** `npx vitest run src/components/settings` should FAIL with `Failed to resolve import "./ProfileLockSection"` and the missing 'Profile lock' heading.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run them and watch them pass.** Run the same command, then `npx tsc --noEmit`. This also proves nothing else writes `passcode` or `require_passcode` through `UserSettingsUpdate`.
- [ ] **Step 5: Commit**
```
git add frontend/src/components/settings/ProfileLockSection.tsx frontend/src/components/settings/ProfileLockSection.test.tsx frontend/src/components/settings/SettingsView.tsx frontend/src/components/settings/SettingsView.test.tsx frontend/src/services/users.ts
git commit -m "feat(settings): Profile lock section with numpad set/change/remove; passcode leaves Restrictions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B5: `/auth/reset-passcode` page and `authService.resetPasscode`

**Files:**
- Modify: `frontend/src/services/auth.ts`. Add `resetPasscode` after `resetPassword` (`:132-138`).
- Create: `frontend/src/app/(web)/auth/reset-passcode/page.tsx` and `page.test.tsx`. The route is already public: `AuthenticatedLayout.tsx:22` lists the `/auth` prefix, and Part A's endpoint needs no cookie, so a signed-out phone never meets the global 401 redirect.
- Create: `frontend/src/services/auth.test.ts`.
- Not here: the email template, its `route.ts` entry and its tests. Part A's Task A6 owns all three (deviation 5).

**Interfaces:**
- Consumes: Part A `POST /auth/reset-passcode {token}` → `{ok: true}`, 410 for a spent, unknown or mismatched token. The link it lands from is built by Part A's `passcode_reset_url(token)`: `/auth/reset-passcode?token=…`.
- Produces:
```ts
authService.resetPasscode(token: string): Promise<void>   // POST '/auth/reset-passcode', { token }
```

**Page.** A **confirm button**, not an auto-POST on load like `/auth/verify`. A mail scanner that runs page scripts would otherwise silently remove the lock. A button also avoids StrictMode burning the token twice.
- `Suspense` wraps a runner that reads `useSearchParams().get('token')`. Phases: `'confirm' | 'working' | 'done' | 'expired' | 'error'`.
- **No token** → `'expired'` without any call.
- **`'confirm'`**: `AuthShell` with eyebrow "Profile lock", title `<>Remove this profile’s <em>lock</em>.</>`, intro "This removes the passcode from the profile the email was about. You can set a new one in Settings → Profile lock." and a primary `Button` **"Remove the lock"** with `isLoading={phase === 'working'}`. `Button` sets `disabled` while `isLoading` (`fre/Button.tsx:46`), and that is the only double-press guard: no separate ref.
- **Success** → `'done'`: eyebrow "Done", title `<>The lock is <em>off</em>.</>`, `AuthLinkButton href="/"` "Open Freeflix".
- **`410`** → `'expired'`: title `<>That link is <em>spent</em>.</>`, intro "Reset links work once and expire. Ask for a new one with “Forgot code?” on the profile’s keypad."
- **Anything else** → `'error'`: title `<>We could not <em>finish</em> that.</>`, intro "The instance did not answer. Try the link again."

- [ ] **Step 1: Write the failing tests**
```ts
// services/auth.test.ts (devices.test.ts pattern: vi.mock('./api-client', …))
it('resetPasscode sends the token in the BODY, never the path', async () => {
  post.mockResolvedValue({ data: { ok: true } });
  await authService.resetPasscode('secret-token');
  const [path, body] = post.mock.calls[0];
  expect(path).toBe('/auth/reset-passcode');
  expect(path).not.toContain('secret-token');
  expect(body).toEqual({ token: 'secret-token' });
});

// reset-passcode/page.test.tsx (verify/page.test.tsx's mock shape: useSearchParams from a mutable `search`)
it('does nothing until the button is pressed, and a second press while working sends nothing', async () => {
  const pending = deferred<void>();          // hand-settled, as profiles/page.test.tsx:54
  resetPasscode.mockReturnValue(pending.promise);
  render(<ResetPasscodePage />);
  expect(resetPasscode).not.toHaveBeenCalled();
  const btn = screen.getByRole('button', { name: 'Remove the lock' });
  await userEvent.click(btn);
  expect(btn).toBeDisabled();
  await userEvent.click(btn);                // still mounted: the request has not answered
  expect(resetPasscode).toHaveBeenCalledTimes(1);
  expect(resetPasscode).toHaveBeenCalledWith('magic-token');
  await act(async () => { pending.resolve(); });
  expect(await screen.findByText(/the lock is/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open Freeflix' })).toHaveAttribute('href', '/');
});
it('a spent link (410) says so', async () => { resetPasscode.mockRejectedValue(httpError(410)); /* press */ expect(await screen.findByText(/spent/i)).toBeInTheDocument(); });
it('any other failure is not called spent', async () => { resetPasscode.mockRejectedValue(httpError(500)); /* press */ expect(await screen.findByText(/could not/i)).toBeInTheDocument(); expect(screen.queryByText(/spent/i)).toBeNull(); });
it('no token: spent, and nothing is sent', () => { search = new URLSearchParams(''); render(<ResetPasscodePage />); expect(screen.getByText(/spent/i)).toBeInTheDocument(); expect(resetPasscode).not.toHaveBeenCalled(); });
```
- Mutations these catch:
  - Auto-posting on load fails the first page test's opening assertion.
  - Dropping `isLoading` from the button fails `toBeDisabled()` and `toHaveBeenCalledTimes(1)`. The test holds the request open so the button is still mounted for the second press; with a resolved mock the page would already have swapped to `'done'`, and the second click would land on a detached node whatever the guard.
  - Mapping every failure to `'expired'` fails the 500 row.
- [ ] **Step 2: Run them and watch them fail.** `npx vitest run src/services/auth.test.ts 'src/app/(web)/auth/reset-passcode'` should FAIL with `authService.resetPasscode is not a function` and `Failed to resolve import "./page"`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass.** Run the same command, then `npx tsc --noEmit`.
- [ ] **Step 5: Commit**
```
git add frontend/src/services/auth.ts frontend/src/services/auth.test.ts "frontend/src/app/(web)/auth/reset-passcode"
git commit -m "feat(auth): passcode reset link landing page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B6: TV picker — select every pick, relock on arrival, Forgot code?

**Files:**
- Modify: `frontend/src/app/(bigscreen)/bigscreen/profiles/page.tsx`
  - docstring, `:14-32`
  - `FALLBACK_LENGTH` comment, `:39-44`: codes are 4–6, legacy 7–8
  - `MESSAGES` / `tryUnlock`, `:105-126`
  - `Keypad`, `:151-244`
  - mount effect
  - `open`, `:336-365`
  - keypad body, `:419-432`
- Modify: `frontend/src/app/(bigscreen)/_data/useTvProfile.ts`. Rewrite the docstring at `:14-18`: the picker runs select; restore never does.
- Modify: `frontend/src/services/users.ts`. **Delete `unlockProfile`** (`:113-121`).
- Modify: `docs/ARCHITECTURE.md`. Append the client paragraph (Step 3) to the `### Profile lock` subsection that Part A's Task A2 creates and Task A7 extends.
- Test:
  - `frontend/src/app/(bigscreen)/bigscreen/profiles/page.test.tsx`
  - `frontend/src/app/(bigscreen)/_data/useTvProfile.test.tsx`
  - `frontend/src/app/(bigscreen)/journeys.test.tsx`

**Interfaces:**
- Consumes: `usersService.selectProfile` / `deselectProfile` (B2), `usersService.requestPasscodeResetLink` (B3), `authService.me(): Promise<SessionPayload>` (`services/auth.ts`, `account.role`), and `statusOf` (`_data/httpStatus.ts:20`).
- Produces: the page-local `const OWNER_RESET = 'Reset it from Settings → Profile lock on your phone or computer';`. This is the spec's exact text, with no trailing full stop.

**Page behaviour**
- **Mount.** `useEffect(() => { usersService.deselectProfile().catch(() => {}); }, [])`. Do not await it, and gate nothing on it: a hung request must not freeze a remote-only screen.
  - The race is accepted. If a late deselect lands after a select with a code, home's first scoped call gets a 423 and `LockedRedirect` brings the viewer straight back here.
  - Write that on the effect.
- **`open(user)`.** It keeps the `latestOpen` token. Every `await` is followed by `if (mine !== latestOpen.current) return;`.
  1. If `user.settings?.require_passcode`, show the keypad at once: `setLocked({ user, length: user.settings.passcode_len || FALLBACK_LENGTH })`. There is no network call, which is what makes every pick ask, including the profile in use.
  2. Otherwise set `opening`, then `await usersService.selectProfile(user.id)`, with **one** argument:
     - resolved → `enter(user)`
     - `403`/`423` → `getUsers()`. Keep the refreshed list (`setUsers`). If the fresh row is `require_passcode`, show the keypad with the fresh length; if not, or if the re-read fails, go to `'failed'`.
     - anything else → `'failed'`.
  3. Delete the comment at `:340-344`. It argues against reading the list, which is now the design.
- **`tryUnlock(id, code)`** calls `usersService.selectProfile(id, code)`. The status mapping at `:121-124` is unchanged.
- **The keypad's message.**
  - Its state becomes `{ text: string; tone: 'info' | 'error' } | null`.
  - The always-mounted `<p role="alert">` gets the class `` tone === 'info' ? 'bs-note bs-msg' : 'bs-no bs-msg' ``.
  - The existing `MESSAGES` are all `'error'`.
- **"Forgot code?"**
  - A `<button className="bs-btn bs-btn--ghost">Forgot code?</button>` inside `<div className="bs-controls bs-inset">`, below `.bs-keypad`. Every class already has a rule in `public/bigscreen.css` (`:158`, `:196`, `:627`), so the stylesheet does not change.
  - Its focus cell is row 4, column 0: `useFocusGrid({ rowCounts: [...KEY_ROW_COUNTS, 1] })`. `KEY_ROWS` stays 3×4.
  - A new `Keypad` prop, `forgot: () => Promise<{ text: string; tone: 'info' | 'error' }>` (resolves, never rejects), is implemented in the page. A press is ignored while `checking.current` is set (a code is being checked) or while an earlier Forgot press is in flight; a second ref tracks the latter. The button is never `disabled`, for the reason at `:201`.
    ```ts
    try {
      const { account } = await authService.me();
      if (account.role === 'owner') return { text: OWNER_RESET, tone: 'info' };
      await usersService.requestPasscodeResetLink(userId);
      return { text: 'Check your email', tone: 'info' };
    } catch { return { text: 'Could not reach the server. Try again.', tone: 'error' }; }
    ```
  - The role is asked for on each press and never cached, so there is no extra state. The page imports `authService` from `@/services/auth`, which is a service, not `@/components`, so the TV import ban (`legacy-target.test.ts`) still holds.
  - The message is shown only if `alive.current` is still true.

- [ ] **Step 1: Update and add the failing tests**

`profiles/page.test.tsx`, mocks and helpers:
- `vi.mock('@/services/users')` gets `{ getUsers, selectProfile, deselectProfile, requestPasscodeResetLink }`. Drop `getUserSettings` and `unlockProfile`.
- Add `vi.mock('@/services/auth', () => ({ authService: { me: vi.fn() } }))`.
- Replace `unlockProfile` with `selectProfile` everywhere in the file, and every `{ ok: true }` resolved by it with `undefined`. That covers `deferred<{ ok: boolean }>` → `deferred<void>`, at `:627`, `:732` and `:927`.
- `beforeEach` (`:114-123`): `selectProfile.mockResolvedValue(undefined); deselectProfile.mockResolvedValue(undefined); requestPasscodeResetLink.mockResolvedValue(undefined); vi.mocked(authService.me).mockReset();`. Delete the `getUserSettings` default. Setting them here means every row starts from these answers, whatever an earlier row set with `mockImplementation`.
- `openProfile(name, users, probe?)` (`:93-103`): `probe` becomes `selectProfile`'s implementation when given.
- `openKeypad(len)` (`:106-111`): `await openProfile('Mum', [ben(), mum(len)])` with no probe. Mum is locked in the list.
- `openKeypadFromLists` (`:766-767`): delete the `getUserSettings` line and use `selectProfile.mockRejectedValue(httpError(403))`.
- Add `const ava = () => profile('p3', 'Ava');`, an open profile.

`profiles/page.test.tsx`, existing tests that change:
- `'an open profile is selected at once…'` (`:456`): `expect(selectProfile).toHaveBeenCalledWith('p1')` replaces the `getUserSettings` assertion.
- **Replace** `'opens the profile when the server says its passcode was already entered this session'` (`:467-475`). The new behaviour is the opposite:
```ts
it('asks a locked profile for its code on every pick, even the one in use', async () => {
  localStorage.setItem('bs-profile', 'p2');
  await openProfile('Mum', [ben(), mum()]);
  expect(await screen.findByRole('button', { name: '1' })).toBeInTheDocument();
  expect(selectProfile).not.toHaveBeenCalled();     // default mock resolves: a codeless select would enter
  expect(router.replace).not.toHaveBeenCalled();
});
```
- Rename `'a locked profile (423) shows the keypad…'` (`:477`) to `'a profile the list marks locked shows the keypad…'`. The body is unchanged.
- `'keeps one status line…'` (`:504`): `selectProfile.mockReturnValue(pending.promise)` replaces `getUserSettings`. Pending is `deferred<void>`, and the rejection stays `httpError(500)`.
- `'does not treat a 403 (not your profile) as a locked profile'` (`:540`): the probe becomes `() => Promise.reject(httpError(403))`. The re-read returns `[ben()]` (open), so the test still expects the failed alert. It pins "an open fresh row is a failure, not a keypad". It does not pin that the re-read happens: going straight to `'failed'` passes it too. The fresh-length test below is the one that needs the re-read.
- `'only the profile chosen last…'` (`:548-565`): use `[ben(), ava()]` and ids `p1`/`p3`. `selectProfile.mockImplementation((id) => id === 'p1' ? first.promise : second.promise)`, and the clicks are Ben then Ava. Expect `'p3'`.
- `'a profile whose passcode check is still pending when Back is pressed does not raise a keypad'` (`:885-891`): this must hold the **re-read** open, not the select. A Back pressed while the select is still out is caught by the check straight after the select, so the check after the re-read would never be reached. The new body:
  ```ts
  const reread = deferred<User[]>();
  // Queued before the click: the rejected select and the re-read both run inside the click's act().
  getUsers.mockResolvedValueOnce([ben(), ava()]).mockReturnValueOnce(reread.promise);
  selectProfile.mockRejectedValue(httpError(403));
  render(<ProfilesPage />);
  const b = await screen.findByRole('button', { name: 'Ava' });
  await act(async () => { b.focus(); fireEvent.click(b); });
  expect(getUsers).toHaveBeenCalledTimes(2);       // the re-read is out
  await back();
  await act(async () => { reread.resolve([ben(), profile('p3', 'Ava', {}, LOCKED)]); });
  expect(document.querySelector('.bs-keypad')).toBeNull();
  ```
  Deleting the `latestOpen` check after the re-read reddens it.
- `'a profile still being opened when Back is pressed is never selected'` (`:871`): open Ben with a pending select (`deferred<void>`) instead of a settings call.

`profiles/page.test.tsx`, new tests:
```ts
it('a profile the list shows open but locked since then gets the keypad at the fresh length', async () => {
  getUsers.mockResolvedValueOnce([ben(), ava()]).mockResolvedValue([ben(), profile('p3', 'Ava', {}, { ...LOCKED, passcode_len: 6 })]);
  selectProfile.mockRejectedValueOnce(httpError(403));
  const { container } = render(<ProfilesPage />);
  const b = await screen.findByRole('button', { name: 'Ava' });
  await act(async () => { b.focus(); fireEvent.click(b); });
  await screen.findByRole('button', { name: '1' });
  expect(dots(container)).toHaveLength(6);
  expect(selectProfile).toHaveBeenCalledTimes(1);
});
it('relocks whatever was open when the picker mounts', async () => {
  getUsers.mockResolvedValue([ben()]);
  render(<ProfilesPage />);
  await screen.findByRole('button', { name: 'Ben' });
  expect(deselectProfile).toHaveBeenCalledTimes(1);
  expect(deselectProfile).toHaveBeenCalledWith();
});
it.each([['hangs', () => new Promise<void>(() => {})], ['fails', () => Promise.reject(new Error('x'))]])(
  'a deselect that %s does not hold up a pick', async (_, impl) => {
    deselectProfile.mockImplementation(impl);
    await openProfile('Ben', [ben(), mum()]);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/bigscreen'));
    expect(selectProfile).toHaveBeenCalledWith('p1');
  });
describe('Forgot code?', () => {
  const forgot = () => screen.getByRole('button', { name: 'Forgot code?' });
  it('sits below the keypad, outside it, one Down from the bottom row', async () => {
    const { container } = await openKeypad();
    expect(container.querySelectorAll('.bs-keypad > .bs-key')).toHaveLength(12);
    expect(container.querySelector('.bs-keypad')!.contains(forgot())).toBe(false);
    await ringPlaced();                       // the ring lands from a passive effect; settle() is not a barrier
    ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'].forEach(arrow);
    expect(document.activeElement).toBe(forgot());
  });
  it('member: one press sends the reset email and says to check it', async () => {
    vi.mocked(authService.me).mockResolvedValue({ account: { role: 'member' }, profiles: [] } as never);
    await openKeypad();
    await act(async () => { fireEvent.click(forgot()); });
    const line = await screen.findByText('Check your email');
    expect(line).toHaveAttribute('role', 'alert');
    expect(line).toHaveClass('bs-note', 'bs-msg');
    expect(line).not.toHaveClass('bs-no');
    expect(requestPasscodeResetLink).toHaveBeenCalledTimes(1);
    expect(requestPasscodeResetLink).toHaveBeenCalledWith('p2');
    expect(router.replace).not.toHaveBeenCalled();
  });
  it('owner: says to reset from the web, and sends nothing', async () => {
    vi.mocked(authService.me).mockResolvedValue({ account: { role: 'owner' }, profiles: [] } as never);
    await openKeypad();
    await act(async () => { fireEvent.click(forgot()); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Reset it from Settings → Profile lock on your phone or computer$/);
    expect(requestPasscodeResetLink).not.toHaveBeenCalled();
  });
  it('an unreachable server is an error, not an email', async () => {
    vi.mocked(authService.me).mockRejectedValue(new Error('net'));
    await openKeypad();
    await act(async () => { fireEvent.click(forgot()); });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not reach the server. Try again.');
    expect(alert).toHaveClass('bs-no');
    expect(requestPasscodeResetLink).not.toHaveBeenCalled();
  });
});
```
Mutations these catch:
- A codeless select first for a locked profile fails `'asks … every pick'`.
- Dropping the re-read fails the fresh-length test.
- Awaiting the deselect fails the `'hangs'` row.
- Swapping the role branch fails both the owner and member tests.
- Putting the button inside `.bs-keypad` fails the 12-key count.
- A missing `1` in `rowCounts` fails the focus walk.
- Deleting the `latestOpen` check after the re-read fails the rewritten Back-while-pending test (`:885`).
- Giving the info tone the `bs-no` class fails the member test.

`_data/useTvProfile.test.tsx`:
- Its `@/services/users` mock (`:6-8`) gets `selectProfile: vi.fn()`.
- Add:
```ts
it('restore never selects: a refresh does not ask again', async () => {
  localStorage.setItem(KEY, 'b');
  getUsers.mockResolvedValue([user('b')]);
  const { result } = renderHook(() => useTvProfile());
  await waitFor(() => expect(result.current.profile?.id).toBe('b'));   // positive control: restore ran
  expect(usersService.selectProfile).not.toHaveBeenCalled();
});
```

`journeys.test.tsx`:
- Add `import type { User } from '@/services/users';` beside the existing `usersService` import (`:55`).
- In the `@/services/users` mock (`:141-152`), replace `unlockProfile` with `selectProfile`, `deselectProfile`, `changePasscode`, `resetPasscodeWithPassword` and `requestPasscodeResetLink`. Every one of them is then made to hang by the `SERVICES` loop, so the existing `'no screen renders with zero focus stops'` row for the picker now also proves that a hung deselect leaves it usable.
- Add `vi.mock('@/services/auth', () => ({ authService: { me: vi.fn() } }))`, import `authService`, and add it to `SERVICES` (`:439-447`). The picker now imports the module, and an unmocked one would load the real `apiClient`.
- Rewrite the profiles `lock: null` comment (`:578-580`): the picker never probes for a 423, because it asks a locked profile for its code on every pick.
- Add a section after the 423 describe (`:1004`):
```ts
describe('Switch profile relocks the profile in use', () => {
  it('the header target is the picker, which relocks on arrival and asks the profile in use for its code', async () => {
    const target = HEADER_TARGETS.find((t) => t.label === 'Switch profile')!;
    expect(routeFor(pathOf(target.href))?.file).toBe('bigscreen/profiles/page.tsx');
    vi.mocked(usersService.getUsers).mockResolvedValue([{ id: BEN.id, username: 'ben', display_name: 'Ben', avatar: null,
      account_id: 'acct-1', created_at: '', settings: { require_passcode: true, has_passcode: true, passcode_len: 4 } } as User]);
    mountScreen(screenFor('bigscreen/profiles/page.tsx'));     // useTvProfile reports BEN as the profile in use
    const ben = await screen.findByRole('button', { name: 'Ben' });
    expect(usersService.deselectProfile).toHaveBeenCalledTimes(1);
    await act(async () => { ben.focus(); fireEvent.click(ben); });
    expect(await screen.findByRole('button', { name: '1' })).toBeInTheDocument();
    expect(usersService.selectProfile).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});
```
- [ ] **Step 2: Run them and watch them fail.** `npx vitest run 'src/app/(bigscreen)/bigscreen/profiles' 'src/app/(bigscreen)/_data/useTvProfile.test.tsx' 'src/app/(bigscreen)/journeys.test.tsx'` should FAIL: `deselectProfile` is never called, there is no "Forgot code?" button, and Mum's keypad does not open without a probe.
- [ ] **Step 3: Implement** the page behaviour above. Delete `unlockProfile` from `services/users.ts`. Then append one paragraph to the `### Profile lock` subsection of `docs/ARCHITECTURE.md` (Part A's A2 creates it and A7 adds the two server-side forgot-code paths; do not repeat those). The paragraph covers:
  - Clients pick a profile through `POST /users/{id}/select`: the web `ProfileGate` and the TV picker.
  - A profile whose list row has `require_passcode` opens the numpad on every pick, with no codeless call.
  - Web boot and `useTvProfile.restore` never select. A 423 at web boot opens the picker with that profile's numpad.
  - Switch profile calls `POST /users/deselect`: web `UserContext.logout`, and the TV picker on mount.
  - "Forgot code?": an owner re-enters the account password on the web; a member gets an emailed `/auth/reset-passcode?token=…` link, which needs a button press. The TV only tells the owner to use the web.
  - Codes are set, changed and removed only in web Settings → Profile lock.
- [ ] **Step 4: Run them and watch them pass.**
  1. Run the same command, then `npx tsc --noEmit`.
  2. Run `npm run test:tv`. `noDeadExports.test.ts` must pass: `unlockProfile` is gone, and every new service member has a production caller.
  3. Check the callers by hand: `grep -rn 'selectProfile\|deselectProfile\|changePasscode\|resetPasscodeWithPassword\|requestPasscodeResetLink\|resetPasscode' frontend/src | grep -v '\.test\.'`. Each name must show a call site, not only its declaration and comments.
  4. Loop the TV suite, per memory "verify-suites-by-looping": `for i in $(seq 25); do npm run test:tv >/dev/null 2>&1 || echo FAIL $i; done`. Report the failure count; it must be 0.
  5. Run `npx vitest run` (the whole suite) 5 times and report the failure count.
- [ ] **Step 5: Commit**
```
git add "frontend/src/app/(bigscreen)/bigscreen/profiles/page.tsx" "frontend/src/app/(bigscreen)/bigscreen/profiles/page.test.tsx" "frontend/src/app/(bigscreen)/_data/useTvProfile.ts" "frontend/src/app/(bigscreen)/_data/useTvProfile.test.tsx" "frontend/src/app/(bigscreen)/journeys.test.tsx" frontend/src/services/users.ts docs/ARCHITECTURE.md
git commit -m "feat(tv): picker selects on every pick, relocks on arrival, Forgot code? on the keypad

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

**Unresolved (for the lead)**
- **No fallback link for members without mail.** `reset-link` answers only `{ok: true}`, with no `action_url` like `MailOutcome`. On an instance with no mail provider, a member cannot reset a forgotten code; the owner can only delete the profile. Part A would have to return the link (and the web prompt show it) to close this.
- **A web tab relocked from elsewhere has no route back to the picker.** The session now holds one open profile, so a second tab on the same browser that picks another profile turns the first tab's profile calls into 423s. Spec §2.3 accepts the relock. The web handles a 423 only at boot; mid-session each page shows its ordinary error. The TV already has `LockedRedirect`. A web equivalent is outside this part.
- **A member whose emailed link was used on another device sees a stale lock on the TV** until the picker is re-entered (Back to home, then Switch profile), because the TV re-reads the list only on mount and after a wrong code.


---

# Part C — Downloads (spec §3, §4.5 deletion rule)

Executes after Parts A and B, before D and E. Consumes nothing from A/B. **Produces** for D:
`Torrent.last_touched_at / finished_at / size_bytes`, `services.watch_share.profile_percents`,
`torrent_manager.remove_torrent` (owned-content-only), `TorrentStatus.vacuum` (declared, left
`None`), `models.VacuumInfo`. **Produces** for E: server-side reuse in `POST /torrents/download`,
`TorrentStatus.file_index`.

## Contract deviations

1. **`owned_content_paths` is not `owned_content_paths(row)`.** A row alone cannot know its
   content name while it is live (the name then comes from the libtorrent handle, which
   `storage.py` cannot see) and cannot know which names its *siblings* under the same
   `save_path` claim. So it is split:
   - `torrent/storage.py`: `owned_content_paths(save_path, claims, sibling_claims, root) -> List[Path]` (pure, filesystem only)
   - `torrent/manager.py`: `TorrentManager._owned_paths(db, row) -> List[Path]` (the row-aware part D calls nothing of; D calls `remove_torrent`).
2. **`VacuumInfo` is defined in Part C** (`app/models.py`, exact contract fields:
   `status: Literal['off','scheduled','kept_watching','active']`, `deletes_at: Optional[datetime]`)
   because `TorrentStatus.vacuum` must be typed. Part D imports it and must not redefine it.
3. **Additions (no contract name existed):** `TorrentStatus.file_index: Optional[int]`;
   `services/torrent_reuse.py` also exports `covers_title(...)`, `pack_contains(...)` and
   `pack_file_index(...)`; `api/torrents.py` gains a module-private `_download_lock(key)`;
   `services/watch_share.py` also exports `percents_from_rows(...)` and `watched_by_map(...)`;
   `services/torrent_touch.py` also exports `mark_finished(...)` and `stamp_legacy_torrents(...)`;
   `torrent/states.py` gains `COMPLETE_STATES`; `storage.py` gains `delete_owned_content`,
   `remove_dir_if_empty`; frontend `src/lib/streamingHref.ts`.
4. **No index on `torrents.account_id`.** The table holds tens of rows; a hand-made index buys
   nothing (YAGNI). Plain nullable column, added by `sync_columns`.
5. **Time convention (contract asked Part C to state it):** every new timestamp is **naive UTC**
   (`utcnow()` = `datetime.now(timezone.utc).replace(tzinfo=None)`), matching the plain
   `DateTime` columns. The API serialises them without a zone; the frontend reads them with the
   existing `src/lib/parseUtc.ts`. Part D compares against `utcnow()` too.

## Conventions used by every backend task

- Test command (repo root):
  `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file>.py -v`
- Manager unit tests build `mgr.TorrentManager.__new__(mgr.TorrentManager)` (no `__init__`, no
  libtorrent session side effects) and `monkeypatch.setattr(mgr, "get_db", override_get_db)` —
  the pattern of `tests/test_prioritize_video_files_list.py:130-146`. Importing
  `app.torrent.manager` still creates the module singleton; that is how every existing manager
  test runs.
- Auth-on HTTP tests copy `tests/test_profile_scoping.py:31-80`: `auth_enabled` fixture,
  `monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)`,
  `app.dependency_overrides[get_db] = override_get_db`, cookies `{settings.cookie_name: token}`
  from `auth_service.create_session(db_session, account)`, `db_session.commit()` before the
  client opens, `app.dependency_overrides.clear()` after.
- Endpoints keep `db: Annotated[Session, Depends(get_db)]` and enter `with db as session:`
  **once**, and **leave that block before calling any `torrent_manager` method** — the manager
  opens its own sessions, and on SQLite (tests) an open read transaction blocks its writer.
- Every task: after the targeted file passes, run the full backend suite once
  (`... python -m pytest tests/ -q --ignore=tests/test_torrent.py --ignore=tests/test_torrent_alternate.py`
  — those two are module-level libtorrent scripts that join a real swarm **during collection**
  and hang without the film already on disk; memory *webos-tv-parked-findings* #21) before
  committing, and run each named mutation by hand
  (copy the file first; verify the mutation landed with `grep` before trusting a green run).

---

### Task C1: Lifecycle columns and the widened `TorrentStatus` wire shape

**Files:**
- Modify: `backend/app/database/models/torrents.py` (imports :1-4; new columns after `meta_data` :46; `to_status` :57-85)
- Modify: `backend/app/models.py` (new models above `TorrentStatus` :429; fields after `episode` :462; rewrite the stale comment :453-458 in Task C6, not here)
- Modify: `backend/app/torrent/states.py` (add `COMPLETE_STATES`)
- Modify: `frontend/src/types/index.ts` (`TorrentStatus` :94-130, new interfaces after it)
- Test: `backend/tests/test_torrent_lifecycle_fields.py` (new)

**Interfaces:**
- Produces (ORM, all `nullable=True`): `Torrent.account_id: String`, `added_at: DateTime`,
  `finished_at: DateTime`, `last_touched_at: DateTime`, `size_bytes: BigInteger`.
- Produces (`app/torrent/states.py`): `COMPLETE_STATES = frozenset({"finished", "seeding"})`.
- Produces (`app/models.py`):
  - `class WatchedBy(BaseModel): profile_id: str; display_name: str; avatar: Optional[str] = None; percent: float`
  - `class VacuumInfo(BaseModel): status: Literal['off', 'scheduled', 'kept_watching', 'active']; deletes_at: Optional[datetime] = None`
  - `class DiskUsageResponse(BaseModel): used_by_downloads_bytes: int; free_bytes: int; total_bytes: int`
  - `TorrentStatus` gains, in this order after `episode`: `size_bytes: Optional[int] = None`,
    `added_at: Optional[datetime] = None`, `finished_at: Optional[datetime] = None`,
    `last_touched_at: Optional[datetime] = None`, `file_index: Optional[int] = None`,
    `watched_by: Optional[List[WatchedBy]] = None`, `vacuum: Optional[VacuumInfo] = None`.
- Produces (TS, `types/index.ts`): `WatchedBy`, `VacuumInfo`, `DiskUsage` interfaces mirroring the
  three models; `TorrentStatus` gains `size_bytes?: number | null; added_at?: string | null;
  finished_at?: string | null; last_touched_at?: string | null; file_index?: number | null;
  watched_by?: WatchedBy[] | null; vacuum?: VacuumInfo | null`.

- [ ] **Step 1: Write the failing tests** in `tests/test_torrent_lifecycle_fields.py`
  (`os.environ.setdefault("DB_PATH", "/tmp/test_torrent_lifecycle_fields.db")` first, like its siblings):
  ```python
  LIFECYCLE = {"account_id", "added_at", "finished_at", "last_touched_at", "size_bytes"}

  def test_sync_columns_adds_the_lifecycle_columns_to_an_old_torrents_table(tmp_path):
      engine = create_engine(f"sqlite:///{tmp_path/'old.db'}")
      with engine.begin() as c:
          c.execute(text("CREATE TABLE torrents (id VARCHAR PRIMARY KEY)"))
      sync_columns(engine, [Torrent.__table__])
      assert LIFECYCLE <= {c["name"] for c in inspect(engine).get_columns("torrents")}

  def test_size_bytes_is_a_bigint():
      # A 4K film is > 2**31 bytes; Integer would overflow on Postgres.
      assert isinstance(Torrent.__table__.c.size_bytes.type, BigInteger)

  def test_to_status_carries_the_lifecycle_fields():
      t = datetime(2026, 11, 5, 10, 0, 0)
      row = Torrent(id="t1", movie_title="M", quality="1080p", state="finished", magnet="m",
                    url="m", save_path="/x", progress=100.0, created_at=t, updated_at=t,
                    size_bytes=5_000_000_000, added_at=t, finished_at=t + timedelta(hours=1),
                    last_touched_at=t + timedelta(hours=2), account_id="acc-1")
      s = row.to_status()
      assert (s.size_bytes, s.added_at, s.finished_at, s.last_touched_at) == (
          5_000_000_000, t, t + timedelta(hours=1), t + timedelta(hours=2))
      assert s.watched_by is None and s.vacuum is None and s.file_index is None
      assert "account_id" not in s.model_dump()   # never on the wire

  @pytest.mark.parametrize("state,expected", [("downloading", 120), ("paused", None),
                                              ("finished", None), ("seeding", None)])
  def test_to_status_reports_eta_only_while_downloading(state, expected):
      row = Torrent(id="t1", movie_title="M", quality="1080p", state=state, magnet="m", url="m",
                    save_path="/x", progress=50.0, created_at=datetime(2026, 1, 1),
                    updated_at=datetime(2026, 1, 1), meta_data={"eta": 120})
      assert row.to_status().eta == expected

  def test_vacuum_status_vocabulary_is_pinned():
      for ok in ("off", "scheduled", "kept_watching", "active"):
          VacuumInfo(status=ok)
      with pytest.raises(ValidationError):
          VacuumInfo(status="deleting")
  ```
  Mutations caught: dropping any of the five columns (first test); `Integer` for size
  (second); a field not mapped in `to_status` — distinct values per field, so a swap of two
  timestamps also fails; the stale-eta gate removed (`paused` row reports 120).
- [ ] **Step 2: Run** — expected FAIL: `ImportError: cannot import name 'VacuumInfo'` (collection).
- [ ] **Step 3: Implement.** Columns with a comment naming the spec (§3.2/§3.3) and that NULL
  `account_id` means "the owner's" (legacy and cron rows). The comment also says why
  `created_at`/`updated_at` are not used: `database/mixins.py:128-129` evaluates
  `default=datetime.now(...)` once at import, so every row holds the process start time (spec
  §3.3: note it, do not fix it here). `to_status` maps the four new
  attributes and gates `eta=meta_data.get('eta') if self.state == 'downloading' else None` (the
  update loop never clears it for a paused/finished row, which is the stale ETA in §3.4). TS
  fields + interfaces. Do not put `account_id` on `TorrentStatus`.
- [ ] **Step 4: Run** the file — expected PASS; then `tests/test_torrent_identity_fields.py`
  (must stay green unchanged); then the full suite. Frontend: `cd frontend && npx tsc --noEmit`.
- [ ] **Step 5: Commit**
  ```
  git add backend/app/database/models/torrents.py backend/app/models.py backend/app/torrent/states.py frontend/src/types/index.ts backend/tests/test_torrent_lifecycle_fields.py
  git commit -m "feat(downloads): lifecycle and ownership columns on torrents, wider TorrentStatus

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task C2: Stamp added / finished / size, and record the starting account in `add_torrent`

**Files:**
- Create: `backend/app/services/torrent_touch.py`
- Modify: `backend/app/torrent/manager.py` — imports (:16-23); update loop body (`torrent.state = state_str` :491, ETA block :502-506); `torrent_finished_alert` branch (:650-672); `state_changed_alert` branch (:758-796); `add_torrent` (:874-923)
- Test: `backend/tests/test_torrent_touch.py` (new)

**Interfaces:**
- Produces (`services/torrent_touch.py`):
  - `utcnow() -> datetime` — naive UTC.
  - `touch_torrent(session: Session, torrent_id: str, now: datetime) -> None` — one
    `UPDATE torrents SET last_touched_at=:now WHERE id=:id` via
    `session.query(Torrent).filter(Torrent.id == torrent_id).update({Torrent.last_touched_at: now}, synchronize_session=False)`;
    does not commit; a missing id is a no-op.
  - `mark_finished(row: Torrent, now: datetime) -> None` — if `row.finished_at is None`: sets
    `finished_at = now` and `last_touched_at = now`; otherwise does nothing.
- Produces: `TorrentManager.add_torrent(movie, torrent, save_path=None, account_id: Optional[str] = None) -> str`
  — the `DbTorrent(...)` at :909 also sets `account_id=account_id, added_at=now, last_touched_at=now`
  with `now = utcnow()` read once.
- Manager imports `from app.services.torrent_touch import utcnow, mark_finished` at module level
  (tests freeze time with `monkeypatch.setattr(mgr, "utcnow", lambda: FROZEN)`).

- [ ] **Step 1: Write the failing tests** (`FROZEN = datetime(2026, 11, 6, 4, 0, 0)`):
  - `test_mark_finished_stamps_once`: row with `finished_at=None`, `last_touched_at=OLD` →
    `mark_finished(row, FROZEN)` → both `== FROZEN`; call again with `FROZEN + 1 day` → both
    still `FROZEN`. Catches: dropping the NULL guard (re-stamping on every tick).
  - `test_touch_torrent_sets_only_that_row` (on `db_session`): rows `a`, `b` with
    `last_touched_at=OLD`; `touch_torrent(db_session, "a", FROZEN); db_session.commit()` → `a ==
    FROZEN`, `b == OLD`; `touch_torrent(db_session, "missing", FROZEN)` does not raise.
  - `test_add_torrent_records_account_and_clock` (async via `asyncio.run`): `__new__` instance,
    `get_db` → `override_get_db`, `inst._add_torrent = lambda *a, **k: object()`,
    `inst.start_update_task = <async no-op>`, `mgr.utcnow` frozen. Movie
    `SimpleNamespace(title="Film", year=None, genre="", tmdb_id=603, media_type="movie", season=None, episode=None)`,
    torrent `SimpleNamespace(id="t-add", quality="1080p", magnet="magnet:?xt=urn:btih:" + "a"*40, url="u", sizes=("1.0 GB", ""))`,
    `save_path=tmp_path / "Film"`, `account_id="acc-7"` → row `account_id == "acc-7"`,
    `added_at == last_touched_at == FROZEN`, `finished_at is None`. A second call without
    `account_id` (id `t-cron`) → `account_id is None` (the cron path, owner's by rule).
  - `test_finish_alert_stamps_finished_at`: copy the shape of
    `tests/test_force_start_release_on_finish.py` but with `get_db` → `override_get_db` and a seeded
    row (`state="downloading"`, `last_touched_at=OLD`); `release_stream_force_start` stubbed;
    `monkeypatch.setattr(mgr.lt, "torrent_finished_alert", _FinishedAlert)` where
    `class _FinishedAlert: pass` and the alert instance gets `.handle = h` → `_handle_alert` → row
    `state == "finished"`, `finished_at == last_touched_at == FROZEN`.
  - `test_state_changed_to_seeding_stamps_finished_at`: same, with
    `monkeypatch.setattr(mgr.lt, "state_changed_alert", _StateAlert)` and
    `alert.state = lt.torrent_status.seeding` (the real enum) → `finished_at == FROZEN`. A
    sibling case with `alert.state = lt.torrent_status.downloading` → `finished_at is None`.
    Catches: stamping on every state change rather than on finished/seeding.
  - `test_update_loop_persists_size_clears_eta_and_stamps_finish` — drives ONE iteration of
    `_update_torrents_status`: `inst.session = SimpleNamespace(pop_alerts=lambda: [])`,
    `inst._last_logged = {tid: 1e18}` (skips the 30 s log branch),
    `monkeypatch.setattr(mgr, "asyncio", SimpleNamespace(sleep=_cancel, CancelledError=asyncio.CancelledError))`
    where `async def _cancel(*a): raise asyncio.CancelledError` (the loop catches it and
    `break`s, :597-599). Handle: `status()` → `SimpleNamespace(state=lt.torrent_status.seeding,
    progress=1.0, download_rate=0, upload_rate=0, num_peers=0, total_wanted=4_500_000_000,
    total_wanted_done=4_500_000_000, has_metadata=True)`, `need_save_resume_data=lambda: False`,
    `has_metadata=lambda: True`. Seed row `state="downloading"`, `meta_data={"eta": 999}`.
    `asyncio.run(inst._update_torrents_status())` → `size_bytes == 4_500_000_000`,
    `meta_data["eta"] is None`, `finished_at == FROZEN`. Second parametrised case:
    `state=lt.torrent_status.downloading, download_rate=100, total_wanted=1000,
    total_wanted_done=400` → `meta_data["eta"] == 6`, `finished_at is None`. Third case:
    `state=lt.torrent_status.finished` (otherwise as the first) → `finished_at == FROZEN` — this
    is the spec's site `:556-567`, which the `:491` call covers; the row pins that claim.
    Catches: eta never cleared; size not persisted; finish stamped while still downloading;
    the `COMPLETE_STATES` check narrowed to `seeding`.
- [ ] **Step 2: Run** — expected FAIL: `ModuleNotFoundError: No module named 'app.services.torrent_touch'`.
- [ ] **Step 3: Implement.**
  - Loop (per torrent, inside the `with get_db() as db:` block): right after
    `torrent.state = state_str` (:491) add `if state_str in COMPLETE_STATES: mark_finished(torrent, utcnow())`
    — this is finish site 1 and covers the `lt.torrent_status.finished` branch at :556 as well;
    in the ETA block (:502-506) add `else: updated_metadata['eta'] = None`; and
    `if status.total_wanted > 0: torrent.size_bytes = int(status.total_wanted)`. No separate
    `has_metadata` check: `total_wanted` is 0 until metadata arrives, so a second guard could
    not be falsified by any fixture (memory *tests-that-cannot-fail*, "two guards where the
    brief saw one"), and the loop rewrites the value every tick anyway.
  - Finish site 2 (:660-663): `mark_finished(torrent, utcnow())` after `torrent.state = 'finished'`.
  - Finish site 3 (:780-781): inside `if torrent and torrent.state != new_state:`, after the
    assignment, `if new_state in COMPLETE_STATES: mark_finished(torrent, utcnow())`.
  - `add_torrent`: new keyword parameter; docstring line for it ("the account that started it;
    None for the schedule cron, which the downloads scope reads as the owner's").
- [ ] **Step 4: Run** the file, then `tests/test_torrents_manager.py`, `tests/test_force_start_release_on_finish.py`,
  `tests/test_client_profile_endpoints.py`, `tests/test_download_select.py` (their `fake_add`
  still takes three args — nothing passes `account_id` yet), then the full suite. Expected PASS.
- [ ] **Step 5: Commit**
  ```
  git add backend/app/services/torrent_touch.py backend/app/torrent/manager.py backend/tests/test_torrent_touch.py
  git commit -m "feat(downloads): stamp added, finished and size on torrents; add_torrent takes the account

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task C3: Every play touches its download; legacy rows get a grace stamp at startup

**Files:**
- Modify: `backend/app/api/streaming.py` (imports :15-24; `create_streaming_progress` :508-553; `update_streaming_progress` :555-597)
- Modify: `backend/app/services/torrent_touch.py` (add `stamp_legacy_torrents`)
- Modify: `backend/app/main.py` (imports; `startup_event` :238 — new block after the accounts bootstrap try/except, whose log line Part A's A4 already extended, and before `start_update_task`. Part D's D5 later adds the vacuum task after the torrent-manager block, so the stamp always runs before the vacuum loop exists)
- Test: `backend/tests/test_torrent_touch.py` (extend), `backend/tests/test_progress_touches_torrent.py` (new)

**Interfaces:**
- Consumes: `touch_torrent`, `utcnow` (C2).
- Produces: `stamp_legacy_torrents(session: Session, now: datetime) -> int` — three bulk
  updates, returns total rows changed, does not commit:
  `added_at = now WHERE added_at IS NULL`; `last_touched_at = now WHERE last_touched_at IS NULL`;
  `finished_at = now WHERE finished_at IS NULL AND state IN COMPLETE_STATES`.
- `app/main.py` imports `from app.services.torrent_touch import stamp_legacy_torrents, utcnow`
  at module level and runs, in its own `try/except Exception` that logs and continues:
  `with get_db() as db: n = stamp_legacy_torrents(db, utcnow()); db.commit()`, logging
  `f"Legacy torrent stamp: {n} field(s) set"`. In the `startup` event, never in `init_db()`.

- [ ] **Step 1: Write the failing tests.**
  - `test_stamp_legacy_torrents` (on `db_session`): row `fin` (state `seeding`, all three NULL),
    row `dl` (state `downloading`, all NULL), row `new` (state `finished`, `added_at=A`,
    `last_touched_at=B`, `finished_at=C`, three distinct values). One call with `FROZEN` →
    `fin` all three `FROZEN`; `dl` added/touched `FROZEN`, `finished_at is None`; `new`
    unchanged `(A, B, C)`. Second call returns `0`. Catches: stamping `finished_at` on an
    unfinished row; overwriting non-NULL values; non-idempotence.
  - `test_startup_runs_the_legacy_stamp`: `calls = []`;
    `monkeypatch.setattr("app.main.stamp_legacy_torrents", lambda db, now: calls.append(now) or 0)`;
    `with TestClient(app): pass` → `len(calls) == 1` and `isinstance(calls[0], datetime)`.
    Catches: the wiring deleted, or moved into `init_db()` (which `TestClient` does not call
    through `app.main`).
  - `tests/test_progress_touches_torrent.py` (auth disabled — `require_profile` is then a
    pass-through, see conftest docstring; `app.dependency_overrides[get_db] = override_get_db`;
    `monkeypatch.setattr("app.api.streaming.utcnow", lambda: FROZEN)`). Seed `User(id="u1",
    username="u1", display_name="U")`, torrents `t1` and `t2` both `last_touched_at=OLD`.
    - `test_post_progress_touches_its_torrent`: `POST /api/v1/streaming/progress/u1` with
      `{"torrent_id": "t1", "movie_id": "movie:603", "current_time": 10, "percentage": 5}` →
      200; `t1.last_touched_at == FROZEN`; `t2 == OLD`.
    - `test_put_progress_touches_the_rows_torrent`: seed `UserStreamingProgress(id="p1",
      user_id="u1", movie_id="movie:603", torrent_id="t2", percentage=1.0)`;
      `PUT /api/v1/streaming/progress/u1/p1` with `{"current_time": 20, "percentage": 6}` →
      200; `t2 == FROZEN`, `t1 == OLD`. This is the web heartbeat path (it never POSTs once it
      has a progress id), so deleting the PUT touch must redden this test alone.
    - `test_put_progress_with_no_torrent_still_saves`: progress row `torrent_id=None` → 200.
- [ ] **Step 2: Run** — expected FAIL: `ImportError: cannot import name 'stamp_legacy_torrents'`.
- [ ] **Step 3: Implement.** POST: `touch_torrent(session, progress.torrent_id, utcnow())` after
  `upsert_progress(...)`, before `session.commit()`. PUT: after the field assignments,
  `if progress_entry.torrent_id: touch_torrent(session, progress_entry.torrent_id, utcnow())`.
  Import `utcnow, touch_torrent` into `api/streaming.py` by name so the test can freeze it there.
  Do **not** touch from `GET /{torrent_id}/video` (per-chunk, no profile identity).
- [ ] **Step 4: Run** both files, then the full suite — expected PASS.
- [ ] **Step 5: Commit**
  ```
  git add backend/app/api/streaming.py backend/app/services/torrent_touch.py backend/app/main.py backend/tests/test_torrent_touch.py backend/tests/test_progress_touches_torrent.py
  git commit -m "feat(downloads): progress writes touch their download; stamp legacy rows at startup

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task C4: Deleting a download deletes only what that torrent owns

The rule (spec §4.5, memory *completed-download-recovery*): `save_path` is
`default_download_path / <label>` and is **shared** by every download of a title; the directory
or file a torrent owns is `save_path / <content name>`, where the name comes from the live handle
(`handle.get_torrent_info().name()` once it has metadata) or, unloaded, from the resume blob's
`name` (present even in an info-dict-less blob). `save_path` itself is removed only if empty
afterwards. This applies to `remove_torrent` (Remove button, and Part D's vacuum) **and** to the
content-guard block path, which has the same `safe_rmtree(save_path)` at `manager.py:2024`.

**Files:**
- Modify: `backend/app/torrent/storage.py` (add three functions; `safe_rmtree` stays for any other caller)
- Modify: `backend/app/torrent/manager.py` — import (:20); `remove_torrent` (:1041-1072); `_block_torrent` (:1994-2026)
- Modify: `backend/tests/test_torrents_manager.py` — replace `test_remove_delete_files_rmtrees` (:156-166)
- Modify: `backend/tests/test_content_guard_manager.py` — `_TI` (:12-19) gains `def name(self): return "Setup.exe"`; `test_block_torrent_removes_deletes_and_marks` (:55) additionally creates `save_path / "Other.Release" / "keep.mkv"` and asserts it survives and that `save_path` still exists (so its old `assert not save_path.exists()` becomes `assert save_path.exists() and not (save_path / "Setup.exe").exists()`)
- Test: `backend/tests/test_owned_content_delete.py` (new)

**Interfaces:**
- Produces (`torrent/storage.py`):
  - `owned_content_paths(save_path: Union[str, Path], claims: Iterable[str], sibling_claims: Iterable[str], root: Union[str, Path]) -> List[Path]`
    — returns `Path(save_path) / c` for each `c` in `claims` that is (a) not in
    `sibling_claims`, (b) a bare component (`c` non-empty, not `"."`/`".."`, no `/` or `\\`,
    `Path(c).name == c`), (c) present (`exists()` or `is_symlink()`), (d) has
    `candidate.parent.resolve() == Path(save_path).resolve()`. Returns `[]` outright unless
    `Path(save_path).resolve()` is `root` resolved or strictly inside it. Sorted, de-duplicated.
  - `delete_owned_content(paths: Iterable[Path]) -> int` — symlink or file → `unlink()`;
    directory → `shutil.rmtree`; returns count removed; logs each.
  - `remove_dir_if_empty(path: Union[str, Path], root: Union[str, Path]) -> bool` — same refusal
    rules as `safe_rmtree` (never `root`, never outside it); `rmdir` only if it is a directory
    with no entries.
- Produces (`torrent/manager.py`, module level): `_v1_hex(magnet: str) -> Optional[str]` —
  `ih = lt.parse_magnet_uri(magnet).info_hashes; return str(ih.v1) if ih.has_v1() else None`;
  any exception → `None` (measured in the backend image, libtorrent 2.0.11: an unparseable
  btih raises `RuntimeError: invalid info-hash`; `str(ih.v1)` is the 40-char lower hex).
- Produces (`TorrentManager`):
  - `_content_claims(self, torrent_id: str, magnet: str, resume_blob: Optional[str]) -> Set[str]`
    — `{name}` (live handle first: `handle.has_metadata()` → `handle.get_torrent_info().name()`;
    else `lt.read_resume_data(decode_resume_data(blob)).name`, falling back to `.ti.name()`; any
    exception → no name) ∪ `{f".{h}.parts"}` when `h = _v1_hex(magnet)` is not None.
    The `.parts` file is libtorrent's partfile for priority-0 pieces (memory
    *libtorrent-priority-mechanics* rule 1) and would otherwise keep `save_path` non-empty for
    ever. Hybrid/v2 partfile spellings are not modelled.
  - `_owned_paths(self, db: Session, row: DbTorrent) -> List[Path]` — `mine =
    self._content_claims(row.id, row.magnet, row.resume_data)`; for every other row whose
    `Path(save_path).resolve()` equals this row's (compare **resolved** paths: rows store
    `downloads/X` relative while blobs store it absolute — memory note trap 2):
    `theirs |= self._content_claims(sib.id, sib.magnet, sib.resume_data)`, and if
    `_v1_hex(sib.magnet)` is **not None and** equals `_v1_hex(row.magnet)`, `theirs |= mine`
    (same torrent twice owns nothing exclusively). Two unknown hashes are NOT "the same
    torrent" — `None == None` must not reach that branch.
    Returns `owned_content_paths(row.save_path, mine, theirs, settings.default_download_path)`.
  - `remove_torrent(torrent_id, delete_files=False) -> bool` — order: (1) if `delete_files`, in a
    `with get_db()` block load the row and compute `owned = self._owned_paths(db, row)` **before**
    the handle leaves the session (the live name needs it); (2) unload the handle as today; (3)
    hard-delete the row as today; (4) if `delete_files`: **if no other row shares this row's
    resolved `save_path`** (lead's decision), `safe_rmtree(save_path, settings.default_download_path)`
    — the directory is wholly this download's, leftovers included; **otherwise**
    `delete_owned_content(owned)` then `remove_dir_if_empty(save_path, settings.default_download_path)`,
    and if `owned` is empty log a WARNING naming the row and the sibling ids (its files are left
    because they cannot be told apart). Compute "has siblings" in step (1) alongside `owned`.
    Return value unchanged.
  - `_block_torrent`: compute `owned` (own `with get_db()` block) before `session.remove_torrent(handle)`,
    then replace the `safe_rmtree(save_path, …)` call with the same two calls as step (4).

- [ ] **Step 1: Write the failing tests** in `tests/test_owned_content_delete.py`. Fixture
  `layout(tmp_path, monkeypatch)`: `root = tmp_path / "downloads"`, `title = root / "Title"`;
  `(title / "Release.A" / "a.mkv")`, `(title / "Release.B" / "b.mkv")`, `(title / "leftover.mkv")`
  all written; `monkeypatch.setattr(mgr.settings, "default_download_path", root)`;
  `mgr.get_db` → `override_get_db`; a `__new__` manager with `active_torrents = {}` and
  `session = SimpleNamespace(remove_torrent=lambda h: None)`. Helper
  `_blind_blob(save_path, name)`: `atp = lt.add_torrent_params(); atp.name = name;
  atp.save_path = str(save_path); return encode_resume_data(lt.write_resume_data_buf(atp))`, and
  every test that uses it first asserts the positive control
  `lt.read_resume_data(decode_resume_data(blob)).name == name` (otherwise "nothing deleted"
  passes for the wrong reason). (Measured in the backend image: an `atp` with only `name` and
  `save_path` round-trips its `name` through `write_resume_data_buf`/`read_resume_data`.)
  Fixture rule: every row's magnet is `"magnet:?xt=urn:btih:" + <40 hex>` with a **distinct**
  hex per row unless the test says otherwise — two rows with unparseable magnets would both
  have hash `None`, and a `None == None` sibling check would then keep A's files and make
  the first test fail for a reason unrelated to `save_path`.
  - `test_remove_deletes_only_its_own_release_dir`: rows A (blob `Release.A`) and B (blob
    `Release.B`), both `save_path=str(title)`. `remove_torrent("A", delete_files=True)` → True;
    `Release.A` gone; `Release.B/b.mkv` and `leftover.mkv` exist; `title` exists. Catches: the
    old `safe_rmtree(save_path)`.
  - `test_last_owner_out_removes_the_empty_title_dir`: only row B, no leftover file, A's dir
    absent → remove B → `not title.exists()`, `root.exists()`. Catches: no empty-dir cleanup, and
    a cleanup that climbs to `root`.
  - `test_a_name_claimed_by_a_sibling_is_kept`: rows A and A2 both with blob `Release.A`,
    different magnets → remove A → `Release.A/a.mkv` exists. Catches: ignoring `sibling_claims`.
  - `test_sibling_spelled_relative_is_still_a_sibling`: `monkeypatch.chdir(tmp_path)`; A stores
    `save_path=str(title)` (absolute), A2 stores `"downloads/Title"` (relative), both blob
    `Release.A` → remove A → `Release.A` survives. Catches: comparing `save_path` strings.
  - `test_same_infohash_sibling_owns_everything`: A has blob `Release.A`; A2 has **no** blob but the
    same magnet `"magnet:?xt=urn:btih:" + "ab" * 20` → remove A → `Release.A` survives.
  - `test_unparseable_magnets_are_not_the_same_torrent`: A (blob `Release.A`) and B (blob
    `Release.B`) both with magnet `"magnet:?x"` → remove A → `Release.A` gone, `Release.B`
    intact. Catches: comparing `_v1_hex` values without the not-None guard.
  - `test_live_handle_name_wins_when_loaded`: row L has no blob;
    `active_torrents["L"] = (SimpleNamespace(has_metadata=lambda: True, get_torrent_info=lambda: SimpleNamespace(name=lambda: "Release.L")), {})`;
    `title / "Release.L" / "l.mkv"` exists → remove L → `Release.L` gone. Catches: reading the
    blob only (a torrent removed mid-download leaves its files).
  - `test_single_file_torrent_owns_its_file`: blob name `leftover.mkv` → that file unlinked,
    `Release.A` and `Release.B` intact.
  - `test_partfile_is_owned`: row with magnet `"magnet:?xt=urn:btih:" + "cd" * 20`, blob
    `Release.A`, and `title / (".%s.parts" % ("cd" * 20))` present → both gone.
  - `test_nothing_known_with_a_sibling_deletes_nothing`: row X with no blob, not loaded, plus
    sibling row B (blob `Release.B`) on the same `save_path` → remove X → True, row gone, every
    fixture file still present, and a WARNING logged naming X (caplog). Catches: falling back to
    `safe_rmtree` while a sibling shares the directory.
  - `test_nothing_known_and_alone_removes_the_title_dir`: row X with no blob, not loaded, no
    other row on that `save_path` → remove X → `not title.exists()`, `root.exists()`. Catches:
    the orphan-files case (lead's decision: an unshared `save_path` is wholly this download's,
    so the last owner out takes the directory with it, leftovers included).
  - `test_last_owner_out_takes_leftovers_too`: only row B (blob `Release.B`), plus a stray
    `leftover.mkv` → remove B → `not title.exists()`. Catches: owned-only deletion when nobody
    else shares the directory, which would leave orphans no one can ever clean up.
  - `test_owned_content_paths_refuses_hostile_names` (pure): `owned_content_paths(title, ["..",
    ".", "", "a/b", "..\\x", "Release.A"], [], root) == [title / "Release.A"]`.
  - `test_owned_content_paths_refuses_a_save_path_outside_root` (pure): `save_path=tmp_path /
    "elsewhere"` containing `x/` → `owned_content_paths(..., ["x"], [], root) == []`.
  - `test_keep_files_deletes_nothing`: `remove_torrent("A", delete_files=False)` → every file
    present (unchanged behaviour).
  - In `tests/test_torrents_manager.py`, replace `test_remove_delete_files_rmtrees` with
    `test_remove_delete_files_removes_own_content_and_empty_dir`: `sub/"Rel"/"f.mkv"`, row
    `resume_data` = the same `atp.name = "Rel"; atp.save_path = str(sub)` recipe written inline
    (that file has no `_blind_blob`; `encode_resume_data` is already imported there) → after
    remove, `not sub.exists()` (the only content was its own).
- [ ] **Step 2: Run** the new file — expected FAIL: `ImportError: cannot import name 'owned_content_paths'`.
- [ ] **Step 3: Implement** per the interfaces above. Log at INFO which paths were deleted and,
  when a claimed name is skipped because a sibling holds it, one line naming the sibling id.
- [ ] **Step 4: Run** the new file, `tests/test_torrents_manager.py`,
  `tests/test_content_guard_manager.py`, `tests/test_resume_data_describes_its_files.py`, then
  the full suite — expected PASS.
- [ ] **Step 5: Commit**
  ```
  git add backend/app/torrent/storage.py backend/app/torrent/manager.py backend/tests/test_owned_content_delete.py backend/tests/test_torrents_manager.py backend/tests/test_content_guard_manager.py
  git commit -m "fix(downloads): delete only a torrent's own content, never its shared save_path

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task C5: Downloads are per-account — scope the management routes, record the starter

**Files:**
- Create: `backend/app/services/torrent_scope.py`
- Modify: `backend/app/api/torrents.py` — imports (:1-23: add `Annotated`, `AuthContext`, `require_session`, `DbTorrent`, scope helpers); `download_movie` (:90-91, :178); `list_torrents` (:239-252); `torrent_action` (:255-271); `batch_action` (:295-322); `delete_torrent` (:325-338)
- Modify: `backend/app/api/activity.py` (:28-38)
- Modify: `backend/tests/test_download_select.py:31` and `backend/tests/test_client_profile_endpoints.py` (its `fake_add`) — signature becomes `async def fake_add(dl_movie, dl_torrent, save_path=None, account_id=None)`
- Modify docs: `docs/ARCHITECTURE.md:66-68`, `CLAUDE.md:60` (see Step 3)
- Test: `backend/tests/test_torrent_scope_api.py` (new)

**Interfaces:**
- Produces (`services/torrent_scope.py`):
  - `visible_to(row, ctx: AuthContext) -> bool` — `ctx.is_owner or (row.account_id is not None and row.account_id == ctx.account_id)`; `row` is anything with `.account_id` (ORM row or a query `Row`).
  - `scope_query(query, ctx: AuthContext)` — `query` unchanged for the owner, else
    `query.filter(Torrent.account_id == ctx.account_id)`.
- Endpoint rules (spec §3.2). Each scoped endpoint gains `ctx: AuthContext = Depends(require_session)`
  (cached with the router-level gate) and, where it needs rows, `db: Annotated[Session, Depends(get_db)]`.
  - `POST /download`: `add_torrent(dl_movie, dl_torrent, save_path, account_id=ctx.account_id)`. Not scoped.
    With auth off, `ctx` is `_DEV_CONTEXT` and the row records `"dev-owner"`; no member can
    match it, so it reads as the owner's exactly like NULL. Accepted — no special case.
  - `GET /list`: owner → unchanged; member → keep only statuses whose id is in
    `{r.id for r in scope_query(session.query(DbTorrent.id), ctx)}`; then the `state` filter.
  - `POST /batch`: same visible-id filter applied to `all_t` before the four selections.
  - `DELETE /{id}` and `POST /action/{id}` with `pause`/`stop`: a module helper
    `_require_visible(db, torrent_id: str, ctx: AuthContext, detail: str) -> None` — owner returns
    immediately (no read); member loads `(DbTorrent.id, DbTorrent.account_id)` and raises
    `HTTPException(404, detail)` when missing or not `visible_to`. `detail` is the route's
    existing not-found text (`"Torrent not found or deletion failed"` / `"Torrent not found or
    action failed"`), so "not yours" and "does not exist" are byte-identical.
  - `POST /action/{id}` with `resume`, `GET /status`, `/sources`, `/{id}/prioritize`, every
    `/streaming/*` route: **unscoped** (Play must work for everyone; the TV resumes on Play).
  - `GET /activity/count`: `scope_query(session.query(DbTorrent.progress).filter(...), ctx)`.

- [ ] **Step 1: Write the failing tests** in `tests/test_torrent_scope_api.py`. Fixture
  `tworld` (auth-on pattern from the conventions section, plus
  `monkeypatch.setattr("app.torrent.manager.get_db", override_get_db)`): accounts `owner`
  (`ROLE_OWNER`), `member` and `other` (both `ROLE_MEMBER`, both `STATUS_ACTIVE`); torrent rows
  `t-owner` (account owner), `t-member` (member), `t-other` (other), `t-legacy` (`account_id=None`),
  all `state="downloading"`, `magnet=f"magnet:?xt=urn:btih:{id}"`, `save_path=f"/tmp/{id}"`.
  Two members, so "member sees own" differs from "member sees non-owner rows".
  - `test_member_lists_only_their_own_downloads`: member `GET /list` ids `== {"t-member"}`;
    owner `== {all four}`. Catches: no filter; NULL treated as visible to members; filtering
    on `account_id != owner`.
  - `test_member_activity_count_is_scoped`: member `active_downloads == 1`, owner `== 4`.
  - `test_member_cannot_delete_another_accounts_download`: member `DELETE /t-other` → 404 with
    `detail == "Torrent not found or deletion failed"` and row still present; `DELETE /t-legacy`
    → 404; `DELETE /t-member` → 200 and row gone; owner `DELETE /t-other` → 200.
  - `test_not_visible_and_missing_are_indistinguishable`: member `DELETE /t-other` and
    `DELETE /nope` give equal `(status_code, json())`.
  - `test_member_cannot_pause_another_accounts_download`: `POST /action/t-other {"action":"pause"}`
    and `{"action":"stop"}` → 404, row state still `downloading`; own `pause` → 200 and row
    `paused`.
  - `test_resume_is_not_scoped`: `monkeypatch.setattr(torrent_manager, "resume_torrent", lambda tid: calls.append(tid) or True)`;
    member `POST /action/t-other {"action":"resume"}` → 200, `calls == ["t-other"]`; member
    `GET /status/t-other` → 200 with `id == "t-other"`. Catches: scoping the play path
    (resume, or the status read the TV polls after Play).
  - `test_batch_acts_only_on_the_visible_set`: member `POST /batch {"action":"pause"}` →
    `[r["id"] for r in results] == ["t-member"]`; `t-other` and `t-owner` still `downloading`.
  - `test_download_records_the_starting_account`: monkeypatch `torrents_api.movie_service.resolve_title_year`
    (→ `("Movie", 2020)`), `torrents_api.catalog.torrents` (one healthy 1080p hit, as
    `test_download_select.py:_hit`), `torrents_api.torrent_manager.add_torrent` with a recorder
    `async def fake_add(m, t, save_path=None, account_id=None)` returning `"t-new"`, and
    `get_torrent_status` returning `Torrent(id="t-new", …).to_status()`. Member
    `POST /download {"tmdb_id": 1}` → 200 and recorded `account_id == member.id`. Catches: the
    endpoint not passing it (recorded `None`).
- [ ] **Step 2: Run** — expected FAIL: member list returns four ids (`assert {...} == {'t-member'}`).
- [ ] **Step 3: Implement** per the interfaces. Update the two `fake_add` signatures. Docs:
  - `docs/ARCHITECTURE.md:66-68` — replace "`torrents.user_id` and `schedules.user_id` are
    account-shaped and remain NULL — a download is an instance-wide commitment, not a personal
    one." with: downloads record the account that started them in `torrents.account_id`
    (`torrents.user_id` is a profile FK and stays NULL); a member sees and manages only their
    account's downloads, the owner sees all, and NULL (pre-change rows, schedule-cron
    downloads) counts as the owner's; Play/stream/resume routes are deliberately unscoped; and
    deleting a download removes only `save_path/<content name>`, never the shared `save_path`
    (`TorrentManager._owned_paths`).
  - `CLAUDE.md:60` — "`torrents.user_id` / `schedules.user_id` are account-shaped and are still
    NULL everywhere" → "`torrents.user_id` / `schedules.user_id` are still NULL everywhere;
    download ownership lives in `torrents.account_id` (NULL = the owner's), enforced in
    `services/torrent_scope.py`".
- [ ] **Step 4: Run** the new file, `tests/test_torrents_api.py`, `tests/test_activity.py`,
  `tests/test_torrent_identity_fields.py`, `tests/test_download_select.py`,
  `tests/test_client_profile_endpoints.py` (all run as the dev owner, so the owner short-circuit
  keeps them DB-free where they were), then the full suite — expected PASS.
- [ ] **Step 5: Commit**
  ```
  git add backend/app/services/torrent_scope.py backend/app/api/torrents.py backend/app/api/activity.py backend/tests/test_torrent_scope_api.py backend/tests/test_download_select.py backend/tests/test_client_profile_endpoints.py docs/ARCHITECTURE.md CLAUDE.md
  git commit -m "feat(downloads): members see and manage only their account's downloads

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task C6: Server-side reuse in `POST /download`, `GET /for-title`, and the web opens the right file

**Files:**
- Create: `backend/app/services/torrent_reuse.py`
- Modify: `backend/app/api/torrents.py` — `download_movie` (:90-188); new route `GET /for-title` (place after `/sources`)
- Modify: `backend/app/models.py:453-458` (the "every press of Play creates another torrent" comment becomes false — say reuse now happens server-side except for an explicit `magnet`)
- Modify: `backend/tests/test_download_select.py` and `backend/tests/test_client_profile_endpoints.py` fixtures — add `monkeypatch.setattr(torrents_api, "find_reusable", lambda *a, **k: None)` (they run against the real conftest DB; a leftover row must not turn their add into a reuse)
- Create: `frontend/src/lib/streamingHref.ts`, `frontend/src/lib/streamingHref.test.ts`
- Modify: `frontend/src/components/tv/EpisodeList.tsx:173`, `frontend/src/components/tv/ShowDetailView.tsx:236` (`router.push(streamingHref(s))`)
- Modify: `frontend/src/components/tv/EpisodeList.test.tsx` (add one case next to :263)
- Test: `backend/tests/test_torrent_reuse.py` (new), `backend/tests/test_torrent_scope_api.py` (append)

**Interfaces:**
- Consumes: `touch_torrent`, `utcnow` (C2).
- Produces (`services/torrent_reuse.py`):
  - `covers_title(row, *, tmdb_id: int, media_type: str, season: Optional[int], episode: Optional[int]) -> bool`
    — exactly `title.ts covers()` (`frontend/src/app/(bigscreen)/_data/title.ts:209-216`):
    tmdb_id and media_type must both match (NULL media_type never matches); movie ⇒ row season
    and episode both NULL; tv with no season ⇒ True; season must match; no episode requested ⇒
    row episode NULL (a pack); else row episode NULL or equal.
  - `pack_file_index(row, season: Optional[int], episode: Optional[int]) -> Optional[int]` —
    only when `row.episode is None`, `episode is not None` and `row.precomputed_episodes` is a
    dict: the int key of the single entry whose `season`/`episode` match; `None` for zero or
    several matches (a sample/repack duplicate is ambiguous — same refusal as
    `_completed_pack_file`).
  - `pack_contains(row, season: Optional[int], episode: Optional[int]) -> bool` — True unless
    the row is a pack (`row.episode is None`) answering an episode request (`episode is not
    None`); in that case True when `precomputed_episodes is None` (metadata not yet in: assume
    it is there) **or** some value has that `season`/`episode`. An empty `{}` counts as
    "metadata says it is missing". **One predicate, used by both `find_reusable` and
    `GET /for-title`** (Review Focus 5), so the TV's "ready" answer and the server's reuse never
    disagree about a pack.
  - `find_reusable(session, *, tmdb_id, media_type, season, episode, quality) -> Optional[Torrent]`
    — SQL prefilter `tmdb_id ==`, `media_type ==`, `quality ==`, `state NOT IN ('error','blocked')`;
    then Python `covers_title`; then `pack_contains`.
    Preference: `COMPLETE_STATES` first, then `ACTIVE_DOWNLOAD_STATES`, then the rest; within a
    rank newest `added_at` first (NULL last), then `id` ascending.
- `api/torrents.py` imports `from app.services.torrent_reuse import covers_title, find_reusable, pack_contains, pack_file_index`
  and `from app.services.torrent_touch import touch_torrent, utcnow`
  **by name** (the fixture stubs below patch `torrents_api.find_reusable`; a module-attribute
  call would walk past them).
- `POST /download` (gains `db: Annotated[Session, Depends(get_db)]`): move the tv `season is
  None` 422 (:95-96) out of the tv branch to the very top of the `try`; then, **only when
  `request.magnet` is falsy** and **before** `resolve_show_name` / `resolve_title_year` (a reuse
  makes no TMDB call and no provider search):
  the whole find → search → add sequence runs under
  `async with _download_lock((tmdb_id, media_type, season, episode, quality)):` — a
  module-level `Dict[tuple, asyncio.Lock]` (create on first use; the app is one process). Inside
  it, `with db as session:` call `find_reusable(..., quality=request.quality)`; if found,
  `touch_torrent(session, row.id, utcnow())` (pressing Play is "anyone playing it", spec §4.2 —
  **Review Focus 2**: a download reused at 03:59 must not be due at 04:00 before its first
  progress write) and copy out `(id, state, quality, pack_file_index(row, request.season, request.episode))`;
  leave the block (get_db commits on exit); if found: when `state in RESUMABLE_STATES` call
  `torrent_manager.resume_torrent(id)` (log a warning on False, still return the row);
  `status = torrent_manager.get_torrent_status(id)` (500 as today if None); set
  `status.chosen_quality = quality` and `status.file_index = idx`; return it without searching
  or adding. The reused row keeps its `account_id` — **never adopt a NULL one** (legacy rows
  stay the owner's, Review Focus 4). If not found, the provider search and `add_torrent` run
  **still inside the lock**, so a second identical request that was waiting on it then finds
  the row the first one added (**Review Focus 3**: the TV's threshold prefetch and the
  end-prompt Play, or two devices, pressing for the same episode while the first request is
  still searching providers). Requests with an explicit `magnet` take no lock.
- `GET /for-title?tmdb_id:int&media_type:Literal['movie','tv']&season:Optional[int]&episode:Optional[int]`
  → `List[TorrentStatus]`: inside one `with db as session:` collect the ids of rows prefiltered
  by `tmdb_id`/`media_type`, `state NOT IN ('error','blocked')` is **not** applied (the TV ranks
  states itself), and kept by `covers_title` **and** `pack_contains`; leave the block; then each id via
  `torrent_manager.get_torrent_status(id)` (skip None). Unscoped. No `watched_by`.
- Produces (TS): `streamingHref(s: Pick<TorrentStatus, 'id' | 'file_index'>): string` →
  `/streaming/${s.id}` plus `?file=${s.file_index}` when `file_index` is a number (0 included).
  In `@/lib`, not `@/utils/streaming`, because `EpisodeList.test.tsx:49` and
  `ShowDetailView.test.tsx:62` mock `@/utils/streaming` wholesale.

- [ ] **Step 1: Write the failing tests.** `tests/test_torrent_reuse.py` (unit, on `db_session`;
  helper `_row(id, **kw)` with `quality="1080p"`, `state="finished"`, `tmdb_id=1399`, `media_type="tv"`):
  - `test_movie_reuse_requires_the_same_quality`: movie row 1080p finished → found for 1080p;
    `None` for 2160p.
  - `test_error_and_blocked_rows_are_never_reused`: only an `error` row and a `blocked` row → `None`.
  - `test_pack_covers_an_episode_it_contains`: pack `season=1, episode=None,
    precomputed_episodes={"0": {"season": 1, "episode": 1}, "3": {"season": 1, "episode": 2}}`
    → found for S1E2; `None` for S1E3; `None` for S2E1.
  - `test_pack_without_metadata_is_reused_optimistically`: same pack with
    `precomputed_episodes=None` → found for S1E3; with `{}` → `None`. Catches: treating `{}` as
    unknown, and treating NULL as missing.
  - `test_single_episode_row_does_not_cover_a_different_episode`: row `episode=2` → `None` for E3.
  - `test_media_type_must_agree`: a `media_type="movie"` row with the same tmdb_id → `None` for a tv request.
  - `test_a_ready_row_beats_a_newer_paused_one`: insert `paused` (added 2026-11-05) **first**,
    then `finished` (added 2026-11-01) → returns the finished row. Insertion order is the
    server's natural order, so a missing sort returns the paused row.
  - `test_newest_ready_row_wins_within_a_rank`: insert `finished` `old` (added 2026-11-01)
    first, then `finished` `new` (added 2026-11-05) → returns `new`. Catches: dropping the
    `added_at` key (the rank test above cannot — its two rows are in different ranks).
  - `test_pack_contains`: pack row with map `{"0": S1E1}` → `pack_contains(row, 1, 1)` True,
    `(row, 1, 2)` False; map `None` → `(row, 1, 2)` True; map `{}` → False; a single-episode
    row (`episode=2`) → True whatever the map (the predicate only judges packs).
  - `test_pack_file_index`: map `{"0": S1E1, "3": S1E2}` → `pack_file_index(row, 1, 2) == 3`
    (a key that is not the list position); duplicate map `{"3": S1E2, "4": S1E2}` → `None`.
  - `test_covers_title_matches_the_tv_rule` — table of `(row identity, request) -> bool` with one
    row per branch of `covers_title`.
  Endpoint tests (append to `tests/test_torrent_reuse.py`; auth disabled; `get_db` overridden
  for both the app and `app.torrent.manager`; `catalog.torrents` replaced by a recorder that
  returns one healthy hit; `movie_service.resolve_title_year` and `tv_service.resolve_show_name`
  by recorders returning `("Movie", 2020)` / `"Show"`; `add_torrent` by a recorder;
  `resume_torrent` by a recorder):
  - `test_download_reuses_a_paused_row_and_resumes_it`: row `r1` (movie 603, 1080p, `paused`,
    `account_id="acc-starter"`) → `POST /download {"tmdb_id": 603}` → 200, `json()["id"] == "r1"`,
    resume recorder `== ["r1"]`, add, catalog and resolver recorders empty, `r1.account_id ==
    "acc-starter"`.
  - `test_explicit_magnet_never_reuses`: same row, body adds `"magnet": "magnet:?xt=urn:btih:" + "ef"*20`;
    the add recorder returns `"r1"` so the real `get_torrent_status` resolves → 200, add
    recorder has one call, resume recorder empty.
  - `test_reused_pack_reports_the_episode_file`: pack `p1` with the two-entry map,
    `POST /download {"tmdb_id": 1399, "media_type": "tv", "season": 1, "episode": 2}` →
    `json()["file_index"] == 3`.
  - `test_for_title_returns_covering_rows_only`: rows movie-603, tv-1399 pack S1, tv-1399
    S1E2, tv-1399 S1E3, tv-1399 S2 pack → `GET /for-title?tmdb_id=1399&media_type=tv&season=1&episode=2`
    ids `== {pack S1, S1E2}`; `?tmdb_id=603&media_type=movie` ids `== {movie-603}`.
  - `test_for_title_and_reuse_agree_on_a_pack_without_the_episode` (**Review Focus 5**): pack
    `pA` S1 with `precomputed_episodes={"0": S1E1}` and pack `pN` S1 with
    `precomputed_episodes=None`, both 1080p finished → `GET /for-title?...season=1&episode=2`
    ids `== {"pN"}` (NULL map: optimistic; known map lacking E2: excluded), and
    `find_reusable(..., season=1, episode=2, quality="1080p").id == "pN"`. Catches for-title
    using `covers_title` alone: the TV would show "ready" on `pA` for an episode it does not
    contain, while the server's reuse refuses it.
  - `test_reuse_counts_as_a_play_and_resets_the_clock` (**Review Focus 2**;
    `monkeypatch.setattr(torrents_api, "utcnow", lambda: FROZEN)`): row `r1` finished,
    `last_touched_at=OLD` → `POST /download {"tmdb_id": 603}` → 200 and `r1.last_touched_at == FROZEN`.
    Catches a reuse that returns the row without touching it: a download pressed at 03:59 with
    an old clock is then deleted by the 04:00 vacuum before the player's first progress write.
  - `test_two_identical_presses_racing_start_one_download` (**Review Focus 3**). Uses
    `httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")` inside
    `asyncio.run` (TestClient serialises requests, so it cannot race). The catalog recorder is
    `async` and `await asyncio.sleep(0.05)` before returning its hit; the `add_torrent` recorder
    inserts a real `Torrent(id=f"r-{n}", tmdb_id=603, media_type="movie", quality="1080p",
    state="downloading", ...)` row through `override_get_db` and returns its id;
    `get_torrent_status` reads that row's `to_status()`. `await asyncio.gather(post(), post())`
    with the same body `{"tmdb_id": 603, "quality": "1080p"}` → both 200, add recorder called
    **once**, both responses carry the same `id`. Catches a reuse check outside the lock (both
    requests pass `find_reusable` before either has added, and two copies download).
  In `tests/test_torrent_scope_api.py` append `test_a_member_reusing_a_legacy_row_does_not_adopt_it`
  (**Review Focus 4**): give `t-legacy` (`account_id=None`) `tmdb_id=604, media_type="movie",
  quality="1080p", state="finished"`; stub the catalog and `add_torrent` with recorders as in
  `test_download_records_the_starting_account` → member `POST /download {"tmdb_id": 604}` → 200,
  `json()["id"] == "t-legacy"`, add recorder empty, the row's `account_id is None` afterwards,
  and the member's `GET /list` ids still exclude `t-legacy`. Catches a "helpful" reuse that
  writes `ctx.account_id` onto an ownerless row: the owner's pre-upgrade library would migrate
  into whichever member pressed Play first, and that member could then Remove it.
  Also append `test_for_title_is_not_scoped`: member
  `GET /for-title?tmdb_id=…` matching `t-owner` (give `t-owner` `tmdb_id=603, media_type="movie"`
  in the fixture) → its id is returned. Catches: scoping the lookup the TV's Play depends on.
  Frontend `streamingHref.test.ts`: `{id:'x'}` → `/streaming/x`; `{id:'x', file_index: 0}` →
  `/streaming/x?file=0` (0 is falsy — catches a truthiness check); `{id:'x', file_index: null}`
  → `/streaming/x`. `EpisodeList.test.tsx`: Play resolving `{...mockTorrentStatus, file_index: 3}`
  → `mockPush` called with `/streaming/stream-456?file=3`.
- [ ] **Step 2: Run** — backend FAIL `ModuleNotFoundError: No module named 'app.services.torrent_reuse'`;
  frontend (`cd frontend && npx vitest run src/lib/streamingHref.test.ts src/components/tv/EpisodeList.test.tsx`)
  FAIL `Failed to resolve import "./streamingHref"`.
- [ ] **Step 3: Implement** per the interfaces; rewrite the `models.py:453-458` comment.
- [ ] **Step 4: Run** both backend files, `tests/test_download_select.py`,
  `tests/test_client_profile_endpoints.py`, the full backend suite; frontend the two files plus
  `src/components/tv/ShowDetailView.test.tsx`, and `npx tsc --noEmit` — expected PASS.
- [ ] **Step 5: Commit**
  ```
  git add backend/app/services/torrent_reuse.py backend/app/api/torrents.py backend/app/models.py backend/tests/test_torrent_reuse.py backend/tests/test_torrent_scope_api.py backend/tests/test_download_select.py backend/tests/test_client_profile_endpoints.py frontend/src/lib/streamingHref.ts frontend/src/lib/streamingHref.test.ts frontend/src/components/tv/EpisodeList.tsx frontend/src/components/tv/ShowDetailView.tsx frontend/src/components/tv/EpisodeList.test.tsx
  git commit -m "feat(downloads): reuse a covering download server-side and add GET /torrents/for-title

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task C7: Who watched each download (owner only) and the disk totals

**Files:**
- Create: `backend/app/services/watch_share.py`
- Modify: `backend/app/api/torrents.py` — `list_torrents` (owner branch); new route `GET /disk`; `import shutil`
- Test: `backend/tests/test_watch_share.py` (new), `backend/tests/test_torrent_scope_api.py` (append)

**Interfaces:**
- Produces (`services/watch_share.py`):
  - `percents_from_rows(torrent: Torrent, rows: Iterable) -> Dict[str, float]` — `rows` have
    `.user_id, .percentage, .completed, .file_index`. Per row `pct = 100.0 if completed else
    clamp(percentage, 0, 100)`. **Pack** (`media_type == "tv"` and `episode is None`): per
    profile `min(100.0, sum(pct) / n)` where `n = len(precomputed_episodes)` if it is a non-empty
    dict, else the number of distinct non-NULL `file_index` values across **all** rows passed,
    else `1`. **Otherwise** (movie, single episode): per profile `max(pct)`. Only profiles whose
    value is `> 0` are returned.
  - `profile_percents(session: Session, torrent: Torrent) -> Dict[str, float]` — the rows of
    `UserStreamingProgress` with `torrent_id == torrent.id`, through `percents_from_rows`. (Part D
    consumes this.)
  - `watched_by_map(session: Session, torrents: Sequence[Torrent]) -> Dict[str, List[WatchedBy]]`
    — ONE query joining `UserStreamingProgress` to `User` on `user_id` for
    `torrent_id IN ids`; rows grouped by torrent; **`percent` is
    `percents_from_rows(torrent, that torrent's rows)[user_id]`** (spec §3.2: "for a pack, the
    §4.3 average" — the same number the vacuum gate reads), and a profile absent from that dict
    (0%) is omitted; every id present as a key (`[]` when nobody); each list sorted by
    `percent` descending then `display_name` ascending; `WatchedBy(profile_id=user_id,
    display_name, avatar, percent)`.
- `GET /list` owner branch: after the manager call, `with db as session:` load
  `session.query(DbTorrent).filter(DbTorrent.id.in_(ids)).all()`, `wb = watched_by_map(session, rows)`,
  set `s.watched_by = wb.get(s.id, [])` on every status. Member statuses keep `watched_by=None`
  — the frontend reads "owner" from the field's presence.
- `GET /disk` → `DiskUsageResponse`: `used_by_downloads_bytes` = `COALESCE(SUM(size_bytes), 0)`
  over **all** rows (not scoped — spec §3.2: not personal); `free_bytes`/`total_bytes` from
  `shutil.disk_usage(settings.default_download_path)`; `OSError` → `HTTPException(503, "Disk usage unavailable")`.

- [ ] **Step 1: Write the failing tests.** `tests/test_watch_share.py` (on `db_session`, users
  `A`, `B`, `C` with display names `"Ann"`, `"Bob"`, `"Cy"`):
  - `test_movie_percent_is_the_row_and_completed_is_100`: movie torrent; A 80.0, B
    `completed=True, percentage=50`, C 0.0 → `{"A": 80.0, "B": 100.0}`.
  - `test_pack_averages_over_every_episode`: pack with 4 precomputed episodes; A has two rows
    at 100 → `50.0`; B one completed row → `25.0`. Catches: averaging over watched episodes only
    (A would read 100).
  - `test_pack_without_map_counts_distinct_file_indexes`: `precomputed_episodes=None`; rows
    A(file 0, 90), B(file 1, 30), B(file 2, 30) → n = 3 → `{"A": 30.0, "B": 20.0}`.
  - `test_pack_with_no_indexes_counts_as_one`: map None, A one row `file_index=None` at 40 → `{"A": 40.0}`.
  - `test_rows_of_other_torrents_are_ignored` (via `profile_percents`): A has a row on torrent
    `x` at 90 and none on `y` → `profile_percents(db_session, y) == {}`.
  - `test_watched_by_map_sorts_and_includes_empty`: torrents `m` (A 80, B 30) and `n` (nobody) →
    `[w.profile_id for w in map["m"]] == ["A", "B"]`, `map["n"] == []`.
  - `test_watched_by_on_a_pack_is_the_season_average`: pack `p` with 4 precomputed episodes,
    A has two rows at 100 → `map["p"][0].percent == 50.0`. Catches `watched_by_map` reading
    the latest row's `percentage` (100) instead of `percents_from_rows`, which would show the
    owner "Ann 100%" on a pack the vacuum gate treats as half-watched.
  Append to `tests/test_torrent_scope_api.py` (add a profile `Ann` under `member` with a progress
  row on `t-member` at 60, and give `t-owner` `size_bytes=100`, `t-member` `size_bytes=50`):
  - `test_owner_sees_who_watched`: owner `GET /list` → row `t-member` has
    `watched_by == [{"profile_id": <ann>, "display_name": "Ann", "avatar": None, "percent": 60.0}]`;
    `t-other` has `watched_by == []`.
  - `test_member_never_sees_watched_by`: member `GET /list` → `t-member["watched_by"] is None`.
    Catches: the owner gate dropped (the anti-goal "a member seeing viewing history").
  - `test_disk_totals_are_the_same_for_everyone`: `monkeypatch.setattr(torrents_api.shutil,
    "disk_usage", lambda p: SimpleNamespace(total=1000, used=400, free=600))` → owner and member
    both get `{"used_by_downloads_bytes": 150, "free_bytes": 600, "total_bytes": 1000}`.
  - `test_disk_unavailable_is_503`: `disk_usage` raises `OSError` → 503.
- [ ] **Step 2: Run** — expected FAIL `ModuleNotFoundError: No module named 'app.services.watch_share'`.
- [ ] **Step 3: Implement** per the interfaces. Note in the `watch_share` module docstring the
  accepted limitation from spec §3.2: `upsert_progress` repoints `torrent_id`
  (`progress_upsert.py:48`), so an older download loses a viewer who re-played elsewhere.
- [ ] **Step 4: Run** both files, `tests/test_torrent_identity_fields.py` (its list tests now run
  the owner branch against the real conftest DB and must still pass), the full suite — PASS.
- [ ] **Step 5: Commit**
  ```
  git add backend/app/services/watch_share.py backend/app/api/torrents.py backend/tests/test_watch_share.py backend/tests/test_torrent_scope_api.py
  git commit -m "feat(downloads): owner sees who watched each download; GET /torrents/disk

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task C8: Frontend `getForTitle`, and the TV asks `for-title` instead of listing everything

Once `/list` is scoped, a member's TV listing all torrents no longer sees a download another
account started, so `titleStateFor` would offer Play for a title already on the box (and the
server would then reuse it — but the TV would lose "ready"/"resume" answers). This task moves it.

**Files:**
- Modify: `frontend/src/services/torrents.ts` (add one member, `getForTitle`)
- Modify: `frontend/src/services/torrents.test.ts` (add a `describe` using the existing `harness()`)
- Modify: `frontend/src/app/(bigscreen)/_data/title.ts` — `titleStateFor` (:409-415) and its docstring (:365-373: "A dead `listTorrents` degrades to `play`" → `getForTitle`; drop "add_torrent does no … dedupe", now false)
- Modify: `frontend/src/types/index.ts:121-125` (comment: the dedupe now happens server-side)
- Modify (mock rename `listTorrents` → `getForTitle`, keep every other key): `frontend/src/app/(bigscreen)/_data/title.test.ts` (:10, :19, rename the two `it` titles at :387, :392), `bigscreen/show/[id]/page.pack.test.tsx` (:25, :69, :134, :153), `bigscreen/watch/[id]/page.next.test.tsx` (:66, :217, :415, :508, :566, :587), `bigscreen/watch/[id]/page.fetch.test.tsx:85`, `page.track.test.tsx:73`, `page.subtitles.test.tsx:94`, `page.test.tsx:74`, `journeys.test.tsx` (factory :131 **adds** `getForTitle: vi.fn()`; :939, :1027, :1039, :1076, :1088 switch to it)

**Interfaces:**
- Produces (`torrentsService`):
  - `getForTitle(params: { tmdb_id: number; media_type: 'movie' | 'tv'; season?: number; episode?: number }): Promise<TorrentStatus[]>` → `GET /torrents/for-title` with those params.
  - **Not `getDisk`.** It moved to C9, which adds its only caller. `noDeadExports.test.ts`
    scans every two-space key of `src/services/*`, so a member with no production caller fails
    `npm run test:tv` in this task's Step 4.
- `titleStateFor` calls `torrentsService.getForTitle({ tmdb_id: ref.tmdbId, media_type: ref.mediaType, season: ref.season, episode: ref.episode })`
  in place of `listTorrents()`; everything after it (the `covers()` loop, ready/live ranking) is
  unchanged — the server pre-filters by the same rule and the client keeps its own check.

- [ ] **Step 1: Write the failing tests.**
  - `services/torrents.test.ts`: `getForTitle({tmdb_id: 1399, media_type: 'tv', season: 1, episode: 3})`
    → last request `url === '/torrents/for-title'`, `params` `toEqual({tmdb_id: 1399, media_type: 'tv', season: 1, episode: 3})`.
  - `title.test.ts`: `it('asks the box for this title only', …)` — `await titleStateFor(ep(1, 3))`
    → `expect(list).toHaveBeenCalledWith({ tmdb_id: 1399, media_type: 'tv', season: 1, episode: 3 })`.
    After the mock rename, the existing rows (`'a null or malformed row costs that row only'`
    expects `open`) are the instrument for "still calls `listTorrents`": the factory no longer has
    it, the call throws inside the `try`, and the action degrades to `play`.
- [ ] **Step 2: Run** (`cd frontend && npx vitest run src/services/torrents.test.ts "src/app/(bigscreen)/_data/title.test.ts"`) —
  expected FAIL: `torrentsService.getForTitle is not a function` / call-assertion failures.
- [ ] **Step 3: Implement** the member, the one-line switch, the comments, and the mock
  renames in the seven other TV test files.
- [ ] **Step 4: Run** `npm run test:tv` **looped 10×** (memory *verify-suites-by-looping*; report
  failures out of 10, not the last run), `npx vitest run src/services/torrents.test.ts`,
  `npx tsc --noEmit`, and `grep -rn "listTorrents" "src/app/(bigscreen)" | grep -v '\.test\.'`
  → no output (no production TV caller left). Expected PASS / 0 of 10.
- [ ] **Step 5: Commit**
  ```
  git add frontend/src/services/torrents.ts frontend/src/services/torrents.test.ts frontend/src/types/index.ts "frontend/src/app/(bigscreen)"
  git commit -m "feat(tv): title state reads GET /torrents/for-title, not the account-scoped list

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task C9: Downloads page — stable rows, fixed slots, size/date/disk (with `getDisk`), watched-by, delete-by-default

Not a redesign (spec §1 non-goals): same components (`Badge`, `Button`, `Modal`, `Pill`,
`Progress`, `RadioGroup` from `@/components/ui/fre`), same filter pills and four batch buttons.
`TopNav` / `ProfileMenu` are unchanged — everyone may open Downloads.

**Files:**
- Modify: `frontend/src/components/downloads/DownloadsView.tsx` (helpers :49-86; `TorrentRow` :97-289; `DownloadsView` :297-446)
- Modify: `frontend/src/components/downloads/DownloadsView.test.tsx` (mock factory :16-24 gains `getDisk`; `beforeEach` :74-87 resolves it; existing tests listed in Step 1)
- Modify: `frontend/src/services/torrents.ts` (add `getDisk(): Promise<DiskUsage>` → `GET /torrents/disk`, moved here from C8 so it lands with its caller) and `frontend/src/services/torrents.test.ts` (`getDisk()` → last request `url === '/torrents/disk'`)

**Interfaces:**
- Consumes: `TorrentStatus` fields and `DiskUsage` (C1), `GET /torrents/disk` (C7), `parseUtc` (`src/lib/parseUtc.ts`).
- Produces: `torrentsService.getDisk(): Promise<DiskUsage>`.
- Module-local helpers (pinned outputs):
  - `formatBytes(n?: number | null): string` — `'—'` for null/≤0; else 1024-based `B/KB/MB/GB/TB`
    with one decimal, same as backend `_human_size`: `1610612736 → '1.5 GB'`.
  - `formatAdded(iso?: string | null): string` — `'Added —'` when unparseable; else
    `'Added ' + new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(parseUtc(iso))` — the viewer's **local** date (lead's decision: a viewer near midnight sees their own day, not UTC's)
    → `'2026-11-05T10:00:00'` → `'Added 5 Nov 2026'`.
  - `displayTitle(t)`: movie → `movie_title`; tv with `episode` → `movie_title` (the label is
    already `"Show SxxEyy"`, `api/torrents.py:101`); tv pack (`season` set, `episode` null) →
    `movie_title` with a trailing `/ S\d{2}$/` removed, plus `' · Season ' + season`.
  - `sortDownloads(list)`: `added_at` descending (via `parseUtc`), NULL/unparseable last, then
    `id` ascending (`a.id < b.id ? -1 : 1`). Applied to the polled list before filtering. Never
    server order (`get_all` has no `ORDER BY`).
- Row layout, top to bottom, every part always rendered unless stated:
  1. title line: `displayTitle`, state `Badge`, quality `Badge` (unchanged).
  2. `Progress` (unchanged).
  3. `data-testid="row-stats"` — for `state === ERROR`: the error text
     (`error_message ?? 'Download failed'`, `text-danger truncate`) **replaces** the slots, so the
     row does not grow; otherwise six slots, each a `<span data-testid="stat-…">` with
     `inline-block tabular-nums whitespace-nowrap` and a fixed `w-[…ch]`:
     `stat-down` `'↓ ' + formatSpeed(download_rate)`, `stat-up` `'↑ ' + formatSpeed(upload_rate)`,
     `stat-peers` `` `${num_peers} peers` ``, `stat-eta` `'ETA ' + (state === DOWNLOADING ? formatETA(eta) : '—')`,
     `stat-size` `formatBytes(size_bytes)`, `stat-added` `formatAdded(added_at)`. The container
     may wrap (`flex flex-wrap gap-x-4`): with fixed-width slots the wrap point depends on the
     viewport only, never on the values.
  4. `data-testid="watched-by"` — **only when `Array.isArray(torrent.watched_by)`** (the owner):
     `'Watched by ' + list.map(w => `${w.display_name} ${Math.round(w.percent)}%`).join(' · ')`,
     or `'Watched by —'` for `[]`. Absent for members (`null`/`undefined`).
  5. actions, always three buttons in this order: **Watch** (`disabled={busy || !canWatch}`),
     one toggle (`aria-label` and text `'Resume'` when `canResume`, else `'Pause'`;
     `disabled={busy || !(canPause || canResume)}`; clicks `act('resume' | 'pause')`), **Remove**.
     `canWatch`/`canPause`/`canResume` keep today's definitions (:141-157).
- Remove dialog: `deleteMode` initial state **`'all'`**, and the Remove button's `onClick` sets
  `'all'` (was `'keep'`, :101 and :251). Options and copy unchanged.
- Header: under the "Active N / max" line, `data-testid="disk-usage"`
  `` `${formatBytes(used_by_downloads_bytes)} in downloads · ${formatBytes(free_bytes)} free of ${formatBytes(total_bytes)}` ``,
  rendered only once a `getDisk()` has resolved; refreshed inside the existing `fetch` callback
  (`torrentsService.getDisk().then(setDisk).catch(() => {})`, independent of the list call so a
  failing disk read never blanks the list).

- [ ] **Step 1: Write the failing tests** (in `DownloadsView.test.tsx`; `mockGetDisk.mockResolvedValue({used_by_downloads_bytes: 12884901888, free_bytes: 85899345920, total_bytes: 536870912000})` in `beforeEach`):
  - `it('orders rows newest-added first with id as tiebreak, whatever the server order')`:
    server `[b(added '2026-11-01T00:00:00'), legacy(id '0', added null), c(added '2026-11-05T00:00:00'), a(added '2026-11-01T00:00:00')]`
    (distinct titles) → `getAllByTestId('torrent-row')` titles in order `c, a, b, legacy`.
    Catches: no sort; tiebreak dropped (stable sort keeps `b` before `a`); NULL sorted first.
  - `it('keeps every stat slot, showing — when a value is unknown')`: finished row with
    `eta: 300, size_bytes: null` → within the row `stat-eta` text `'ETA —'` (the stale eta is not
    shown), `stat-size` `'—'`; downloading row `eta: 300, size_bytes: 1610612736` → `'ETA 5m'`,
    `'1.5 GB'`. Catches: the old conditional ETA (`getByTestId` throws).
  - `it('every stat slot is fixed-width tabular and non-wrapping')`: every
    `[data-testid^="stat-"]` has classes `tabular-nums` and `whitespace-nowrap`. (Structural only:
    jsdom does no layout — the visual check is Step 4's screenshot.)
  - `it('shows the added date in the viewer\'s local day')`: `added_at: '2026-11-05T23:30:00'`
    (naive UTC) → under `TZ=Asia/Tokyo` (08:30 on 6 Nov local) `stat-added` is
    `'Added 6 Nov 2026'`; under `TZ=America/Los_Angeles` (15:30 on 5 Nov local) it is
    `'Added 5 Nov 2026'`. Compute the expectation inside the test from `process.env.TZ` (a
    three-entry map; `UTC` → `'Added 5 Nov 2026'`). Run this file once under each of the three TZs in
    Step 4. Catches: a dropped `parseUtc` (Tokyo would read 5 Nov 23:30 local → `'5 Nov'`), and a
    hard-coded `timeZone: 'UTC'` (Tokyo would show `'5 Nov'`).
  - `it('always renders Watch, one Pause/Resume toggle and Remove, disabling what does not apply')`:
    finished row → `within(row).getAllByRole('button').map(b => b.getAttribute('aria-label'))`
    `toEqual(['Watch', 'Pause', 'Remove'])`, Pause `toBeDisabled()`, Watch enabled; paused row →
    `['Watch', 'Resume', 'Remove']`, Watch disabled, Resume enabled; downloading row → Pause
    enabled. Catches: conditional buttons (length/order changes), two buttons in the toggle slot.
  - `it('an error replaces the stats line instead of adding one')`: error row with
    `error_message: 'tracker said no'` → `within(row).getByTestId('row-stats')` has that text,
    `within(row).queryByTestId('stat-eta')` is null.
  - `it('shows who watched only when the owner gets watched_by')`: row with
    `watched_by: [{profile_id:'a', display_name:'Alice', avatar:null, percent:80.4}, {profile_id:'b', display_name:'Bob', avatar:null, percent:30}]`
    → `getByTestId('watched-by')` text `'Watched by Alice 80% · Bob 30%'`; a row with `[]` →
    `'Watched by —'`; a row without the field → `within(row).queryByTestId('watched-by')` null.
    Each assertion scoped `within(row)` (a page-wide matcher could be satisfied by another row).
  - `it('shows disk used and free')`: `getByTestId('disk-usage')` text
    `'12.0 GB in downloads · 80.0 GB free of 500.0 GB'`; second case with `mockGetDisk` rejected →
    `queryByTestId('disk-usage')` null and the rows still render.
  - `it('Remove defaults to deleting everything')`: open the dialog → `getByRole('radio', {name: /Delete everything/i})`
    `toBeChecked()`; confirm → `mockDeleteTorrent` called with `('tor-99', true)`.
  - `it('titles a season pack "Season N"')`: `movie_title: 'The Boys S01', media_type: 'tv', season: 1, episode: null`
    → `'The Boys · Season 1'`; episode row `'The Boys S01E05'` unchanged.
  - **Existing tests that change:** `'remove (confirmed) calls deleteTorrent(id, false)'` (:128)
    → becomes the `true` default case above; `'remove with "Delete everything" calls deleteTorrent(id, true)'`
    (:206) → `'choosing "Remove from list" keeps the files'`, clicking
    `/Remove from list/i` → `('r9', false)`. `'shows a Resume button for a stopped torrent'`,
    `'does not show a Stop button'`, pause, filter, empty-state, batch and error-toast tests stay
    as written. Add `getDisk` to the `vi.mock` factory.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/components/downloads/DownloadsView.test.tsx` —
  expected FAIL (no `stat-eta` in a finished row; order `b, legacy, c, a`).
- [ ] **Step 3: Implement** per the interfaces. No new dependency, no new fre component.
- [ ] **Step 4: Verify.** `npm run test:tv` once (noDeadExports: `getDisk` now has its caller). The file looped 5× (all green), once more each with
  `TZ=America/Los_Angeles` and `TZ=Asia/Tokyo`;
  `npx tsc --noEmit`; then the running dev stack (`make up` only if it is not already up — never
  recreate `backend` mid-download, CLAUDE.md; source changes hot-reload), open `http://localhost:3001/downloads` as the owner with one
  downloading and one finished row and take two screenshots 4 s apart — the Remove button and the
  ETA column must not move between them.
- [ ] **Step 5: Commit**
  ```
  git add frontend/src/components/downloads/DownloadsView.tsx frontend/src/components/downloads/DownloadsView.test.tsx frontend/src/services/torrents.ts frontend/src/services/torrents.test.ts
  git commit -m "feat(downloads): stable rows, fixed stat slots, size, added date, disk and watched-by

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Part C journey check (run after C9, before handing to Part D)

Per memory *review-cannot-see-the-seams*: for every symbol Part C exports, a production caller
exists — `grep -rn "<name>" backend/app frontend/src | grep -v '\.test\.'` must show a call site
(not a comment) for: `visible_to`, `scope_query`, `touch_torrent`, `mark_finished`,
`stamp_legacy_torrents`, `find_reusable`, `pack_contains`, `pack_file_index`, `covers_title`, `watched_by_map`,
`owned_content_paths`, `delete_owned_content`, `remove_dir_if_empty`, `getForTitle`, `getDisk`,
`streamingHref`. `profile_percents` and `VacuumInfo` are allowed zero callers until Part D (say so
in the hand-off). Then one journey by hand on `make up`: member account presses Play on a film the
owner already downloaded → no new row in `make db` `SELECT id, account_id FROM torrents`, the
member's Downloads page does not list it, the owner's lists it with the member's profile under
"Watched by" after a minute of playback.

## Known gaps (left open deliberately)

- **Downgraded titles still duplicate.** Quality must match (spec §3.2), and a 1080p request
  downgraded to 720p stores `quality="720p"`, so the next 1080p press never matches and adds
  again. Fixing it needs the requested quality on the row; not specified.
- **Legacy finished rows have no `size_bytes`** (never re-enter the session), so "in downloads"
  under-counts and their size slot reads "—" until removed.
- **A reused pack whose metadata has not arrived** returns `file_index=None`, so the web opens
  the pack's first file rather than the requested episode (Part E's E4 falls back to
  `getFiles` for exactly this case).
- Hybrid/v2 libtorrent partfile names are not claimed; such a `.parts` file only keeps an
  otherwise-empty `save_path` from being removed.


---

# Part D — instance settings + autovacuum

Spec: §4 (all), §4.6, §5.1 (the controls), §5.2 (`GET /instance/playback`). Runs after Part C.

## Contract deviations

1. `vacuum_info` gains two **keyword-only** parameters:
   `vacuum_info(row, percents, settings, now, recently_played, *, live_download_rate: float, tz: Optional[tzinfo] = None)`.
   The reason is that the row cannot supply "live download rate > 0" (§4.4). `Torrent.to_status()` (`database/models/torrents.py:57`, the read is at `:69`) reads `download_rate` from `meta_data`. The poll loop writes that value (`torrent/manager.py:495-499`) and never clears it. `pause_torrent` then unloads the handle, so a paused torrent keeps its last rate in `meta_data` indefinitely. Reading the rate off the row would therefore protect every paused download from deletion forever. The live rate has to come from `torrent_manager.active_torrents`. `tz` makes the 04:00 local-time rule testable.
2. `row` in `vacuum_info` is the ORM `Torrent`. Only `row.last_touched_at` is read.
3. `run_vacuum(now, *, manager=None, tz=None)`. `manager=None` means the function lazily imports `app.torrent.manager.torrent_manager`. That keeps `services/vacuum.py` importable without starting libtorrent.
4. `start_vacuum_task() -> asyncio.Task` is sync. `stop_vacuum_task()` is `async`, because it awaits the cancelled task.
5. `VacuumInfo.deletes_at` is timezone-aware UTC, serialised with `Z`. Every other timestamp is naive UTC, and the browser's `new Date()` would read a naive one as local time. This value is computed and never stored, so it can carry a zone.
6. Names this part adds that are not in the contract:
   - `services/vacuum.py`: `VACUUM_HOUR = 4`, `next_run_at`, `seconds_until_next_run`, `is_due`, `fill_vacuum`, `_evaluate`, `_vacuum_loop`
   - `torrent/storage.py`: `human_size`
   - `services/instance_settings.py`: `SETTING_FIELDS`
   - frontend: `components/downloads/vacuumLine.ts` and the TS `VacuumStatus` alias (the TS `VacuumInfo` itself is Part C's C1)
7. `effective_settings(instance: Optional[Instance])` accepts `None` for an instance row that does not exist yet.

## What this part takes from Part C (checked against part-C.md)

- **C1:** `Torrent` columns `last_touched_at` (DateTime, naive UTC), `finished_at`, `added_at` and `size_bytes` (BigInteger); the pydantic `VacuumInfo` (`status: Literal['off','scheduled','kept_watching','active']`, `deletes_at: Optional[datetime] = None`) in `app/models.py`; `TorrentStatus.vacuum: Optional[VacuumInfo] = None`; the TS `VacuumInfo` interface and `TorrentStatus.vacuum?: VacuumInfo | null` in `frontend/src/types/index.ts`. **Part D redefines none of these** (C deviation 2).
- **C2:** `app/services/torrent_touch.py` `utcnow() -> datetime` (naive UTC) and `touch_torrent(session, torrent_id, now)`.
- **C3:** `stamp_legacy_torrents(session, now) -> int`, run from the `startup` event.
- **C4:** `torrent_manager.remove_torrent(torrent_id, delete_files=True)`, which deletes only the torrent's own content and removes `save_path` only if left empty.
- **C6:** `POST /torrents/download`'s reuse touches the reused row (Review Focus 2).
- **C7:** `app/services/watch_share.py` `profile_percents(session, torrent) -> Dict[str, float]`. Only profiles with a percent `> 0` appear. For a pack, the value is averaged over all its episodes (fallback: distinct `file_index` count, else 1).
- **C5/C7:** `list_torrents` as C leaves it: scoped for members, `watched_by` filled for the owner, rows read through the `db` dependency.

---

### Task D1: Instance settings columns and `effective_settings`

**Files:**
- Modify: `backend/app/database/models/accounts.py`. Add six columns to `class Instance` after `instance_name` (`:70`). Import `Boolean` in the `sqlalchemy` import at `:21-23`.
- Create: `backend/app/services/instance_settings.py`
- Test: `backend/tests/test_instance_settings.py`

**Interfaces:**
- Produces:
  - `Instance.autovacuum_enabled`, `.autovacuum_watched_gate` and `.auto_next_enabled`: `Column(Boolean, nullable=True)`
  - `Instance.autovacuum_days`, `.autovacuum_watched_pct` and `.auto_next_pct`: `Column(Integer, nullable=True)`
  - All six columns have no `default` and no `server_default`. NULL means "never chosen", and the default lives only in `effective_settings`.
  - `@dataclass(frozen=True) class EffectiveSettings` with fields `autovacuum_enabled: bool`, `autovacuum_days: int`, `autovacuum_watched_gate: bool`, `autovacuum_watched_pct: int`, `auto_next_enabled: bool`, `auto_next_pct: int`, in that order
  - `DEFAULTS = EffectiveSettings(False, 30, True, 80, True, 80)`
  - `SETTING_FIELDS: tuple[str, ...]` = the six names, from `dataclasses.fields`
  - `effective_settings(instance: Optional[Instance]) -> EffectiveSettings`. For each field, a stored value that `is not None` wins; otherwise the default applies. **Do not use `or`.** A stored `False` must stay `False`.

- [ ] **Step 1: Write the failing tests** in `backend/tests/test_instance_settings.py`. These are pure, with no DB and no client.
```python
from app.database.models.accounts import Instance, INSTANCE_SINGLETON_ID
from app.services.instance_settings import EffectiveSettings, effective_settings

LITERAL_DEFAULTS = EffectiveSettings(
    autovacuum_enabled=False, autovacuum_days=30, autovacuum_watched_gate=True,
    autovacuum_watched_pct=80, auto_next_enabled=True, auto_next_pct=80,
)
COLUMNS = ("autovacuum_enabled", "autovacuum_days", "autovacuum_watched_gate",
           "autovacuum_watched_pct", "auto_next_enabled", "auto_next_pct")

def test_an_all_null_instance_reads_as_the_spec_defaults():
    assert effective_settings(Instance(id=INSTANCE_SINGLETON_ID)) == LITERAL_DEFAULTS

def test_a_missing_instance_row_reads_as_the_spec_defaults():
    assert effective_settings(None) == LITERAL_DEFAULTS

def test_a_stored_false_is_not_mistaken_for_unset():
    row = Instance(id=INSTANCE_SINGLETON_ID, autovacuum_watched_gate=False, auto_next_enabled=False)
    got = effective_settings(row)
    assert got.autovacuum_watched_gate is False and got.auto_next_enabled is False

def test_stored_values_win():
    row = Instance(id=INSTANCE_SINGLETON_ID, autovacuum_enabled=True, autovacuum_days=7,
                   autovacuum_watched_pct=50, auto_next_pct=65)
    got = effective_settings(row)
    assert (got.autovacuum_enabled, got.autovacuum_days, got.autovacuum_watched_pct, got.auto_next_pct) == (True, 7, 50, 65)

def test_the_columns_are_nullable_with_no_default_so_sync_columns_can_add_them():
    assert len(COLUMNS) == 6
    for name in COLUMNS:
        col = Instance.__table__.columns[name]
        assert col.nullable is True, name
        assert col.default is None and col.server_default is None, name
```
  Mutations each test catches:
  - `test_an_all_null_instance_reads_as_the_spec_defaults` catches any wrong default value. It compares against a literal, not `DEFAULTS`.
  - `test_a_stored_false_is_not_mistaken_for_unset` catches `stored or default`.
  - `test_the_columns_are_nullable_with_no_default_so_sync_columns_can_add_them` catches `nullable=False`. `sync_columns` emits a bare `ADD COLUMN` (`database/session.py:152`), so an upgraded DB would get the column nullable while a fresh `create_all` makes it `NOT NULL` and `get_instance(create=True)`'s bare `Instance(id=...)` insert (`services/accounts.py:52`) fails. The two deployments would diverge. It also catches `default=` on a column, which would write the default at insert time and erase "never chosen".
- [ ] **Step 2: Run** `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_instance_settings.py -v`. Expected: an ERROR at collection, `ModuleNotFoundError: No module named 'app.services.instance_settings'`.
- [ ] **Step 3: Implement** the columns and `services/instance_settings.py` as given under **Produces**.
- [ ] **Step 4: Run** the same command. Expected: 5 passed.
- [ ] **Step 5: Commit**
```bash
git add backend/app/database/models/accounts.py backend/app/services/instance_settings.py backend/tests/test_instance_settings.py
git commit -m "feat(instance): owner settings columns with NULL-means-default reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D2: `GET/PUT /instance/owner-settings` and `GET /instance/playback`

**Files:**
- Modify: `backend/app/models.py`. Add three models after `InstanceSettingsUpdate` (`:858-859`).
- Modify: `backend/app/api/instance.py`:
  - add the imports at `:25-50`;
  - add `require_session` to the import at `:35`;
  - add three routes after `update_instance_settings` (`:535-548`), and leave that route and its `InstanceStatusResponse` return unchanged;
  - update the module docstring line at `:12`.
- Modify: `backend/app/main.py:182`, the comment.
- Test: `backend/tests/test_owner_settings_api.py`

**Interfaces:**
- Consumes D1: `effective_settings` and `SETTING_FIELDS`. Also uses `accounts_service.get_instance(session, create=...)` (`services/accounts.py:49`).
- Produces:
  - `OwnerSettingsResponse(BaseModel)`: the six fields as non-optional `bool`/`int`.
  - `OwnerSettingsUpdate(BaseModel)`:
    - `model_config = ConfigDict(extra='forbid')`
    - every field `Optional`, default `None`
    - `autovacuum_days: Optional[int] = Field(None, ge=1, le=365)`
    - `autovacuum_watched_pct: Optional[int] = Field(None, ge=10, le=100)`
    - `auto_next_pct: Optional[int] = Field(None, ge=50, le=95, multiple_of=5)`
  - `PlaybackSettingsResponse(BaseModel)`: `auto_next_enabled: bool` and `auto_next_pct: int`.
  - `GET /api/v1/instance/owner-settings` uses `Depends(require_owner)` and returns `OwnerSettingsResponse(**asdict(effective_settings(get_instance(session, create=False))))`.
  - `PUT /api/v1/instance/owner-settings` uses `Depends(require_owner)` and takes an `OwnerSettingsUpdate` body. It calls `get_instance(session)` (create), then for each field of `payload.model_dump()` it calls `setattr` only when the value `is not None`. Then it calls `session.flush()` and returns the same shape as GET.
  - `GET /api/v1/instance/playback` uses `Depends(require_session)`. The instance router is not gated at include time (`main.py:182-187`), so the route must declare the dependency itself. It returns `PlaybackSettingsResponse`.
  - All three use the `db: Annotated[Session, Depends(get_db)]` + `with db as session:` pattern, entered once, as `update_instance_settings` does.

- [ ] **Step 1: Write the failing tests.** Build the fixture from `tests/test_profile_scoping.py:31-80`, keeping only the two accounts and their sessions:
  - signature `world(db_session, override_get_db, auth_enabled, monkeypatch)`. **`auth_enabled` is required.** `conftest.py`'s session-scoped autouse `auth_disabled` makes `require_session` return a synthetic owner (`dependencies/auth.py:51-58`, `:97`), so without it the member gets 200 and the signed-out caller gets 200, and the 403/401 tests fail against correct code.
  - `monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)`
  - owner `Account(role=ROLE_OWNER, status=STATUS_ACTIVE)` and member `Account(role=ROLE_MEMBER, ...)`
  - `auth_service.create_session` for each
  - `app.dependency_overrides[get_db] = override_get_db`
  - `with TestClient(app) as client`
  - yield `client`, `owner_cookie` and `member_cookie`

  Tests:
```python
DEFAULTS = {"autovacuum_enabled": False, "autovacuum_days": 30, "autovacuum_watched_gate": True,
            "autovacuum_watched_pct": 80, "auto_next_enabled": True, "auto_next_pct": 80}
PUBLIC_KEYS = {"claimed", "needs_claim", "instance_name", "claimed_at"}

def test_the_owner_reads_the_defaults(world): GET owner-settings as owner -> 200, json == DEFAULTS
def test_a_member_can_neither_read_nor_write(world):
    GET as member -> 403; PUT {"autovacuum_enabled": True} as member -> 403;
    then GET as owner -> json == DEFAULTS   # the refused PUT wrote nothing
def test_signed_out_is_401(world): GET owner-settings and GET playback with no cookie -> both 401
def test_a_put_merges_rather_than_resets(world):
    PUT {"autovacuum_enabled": True, "autovacuum_days": 14} -> json["autovacuum_days"] == 14
    PUT {"auto_next_pct": 65}
    GET -> json == {**DEFAULTS, "autovacuum_enabled": True, "autovacuum_days": 14, "auto_next_pct": 65}
CASES = [("autovacuum_days", 0, 422), ("autovacuum_days", 1, 200), ("autovacuum_days", 365, 200),
         ("autovacuum_days", 366, 422), ("autovacuum_watched_pct", 9, 422), ("autovacuum_watched_pct", 10, 200),
         ("autovacuum_watched_pct", 100, 200), ("autovacuum_watched_pct", 101, 422), ("auto_next_pct", 45, 422),
         ("auto_next_pct", 50, 200), ("auto_next_pct", 95, 200), ("auto_next_pct", 100, 422),
         ("auto_next_pct", 82, 422), ("auto_next_pct", 85, 200)]
def test_case_count_is_pinned(): assert len(CASES) == 14
@pytest.mark.parametrize("field,value,code", CASES)
def test_bounds(world, field, value, code): PUT {field: value} as owner -> status_code == code
def test_an_unknown_key_is_422_not_silently_dropped(world): PUT {"autovacuum": True} -> 422
def test_the_public_shapes_do_not_grow(world):
    PUT owner-settings {"autovacuum_enabled": True, "auto_next_pct": 65} as owner -> assert 200 first
    r = GET /api/v1/instance/status (no cookie): set(r.json()) == PUBLIC_KEYS and "autovacuum" not in r.text
    r = PUT /api/v1/instance/settings {"instance_name": "Den"} as owner: set(r.json()) == PUBLIC_KEYS
def test_a_member_reads_playback_and_only_playback(world):
    owner PUT {"auto_next_enabled": False, "auto_next_pct": 65}
    member GET /api/v1/instance/playback -> 200, json == {"auto_next_enabled": False, "auto_next_pct": 65}
```
  Mutations these tests catch:
  - The merge test catches setting every dumped field, which writes `None` and resets days to the default 30.
  - The 82 and 85 rows catch a missing `multiple_of`.
  - Each boundary pair catches an off-by-one in `ge`/`le`.
  - The public-shape test catches adding the fields to `InstanceStatusResponse`.
  - The playback test catches `require_owner` on `/playback` (member gets 403). Its exact-dict assertion catches returning the full owner shape to a member. Its stored `False` also catches the merge guard written as `if value:` instead of `is not None` (the `False` is skipped and the default `True` comes back).
  - The public-shape test's `assert 200` on the owner PUT is what makes it fail before the routes exist. Without it the test passes against a 404 and guards nothing until D2 lands.
- [ ] **Step 2: Run** `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_owner_settings_api.py -v`. Expected: every test that touches a new path fails with 404 (the tests are HTTP-only and import no new names). `test_case_count_is_pinned` passes already.
- [ ] **Step 3: Implement** the models and routes as given under **Produces**. Then update the comments:
  - `api/instance.py:12`: `* \`\`GET /playback\`\` needs only a signed-in session (both players read it). Everything else is **owner-only** via \`\`Depends(require_owner)\`\`. The owner settings have their own response model; \`\`PUT /settings\`\` still returns the public \`\`InstanceStatusResponse\`\`, so nothing private may be added to it.`
  - `main.py:182`: `# Mixed: GET /status is public, GET /playback declares require_session, everything else declares Depends(require_owner).`
- [ ] **Step 4: Run** the same command. Expected: all pass (22 = 8 + 14 parametrised rows).
- [ ] **Step 5: Commit**
```bash
git add backend/app/models.py backend/app/api/instance.py backend/app/main.py backend/tests/test_owner_settings_api.py
git commit -m "feat(instance): owner-only storage & playback settings and a session-level playback read

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D3: Vacuum rules (`vacuum_info`, `is_due`, `next_run_at`)

**Files:**
- Create: `backend/app/services/vacuum.py` (the pure half only)
- No change to `backend/app/models.py`: Part C's C1 already defines `VacuumInfo` and `TorrentStatus.vacuum`.
- Test: `backend/tests/test_vacuum_rules.py`

**Interfaces:**
- Consumes D1: `EffectiveSettings`. Consumes C: `VacuumInfo`.
- Produces, in `services/vacuum.py`. **Module-level imports are limited to stdlib, `loguru`, `sqlalchemy`, `app.models`, `app.database.*`, `app.services.instance_settings`, `app.services.accounts`, `app.services.watch_share`, `app.services.torrent_touch` and `app.torrent.storage`. `app.torrent.manager` is never imported at module level.**
  - `VACUUM_HOUR = 4` and `RECENT_PLAY_WINDOW = timedelta(minutes=10)`
  - `next_run_at(after: datetime, tz: Optional[tzinfo] = None) -> datetime`
    - `after` is aware. `tz=None` means the container's local zone, via `after.astimezone()`.
    - Algorithm: convert `after` to `tz`, replace the time with `VACUUM_HOUR:00:00.000000`, and add one day if the result is `<=` the converted `after`.
    - The first run is **strictly after** `after`, so a loop that wakes at exactly 04:00 schedules tomorrow, not 0 s.
    - Returns the instant in UTC (`.astimezone(timezone.utc)`).
    - Accepted limitation: `astimezone()` with no argument yields a fixed offset, so on a DST-change day the run lands an hour early or late. The default container zone is UTC, which has no DST.
  - `seconds_until_next_run(now: datetime, tz: Optional[tzinfo] = None) -> float` = `(next_run_at(now, tz) - now).total_seconds()`.
  - `is_due(row, settings: EffectiveSettings, now: datetime) -> bool` = `row.last_touched_at is not None and now - row.last_touched_at >= timedelta(days=settings.autovacuum_days)`. `now` is naive UTC.
  - `vacuum_info(row, percents: Dict[str, float], settings: EffectiveSettings, now: datetime, recently_played: bool, *, live_download_rate: float, tz: Optional[tzinfo] = None) -> VacuumInfo`. Evaluate in this order:
    1. `not settings.autovacuum_enabled` gives `VacuumInfo(status='off')`.
    2. `settings.autovacuum_watched_gate and percents and any(p < settings.autovacuum_watched_pct for p in percents.values())` gives `status='kept_watching'`. Nobody started it means `percents` is empty, so the gate does not apply. Every starter must be at or above the threshold, which is inclusive.
    3. Otherwise, `deletes_at` is `None` if `row.last_touched_at is None`, else `next_run_at(max(expiry, now_aware), tz)`, where `expiry = (row.last_touched_at + timedelta(days=settings.autovacuum_days)).replace(tzinfo=timezone.utc)` and `now_aware = now.replace(tzinfo=timezone.utc)`.
    4. `status='active'` if `live_download_rate > 0 or recently_played`, else `'scheduled'`.

    The gate comes before "active" because it is stable while "active" is transient. A paused-at-40% film would otherwise flip from a countdown to "Kept" every time someone pressed play. Paused, stopped, errored and blocked states are not special-cased. They are eligible (§4.4).

- [ ] **Step 1:** `grep -n "class VacuumInfo" backend/app/models.py` must show C1's definition. If it does not, stop: Part C's C1 has not landed, and D must not define a second copy.
- [ ] **Step 2: Write the failing tests** in `backend/tests/test_vacuum_rules.py`:
```python
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from app.services.instance_settings import EffectiveSettings
from app.services.vacuum import vacuum_info, is_due, next_run_at, seconds_until_next_run

UTC = timezone.utc
NOW = datetime(2026, 11, 7, 10, 0)                     # naive UTC
TONIGHT = datetime(2026, 11, 8, 4, 0, tzinfo=UTC)
ON = EffectiveSettings(True, 30, True, 80, True, 80)

def info(touched_days_ago, percents=None, settings=ON, rate=0.0, recent=False, tz=UTC):
    lt = None if touched_days_ago is None else NOW - timedelta(days=touched_days_ago)
    return vacuum_info(SimpleNamespace(last_touched_at=lt), percents or {}, settings, NOW, recent,
                       live_download_rate=rate, tz=tz)

def test_off_is_off_whatever_the_clock():
    got = info(400, settings=replace(ON, autovacuum_enabled=False))
    assert (got.status, got.deletes_at) == ("off", None)
def test_expired_and_nobody_started_it_deletes_tonight():
    assert (info(31).status, info(31).deletes_at) == ("scheduled", TONIGHT)
def test_the_countdown_lands_on_the_first_run_after_expiry():
    assert info(12).deletes_at == datetime(2026, 11, 26, 4, 0, tzinfo=UTC)   # expiry 11-25 10:00
def test_the_run_hour_is_container_local_not_utc():
    assert info(31, tz=timezone(timedelta(hours=10))).deletes_at == datetime(2026, 11, 7, 18, 0, tzinfo=UTC)
def test_one_starter_below_the_threshold_keeps_it():
    got = info(31, {"p1": 50.0}); assert (got.status, got.deletes_at) == ("kept_watching", None)
def test_every_starter_must_pass():
    assert info(31, {"p1": 85.0, "p2": 79.9}).status == "kept_watching"
def test_the_threshold_is_inclusive():
    assert info(31, {"p1": 80.0, "p2": 100.0}).status == "scheduled"
def test_the_threshold_comes_from_settings():
    assert info(31, {"p1": 50.0}, settings=replace(ON, autovacuum_watched_pct=40)).status == "scheduled"
def test_gate_off_ignores_percents():
    assert info(31, {"p1": 10.0}, settings=replace(ON, autovacuum_watched_gate=False)).status == "scheduled"
def test_a_live_download_is_active_and_keeps_its_countdown():
    got = info(31, rate=12.5); assert (got.status, got.deletes_at) == ("active", TONIGHT)
def test_a_recent_play_is_active():
    assert info(31, recent=True).status == "active"
def test_the_gate_outranks_active():
    assert info(31, {"p1": 50.0}, rate=12.5).status == "kept_watching"
def test_a_row_with_no_clock_has_no_date():
    got = info(None); assert (got.status, got.deletes_at) == ("scheduled", None)
def test_is_due_is_inclusive_at_exactly_n_days():
    row = lambda d: SimpleNamespace(last_touched_at=NOW - d)
    assert is_due(row(timedelta(days=30)), ON, NOW) is True
    assert is_due(row(timedelta(days=30) - timedelta(seconds=1)), ON, NOW) is False
    assert is_due(SimpleNamespace(last_touched_at=None), ON, NOW) is False
def test_next_run_is_strictly_after():
    assert next_run_at(datetime(2026, 11, 7, 3, 59, tzinfo=UTC), UTC) == datetime(2026, 11, 7, 4, 0, tzinfo=UTC)
    assert next_run_at(datetime(2026, 11, 7, 4, 0, tzinfo=UTC), UTC) == datetime(2026, 11, 8, 4, 0, tzinfo=UTC)
    assert seconds_until_next_run(datetime(2026, 11, 7, 3, 0, tzinfo=UTC), UTC) == 3600.0
```
  Mutations these tests catch:

  | Test | Catches |
  | --- | --- |
  | `test_off_is_off_whatever_the_clock` | ignoring `autovacuum_enabled` |
  | `test_expired_and_nobody_started_it_deletes_tonight` | applying the gate when nobody started it |
  | `test_the_countdown_lands_on_the_first_run_after_expiry` | `deletes_at = expiry` |
  | `test_the_run_hour_is_container_local_not_utc` | 04:00 computed in UTC (would give 11-08 04:00Z) |
  | `test_every_starter_must_pass` | the gate's `any(p < pct)` written as `all(p < pct)` |
  | `test_the_threshold_is_inclusive` | `<=` instead of `<` in the gate |
  | `test_the_threshold_comes_from_settings` | a hard-coded 80 |
  | `test_a_live_download_is_active_and_keeps_its_countdown`, `test_a_recent_play_is_active` | dropping either guard |
  | `test_the_gate_outranks_active` | reordering steps 2 and 4 |
  | `test_is_due_is_inclusive_at_exactly_n_days` | `>` for `>=` |
  | `test_next_run_is_strictly_after` | `<` for `<=` in `next_run_at` |
- [ ] **Step 3: Run** `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_vacuum_rules.py -v`. Expected: `ModuleNotFoundError: No module named 'app.services.vacuum'`.
- [ ] **Step 4: Implement** the functions as given under **Produces**.
- [ ] **Step 5: Run** the same command. Expected: 15 passed.
- [ ] **Step 6: Commit**
```bash
git add backend/app/services/vacuum.py backend/tests/test_vacuum_rules.py
git commit -m "feat(vacuum): the expiry, watched-gate and in-use rules as one pure function

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D4: `run_vacuum` and `fill_vacuum`, one shared evaluator

**Files:**
- Modify: `backend/app/services/vacuum.py`
- Modify: `backend/app/torrent/storage.py`. Add `human_size(num: Optional[int]) -> str` with the body of `api/torrents.py:26-31`, unchanged. Widen the `from typing import Union` at `:5` to `Optional, Union`.
- Modify: `backend/app/api/torrents.py:26-31`. Replace the `def` with `from app.torrent.storage import human_size as _human_size`, which keeps `cron/jobs.py:277`'s import working.
- Test: `backend/tests/test_vacuum_run.py`

**Interfaces:**
- Consumes:
  - D1 `effective_settings`
  - D3 `vacuum_info`, `is_due`, `RECENT_PLAY_WINDOW`
  - C `profile_percents` (C7), `Torrent.last_touched_at`, `Torrent.size_bytes` (C1), `remove_torrent(id, delete_files=True)` (C4), and, in tests only, `touch_torrent` (C2) and `stamp_legacy_torrents` (C3)
  - `accounts_service.get_instance(session, create=False)`
  - `app.database.session.get_db`, imported at module level as `get_db` so tests can patch `app.services.vacuum.get_db`
- Produces:
  - `_live_rates(manager) -> Dict[str, float]` returns `{tid: handle.status().download_rate}` for every entry in `getattr(manager, "active_torrents", {})`. **A handle whose `status()` raises counts as live (`1.0`).** Deleting on an unreadable handle is the unsafe direction.
  - `_evaluate(session, rows: List[Torrent], settings, now, *, manager, tz) -> Dict[str, VacuumInfo]` does the following for each row:
    - `percents = profile_percents(session, row)`
    - `recently_played`: `max(UserStreamingProgress.last_watched_at)` over rows with `torrent_id == row.id`, one grouped query for all ids, normalised to naive UTC if aware, must be `>= now - RECENT_PLAY_WINDOW`
    - `live_download_rate = rates.get(row.id, 0.0)`, where `rates = _live_rates(manager)` is computed once per `_evaluate` call, not once per row

    Add this comment at the `last_watched_at` read: the PUT heartbeat writes naive *local* time (`api/streaming.py:591`). With `TZ` east of UTC that over-reports "recent", which keeps the download (the safe direction). With `TZ` west of UTC it under-reports, and the clock still protects the download, because every progress write also touches `last_touched_at` (Part C).
  - `fill_vacuum(statuses: List[TorrentStatus], now: datetime, *, manager=None, tz=None) -> None` opens `with get_db() as session` and loads `effective_settings` once. It loads the `Torrent` rows for the statuses' ids, then sets `status.vacuum = _evaluate(...)[status.id]`. A status with no row keeps `vacuum = None`.
  - `run_vacuum(now: datetime, *, manager=None, tz=None) -> List[str]` works in two phases:
    1. Inside one `get_db()`, if `not effective_settings(...).autovacuum_enabled`, return `[]`. Otherwise evaluate all rows and collect `(id, movie_title, reason, last_touched_at, size_bytes)` for each row where `info.status == 'scheduled' and is_due(row, settings, now)`.
    2. After the session has closed, for each collected row **in id order**, if `manager.remove_torrent(tid, delete_files=True)` is truthy, append the id and log one line. A failed removal is neither returned nor logged as deleted.

    Due-ness is computed from `last_touched_at` read in phase 1 of **this** run, never from a value cached by an earlier `fill_vacuum` or from `added_at`/`finished_at`. `run_vacuum` and the endpoints all run on the one event loop (D5 calls it synchronously), so a Play handled before the run has already written its touch (C3 progress writes, C6 reuse).

    The reason is `f"untouched {(now - lt).days} days"`. When the gate applied (gate on and `percents` non-empty), append `f", every viewer past {settings.autovacuum_watched_pct}%"`.

    The log line is exactly:
    `logger.info(f"Autovacuum: deleted '{title}' ({tid}) — reason: {reason}; last touched {lt:%Y-%m-%d %H:%M} UTC; freed {human_size(size) if size else 'unknown size'}")`.

- [ ] **Step 1: Write the failing tests** in `backend/tests/test_vacuum_run.py`.

  Fixture `world(db_session, override_get_db, monkeypatch)`:
  - `monkeypatch.setattr("app.services.vacuum.get_db", override_get_db)`
  - seed `Instance(id=INSTANCE_SINGLETON_ID, autovacuum_enabled=True)`, leaving days, gate and percent NULL, i.e. 30, on, 80
  - users `p1`, `p2`, `p3` (`User(username=…, display_name=…)`)
  - a fake manager: `fake = SimpleNamespace(active_torrents={}, removed=[], ok={})`, then `fake.remove_torrent = lambda tid, delete_files=False: fake.removed.append((tid, delete_files)) or fake.ok.get(tid, True)`

  `NOW = datetime(2026, 11, 7, 10, 0)`. A helper `torrent(tid, days, **kw)` inserts a `Torrent` with the following values:
  - `movie_title=f"Title {tid}"`, `quality="1080p"`, `magnet=f"magnet:?xt=urn:btih:{tid}"`, `url=""`, `save_path=f"downloads/{tid}"`
  - `state=kw.get("state", "finished")`, `media_type=kw.get("media_type", "movie")`
  - `last_touched_at=NOW - timedelta(days=days)`, `size_bytes=1610612736`
  - `meta_data`, `season` and `precomputed_episodes` from `kw`

  A helper `progress(user, tid, movie_id, pct, *, completed=False, file_index=None, watched=NOW - timedelta(days=40))` inserts a `UserStreamingProgress`. Commit. The fixture exposes `world.db = db_session`. Imports include `from app.services.torrent_touch import touch_torrent, stamp_legacy_torrents` (C2/C3).

  Seeded rows:

  | Row | Days untouched | Other setup | Expected outcome |
  | --- | --- | --- | --- |
  | `expired` | 31 | — | deleted |
  | `fresh` | 5 | — | kept |
  | `gated` | 31 | p1 at 40% on `movie:1` | kept |
  | `finished-watched` | 31 | p3 at 100, `completed=True`, on `movie:3` | deleted, gate passed |
  | `downloading` | 31 | `state="downloading"`, plus `fake.active_torrents["downloading"] = (SimpleNamespace(status=lambda: SimpleNamespace(download_rate=50_000)), {})` | kept |
  | `stale-rate` | 31 | `state="paused"`, `meta_data={"download_rate": 300.0}`, not in `active_torrents` | deleted |
  | `watching` | 31 | p2 at 95 on `movie:2`, `watched=NOW - timedelta(minutes=5)` | kept |
  | `errored` | 31 | `state="error"` | deleted |
  | `pack` | 31 | `media_type="tv"`, `season=1`, `precomputed_episodes={str(i): {"season": 1, "episode": i + 1} for i in range(10)}`; p1 at 100 on `tv:9:s1:e1..e3`, `file_index` 0..2 | kept, average 30% |

```python
DELETED = {"expired", "finished-watched", "stale-rate", "errored"}

def test_run_deletes_exactly_the_due_rows_with_their_files(world):
    assert set(run_vacuum(NOW, manager=world.fake)) == DELETED
    assert set(world.fake.removed) == {(t, True) for t in DELETED}
def test_disabled_deletes_nothing(world):            # set instance.autovacuum_enabled = False, commit
    assert run_vacuum(NOW, manager=world.fake) == [] and world.fake.removed == []
def test_no_instance_row_deletes_nothing(world):     # delete the Instance row, commit
    assert run_vacuum(NOW, manager=world.fake) == []
def test_a_failed_removal_is_not_reported(world):
    world.fake.ok["expired"] = False
    assert "expired" not in run_vacuum(NOW, manager=world.fake)
def test_one_log_line_per_deletion(world):
    lines = []; hid = logger.add(lambda m: lines.append(m.record["message"]), level="INFO")
    try: run_vacuum(NOW, manager=world.fake)
    finally: logger.remove(hid)
    deleted = [l for l in lines if l.startswith("Autovacuum: deleted")]
    assert len(deleted) == 4
    assert ("Autovacuum: deleted 'Title expired' (expired) — reason: untouched 31 days; "
            "last touched 2026-10-07 10:00 UTC; freed 1.5 GB") in deleted
    assert any("(finished-watched) — reason: untouched 31 days, every viewer past 80%;" in l for l in deleted)
def test_a_download_played_moments_before_the_run_is_kept(world):   # Review Focus 2
    # What C6's reuse (Play pressed at 03:59) and C3's progress writes leave behind. No progress
    # row is added, so recently_played is False and only the clock can protect it.
    touch_torrent(world.db, "expired", NOW - timedelta(seconds=5)); world.db.commit()
    assert "expired" not in run_vacuum(NOW, manager=world.fake)
    assert ("expired", True) not in world.fake.removed
def test_legacy_rows_get_a_full_grace_period_after_the_startup_stamp(world):   # Review Focus 4
    # A pre-upgrade row: every lifecycle column NULL, finished, no size, no account.
    world.db.add(Torrent(id="legacy", movie_title="Old", quality="1080p", state="finished",
                         magnet="magnet:?xt=urn:btih:legacy", url="", save_path="downloads/legacy",
                         media_type="movie")); world.db.commit()
    T0 = NOW
    stamp_legacy_torrents(world.db, T0); world.db.commit()        # what C3's startup block runs
    assert "legacy" not in run_vacuum(T0 + timedelta(days=29), manager=world.fake)
    assert "legacy" in run_vacuum(T0 + timedelta(days=30), manager=world.fake)
def test_fill_marks_each_status_and_leaves_unknown_ids_alone(world):
    # statuses = [row.to_status() for the "expired" and "gated" rows] + [TorrentStatus(id="ghost", movie_title="x",
    #   quality="1080p", state="finished", save_path="x", created_at=NOW, updated_at=NOW)]
    fill_vacuum(statuses, NOW, manager=world.fake, tz=timezone.utc)
    assert [s.vacuum.status if s.vacuum else None for s in statuses] == ["scheduled", "kept_watching", None]
```
  Mutations each test catches:
  - `test_run_deletes_exactly_the_due_rows_with_their_files`:
    - `delete_files=False` changes the removed tuples;
    - dropping the gate deletes `gated` and `pack`;
    - reading `status.download_rate` or `meta_data` instead of the live handle keeps `stale-rate`;
    - dropping the `active_torrents` check deletes `downloading`;
    - dropping `recently_played` deletes `watching`;
    - exempting error or paused states keeps `errored` or `stale-rate`.
  - `test_disabled_deletes_nothing`: dropping the enabled check.
  - `test_a_failed_removal_is_not_reported`: appending before checking the return value.
  - `test_one_log_line_per_deletion`: a missing or extra line, or a wrong field in the pinned line.
  - `test_a_download_played_moments_before_the_run_is_kept`: due-ness read from `added_at`/`finished_at` (31 days old here too) instead of `last_touched_at`, or from a stale cached evaluation.
  - `test_legacy_rows_get_a_full_grace_period_after_the_startup_stamp`: the stamp writing an old instant (e.g. the mixin's process-start `created_at`) or leaving `last_touched_at` NULL (the row would then never be due, and the +30 d assertion fails), and the vacuum counting from `finished_at` set by a different path. The `size_bytes=NULL` legacy row also exercises the `'unknown size'` branch of the log line.
  - `test_fill_marks_each_status_and_leaves_unknown_ids_alone`: `fill_vacuum` skipping the gate (`gated` would read `scheduled`), never setting `vacuum` (both `None`), and a `KeyError` on a ghost id. It cannot prove that `fill_vacuum` shares `_evaluate` with `run_vacuum`, because a correct copy would pass. Sharing is a code-review check: `fill_vacuum` must contain no rule of its own.
- [ ] **Step 2: Run** `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_vacuum_run.py -v`. Expected: `ImportError: cannot import name 'run_vacuum'`.
- [ ] **Step 3: Implement** as given under **Produces**, plus the `human_size` move.
- [ ] **Step 4: Run** the same command, then `... python -m pytest tests/test_torrents_api.py tests/test_vacuum_rules.py -v` to confirm the `_human_size` alias broke nothing. Expected: all pass.
- [ ] **Step 5: Commit**
```bash
git add backend/app/services/vacuum.py backend/app/torrent/storage.py backend/app/api/torrents.py backend/tests/test_vacuum_run.py
git commit -m "feat(vacuum): delete due downloads through the owned-content path, one log line each

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D5: Daily 04:00 task, started from `startup` whatever `cron_enabled` is

**Files:**
- Modify: `backend/app/services/vacuum.py`
- Modify: `backend/app/main.py`:
  - import `from app.services.vacuum import start_vacuum_task, stop_vacuum_task` near `:24-28`;
  - startup: a new `try` block after the torrent-manager block (`:271-278`) and before `# Start scheduler if enabled` (`:280`), outside the `if settings.cron_enabled:` block. By now the startup event already holds A4's extended accounts-bootstrap log line and C3's legacy-stamp block (before the torrent manager); D5 adds below both and edits neither;
  - shutdown: a new block first, before `# First shut down the scheduler` (`:308`).
- Modify: `docs/ARCHITECTURE.md:179`, the Volumes bullet.
- Test: `backend/tests/test_vacuum_schedule.py`

**Interfaces:**
- Consumes D3 `seconds_until_next_run`, D4 `run_vacuum`, and C `utcnow`.
- Produces:
  - `async def _vacuum_loop(*, sleep=asyncio.sleep, run=None, clock=None, tz=None) -> None` loops forever:
    - `now = clock() if clock else datetime.now(timezone.utc)`
    - `await sleep(seconds_until_next_run(now, tz))`
    - then, inside `try` / `except Exception: logger.exception("Autovacuum run failed")`, call `(run or run_vacuum)(utcnow())`

    It runs synchronously on the loop, as `DELETE /torrents/{id}` already does, because `remove_torrent` mutates `active_torrents`, which the loop's other code reads.
  - `_task: Optional[asyncio.Task] = None` at module level.
  - `def start_vacuum_task() -> asyncio.Task` is idempotent: it returns the existing task if that task is not done, otherwise it calls `asyncio.create_task(_vacuum_loop())`.
  - `async def stop_vacuum_task() -> None` cancels `_task`, awaits it while swallowing `CancelledError`, and sets `_task = None`.
  - `main.py` startup: `start_vacuum_task()` in its own `try/except Exception` that logs `critical`, plus `logger.info("Autovacuum task started (daily at 04:00 container time)")`.
  - `main.py` shutdown: `await asyncio.wait_for(stop_vacuum_task(), timeout=5.0)`. On a timeout or exception, `failed_services.append("autovacuum")`, using the same shape as the scheduler block.

- [ ] **Step 1: Write the failing tests:**
```python
import asyncio
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from app.config import settings
from app.main import app
from app.services import vacuum

def test_the_loop_sleeps_to_four_runs_and_survives_a_failing_run():
    sleeps, runs = [], []
    async def fake_sleep(s):
        sleeps.append(s)
        if len(sleeps) == 3: raise asyncio.CancelledError
    def fake_run(now):
        runs.append(now)
        if len(runs) == 1: raise RuntimeError("disk on fire")
        return []
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(vacuum._vacuum_loop(sleep=fake_sleep, run=fake_run, tz=timezone.utc,
                    clock=lambda: datetime(2026, 11, 7, 3, 0, tzinfo=timezone.utc)))
    assert sleeps == [3600.0, 3600.0, 3600.0]
    assert len(runs) == 2 and all(r.tzinfo is None for r in runs)

def test_start_is_idempotent_and_stop_cancels():
    async def scenario():
        t1 = vacuum.start_vacuum_task(); t2 = vacuum.start_vacuum_task()
        assert t1 is t2 and not t1.done()
        await vacuum.stop_vacuum_task()
        assert t1.cancelled() and vacuum._task is None
    asyncio.run(scenario())

def test_startup_starts_it_even_with_cron_disabled_and_shutdown_stops_it(monkeypatch):
    monkeypatch.setattr(settings, "cron_enabled", False)
    with TestClient(app):
        task = vacuum._task
        assert task is not None and not task.done()
    assert vacuum._task is None and task.done()
```
  Mutations these tests catch:
  - The loop test catches:
    - removing the `try/except`, because the `RuntimeError` escapes instead of `CancelledError`;
    - running before sleeping, which gives 3 runs;
    - passing an aware `now` to `run`, which fails the `tzinfo` check.
  - The startup test catches:
    - moving `start_vacuum_task()` inside `if settings.cron_enabled:`;
    - forgetting the shutdown call, which leaves `_task` set.

  This startup test is the seam test. Without it, every unit can pass while nothing ever starts the loop. That failure mode is the `review-cannot-see-the-seams` lesson.
- [ ] **Step 2: Run** `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_vacuum_schedule.py -v`. Expected: `AttributeError: module 'app.services.vacuum' has no attribute '_vacuum_loop'`.
- [ ] **Step 3: Implement** as given under **Produces**. Then update `docs/ARCHITECTURE.md:179` to:

  `- \`./downloads\` (bind mount) — downloaded media on the host. **Autovacuum** (owner setting in Settings → Storage & playback, off by default) deletes downloads untouched for N days once a day at 04:00 *container-local* time (UTC unless \`TZ\` is set): \`services/vacuum.py\`, its own asyncio task started from the \`startup\` event, independent of \`CRON_ENABLED\`.`
- [ ] **Step 4: Run** the same command. Expected: 3 passed. Then run the whole suite to confirm that every `with TestClient(app)` file still starts and stops cleanly: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/ -q --ignore=tests/test_torrent.py --ignore=tests/test_torrent_alternate.py`. Expected: no new failures against the pre-task baseline. Record the baseline count before Step 3, using the same command. The two `--ignore`s are required. Both files are module-level libtorrent scripts that join a real swarm during collection, so on a host without the film already on disk the run downloads it or hangs (parked finding 21).
- [ ] **Step 5: Commit**
```bash
git add backend/app/services/vacuum.py backend/app/main.py backend/tests/test_vacuum_schedule.py docs/ARCHITECTURE.md
git commit -m "feat(vacuum): run daily at 04:00 from the startup event, independent of the schedule cron

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D6: Fill `TorrentStatus.vacuum` in `/torrents/list` and `/torrents/status/{id}`

**Files:**
- Modify: `backend/app/api/torrents.py`:
  - `get_torrent_status` (`:227-236` at `8fc6fe3`): before `return status`, call `fill_vacuum([status], utcnow(), manager=torrent_manager)`.
  - `list_torrents` (`:239-252`, as rewritten by Part C for scoping and `watched_by`): call `fill_vacuum(result, utcnow(), manager=torrent_manager)` on the final list after any `state` filter, then return it.

  Pass the module-level `torrent_manager` explicitly, so the existing `monkeypatch.setattr(torrents_api, "torrent_manager", fake)` fakes reach it. Leave `/for-title` and the `POST /download` reuse return alone: the TV never shows `vacuum`. In `list_torrents`, the call goes after C7's owner-branch `watched_by` block and outside C's `with db as session:` block (`fill_vacuum` opens its own `get_db()`; entering the dependency twice is the CLAUDE.md 500).
- Test: `backend/tests/test_vacuum_status_fields.py`

**Interfaces:**
- Consumes D4 `fill_vacuum`, C `utcnow`, and C's list/status endpoint shapes.
- Produces: `vacuum` set on every row of those two responses. It is `{"status": "off", "deletes_at": null}` when autovacuum is disabled, and `null` only for an id with no DB row.

- [ ] **Step 1: Write the failing tests.**

  Fixture: copy `tests/test_torrents_api.py:13-27`'s fake manager and add `active_torrents={}`, `get_torrent_status=lambda tid: rows[tid].to_status()` and `get_all_torrents=lambda: [r.to_status() for r in rows.values()]`. Also:
  - `monkeypatch.setattr("app.services.vacuum.get_db", override_get_db)`
  - `app.dependency_overrides[get_db] = override_get_db`
  - seed `Instance(autovacuum_enabled=True)` and one `Torrent` `expired` with `last_touched_at = utcnow() - timedelta(days=31)`, `state="finished"`

  If Part C's `list_torrents` reads rows by another route than `get_all_torrents`, seed through the fixture Part C's own list test uses. The assertions stay the same.
```python
def _aware(s): return datetime.fromisoformat(s.replace("Z", "+00:00"))
def test_list_carries_the_countdown(client):
    v = client.get("/api/v1/torrents/list").json()[0]["vacuum"]
    assert v["status"] == "scheduled"
    when = _aware(v["deletes_at"])
    assert when.utcoffset() == timedelta(0) and when.astimezone().hour == 4   # aware UTC, 04:00 local
def test_status_carries_the_countdown(client):
    assert client.get("/api/v1/torrents/status/expired").json()["vacuum"]["status"] == "scheduled"
def test_disabled_is_reported_as_off_not_absent(client):   # set autovacuum_enabled False, commit
    assert client.get("/api/v1/torrents/list").json()[0]["vacuum"] == {"status": "off", "deletes_at": None}
```
  Mutations these tests catch:
  - The first two tests catch the `fill_vacuum` call being missing from either endpoint, since each test fails alone.
  - The `utcoffset` assertion catches serialising a naive `deletes_at`, which `fromisoformat` would return with no offset.
  - `astimezone().hour == 4` is independent of TZ, because the server and the test share the process's zone.
- [ ] **Step 2: Run** `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_vacuum_status_fields.py -v`. Expected: `TypeError: 'NoneType' object is not subscriptable`, because `vacuum` is null.
- [ ] **Step 3: Implement** the two calls.
- [ ] **Step 4: Run** the same command, plus `tests/test_torrents_api.py`. Expected: all pass.
- [ ] **Step 5: Commit**
```bash
git add backend/app/api/torrents.py backend/tests/test_vacuum_status_fields.py
git commit -m "feat(downloads): list and status report each download's autovacuum outcome

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D7: Frontend `instanceService` owner-settings and playback calls

**Files:**
- Modify: `frontend/src/services/instance.ts`:
  - change the header comment at `:3-4` to `// Owner-only instance administration (every call 403s for a member) — except getPlayback, which any signed-in session reads.`
  - add the types and three members after `updateSettings` (`:77-80`). Indent the members two spaces, like the rest of the object. `deadServiceMembers` only sees keys matching `^ {2}(\w+)\s*:`.
- Modify: `frontend/src/app/(bigscreen)/noDeadExports.test.ts`, adding three entries inside `DECLARED_TEST_ONLY` (`:332-358`), after the `'instanceService.updateSettings'` entry and before the closing `};` at `:358`
- Test: `frontend/src/services/instance.test.ts`

**Interfaces:**
- Produces:
```ts
export interface OwnerSettings {
  autovacuum_enabled: boolean; autovacuum_days: number; autovacuum_watched_gate: boolean;
  autovacuum_watched_pct: number; auto_next_enabled: boolean; auto_next_pct: number;
}
export interface PlaybackSettings { auto_next_enabled: boolean; auto_next_pct: number }
// members of instanceService:
getOwnerSettings: async (): Promise<OwnerSettings>          // GET  '/instance/owner-settings'
updateOwnerSettings: async (patch: Partial<OwnerSettings>): Promise<OwnerSettings>  // PUT '/instance/owner-settings', patch
getPlayback: async (): Promise<PlaybackSettings>             // GET  '/instance/playback'
```
- [ ] **Step 1: Write the failing test.** Mock `./api-client` as `devices.test.ts:5-7` does, with `{ default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }`, so that the real `instance.ts` runs:
  - `getOwnerSettings` → `expect(apiClient.get).toHaveBeenCalledWith('/instance/owner-settings')`, and it returns `response.data`.
  - `updateOwnerSettings({ auto_next_pct: 65 })` → `expect(apiClient.put).toHaveBeenCalledWith('/instance/owner-settings', { auto_next_pct: 65 })`.
  - `getPlayback` → `expect(apiClient.get).toHaveBeenCalledWith('/instance/playback')`. This catches pointing it at `/owner-settings`, which 403s every member's player.

  Also add three entries to `DECLARED_TEST_ONLY`:
  - `'instanceService.getOwnerSettings'` and `'instanceService.updateOwnerSettings'`: `'Added in Part D task D7; StorageAndPlaybackSection (D8) is the caller and deletes this line.'`
  - `'instanceService.getPlayback'`: `'Added in Part D; Part E usePlaybackSettings is the caller and deletes this line.'`

  The allowlist asserts that every entry is still dead, so each line must be removed by the task that wires its member.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/services/instance.test.ts`. Expected: `TypeError: instanceService.getOwnerSettings is not a function`.
- [ ] **Step 3: Implement** the types and members.
- [ ] **Step 4: Run** `npx vitest run src/services/instance.test.ts`, then `npm run test:tv` and `npx tsc --noEmit`. Expected: all green. If the three allowlist lines were missing, `test:tv` would fail with `instanceService.getOwnerSettings` reported dead.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/services/instance.ts frontend/src/services/instance.test.ts "frontend/src/app/(bigscreen)/noDeadExports.test.ts"
git commit -m "feat(instance): client calls for owner settings and the playback read

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D8: Owner-only "Storage & playback" section in web Settings

**Files:**
- Modify: `frontend/src/components/settings/SettingsView.tsx`:
  - add `export const StorageAndPlaybackSection` beside the other sections, before the `// SettingsView (main export)` banner, using the file's private `Card` and `SectionHeading`. Re-add `Toggle` to the fre import at `:7` (B4 dropped it when Restrictions stopped using it);
  - in `SettingsView` (`:543`), add `const { account } = useSession();` on the line after `useUser()` (`:544`), **before** the `if (isLoading) return` at `:550`. A hook below that early return breaks the rules of hooks;
  - render `{account?.role === 'owner' && <StorageAndPlaybackSection />}` immediately before `<InstallCard />` (`:581`), outside the `effectiveId &&` block, because the setting is instance-wide and not per-profile.
- Modify: `frontend/src/components/settings/SettingsView.test.tsx`, as Part B's B4 left it (B4 renamed the sections test to four sections, added `changePasscode: vi.fn()` to the `useUser` mock, deleted the require-passcode toggle test and added two tests; it added **no** `SessionContext` mock). The change breaks it, because `useSession` throws outside a provider. Add the following, and the existing tests then run unchanged as a member:
  - `let mockRole: 'owner' | 'member' = 'member'`, plus `vi.mock('@/context/SessionContext', () => ({ useSession: () => ({ account: { role: mockRole } }) }))`.
  - `vi.mock('@/services/instance', () => ({ instanceService: { getOwnerSettings: (...a: unknown[]) => mockGetOwnerSettings(...a), updateOwnerSettings: vi.fn() } }))`
  - declare `const mockGetOwnerSettings = vi.fn();` beside the other `mock*` consts at the top of the file
  - in `beforeEach`, set `mockRole = 'member'` and `mockGetOwnerSettings.mockResolvedValue(DEFAULTS)`
- Modify: `frontend/src/app/(bigscreen)/noDeadExports.test.ts`. Delete the two D7 lines for `getOwnerSettings` and `updateOwnerSettings`.
- Test: `frontend/src/components/settings/StorageAndPlaybackSection.test.tsx` (new). It imports `{ StorageAndPlaybackSection } from './SettingsView'` and mocks `react-hot-toast` and `@/services/instance` as `{ instanceService: { getOwnerSettings: (...a) => mockGetOwnerSettings(...a), updateOwnerSettings: (...a) => mockUpdateOwnerSettings(...a) } }`, with both `mock*` consts declared at the top of the file.

**Interfaces:**
- Consumes D7: `instanceService.getOwnerSettings` and `updateOwnerSettings`, and `OwnerSettings`. Consumes `useSession` (`context/SessionContext.tsx:84`).
- Produces `StorageAndPlaybackSection: React.FC` (no props). It contains:
  - **Heading:** `SectionHeading` "Storage & playback".
  - **Loading:** on mount, `getOwnerSettings()` with a cancelled-flag guard. Until it resolves, render no form. On rejection, render `<p role="alert">Could not load storage & playback settings.</p>` and no form.
  - **Controls.** The labels are exact, because the tests find controls by them:

    | Control | Type and bounds | Disabled when |
    | --- | --- | --- |
    | "Delete untouched downloads automatically" | `Toggle` (`autovacuum_enabled`) | — |
    | "Days untouched before deleting" | `Field`, `htmlFor="autovacuum-days"`, `Input id="autovacuum-days" type="number" min={1} max={365}` | autovacuum off |
    | "Only once everyone who started it has watched" | `Toggle` (`autovacuum_watched_gate`) | autovacuum off |
    | "Watched threshold" | `Field`, `htmlFor="autovacuum-watched-pct"`, native `<input id="autovacuum-watched-pct" type="range" min={10} max={100} step={5}>`, with `<output>{n}%</output>` | autovacuum off or gate off |
    | "Download the next episode automatically" | `Toggle` (`auto_next_enabled`) | — |
    | "Start the next episode at" | `Field`, `htmlFor="auto-next-pct"`, `<input id="auto-next-pct" type="range" min={50} max={95} step={5}>`, with `<output>` | auto-next off |

    Each range input needs the `id`. Without it, `Field`'s `<label htmlFor>` labels nothing and `getByLabelText` throws.

    Both sliders get `className="w-full accent-gold"`. Keep the days value as a string while the user types.
  - **Hint** under the days field, passed as the days `Field`'s `hint` prop: "Runs daily at 4 am. Playing something resets its clock."
  - **Form:** `<form noValidate onSubmit={...}>`. `noValidate` is required. jsdom (`HTMLFormElement-impl.js:114`) and browsers run constraint validation on submit, so with the input's `min`/`max` an out-of-range value blocks the submit event. The handler would never run, the message below would never show, and test 4 would fail against correct code.
  - **Save:** a submit `Button` labelled "Save storage & playback".
    - If `Number(days)` is not an integer from 1 to 365, pass "Days must be a whole number from 1 to 365" as the days `Field`'s `error` prop (it renders `role="alert"`) and make no request.
    - Otherwise call `updateOwnerSettings({...form, autovacuum_days: Number(days)})`, which sends all six fields. Set the form from the response, then `toast.success('Storage & playback saved')`.
    - On error, `toast.error('Could not save storage & playback settings')`.

- [ ] **Step 1: Write the failing tests.**

  `StorageAndPlaybackSection.test.tsx`, where `DEFAULTS = {autovacuum_enabled:false, autovacuum_days:30, autovacuum_watched_gate:true, autovacuum_watched_pct:80, auto_next_enabled:true, auto_next_pct:80}`:
  1. **Loads the saved values.** Resolve `{true, 14, true, 70, true, 65}`. Then:
     - `await screen.findByLabelText('Days untouched before deleting')` `toHaveValue(14)`, **a number**. jest-dom returns `Number(value)` for `type="number"`, so `toHaveValue('14')` fails against correct code. The range inputs return strings, so the next two use `'70'` and `'65'`;
     - `getByLabelText('Watched threshold')` has value `'70'`;
     - `getByLabelText('Start the next episode at')` has value `'65'`;
     - `getByRole('switch', { name: 'Delete untouched downloads automatically' })` is checked.

     The values 14, 70 and 65 differ from every default, which catches rendering the defaults instead of the response.
  2. **The sliders' bounds are the spec's.** The auto-next slider has `min '50'`, `max '95'` and `step '5'`. The watched slider has `'10'`, `'100'` and `'5'`.
  3. **Save sends the whole form as edited.** Resolve `DEFAULTS`. Then:
     - click the autovacuum switch;
     - `userEvent.clear` the days input and type `14`;
     - `fireEvent.change(getByLabelText('Start the next episode at'), { target: { value: '65' } })`;
     - click "Save storage & playback".

     Before the click, `mockUpdateOwnerSettings.mockImplementation(async (p) => p)`. The component sets the form from the response, and a bare `vi.fn()` resolving `undefined` would crash the render after the assertion.

     Assert `toHaveBeenCalledWith({ autovacuum_enabled: true, autovacuum_days: 14, autovacuum_watched_gate: true, autovacuum_watched_pct: 80, auto_next_enabled: true, auto_next_pct: 65 })`. This catches sending `'14'` as a string, dropping a field, and the slider not being wired to `auto_next_pct`.
  4. **Out-of-range days are refused before any request.** With autovacuum on, typing `0` and then `366` each give `findByRole('alert')` with the text "Days must be a whole number from 1 to 365", and `updateOwnerSettings` is not called.
  5. **Dependent controls follow their switches.** On `DEFAULTS`:
     - the days input and the watched slider are `disabled`, and the auto-next slider is enabled;
     - after clicking "Download the next episode automatically", the auto-next slider is `disabled`;
     - after clicking "Delete untouched downloads automatically", the days input and the watched slider are enabled; after clicking "Only once everyone who started it has watched", the watched slider is `disabled` and the days input is still enabled. This case is the only one that catches the watched slider ignoring the gate switch.
  6. **A load failure shows an error, not a form of defaults.** `getOwnerSettings` rejects. Then:
     - `findByRole('alert')` has the text "Could not load storage & playback settings.";
     - `queryByRole('button', { name: 'Save storage & playback' })` is null.

     This catches initialising the form state with defaults, which would let an owner overwrite real settings blind.

  `SettingsView.test.tsx`, two new tests:
  - **The owner sees the section.** With `mockRole = 'owner'`, `findByRole('heading', { name: 'Storage & playback' })` is found and `mockGetOwnerSettings` was called once. That call is the positive control for the member test's `not.toHaveBeenCalled()`.
  - **A member does not.** With `mockRole = 'member'`, after `await screen.findByText('Settings')`, `queryByRole('heading', { name: 'Storage & playback' })` is null and `expect(mockGetOwnerSettings).not.toHaveBeenCalled()`. This catches rendering the section for everyone and hiding it with CSS, as well as fetching before the role check.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/components/settings/`. Expected: the new file fails with `StorageAndPlaybackSection is not exported` or an element type of undefined, and the owner test fails because the heading is not found.
- [ ] **Step 3: Implement** as given under **Produces**, and delete the two allowlist lines.
- [ ] **Step 4: Run** `npx vitest run src/components/settings/`, then `npm run test:tv` and `npx tsc --noEmit`. Expected: green. Loop the settings directory 5 times (`for i in 1 2 3 4 5; do npx vitest run src/components/settings/ || break; done`), because a single green run of an RTL `waitFor` suite proves little (see `verify-suites-by-looping`).
- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/settings/SettingsView.tsx frontend/src/components/settings/SettingsView.test.tsx frontend/src/components/settings/StorageAndPlaybackSection.test.tsx "frontend/src/app/(bigscreen)/noDeadExports.test.ts"
git commit -m "feat(settings): owner-only Storage & playback section for autovacuum and next-episode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D9: Downloads row shows the autovacuum line

**Files:**
- Modify: `frontend/src/types/index.ts`. Part C's C1 already declares `VacuumInfo` and `TorrentStatus.vacuum?: VacuumInfo | null`. D9 only adds `export type VacuumStatus = 'off' | 'scheduled' | 'kept_watching' | 'active';` above C1's `VacuumInfo` and makes its field `status: VacuumStatus` (if C1 wrote the union inline, replace it with the alias). Do not declare a second `VacuumInfo`: TS would merge the two interfaces silently.
- Create: `frontend/src/components/downloads/vacuumLine.ts`
- Modify: `frontend/src/components/downloads/DownloadsView.tsx` as Part C's C9 left it, in `TorrentRow`. Between C9's `data-testid="row-stats"` line (layout item 3) and its owner-only `data-testid="watched-by"` line (item 4), add its own line: `{line !== null && <p data-testid="vacuum-line" className="font-ui text-xs text-muted tabular-nums whitespace-nowrap">{line}</p>}`, where `const line = vacuumLine(torrent.vacuum, Date.now());`. It must not go inside the stats slot.
- Test: `frontend/src/components/downloads/vacuumLine.test.ts` (new) and `frontend/src/components/downloads/DownloadsView.test.tsx` (add 2 tests; C9's `getDisk` mock and `beforeEach` stay as they are, and the new fixtures carry C1's fields like C9's do)

**Interfaces:**
- Consumes D6: `TorrentStatus.vacuum`, where `deletes_at` is an aware ISO string at a 04:00 run instant.
- Produces:
```ts
export type VacuumStatus = 'off' | 'scheduled' | 'kept_watching' | 'active';
// C1's interface, after D9 narrows it (not a second declaration):
// export interface VacuumInfo { status: VacuumStatus; deletes_at: string | null }
// vacuumLine.ts
export const KEPT_LINE = 'Kept: not everyone has finished it';
export function vacuumLine(info: VacuumInfo | null | undefined, nowMs: number): string | null;
```
  Rules:
  - `!info`, `status === 'off'`, or `deletes_at === null` for `scheduled`/`active` gives `null`.
  - `kept_watching` gives `KEPT_LINE`.
  - For `scheduled` and `active`, which share one rendering so a row does not change text when playback starts, compute `n = Math.ceil((Date.parse(deletes_at) - nowMs) / 86_400_000)`. `n <= 1` gives `'Deletes tonight'`, otherwise `` `Deletes in ${n} days` ``.

  `n` counts the nightly runs left. `deletes_at` is always a 04:00 run, and the next run is never more than 24 h away. So "1 day" can never be printed; 1 is "tonight".

- [ ] **Step 1: Write the failing tests.**

  `vacuumLine.test.ts`, where `NOW = Date.parse('2026-11-07T10:00:00Z')`, `at = (h: number) => new Date(NOW + h * 3_600_000).toISOString()` and `s = (status, h) => ({ status, deletes_at: h === null ? null : at(h) })`:

  | Call | Expected |
  | --- | --- |
  | `vacuumLine(s('off', null), NOW)` | `null` |
  | `vacuumLine(undefined, NOW)` | `null` |
  | `vacuumLine(s('kept_watching', null), NOW)` | `'Kept: not everyone has finished it'`, as a literal and not `KEPT_LINE` |
  | `vacuumLine(s('scheduled', 18), NOW)` | `'Deletes tonight'` |
  | `vacuumLine(s('scheduled', 24), NOW)` | `'Deletes tonight'` |
  | `vacuumLine(s('scheduled', 24 + 1/60), NOW)` | `'Deletes in 2 days'` |
  | `vacuumLine(s('scheduled', 288), NOW)` | `'Deletes in 12 days'` |
  | `vacuumLine(s('active', 306), NOW)` | `'Deletes in 13 days'` |
  | `vacuumLine(s('scheduled', -2), NOW)` | `'Deletes tonight'` (a stale poll past the run) |
  | `vacuumLine(s('scheduled', null), NOW)` | `null` |

  Mutations:
  - The 24 h and 24 h + 1 min pair catches `floor + 1` and `<` for `<=`.
  - The 288 h row catches `Math.round` paired with an off-by-one.
  - The `active` row catches rendering only `scheduled`.

  `DownloadsView.test.tsx` (add):
  - **The row shows its own countdown.** Alpha has `vacuum: { status: 'scheduled', deletes_at: new Date(Date.now() + 12 * 86_400_000 - 3_600_000).toISOString() }` and Beta has `vacuum: { status: 'kept_watching', deletes_at: null }`. Find each row as `(await screen.findAllByTestId('torrent-row')).find(r => within(r).queryByText('Alpha'))`. Then:
    - `within(alphaRow).getByTestId('vacuum-line')` has the text `'Deletes in 12 days'`;
    - `within(betaRow).getByTestId('vacuum-line')` has the text `'Kept: not everyone has finished it'`;
    - `getAllByTestId('vacuum-line')` has length 2.

    Scoping to the row catches a line rendered against the wrong torrent. The length check catches a duplicate line.
  - **Nothing when autovacuum is off.** One row with `vacuum: { status: 'off', deletes_at: null }` and another with `vacuum` undefined: after the rows render, `queryByTestId('vacuum-line')` is null.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/components/downloads/`. Expected: `Failed to resolve import "./vacuumLine"`. The DownloadsView tests fail with `Unable to find an element by: [data-testid="vacuum-line"]`.
- [ ] **Step 3: Implement** the types, `vacuumLine.ts` and the one render line.
- [ ] **Step 4: Run** `npx vitest run src/components/downloads/` 5 times in a loop, then `npx tsc --noEmit` and `npm run test:tv`. Expected: green each time.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/types/index.ts frontend/src/components/downloads/vacuumLine.ts frontend/src/components/downloads/vacuumLine.test.ts frontend/src/components/downloads/DownloadsView.tsx frontend/src/components/downloads/DownloadsView.test.tsx
git commit -m "feat(downloads): each row says when autovacuum will delete it, or why it is kept

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Notes for Part E (consumer)
- Part E reads `GET /api/v1/instance/playback` through `instanceService.getPlayback()`, which returns `{auto_next_enabled, auto_next_pct}` with `auto_next_pct` in {50, 55, …, 95}. Part D builds the controls that write it.
- **Part E must delete the `'instanceService.getPlayback'` line from `DECLARED_TEST_ONLY`** in `(bigscreen)/noDeadExports.test.ts` in the same task that wires `usePlaybackSettings`. Otherwise `npm run test:tv` fails, because the allowlist requires every entry to still be dead.


---

# Part E — next-episode auto-download (spec §5)

Consumes, from earlier parts:
- **Part D (task D7):** `instanceService.getPlayback(): Promise<PlaybackSettings>` in `frontend/src/services/instance.ts` (`GET /api/v1/instance/playback`, any session), where D7 exports `export interface PlaybackSettings { auto_next_enabled: boolean; auto_next_pct: number }` from the same file. Tests type their fixtures as `PlaybackSettings` (`import type { PlaybackSettings } from '@/services/instance'`). D7 also adds `'instanceService.getPlayback'` to `DECLARED_TEST_ONLY` in `(bigscreen)/noDeadExports.test.ts`, and E2 must delete it (see E2 Step 5).
- **Part C:** server-side reuse in `POST /torrents/download`. When the body has no `magnet`, the request returns an existing non-error row at the same `(tmdb_id, media_type, season, episode, quality)`, or a season pack that contains the episode, and resumes it if it is paused. Only `magnet` switches the reuse off. So the web can POST the same body twice without starting a second download — sequentially (C6 reuse) **and** concurrently (C6's per-key `_download_lock`, Review Focus 3), and a reuse touches the row's `last_touched_at` (Review Focus 2). A reused **pack** comes back with `TorrentStatus.file_index` set to the requested episode's file when its metadata is in (C1/C6), and `@/lib/streamingHref` (C6) turns a status into `/streaming/{id}[?file=N]`. Part C also moved the TV `titleStateFor` from `listTorrents` to `getForTitle`. Every TV test mock below is "as Part C left it", and this part never touches those mocks.
- **Part A** keeps pydantic's default `extra='ignore'` on `UserSettingsUpdate` (part-A.md, "Both fields are removed from `UserSettingsUpdate`, and pydantic's default `extra='ignore'`…"). E6 relies on that.

## Contract deviations

1. **One `usePlaybackSettings` hook, at `frontend/src/lib/usePlaybackSettings.ts`, shared by the TV and the web.** The contract asked for one in `(bigscreen)/_data/` and another in `frontend/src/hooks/`. There is no `src/hooks/` directory, and the web's hooks live in `src/lib/` (`useScrolled.ts`, `useTitleImages.ts`, `useSearchUrlState.ts`). The TV already imports `@/lib` (`bigscreen/movie/[id]/page.tsx:8`, `watch/[id]/page.tsx:10`). The one-hop guard (`legacy-target.test.ts:254-286`, `isBannedImport`/`componentImportsBehind`) passes a lib module that imports only `react` and `@/services/instance`. Two copies of one read would be the duplication spec §5.4 forbids.
2. **`AUTO_NEXT_AT` is deleted, and there is no `DEFAULT_AUTO_NEXT_AT`.** A failed read means no prefetch (spec §5.2), so nothing would ever read a fallback.
3. **`threshold` is a fraction** (`0.8`, not `80`). The hook divides `auto_next_pct` by 100 once.
4. **New web hook `useUpNextEpisode`** in `frontend/src/lib/player/useUpNextEpisode.ts`. The contract does not name it. It holds the web's lookup, prefetch and "Play next" logic so the page only wires it.
5. **Play next does not call `getForTitle`.** It POSTs `/torrents/download` with the same body as the prefetch. Part C's reuse turns that into "reuse or start", so a separate lookup would add a round trip and decide nothing.
6. **The hook's result type is `PlaybackSettingsState`, not `PlaybackSettings`.** Part D already exports `PlaybackSettings` (the wire shape) from `@/services/instance`. Two exported interfaces with the same name and different fields would invite the wrong import.

## Files this part touches (overview)

| Task | Creates | Modifies | Deletes |
| --- | --- | --- | --- |
| E1 | `src/lib/nextEpisode.ts`, `src/lib/nextEpisode.test.ts` | `(bigscreen)/_data/nextEpisode.ts`, its test, `watch/[id]/page.tsx`, `watch/[id]/page.next.test.tsx` | — |
| E2 | `src/lib/usePlaybackSettings.ts` + test | `watch/[id]/page.tsx`, the 5 `watch/[id]/page*.test.tsx`, `journeys.test.tsx`, `noDeadExports.test.ts` | — |
| E3 | — | `show/[id]/page.tsx`, `show/[id]/page.test.tsx`, `page.pack.test.tsx`, `public/bigscreen.css`, `services/users.ts` | `_data/autoNext.ts`(+test), `_components/AutoNextToggle.tsx`(+test) |
| E4 | `src/lib/player/useUpNextEpisode.ts` + test | — | — |
| E5 | `src/app/(web)/streaming/[id]/page.test.tsx` | `(web)/streaming/[id]/page.tsx`, `components/player/UpNextCard.tsx` (header comment) | — |
| E6 | — | `backend/app/models.py`, `backend/app/api/users.py`, `backend/app/database/models/users.py`, `backend/tests/test_auto_next_episode.py` | — |

All frontend paths are under `frontend/`. `npx vitest`, `npx tsc` and `npm run …` run from `frontend/`. `git`, `grep` and `docker compose` commands are written for the **repo root** (they name `frontend/…` and `backend/…` paths).

Line numbers are master's at `f02fce9`. Parts A and B edit `backend/app/models.py`, `backend/app/api/users.py` and `frontend/src/services/users.ts` before this part runs, and Part C edits the TV test mocks. So find each edit by the symbol or text quoted next to its line number, and treat the number as a hint.

---

### Task E1: Move the pure next-episode logic to `@/lib/nextEpisode` and give `pastAutoNextPoint` a threshold

**Files:**
- Create: `frontend/src/lib/nextEpisode.ts`
- Create: `frontend/src/lib/nextEpisode.test.ts`
- Modify: `frontend/src/app/(bigscreen)/_data/nextEpisode.ts`.
  - Delete lines 43-99 (`NextUp`, `NextUpVerdict`, `NextEpisodeAnswer`, `EpisodeRef`, `episodeRefOf`) and lines 167-291 (the private helpers `toNextUp`, `episodesOf`, `lowestAbove`, `regularSeasons`, `runtimeSecondsOf`, `UNKNOWN`, then `findNextEpisode`, `episodeScaleSeconds`, `AUTO_NEXT_AT`, `pastAutoNextPoint`).
  - Keep `assertNever` (163-165). `nextCellView` and `whereToWatchEpisode` still call it.
  - Replace imports 1-3 (`type { Episode, SeasonSummary, ShowDetail }`, `tvService`, `parseContentId`) with `import type { EpisodeRef, NextEpisodeAnswer } from '@/lib/nextEpisode';`. Nothing left in the module uses the three old imports.
  - Rewrite the module header at lines 7-41 so it covers only what stays: the cell words, the end prompt, prefetch and the press.
- Modify: `frontend/src/app/(bigscreen)/_data/nextEpisode.test.ts`
- Modify: `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx`. Update the imports at lines 18-29 and the call at line 899.
- Modify: `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.next.test.tsx`. Update line 33 and the uses of `AUTO_NEXT_AT` at lines 300, 361, 427 and 429.

**Interfaces:**
- Consumes: `parseContentId` (`@/lib/contentId`), `tvService.getSeason`/`getShow` (`@/services/tv`), types `Episode`, `SeasonSummary`, `ShowDetail` (`@/types`).
- Produces, from `@/lib/nextEpisode` (moved verbatim except for `pastAutoNextPoint`):
  - `interface NextUp { season: number; episode: number; name: string }`
  - `type NextUpVerdict = { k: 'ready'; next: NextUp } | { k: 'none' } | { k: 'unknown' }`
  - `interface NextEpisodeAnswer { verdict: NextUpVerdict; runtimeS: number | null }`
  - `interface EpisodeRef { tmdbId: number; season: number; episode: number }`
  - `episodeRefOf(contentId: string | null | undefined): EpisodeRef | null`
  - `findNextEpisode(ref: EpisodeRef): Promise<NextEpisodeAnswer>` (never rejects)
  - `episodeScaleSeconds(opts: { duration: number; storedSeconds: number | null | undefined; runtimeS: number | null | undefined }): number | null`
  - `pastAutoNextPoint(position: number, scaleSeconds: number | null, threshold: number): boolean`, a **changed signature**
- `(bigscreen)/_data/nextEpisode.ts` keeps `episodeTag`, `NEXT_CELL_STATES`, `NextCellStateId`, `nextCellView`, `END_PROMPT_S`, `nearTheEnd`, `prefetchEpisode` and `whereToWatchEpisode`. It imports `type { EpisodeRef, NextEpisodeAnswer } from '@/lib/nextEpisode'` (type-only, so the TV module no longer pulls `@/services/tv`). It does **not** re-export the moved names, because every caller is updated instead.

- [ ] **Step 1: Write the failing lib test.** Create `src/lib/nextEpisode.test.ts`.
  - From `(bigscreen)/_data/nextEpisode.test.ts`, **cut and paste** (move, do not copy):
    - the imports `import type { Episode, SeasonDetail, ShowDetail } from '@/types'` (12) and `import { tvService } from '@/services/tv'` (13);
    - the `vi.mock('@/services/tv', …)` line (31) and the `tv` handle (38);
    - the fixtures `ep`, `season`, `show` and `REF` (lines 41-86);
    - the whole `describe('episodeRefOf')` (97-110), `describe('findNextEpisode')` (123-230) and `describe('episodeScaleSeconds')` (280-298) blocks.
  - Add a `beforeEach(() => vi.clearAllMocks())`. Import from `'./nextEpisode'`.
  - Replace the old `describe('pastAutoNextPoint')` (300-327) with:
  ```ts
  describe('pastAutoNextPoint', () => {
    it('is the given fraction of the episode, in both directions, at every slider stop it is fed', () => {
      const total = 1000;
      for (const t of [0.5, 0.8, 0.95]) {
        expect.soft(pastAutoNextPoint(total * t - 1, total, t), `${t}: one second before`).toBe(false);
        expect.soft(pastAutoNextPoint(total * t, total, t), `${t}: exactly at`).toBe(true);
      }
      expect.soft(pastAutoNextPoint(total, total, 0.95)).toBe(true);
    });

    it('reads the threshold it is handed, not a constant', () => {
      expect.soft(pastAutoNextPoint(600, 1000, 0.6)).toBe(true);
      expect.soft(pastAutoNextPoint(600, 1000, 0.8)).toBe(false);
    });

    it('is a fraction and not a fixed lead time, so it scales with the episode', () => {
      expect.soft(pastAutoNextPoint(18 * 60, 22 * 60, 0.8)).toBe(true);
      expect.soft(pastAutoNextPoint(18 * 60, 70 * 60, 0.8)).toBe(false);
    });

    it('refuses with no scale, a playhead of 0, or a threshold that is not above 0', () => {
      expect.soft(pastAutoNextPoint(900, null, 0.8)).toBe(false);
      expect.soft(pastAutoNextPoint(900, 0, 0.8)).toBe(false);
      expect.soft(pastAutoNextPoint(0, 1000, 0.8)).toBe(false);
      expect.soft(pastAutoNextPoint(Number.NaN, 1000, 0.8)).toBe(false);
      expect.soft(pastAutoNextPoint(1, 1000, 0), 'a 0 threshold is not "always"').toBe(false);
      expect.soft(pastAutoNextPoint(1, 1000, -1)).toBe(false);
    });
  });
  ```
  - What each assertion catches:
    - a hard-coded `0.8` inside the function fails `(600, 1000, 0.6)`;
    - `>` in place of `>=` fails "exactly at";
    - dropping the `threshold > 0` guard fails `(1, 1000, 0)`.
  - The `NaN`-threshold case is left out on purpose. `x >= NaN` is already false, so it could not fail.
- [ ] **Step 2: Rewrite the TV test's end-prompt row for the slider's worst case.**
  - In `(bigscreen)/_data/nextEpisode.test.ts`:
    - remove `AUTO_NEXT_AT`, `episodeRefOf`, `episodeScaleSeconds`, `findNextEpisode` and `pastAutoNextPoint` from the import (lines 15-29);
    - remove the `import { tvService }` (13) and the `import type { Episode, SeasonDetail, ShowDetail }` (12);
    - delete nothing else that `prefetchEpisode`/`whereToWatchEpisode` still use (`state`, `title`; their `ARGS` are local).
  - Replace the test at lines 344-349 with:
  ```ts
  it('is shorter than the window the prefetch opens, even at the HIGHEST threshold the owner can pick', () => {
    // The slider's top stop is 95% (spec §5.1; Part D's OwnerSettingsUpdate.auto_next_pct
    // accepts at most 95). At 95% a 20-minute episode leaves 60 s — the prompt must not
    // precede the download it invites the viewer to use.
    const WORST = 0.95;
    const shortest = 20 * 60;
    expect(shortest * (1 - WORST)).toBeGreaterThan(END_PROMPT_S); // 60 > 45
  });
  ```
  - This row pins a design invariant, not a line of code. It fails if `END_PROMPT_S` is raised to 60 or more. Mutation-check it that way.
  - **At 95% it passes (60 > 45).** If a later change makes it fail, do not shrink `shortest`. Either lower the slider's top stop (Part D's `auto_next_pct` validation and the slider's `max` together) or lower `END_PROMPT_S`.
  - Rewrite the file header (lines 1-9): the catalog half and its `@/services/tv` driving now live in `src/lib/nextEpisode.test.ts`.
- [ ] **Step 3: Run it and expect it to fail.**
  ```
  npx vitest run src/lib/nextEpisode.test.ts
  ```
  Expected: FAIL, `Failed to resolve import "./nextEpisode"`.
- [ ] **Step 4: Implement.**
  - Create `src/lib/nextEpisode.ts` by moving the code listed under **Files**, with the imports it needs (`type { Episode, SeasonSummary, ShowDetail }` from `@/types`, `tvService` from `@/services/tv`, `parseContentId` from `./contentId`). No `'use client'`: it holds no hook.
  - Keep the doc comments, with two wording changes:
    - the header's "start the next download at 80%" (today's line 31) becomes "start the next download at the owner's threshold";
    - `episodeScaleSeconds`'s "past 80%" (line 254) becomes "past the owner's threshold".
  - `pastAutoNextPoint`'s doc (lines 276-283) loses "0.8 is the figure the feature was asked for" and keeps the fraction-not-lead-time paragraph.
  - Change the function to:
    ```ts
    export function pastAutoNextPoint(position: number, scaleSeconds: number | null, threshold: number): boolean
    ```
    Its body is today's (`_data/nextEpisode.ts:287-290`), plus `if (!(threshold > 0)) return false;` and `return at / scaleSeconds >= threshold;`.
  - In `watch/[id]/page.tsx`:
    - import `episodeRefOf`, `episodeScaleSeconds`, `findNextEpisode`, `pastAutoNextPoint` and `type NextEpisodeAnswer` from `'@/lib/nextEpisode'`, and the rest from `'../../../_data/nextEpisode'`;
    - at line 899 call `pastAutoNextPoint(position, scaleSeconds, 0.8)` with the trailing comment `// E2 replaces 0.8 with the owner's threshold`.
  - In `page.next.test.tsx`, line 33 becomes:
    ```ts
    import { END_PROMPT_S } from '../../../_data/nextEpisode';
    const AT = 0.8; // E2: the getPlayback fixture's auto_next_pct / 100
    ```
    and `AUTO_NEXT_AT` becomes `AT` at lines 300, 361, 427 and 429.
- [ ] **Step 5: Run it and expect it to pass.**
  ```
  npx vitest run src/lib/nextEpisode.test.ts 'src/app/(bigscreen)/_data/nextEpisode.test.ts' 'src/app/(bigscreen)/bigscreen/watch/[id]/page.next.test.tsx' 'src/app/(bigscreen)/_player/TransportBar.test.tsx'
  npx tsc --noEmit
  npm run test:tv
  ```
  Expected: all PASS. `test:tv` includes `legacy-target.test.ts`, which proves the new `@/lib` edge passes the one-hop ban, and `noDeadExports.test.ts`.
- [ ] **Step 6: Commit.**
  ```
  git add frontend/src/lib/nextEpisode.ts frontend/src/lib/nextEpisode.test.ts "frontend/src/app/(bigscreen)/_data/nextEpisode.ts" "frontend/src/app/(bigscreen)/_data/nextEpisode.test.ts" "frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx" "frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.next.test.tsx"
  git commit -m "refactor(next-episode): share the pure next-episode logic from @/lib and take the threshold as a parameter

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task E2: `usePlaybackSettings`, and the TV prefetch reads the global setting

**Files:**
- Create: `frontend/src/lib/usePlaybackSettings.ts`
- Create: `frontend/src/lib/usePlaybackSettings.test.tsx`
- Modify: `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx`
  - line 16: drop the `useAutoNext` import;
  - line 835: `const autoNext = useAutoNext(userId)` becomes `const playback = usePlaybackSettings()`;
  - lines 877-914: the prefetch comment and effect.
- Modify: `frontend/src/app/(bigscreen)/bigscreen/watch/[id]/page.next.test.tsx`
- Modify, mocks only: `watch/[id]/page.test.tsx` (lines 36, 78-92, 382-393, 422), `page.fetch.test.tsx` (51, 93-103, 320-331, 343), `page.subtitles.test.tsx` (54, 102-112, 357-368, 380) and `page.track.test.tsx` (42, 81-91, 237-248, 260)
- Modify: `frontend/src/app/(bigscreen)/journeys.test.tsx`. Add the mock next to the others (lines 87-161).
- Modify: `frontend/src/app/(bigscreen)/noDeadExports.test.ts`. Delete the `'instanceService.getPlayback'` entry that Part D task D7 added to `DECLARED_TEST_ONLY` (line 332 onward).

**Interfaces:**
- Consumes: `instanceService.getPlayback()` (Part D) and `pastAutoNextPoint` (E1).
- Produces:
  ```ts
  // @/lib/usePlaybackSettings
  export interface PlaybackSettingsState {
    /** True only when the read ANSWERED and said on. False while in flight and after a failure. */
    enabled: boolean;
    /** auto_next_pct / 100 once the read answered; null until then and after a failure. */
    threshold: number | null;
  }
  export function usePlaybackSettings(): PlaybackSettingsState;
  ```
  It reads once per mount, ignores the answer after unmount (a `cancelled` flag set in the effect's cleanup), and keeps any rejection or throw inside the hook. Write it as `void (async () => { try { … } catch { … } })()`, so that a `vi.fn()` mock returning `undefined` is also a failure, not a crash.
  - No test pins the unmount guard. React 18+ drops a state update on an unmounted component without a warning, so nothing observable changes when the guard is missing. Say so in a comment on the flag.

- [ ] **Step 1: Write the failing hook test.** Create `src/lib/usePlaybackSettings.test.tsx`.
  - Mock `@/services/instance` as `{ instanceService: { getPlayback: vi.fn() } }`, then `import { instanceService, type PlaybackSettings } from '@/services/instance'` and `const svc = vi.mocked(instanceService);`.
  - Use `renderHook` and `act` from `@testing-library/react`, and `beforeEach(() => vi.resetAllMocks())`.
  ```ts
  const answer = (over: Partial<PlaybackSettings> = {}): PlaybackSettings => ({ auto_next_enabled: true, auto_next_pct: 80, ...over });
  const flush = async () => { for (let i = 0; i < 3; i++) await act(async () => {}); };

  it('acts on nothing until the box answers', async () => {
    let settle: (v: PlaybackSettings) => void = () => {};
    svc.getPlayback.mockReturnValue(new Promise((r) => { settle = r; }));
    const { result } = renderHook(() => usePlaybackSettings());
    await flush();
    expect(result.current, 'still in flight').toEqual({ enabled: false, threshold: null });
    await act(async () => settle(answer()));
    await flush();
    expect(result.current).toEqual({ enabled: true, threshold: 0.8 });
  });
  it('is the owner’s number, as a fraction', async () => {
    svc.getPlayback.mockResolvedValue(answer({ auto_next_pct: 65 }));
    const { result } = renderHook(() => usePlaybackSettings());
    await flush();
    expect(result.current.threshold).toBe(0.65);
  });
  it('off is off', async () => {
    svc.getPlayback.mockResolvedValue(answer({ auto_next_enabled: false }));
    const { result } = renderHook(() => usePlaybackSettings());
    await flush();
    expect(result.current.enabled).toBe(false);
  });
  it('a failed read is OFF, never the product default (which is on)', async () => {
    svc.getPlayback.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePlaybackSettings());
    await flush();
    expect.soft(svc.getPlayback).toHaveBeenCalledTimes(1);
    expect.soft(result.current).toEqual({ enabled: false, threshold: null });
  });
  it('reads once per mount, not once per render', async () => {
    svc.getPlayback.mockResolvedValue(answer());
    const { rerender } = renderHook(() => usePlaybackSettings());
    rerender(); rerender();
    await flush();
    expect(svc.getPlayback).toHaveBeenCalledTimes(1);
  });
  ```
  What each test catches:
  - a hard-coded 0.8, or a missing `/100`, fails the "65" row;
  - a catch that falls back to `{ enabled: true, threshold: 0.8 }` fails the "failed read" row;
  - an effect with no `[]` deps fails "once per mount".
- [ ] **Step 2: Rewrite the TV watch page's prefetch tests against the global setting** in `page.next.test.tsx`.
  - Replace the `@/services/users` import/mock (lines 31, 72-74, 87) and `settingsRow` (181-192) with:
    ```ts
    import { instanceService, type PlaybackSettings } from '@/services/instance';
    vi.mock('@/services/instance', () => ({ instanceService: { getPlayback: vi.fn() } }));
    const instance = vi.mocked(instanceService);
    const playback = (enabled: boolean, pct = 80): PlaybackSettings => ({ auto_next_enabled: enabled, auto_next_pct: pct });
    ```
  - `beforeEach` line 229 becomes `instance.getPlayback.mockResolvedValue(playback(true));`.
  - Header lines 13-14: "only when the profile's setting says so" becomes "only when the owner's global setting says so".
  - `describe('the prefetch at 80%')` becomes `describe('the prefetch at the owner’s threshold')`.
  - "setting off" (383-388): `instance.getPlayback.mockResolvedValue(playback(false));`
  - "setting could not be read" (390-398): `instance.getPlayback.mockRejectedValue(new Error('offline'));`, with the comment reworded: a failed read is not a default, so nothing starts.
  - Add these two rows inside the describe:
  ```ts
  it('starts at the threshold the OWNER chose, not at 80%', async () => {
    instance.getPlayback.mockResolvedValue(playback(true, 60));
    const handle = await playing();
    await playTo(handle, Math.floor(DURATION * 0.6) - 60);
    expect.soft(asked(), 'nothing before 60%').toEqual([]);
    await playTo(handle, Math.ceil(DURATION * 0.6) + 1); // 1441 s — well before PAST_80 (1921)
    expect.soft(asked()).toHaveLength(1);
  });

  it('fires when the setting arrives AFTER the playhead passed the point, with no further tick', async () => {
    let settle: (v: PlaybackSettings) => void = () => {};
    instance.getPlayback.mockReturnValue(new Promise((r) => { settle = r; }));
    const handle = await playing();
    await playTo(handle, PAST_80);
    expect.soft(asked(), 'not on a read that has not answered').toEqual([]);
    await act(async () => settle(playback(true)));
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect.soft(asked()).toHaveLength(1);
  });
  ```
  What each row catches:
  - a hard-coded `0.8` at the call site fails "OWNER chose";
  - dropping `playback.enabled`/`playback.threshold` from the effect's deps fails "arrives AFTER", because `position` does not change after `settle`.
  - Dropping **only** `threshold` from the deps cannot be caught, because it changes in the same commit as `enabled`. The `eslint-disable` line already exists, so say this in the effect's comment.
- [ ] **Step 3: Swap the setting mock in the four other watch suites and in journeys.**
  - In each of `page.test.tsx`, `page.fetch.test.tsx`, `page.subtitles.test.tsx` and `page.track.test.tsx`:
    - delete the `usersService` import, its `vi.mock` and `settingsRow`;
    - add `import { instanceService } from '@/services/instance';` where the `usersService` import was, and `vi.mock('@/services/instance', () => ({ instanceService: { getPlayback: vi.fn() } }));` where its mock was (under the "THE TWO SERVICES THE NEXT-EPISODE WORK ADDED" comment, which stays true: `tv` and `instance`);
    - change the `beforeEach` line (`getUserSettings.mockResolvedValue(settingsRow(false))`) to `vi.mocked(instanceService).getPlayback.mockResolvedValue({ auto_next_enabled: false, auto_next_pct: 80 });`. This keeps those files' "setting OFF in this file" fixture decision.
    - In the header comment, "(The product default is ON — `autoNextFrom` and the backend's NULL column are where that is pinned.)" becomes "(The product default is ON — `backend/app/services/instance_settings.py` `DEFAULTS` is where that is pinned.)".
  - In `journeys.test.tsx`, add:
    ```ts
    vi.mock('@/services/instance', () => ({ instanceService: { getPlayback: vi.fn().mockResolvedValue({ auto_next_enabled: false, auto_next_pct: 80 }) } }))
    ```
    The file uses `vi.clearAllMocks()` (line 450), which keeps a factory implementation. No earlier part mocks `@/services/instance` there (B6 adds `@/services/auth` to the factory list and to `SERVICES`; C8 adds `getForTitle` to the torrents factory). Do **not** add `instanceService` to `SERVICES`: that loop makes every member hang, and a hung read is the "off" path, which the journeys' fixture already chooses explicitly. Without this mock, `WatchPage` journeys make a real XHR out of jsdom.
  - `@/services/users` stays mocked in journeys, because the profiles screen uses it.
- [ ] **Step 4: Run it and expect it to fail.**
  ```
  npx vitest run src/lib/usePlaybackSettings.test.tsx 'src/app/(bigscreen)/bigscreen/watch/[id]/page.next.test.tsx'
  ```
  Expected:
  - the hook file FAILS with `Failed to resolve import "./usePlaybackSettings"`;
  - the page rows that expect a download FAIL with `expected [] to have a length of 1`, because the page still calls `useAutoNext`, whose users service is no longer mocked.
- [ ] **Step 5: Implement.**
  - Create `src/lib/usePlaybackSettings.ts` (`'use client'`) to the interface above.
  - In `watch/[id]/page.tsx`, keep the first two gates (896 `if (!epRef || !contentId) return;` and 897 `if (nextAnswer?.verdict.k !== 'ready') return;`, which also narrows `nextAnswer` for line 904). Replace only lines 898-899 with:
    ```ts
    if (!userId) return;                                   // unchanged behaviour: no profile, no download
    if (!playback.enabled || playback.threshold === null) return;
    if (!pastAutoNextPoint(position, scaleSeconds, playback.threshold)) return;
    ```
    and the deps (914) become `[contentId, nextAnswer, playback.enabled, playback.threshold, position, scaleSeconds, userId]`.
  - The `userId` gate keeps today's behaviour. `useAutoNext(null)` never settled (`_data/autoNext.ts:74-79`), so the prefetch never ran without a profile. No row pins this gate. It only preserves behaviour, so no mutation is prescribed for it.
  - Rewrite the comment block at lines 877-893:
    - "THE PREFETCH: past the owner's threshold (`GET /instance/playback`), start the next episode downloading";
    - "GATED ON A READ THAT ANSWERED: `usePlaybackSettings` reports `enabled: false` while in flight and after a failure";
    - keep the ONCE PER EPISODE and NO CLEANUP paragraphs.
  - Delete the `'instanceService.getPlayback'` entry from `DECLARED_TEST_ONLY` in `noDeadExports.test.ts`. Part D task D7 added it. Once `usePlaybackSettings.ts` calls `.getPlayback(`, `deadServiceMembers` counts it alive, and the "declare nothing test-only that now has a caller" row fails until the entry is gone.
- [ ] **Step 6: Run it and expect it to pass.**
  ```
  npx vitest run src/lib/usePlaybackSettings.test.tsx 'src/app/(bigscreen)/bigscreen/watch/[id]' 'src/app/(bigscreen)/journeys.test.tsx'
  npx tsc --noEmit
  npm run test:tv
  ```
  Expected: PASS. Mutation-check the two new page rows by putting `0.8` back at the call site, then by deleting `playback.enabled, playback.threshold` from the deps. Each must turn its row red. `grep` that the edit landed before you believe a green run.
- [ ] **Step 7: Commit.**
  ```
  git add frontend/src/lib/usePlaybackSettings.ts frontend/src/lib/usePlaybackSettings.test.tsx "frontend/src/app/(bigscreen)/bigscreen/watch/[id]" "frontend/src/app/(bigscreen)/journeys.test.tsx" "frontend/src/app/(bigscreen)/noDeadExports.test.ts"
  git commit -m "feat(tv): the next-episode prefetch follows the owner's global switch and threshold

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task E3: Remove the per-profile auto-next toggle from the TV show screen

**Files:**
- Delete: `frontend/src/app/(bigscreen)/_data/autoNext.ts`, `_data/autoNext.test.tsx`, `_components/AutoNextToggle.tsx` and `_components/AutoNextToggle.test.tsx`
- Modify: `frontend/src/app/(bigscreen)/bigscreen/show/[id]/page.tsx`
  - imports at lines 17-18;
  - the `useAutoNext` block at 186-190;
  - the ACTION_CELLS comment and value at 306-315;
  - `<AutoNextToggle>` at 412, and again at 425-428 with its JSX comment.
- Modify: `frontend/src/app/(bigscreen)/bigscreen/show/[id]/page.test.tsx`
  - lines 5 and 16-20 (`usersService` import/mock), 101-112 (`settingsRow`), 116;
  - the section header at 630-632 and the four toggle tests at 636-689.
- Modify: `frontend/src/app/(bigscreen)/bigscreen/show/[id]/page.pack.test.tsx`: lines 10, 20-24, 47-58 and 61.
- Modify: `frontend/public/bigscreen.css`: delete lines 990-1000 (the comment and the `.bs-show__autonext` rule).
- Modify: `frontend/src/services/users.ts` as Parts B left it (B2 rewrote the `has_passcode` doc, B4 removed `require_passcode`/`passcode` from `UserSettingsUpdate`, B6 deleted `unlockProfile`): delete `auto_next_episode` and its doc comments from `UserSettings` (master lines 23-35) and from `UserSettingsUpdate` (master 47-48). Find them by text.

**Interfaces:**
- Consumes: nothing new.
- Produces: the show screen's action row has `ACTION_CELLS = 1` in both arms. Nothing calls `usersService.getUserSettings` from the show screen any more.

- [ ] **Step 1: Write the failing test.**
  - In `show/[id]/page.test.tsx`, delete the four toggle tests, `toggle()`, `settingsRow`, the `getUserSettings` `beforeEach` line and the users mock. Rename the section header to "The action row, and the trace the episode list draws".
  - Add:
  ```ts
  it('the action row is the episode control alone: Right from it goes nowhere', async () => {
    await mount();
    await ringSettled();
    const play = screen.getByRole('button', { name: 'Play' });
    expect.soft(document.activeElement, 'the ring starts on the episode control').toBe(play);
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true }),
      );
    });
    await ringSettled();
    expect.soft(document.activeElement).toBe(play);
    expect.soft(screen.queryByRole('button', { name: /^Auto-download next:/ })).toBeNull();
    expect.soft(document.querySelector('.bs-show__autonext')).toBeNull();
  });
  ```
  - This catches leaving `ACTION_CELLS = 2` with the toggle removed. The grid moves its model to `(ACTION_ROW, 1)`, nothing is rendered there, no cell holds `tabindex="0"`, and `ringSettled()` times out. Run that mutation and confirm the row goes red.
  - In `page.pack.test.tsx`, delete the users import/mock, `settingsRow` and its `beforeEach` line.
  - Before deleting the two `vi.mock('@/services/users', …)` factories, run `grep -rln "usersService" "frontend/src/app/(bigscreen)/_components" "frontend/src/app/(bigscreen)/_data"`. On master it lists only `_data/autoNext.ts` and `_data/useTvProfile.ts`, and both test files mock `useTvProfile`. If Part B made a component the show screen renders (for example `_components/Header.tsx`) import `usersService`, keep the factory and list only that component's members in it. An unmocked call at mount is a real XHR out of jsdom.
- [ ] **Step 2: Run it and expect it to fail.**
  ```
  npx vitest run 'src/app/(bigscreen)/bigscreen/show/[id]'
  ```
  Expected: the new row FAILS. ArrowRight moves focus to the toggle, so `activeElement` is not Play, and the toggle query is not null.
- [ ] **Step 3: Implement.**
  - Delete the four files and the CSS rule.
  - In `show/[id]/page.tsx`:
    - remove the two imports, the `useAutoNext` block and both `<AutoNextToggle …/>` elements, along with the `{/* HERE TOO … */}` comment;
    - set `const ACTION_CELLS = 1;`;
    - replace the comment above it with "ROW 1 IS ONE CELL, the subject's control (or 'Back to home'), and stays one in both arms of `actions`."
  - Remove `auto_next_episode` from `services/users.ts`.
  - Then run:
    ```
    grep -rn "auto_next_episode\|autoNext\|AutoNextToggle\|bs-show__autonext" frontend/src frontend/public
    ```
    Run it from the repo root. It must return no hit at all, test files included (Part B's rule keeps its new fixtures free of the key; if `UserContext.test.tsx`, `ProfileLockSection.test.tsx` or `SettingsView.test.tsx` shows a hit anyway, delete the key there, which `tsc` would otherwise reject as an unknown property): E2 deleted the watch suites' `settingsRow`, and this task deletes the show suites' copies. Hits in `docs/superpowers/plans/` are outside the searched paths, are history, and stay.
- [ ] **Step 4: Run it and expect it to pass, in a loop.**
  ```
  npx vitest run 'src/app/(bigscreen)/bigscreen/show/[id]'
  npx tsc --noEmit
  npm run test:tv
  for i in $(seq 1 25); do npx vitest run 'src/app/(bigscreen)/bigscreen/show/[id]' 'src/app/(bigscreen)/bigscreen/watch/[id]/page.next.test.tsx' >/dev/null 2>&1 || echo "FAIL $i"; done
  for i in $(seq 1 5); do npm run test:tv >/dev/null 2>&1 || echo "TV FAIL $i"; done
  ```
  Expected: PASS, with no `FAIL` lines. The focus and fake-timer suites here are the ones that flake under load (memory: verify-suites-by-looping), so report the failure count, not the last run. `noDeadExports.test.ts` must stay green. No allowlist entry names the deleted symbols, and its non-test file count drops by exactly 2 (75 on master, before Parts B–D add files) and stays above its floor of 55.
- [ ] **Step 5: Commit.**
  ```
  git add -A "frontend/src/app/(bigscreen)/_data/autoNext.ts" "frontend/src/app/(bigscreen)/_data/autoNext.test.tsx" "frontend/src/app/(bigscreen)/_components/AutoNextToggle.tsx" "frontend/src/app/(bigscreen)/_components/AutoNextToggle.test.tsx" "frontend/src/app/(bigscreen)/bigscreen/show/[id]" frontend/public/bigscreen.css frontend/src/services/users.ts
  git commit -m "refactor(tv): drop the per-profile auto-next toggle from the show screen

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task E4: `useUpNextEpisode`, the web's lookup, prefetch and Play next

**Files:**
- Create: `frontend/src/lib/player/useUpNextEpisode.ts`
- Create: `frontend/src/lib/player/useUpNextEpisode.test.tsx`

**Interfaces:**
- Consumes:
  - `episodeRefOf`, `findNextEpisode`, `episodeScaleSeconds`, `pastAutoNextPoint` and `type NextUp` (E1);
  - `usePlaybackSettings` (E2);
  - `torrentsService.downloadCatalogMovie(req: CatalogTorrentRequest): Promise<TorrentStatus>`;
  - `streamingService.getFiles(torrentId: string): Promise<VideoFile[]>`;
  - `streamingHref(s: Pick<TorrentStatus, 'id' | 'file_index'>)` from `@/lib/streamingHref` and `TorrentStatus.file_index` (Part C, C1/C6).
- Produces:
  ```ts
  export interface UpNextEpisode {
    /** The catalog's next episode (a `ready` verdict), or null: none, unknown, still looking, or not an episode. */
    next: NextUp | null;
    /** Feed every player progress tick. Starts the prefetch at most once per content id. Stable identity. */
    onProgress: (currentTime: number, duration: number) => void;
    /** Where "Play next" goes: an href, or null when the box refused or there is no next episode. Never rejects. */
    playNext: () => Promise<string | null>;
  }
  export function useUpNextEpisode(args: {
    contentId: string | null | undefined;   // streamingInfo.content_id
    quality: string | undefined;            // torrentStatus.quality
    nextFileInTorrent: boolean;             // the page has a next VideoFile in THIS torrent
  }): UpNextEpisode;
  ```
- Pinned rules:
  - **Lookup:**
    - run `findNextEpisode(episodeRefOf(contentId))` once per `contentId`, and never for a non-episode;
    - reset `next` to null when `contentId` changes;
    - drop an answer that belongs to a previous `contentId` (generation counter, as in TV `watch/[id]/page.tsx:844-864`).
  - **Download body**, the same for the prefetch and for Play next, exactly:
    ```ts
    { tmdb_id: ref.tmdbId, quality: q, media_type: 'tv', season: next.season, episode: next.episode }
    ```
    `q` is `quality` when that is `'720p' | '1080p' | '2160p'`, and `'1080p'` otherwise (the page's `normalizeSwitchQuality` rule, `(web)/streaming/[id]/page.tsx:348-349`). No `client` (browsers stay unprofiled, `types/index.ts:433-449`). No `magnet`, because it switches off Part C's reuse. No `source_id`, because that is an explicit pick from the source switcher, not a background choice.
  - **Prefetch** fires only when all of these hold:
    - `onProgress(t, d)` is called;
    - `ref` is set and the answer is `ready`;
    - `!nextFileInTorrent`;
    - `enabled` is true and `threshold !== null`;
    - `pastAutoNextPoint(t, episodeScaleSeconds({ duration: d, storedSeconds: null, runtimeS: answer.runtimeS }), threshold)`;
    - the latch is not already set to `contentId`.

    It keeps `{ contentId, promise }`, where `promise` resolves to the row or to `null` on rejection. It is silent.
  - **playNext:**
    1. If there is no `ready` answer, return `null`.
    2. Take `status` from the prefetch promise for this `contentId`. If there is none, or it resolved `null`, call `downloadCatalogMovie(body)` (a rejection becomes `null`).
    3. If `status` is still `null`, return `null`.
    4. If `typeof status.file_index === 'number'` (a reused pack whose metadata is in; C6 picked the file), return `streamingHref(status)` without calling `getFiles`.
    5. Else if `status.episode != null`, return `` `/streaming/${status.id}` ``.
    6. Otherwise (a pack without `file_index`: freshly added, or its metadata not yet in — Review Focus 5), `getFiles(status.id)` and find `f.season === next.season && f.episode === next.episode`. Return `` `/streaming/${status.id}?file=${f.index}` ``, or `` `/streaming/${status.id}` `` when no file matches or `getFiles` rejects. The web's pack has a visible episode picker, and the identity comes from the file, so no progress is mis-keyed.

- [ ] **Step 1: Write the failing test.**
  - Mock `@/services/tv` (`getSeason`, `getShow`), `@/services/torrents` (`downloadCatalogMovie`), `@/services/streaming` (`getFiles`) and `@/services/instance` (`getPlayback`).
  - In `beforeEach`, call `vi.resetAllMocks()` (not `clearAllMocks`, which keeps queued `mockResolvedValueOnce`s; see memory note tests-that-cannot-fail), then set the defaults:
    - `getSeason` → season 2 with episodes `[1, 2, 3]` at a 40-minute runtime (the `season()` shape from `watch/[id]/page.next.test.tsx:144-158`);
    - `getPlayback` → `{ auto_next_enabled: true, auto_next_pct: 80 }`;
    - `downloadCatalogMovie` → `{ id: 'next-1', season: 2, episode: 3 }`.
  - `CID = 'tv:1399:s2:e2'`.
  - Helpers:
    - `mount(over = {})` → `renderHook((p) => useUpNextEpisode(p), { initialProps: { contentId: CID, quality: '1080p', nextFileInTorrent: false, ...over } })`, then `flush()`;
    - `flush` = three `await act(async () => {})`;
    - `tick(t, d = 2400)` = `act(() => result.current.onProgress(t, d))` + `flush()`;
    - `asked()` = `downloadCatalogMovie.mock.calls.map(([b]) => b)`.

  The rows. One `mount()` per `it`: every case that needs a different fixture is its own row, so no row re-mounts over mocks a previous case left behind.
  ```ts
  it('names the next episode from the catalog, and asks once', …)
     // mount; rerender(same props); flush → result.current.next toEqual { season: 2, episode: 3, name: 'Episode 3' };
     // getSeason toHaveBeenCalledTimes(1)
  it('asks the catalog nothing for a film', …)     // contentId 'movie:603' → next null, getSeason not called
  it('starts the next episode downloading once, at the owner’s threshold', async () => {
    const { result } = await mount();
    await tick(1919);                        // 79.96 %
    expect.soft(asked(), 'not before').toEqual([]);
    await tick(1920);                        // exactly 80 %
    expect.soft(asked(), 'AT the point, not one tick after it').toHaveLength(1);
    for (const t of [1921, 2000, 2399]) await tick(t);
    expect.soft(asked()).toEqual([{ tmdb_id: 1399, quality: '1080p', media_type: 'tv', season: 2, episode: 3 }]);
  });
  it('uses the threshold the owner chose', …)      // pct 60 → tick(1439) → []; tick(1440) → asked() length 1
  it('uses TMDB’s runtime when the element has no duration', …) // tick(1920, NaN) → length 1
  it('carries this torrent’s quality', …)          // quality '2160p' → asked()[0].quality '2160p'
  it('sends 1080p for a quality it does not know', …) // quality 'weird' → asked()[0].quality '1080p'
  it('starts NOTHING when the next episode is in this torrent', …) // nextFileInTorrent: true → tick(2399) → []
  it('starts NOTHING when the setting is off', …)         // getPlayback → enabled false → tick(2399) → []
  it('starts NOTHING when the setting could not be read', …) // getPlayback rejects → tick(2399) → []
  it('starts NOTHING when the catalog could not say', …)  // getSeason rejects → next null → tick(2399) → []
  it('latches per content id, not once for ever', async () => {
    getSeason → episodes [1,2,3,4]; mount; tick(2000); rerender({ contentId: 'tv:1399:s2:e3', … });
    expect.soft(result.current.next, 'reset the moment the episode changes').toBeNull(); // before any flush
    flush; tick(2000)
    expect asked().map(b => b.episode) toEqual [3, 4]
  });
  it('drops a previous episode’s late answer', async () => {
    first getSeason call is a deferred promise; mount; rerender to 'tv:1399:s2:e3' (second call resolves [1,2,3,4]);
    flush; settle the first with [1,2,3]; flush → result.current.next.episode toBe 4
  });
  it('Play next goes to the download it prefetched, without asking again', async () => {
    mount; tick(2000); const href = await act(() => result.current.playNext());
    expect.soft(href).toBe('/streaming/next-1'); expect.soft(asked()).toHaveLength(1);
  });
  it('Play next asks the box when nothing was prefetched', …) // playback(false); playNext → '/streaming/next-1'; asked() toEqual [the exact body]
  it('Play next into a season pack opens that episode’s file', …)
     // download → { id: 'pack-9', season: 2, episode: null }; getFiles → [{index:4,season:2,episode:1}, {index:0,season:2,episode:3}] → '/streaming/pack-9?file=0';
     // and getFiles → [] → '/streaming/pack-9'
  it('Play next into a reused pack uses the file the server picked', …)   // Review Focus 5
     // download → { id: 'pack-9', season: 2, episode: null, file_index: 0 } → '/streaming/pack-9?file=0'
     // (0 is falsy: catches a truthiness check), and getFiles NOT called
  it('Play next into a pack whose metadata is not in yet opens the pack, never ?file=undefined', …)
     // download → { id: 'pack-9', season: 2, episode: null, file_index: null }; getFiles → [] → '/streaming/pack-9'
  it('Play next is null when the box refuses', …) // playback(false); download rejects → null
  ```
  What these rows catch:
  - `>` for `>=`: 1920 is exactly 80%, and the "AT the point" assertion runs before 1921 (without it, a `>` mutant fires at 1921 and the final `toEqual` passes);
  - a lookup effect that re-runs on every render ("asks once");
  - not resetting `next` on a content-id change ("reset the moment");
  - a missing latch;
  - a boolean latch: "per content id" fails;
  - `ref.episode` sent in place of `next.episode` (2 vs 3);
  - an added `client`/`magnet` (`toEqual`);
  - a hard-coded `'1080p'`;
  - ignoring `nextFileInTorrent`;
  - acting on an unread setting;
  - a missing generation guard;
  - Play next always POSTing ("prefetched" fails on length 2);
  - always appending `?file`, or never doing so (the pack row);
  - ignoring the server's `file_index` and re-deriving from `getFiles` (the reused-pack row: `getFiles` must not be called), or `if (status.file_index)` (its `0`);
  - building `?file=${status.file_index}` for a `null` index (the metadata-not-in row).
- [ ] **Step 2: Run it and expect it to fail.**
  ```
  npx vitest run src/lib/player/useUpNextEpisode.test.tsx
  ```
  Expected: FAIL, `Failed to resolve import "./useUpNextEpisode"`.
- [ ] **Step 3: Implement** `src/lib/player/useUpNextEpisode.ts` (`'use client'`) to the interface and pinned rules above.
  - Keep the latest `{ ref, answer, playback, nextFileInTorrent, quality }` in a ref, so that `onProgress` and `playNext` can be `useCallback(…, [])` and read current values. Settings or an answer that arrive after earlier ticks then act on the next tick.
  - Reset `next` with `setNext(null)` at the top of the lookup effect, as the TV does (`watch/[id]/page.tsx:846-849`). The "reset the moment" assertion reads `result.current` straight after a synchronous `rerender`, which commits that effect before the new lookup's promise settles.
- [ ] **Step 4: Run it and expect it to pass.**
  ```
  npx vitest run src/lib/player/useUpNextEpisode.test.tsx
  npx tsc --noEmit
  for i in $(seq 1 10); do npx vitest run src/lib/player/useUpNextEpisode.test.tsx >/dev/null 2>&1 || echo "FAIL $i"; done
  ```
  Expected: PASS with no FAIL lines. Run every mutation in the list above, plus at least one you invent yourself.
- [ ] **Step 5: Commit.**
  ```
  git add frontend/src/lib/player/useUpNextEpisode.ts frontend/src/lib/player/useUpNextEpisode.test.tsx
  git commit -m "feat(web): next-episode lookup, prefetch and play-next for the web player

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task E5: Wire it into the web streaming page; Up Next for single-episode downloads

**Files:**
- Modify: `frontend/src/app/(web)/streaming/[id]/page.tsx`
  - Move `fileLabel` (401-407) and the `nextVideoFile` computation (409-414) up to just after the last effect (after line 228). Below them, in this order: the new hook call, `upNextLabel`, then `handleVideoProgress`. `upNextLabel` calls `fileLabel` while the component renders, so `fileLabel` must be defined above it. The hook call must sit before the `isLoading` early return at 417 (rules of hooks).
  - Replace `handleVideoProgress` and its comment (230-245).
  - In `fileLabel`, use a shared `epLabel`.
  - Change the Up Next render (581-594).
- Modify: `frontend/src/components/player/UpNextCard.tsx`, header comment lines 2-14 only.
- Create: `frontend/src/app/(web)/streaming/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `useUpNextEpisode` (E4).
- Produces, on the page:
  - `const upNext = useUpNextEpisode({ contentId: streamingInfo?.content_id, quality: torrentStatus?.quality, nextFileInTorrent: nextVideoFile !== null })`;
  - `const pad = (n: number) => String(n).padStart(2, '0')` and `const epLabel = (s: number, e: number) => \`S${pad(s)}E${pad(e)}\``. The page has no `pad` today; `fileLabel` inlines `padStart`. `fileLabel` uses `epLabel`, and the format stays `S02E03`;
  - `upNextLabel = nextVideoFile ? fileLabel(nextVideoFile) : upNext.next ? epLabel(upNext.next.season, upNext.next.episode) : null`;
  - `handleVideoProgress({currentTime, duration})`:
    1. call `upNext.onProgress(currentTime, duration)` first;
    2. return if `upNextLabel === null` or `duration <= 0`;
    3. `setShowUpNext(true)` when `remaining <= 30 || pct >= 95` (unchanged trigger).
  - The card renders when `showUpNext && upNextLabel`, with `countdownSeconds={15}` unchanged. Its `onPlayNext`:
    1. `setShowUpNext(false)`;
    2. if `nextVideoFile`, use today's `router.replace(\`/streaming/${torrentId}?file=${nextVideoFile.index}\`)`;
    3. otherwise `const href = await upNext.playNext()`, then `router.replace(href)`, or `toast.error('Could not start the next episode.', { id: 'play-next' })` when `href` is null.
  - The comment above `handleVideoProgress` loses the stale "Does NOT autoplay". It becomes: "The card counts down 15 s and then plays next by itself (`UpNextCard`'s countdown); Dismiss cancels it. Inside a season pack the next file is next; otherwise the next episode's own download is (reused or started via `useUpNextEpisode`)."
  - In `UpNextCard.tsx`, the header "for multi-file season packs" becomes "for the next episode — the next file of a season pack, or the next episode's own download". It also states that `countdownSeconds` auto-advances.

- [ ] **Step 1: Write the failing page test.** Create `src/app/(web)/streaming/[id]/page.test.tsx`.
  - Mocks:
    - `next/navigation`: `useParams` → `{ id: nav.id }`, `useRouter` → `{ push, replace }`, and `useSearchParams` → `nav.search`, all from `vi.hoisted`;
    - `@/services/torrents`: `getTorrentStatus`, `prioritizeForStreaming` (→ true), `getSources` (→ []), `downloadCatalogMovie`;
    - `@/services/streaming`: `getFiles`, `getStreamingInfo`, `getStreamingUrl` (→ `'/v'`);
    - `@/utils/streaming`: `{ isStreamingReady: vi.fn() }`, set to resolve `true` in `beforeEach`;
    - `@/services/tv`: `getSeason`, `getShow`;
    - `@/services/instance`: `getPlayback`;
    - `react-hot-toast`: `{ toast: Object.assign(vi.fn(), { loading: vi.fn(), success: vi.fn(), error: vi.fn() }) }`;
    - `@/components/player/PatchedVideoPlayer`: a default export stub that stores `props.onProgress` in a hoisted `player` holder and renders `<div data-testid="player" />`. Make it a plain function, not a `vi.fn()`, because `vi.resetAllMocks()` would wipe a `vi.fn()` implementation and the player would render nothing.
  - `UpNextCard` stays real, because it is the thing being clicked. Use `vi.resetAllMocks()` and set the defaults in `beforeEach`.
  - Mock `@/services/instance`'s fixtures as `PlaybackSettings` (`import type { PlaybackSettings } from '@/services/instance'`), not `as never`.
  - Fixtures:
    - single-episode `status = { id: 'ep-2', quality: '1080p', state: 'downloading', progress: 50, download_rate: 1, num_peers: 3, media_type: 'tv', tmdb_id: 1399, season: 2, episode: 2, movie_title: 'Show S02E02' }`;
    - `info = { torrent_id: 'ep-2', content_id: 'tv:1399:s2:e2', video_file: { name: 'e2.mkv', progress: 50, size: 1, downloaded: 1, mime_type: 'video/mp4', stream_url: '/v' } }`;
    - `getFiles` → one file;
    - `getSeason` → season 2 with episodes `[1, 2, 3]`, each with `runtime: 40` (the "duration of 0" row needs the 2400 s TMDB scale);
    - `getPlayback` → `{ auto_next_enabled: true, auto_next_pct: 80 }`;
    - `downloadCatalogMovie` → `{ id: 'next-1', season: 2, episode: 3 }`.
  - Handles: `const torrents = vi.mocked(torrentsService)`, `const tv = vi.mocked(tvService)`, `const instance = vi.mocked(instanceService)`.
  - Helpers:
    - `open()` = `render(<StreamingPage />)`, `await screen.findByTestId('player')`, then three `await act(async () => {})`;
    - `tick(t, d = 2400)` = `await act(async () => player.onProgress!({ currentTime: t, duration: d }))` + two flushes.
  ```ts
  it('a single-episode download starts the next episode past the owner’s threshold, once', async () => {
    await open();
    await tick(1900);
    expect.soft(torrents.downloadCatalogMovie, 'not before 80%').not.toHaveBeenCalled();
    await tick(1921); await tick(2000);
    expect.soft(torrents.downloadCatalogMovie.mock.calls.map(([b]) => b)).toEqual([
      { tmdb_id: 1399, quality: '1080p', media_type: 'tv', season: 2, episode: 3 },
    ]);
  });
  it('starts it by TMDB’s runtime when the player reports a duration of 0', async () => {
    // getSeason's fixture lists 40-minute episodes, so the scale is 2400 s from TMDB.
    await open();
    await tick(2000, 0);
    expect(torrents.downloadCatalogMovie.mock.calls.map(([b]) => b)).toEqual([
      { tmdb_id: 1399, quality: '1080p', media_type: 'tv', season: 2, episode: 3 },
    ]);
  });
  it('the last episode of a pack reaches into the next season', async () => {
    // pack 'pk', files [{index 4, e1}, {index 0, e2}, {index 7, e3}], ?file=7, content_id 'tv:1399:s2:e3';
    // getShow → seasons 2 (3 eps) and 3 (8 eps); getSeason(…, 3) → [1..8]
    await open(); await tick(2000);
    expect(torrents.downloadCatalogMovie.mock.calls.map(([b]) => b)).toEqual([
      { tmdb_id: 1399, quality: '1080p', media_type: 'tv', season: 3, episode: 1 },
    ]);
  });
  it('inside a season pack the next FILE is next: no download, and Play next swaps the file', async () => {
    // pack 'pk', same files, no ?file (plays index 4 = e1), content_id 'tv:1399:s2:e1'
    await open(); await tick(2399);
    expect.soft(torrents.downloadCatalogMovie).not.toHaveBeenCalled();
    expect.soft(screen.getByTestId('upnext-label').textContent).toBe('S02E02');
    await act(async () => fireEvent.click(screen.getByTestId('upnext-play')));
    expect.soft(nav.replace).toHaveBeenCalledWith('/streaming/pk?file=0');
  });
  it('a single-episode download offers the next episode near the end, and Play next goes to its download', async () => {
    instance.getPlayback.mockResolvedValue({ auto_next_enabled: false, auto_next_pct: 80 });
    await open(); await tick(2390);
    expect.soft(screen.getByTestId('upnext-label').textContent).toBe('S02E03');
    await act(async () => fireEvent.click(screen.getByTestId('upnext-play')));
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect.soft(nav.replace).toHaveBeenCalledWith('/streaming/next-1');
  });
  it('a film has no Up Next and asks the catalog nothing', async () => {
    // media_type 'movie', content_id 'movie:603'
    await open(); await tick(2399);
    expect.soft(screen.queryByTestId('upnext-card')).toBeNull();
    expect.soft(tv.getSeason).not.toHaveBeenCalled();
  });
  ```
  What each row catches (rows numbered in the order above):
  - not calling `upNext.onProgress`: row 1;
  - calling it after the `duration <= 0` early return instead of first: row 2 (the "duration of 0" row);
  - passing `isMultiFile` as `nextFileInTorrent`: row 3, because a pack whose next episode lives in another season would never prefetch;
  - keeping `if (!isMultiFile) return;`: row 5;
  - a Play next that always uses `?file=`: row 5 (`'/streaming/ep-2?file=undefined'`);
  - wiring `torrentId` as the content id: row 1.
- [ ] **Step 2: Run it and expect it to fail.**
  ```
  npx vitest run 'src/app/(web)/streaming/[id]/page.test.tsx'
  ```
  Expected: rows 1, 2, 3 and 5 FAIL: `downloadCatalogMovie` is not called, and `upnext-label` is not found. Rows 4 and 6 pass already, because they pin today's behaviour.
- [ ] **Step 3: Implement** the page changes listed under **Interfaces**, and the two comment fixes.
- [ ] **Step 4: Run it and expect it to pass.**
  ```
  npx vitest run 'src/app/(web)/streaming/[id]/page.test.tsx' src/components/player/UpNextCard.test.tsx src/lib/player/useUpNextEpisode.test.tsx
  npx tsc --noEmit
  for i in $(seq 1 10); do npx vitest run 'src/app/(web)/streaming/[id]/page.test.tsx' >/dev/null 2>&1 || echo "FAIL $i"; done
  npx vitest run
  ```
  Expected: PASS with no FAIL lines, and the full suite green.
  - Seam check: `src/lib` is outside `noDeadExports`'s declaration scope, so prove each wire by hand:
    ```
    grep -rn "useUpNextEpisode\|usePlaybackSettings\|pastAutoNextPoint\|findNextEpisode\|episodeScaleSeconds\|episodeRefOf" frontend/src --include='*.ts' --include='*.tsx' | grep -v '\.test\.'
    ```
    The `--include` globs are quoted because zsh aborts an unmatched bare `*.ts` with "no matches found". Run it from the repo root.
    It must show a non-comment call in `(web)/streaming/[id]/page.tsx` (`useUpNextEpisode`), in `lib/player/useUpNextEpisode.ts` (the other five) and in TV `watch/[id]/page.tsx` (`usePlaybackSettings`, `pastAutoNextPoint`, `findNextEpisode`, `episodeScaleSeconds`, `episodeRefOf`).
- [ ] **Step 5: Commit.**
  ```
  git add "frontend/src/app/(web)/streaming/[id]/page.tsx" "frontend/src/app/(web)/streaming/[id]/page.test.tsx" frontend/src/components/player/UpNextCard.tsx
  git commit -m "feat(web): prefetch the next episode past the owner's threshold and offer Up Next for single-episode downloads

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task E6: Backend: retire `auto_next_episode` from the profile-settings API (the column stays)

**Files:**
- Modify: `backend/app/models.py` (Part A has already edited `UserSettingsUpdate`, so these lines will have moved; find them by text)
  - delete lines 640-644 (`UserSettingsUpdate.auto_next_episode` and its four-line `exclude_unset=True` comment);
  - delete lines 666-671 (`UserSettingsResponse.auto_next_episode` and its five-line "NEVER Optional" comment).
- Modify: `backend/app/api/users.py`: delete lines 104-110 in `profile_response`, the `auto_next_episode=…` keyword and its comment.
- Modify: `backend/app/database/models/users.py`: replace the comment at lines 88-107 above `auto_next_episode = Column(Boolean, nullable=True)` (108). The column itself is unchanged.
- Test: `backend/tests/test_auto_next_episode.py`. This is a rewrite: keep `world`, `_get` and `_put`.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `GET /users/{id}/settings`, `GET /users`, `GET /users/{id}` and `GET /auth/me` profiles carry no `auto_next_episode` key (all through `profile_response`);
  - `PUT /users/{id}/settings` never writes the column.

- [ ] **Step 1: Write the failing test.**
  - Rewrite the module docstring: the per-profile switch is retired by spec §5.1, the global switch is `Instance.auto_next_enabled` (Part D), and the column stays because `sync_columns` never drops a column.
  - Delete `test_null_column_reads_as_on`, `test_turning_it_off_is_an_explicit_false`, `test_turning_it_back_on_sticks`, `test_an_unrelated_update_leaves_it_alone` and `test_false_survives_the_handler_loop_and_omission_is_absent`, and the now-unused `UserSettingsUpdate` import.
  - Keep `test_the_column_is_nullable_so_sync_columns_can_add_it` unchanged. It is now the pin that the column was not dropped: deleting the ORM column raises `KeyError`.
  - Add:
  ```python
  def test_settings_no_longer_carry_it(world):
      assert "auto_next_episode" not in _get(world)


  def test_a_stale_client_cannot_write_it(world):
      """Cached TV JS from before this change may still PUT the old toggle."""
      r = world["client"].put(
          f"/api/v1/users/{world['profile']}/settings",
          json={"auto_next_episode": False, "theme": "light"},
          cookies=world["cookie"],
      )
      assert r.status_code == 200, r.text
      world["db"].expire_all()
      assert world["settings_row"].auto_next_episode is None
      assert world["settings_row"].theme == "light"  # the request was processed, not refused
  ```
  - The 200 is right because Part A keeps pydantic's default `extra='ignore'` on `UserSettingsUpdate`, so an unknown key is dropped rather than refused. Check with `grep -n "class UserSettingsUpdate" -A3 backend/app/models.py`. If a `model_config` with `extra='forbid'` is there, stop and report it to the lead, because then a stale TV client's PUT 422s and that is a behaviour change this part does not own.
  - What the rows catch:
    - leaving the field on `UserSettingsUpdate`: the handler's `setattr` loop writes `False`, so `is None` fails;
    - leaving it on the response: `not in` fails.
- [ ] **Step 2: Run it and expect it to fail.**
  ```
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_auto_next_episode.py -v
  ```
  Expected: `test_settings_no_longer_carry_it` FAILS with `assert 'auto_next_episode' not in {…}`, and `test_a_stale_client_cannot_write_it` FAILS with `assert False is None`.
- [ ] **Step 3: Implement.**
  - Delete the two schema fields and the `profile_response` keyword.
  - Replace the ORM comment with:
    ```
    # RETIRED (spec 2026-11-06 §5.1): the per-profile next-episode switch is gone; the global
    # Instance.auto_next_enabled / auto_next_pct replace it. Nothing reads or writes this column.
    # It stays because sync_columns() only adds and there is no migration framework to drop it.
    ```
- [ ] **Step 4: Run it and expect it to pass.**
  ```
  docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_auto_next_episode.py tests/test_profile_scoping.py -v
  grep -rn "auto_next_episode" backend/app
  ```
  Expected:
  - PASS;
  - `grep` shows only the ORM column line (`database/models/users.py`);
  - `test_profile_scoping.py` still green, since it uses the same `profile_response`.
- [ ] **Step 5: Commit.**
  ```
  git add backend/app/models.py backend/app/api/users.py backend/app/database/models/users.py backend/tests/test_auto_next_episode.py
  git commit -m "refactor(users): drop auto_next_episode from the profile settings API; the column stays unused

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Docs

- No line in `CLAUDE.md` or `docs/ARCHITECTURE.md` mentions auto-next, Up Next or the toggle, so none becomes false. That was checked with `grep -in "up next\|auto.next\|next.episode\|prefetch"`.
- The stale comments this part fixes:
  - the web page's "Does NOT autoplay" (E5);
  - `UpNextCard`'s "multi-file season packs" header (E5);
  - the `auto_next_episode` ORM, schema and `profile_response` comments (E6);
  - the TV watch page's "past 80%" prefetch comment (E2);
  - the `nextEpisode` module headers (E1);
  - the four watch suites' "`autoNextFrom` … pinned" header line (E2).
- Old plans in `docs/superpowers/plans/` are history and stay unedited.
