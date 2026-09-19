# Instance Claim — design

Converts Freeflix/FRÈ from a no-auth, anyone-can-create-a-profile app into a **claimed instance** with
**invite-only** membership, passwordless (magic-link) sign-in, and transactional email delivered through
**Resend + React Email**.

Status: design locked 2026-09-18. Branch `feat/instance-claim`.

---

## 1. Locked decisions

| # | Decision |
|---|---|
| 1 | **Auth = magic link, passwordless.** No passwords anywhere. Invite → set up profile → 30-day HTTP-only session cookie. Later sign-ins request a fresh emailed link. *Superseded for the OWNER by §13 — the owner signs in with a password; members are unchanged.* |
| 2 | **Two-level identity.** An **Account** (email + role) owns one or more **Profiles** (the existing "Who's watching?" profiles, with per-profile passcode + maturity restriction). |
| 3 | **Roles: `owner` and `member` only.** Owner invites / revokes / removes / transfers ownership and sees instance settings. Members manage their own profiles, watch, download, schedule, watchlist. |
| 4 | **First-run claim is protected by a claim code.** While unclaimed the backend generates a one-time code every boot, logs it in a banner and writes it to a persisted volume. `/claim` requires code + email; a verification email finalises ownership. |
| 5 | **Email = Resend + React Email.** Templates are `.tsx` under `frontend/src/emails`. FastAPI POSTs to a Next.js internal route (shared-secret header) which renders and sends. Design matches FRÈ Editorial Noir. |
| 6 | **Migration is non-destructive.** The oldest existing profile's account becomes `owner` (status `pending_email`); every other existing profile gets its own `member` account, also pending. No watch progress, watchlist, download or schedule data is lost. |
| 7 | **All `/api/v1` endpoints require a session** except the claim/auth routes, `GET /` and `GET /health`. |

---

## 2. Non-negotiable constraints discovered in the codebase

These come from reading the repo. Violating any of them silently breaks production.

### 2.1 `get_db()` is a `@contextmanager`, and it is single-use

`Depends(get_db)` injects the `_GeneratorContextManager` **object**, not a `Session`. FastAPI caches
sub-dependency results per request, so **an auth dependency must never declare `Depends(get_db)`** — the
endpoint would then receive an already-exhausted context manager and raise
`AttributeError: '_GeneratorContextManager' object has no attribute 'args'`, which the error middleware turns
into an opaque 500.

**Rule:** auth dependencies open their own session with `with get_db() as db:` (note the call), exactly as
`api/streaming.py:198` already does. Endpoints keep `db: Annotated[Session, Depends(get_db)]` + `with db as session:`.

### 2.2 `users` cannot be renamed

Five FK constraints across four tables point at `users.id`, and `sync_columns()` has no rename path.
**`__tablename__` stays `"users"`.** The Python class stays `User`. Only the API surface and UI call it a
*profile*. A new nullable `users.account_id` column is the whole schema change on that table.

### 2.3 `sync_columns()` only ever `ADD COLUMN`s

New **tables** are free (`create_all`), provided the module is imported in
`app/database/models/__init__.py`. New **nullable columns** on existing tables are free. Everything else —
indexes on new columns, FK constraints on new columns, `NOT NULL`, defaults, backfill — needs hand-written
idempotent SQL in the `sync_indexes()` style (existence-guarded, `try/except` + `logger.warning`,
Postgres-and-SQLite-safe, safe to run on every boot).

`tests/test_sync_indexes.py` runs `sync_indexes(engine)` against a near-empty DB, so **every new statement
must be individually existence-guarded**.

### 2.4 `init_db()` runs at *import* time, twice

`app/cron/jobs.py` ends with `schedule_manager = ScheduleManager()` at module scope, and
`ScheduleManager.__init__` calls `init_db()`. `app/main.py` imports it at line 16 — **before**
`settings.initialize()` creates the runtime directories.

**Rule:** schema work (idempotent DDL) may live in `init_db()`. **Anything that writes a file or generates a
claim code must live in the `startup` event**, after `settings.initialize()`.

### 2.5 `Model.created_at` is a process-wide constant

`created_at = Column(DateTime, default=datetime.datetime.now(datetime.timezone.utc))` — `now()` is called once
at class-definition time. Every row inserted by one process shares a timestamp. So "oldest user" must order by
`(created_at, id)` deterministically, and the chosen owner must be surfaced loudly in the boot banner so the
operator can correct it.

**All new expiry/timestamp columns use `default=lambda: ...` (a callable) — never a bare call.**

### 2.6 Timezone-naive columns vs timezone-aware values

Every `DateTime` column is declared without `timezone=True` while the code writes
`datetime.now(timezone.utc)` (aware). Postgres drops the tzinfo, so a value read back is **naive**, and
comparing it to an aware `now()` raises `TypeError`.

**Rule:** all auth expiry logic uses **naive UTC** on both sides. A single helper,
`app/services/auth.py::utcnow() -> datetime` returning `datetime.now(timezone.utc).replace(tzinfo=None)`, is
the only clock in the auth code.

### 2.7 Soft delete is a trap

`CRUDMixin.delete()` defaults to `hard_delete=False` and merely stamps `deleted_at`. **No query anywhere
filters `deleted_at`.** A "revoked" account soft-deleted this way would still authenticate.

**Rule:** revocation is a `status` change that the session lookup filters on. Removal is
`hard_delete=True`.

### 2.8 `to_dict()` drops `None` keys

`SomeResponse(**row.to_dict())` silently omits every NULL column. New response models must either give every
nullable field a default, or use `Model.model_validate(row)` with `from_attributes=True` (the pattern already
used at `api/watchlist.py:49`). **Prefer `model_validate`.**

### 2.9 `/_backend/:path*` is a wildcard alias for the entire backend

`next.config.ts` proxies `/_backend/:path*` → `${backendUrl}/:path*`, so `/_backend/api/v1/users` reaches a
gated route by a second same-origin path.

**Rule:** the session cookie is `Path=/` (never `Path=/api`), and the gate lives in FastAPI (a Next
middleware guard would be bypassed by this spelling, and by the published `8000:8000` port).

### 2.10 Auth tokens must never appear in a URL path

`middleware/error_handler.py:30` logs `request.method` + `request.url.path` to stdout **and** to a 7-day
retained file in the persisted `logs` volume. Query strings are *not* logged.

**Rule:** the emailed link points at a **Next.js page** (`/auth/verify?token=…`), which POSTs the token in a
**JSON body** to the backend. The backend never sees a token in a path. Backend log lines only ever read
`POST /api/v1/auth/verify`.

### 2.11 The video element can only be gated by a cookie

`GET /api/v1/streaming/{torrent_id}/video?quality=&file_index=` is assigned to a raw `<video src>`. No header
can be attached. It is same-origin through the Next rewrite, so an `HttpOnly` cookie works — but an HTML 401
body would be read by the player as corrupt media. **The video endpoint returns a bare 401 with an empty body
and no redirect.**

Note the query param is **`file_index`**, not `file` (`?file=` is the *frontend* page param).

### 2.12 Server components have no cookie jar

`api-client.ts` sets `baseURL = isServer ? '${BACKEND_INTERNAL_URL}/api/v1' : '/api/v1'`.
`app/movies/[id]/page.tsx` and `app/tv/[id]/page.tsx` are server components that fetch through it and
`catch → notFound()`. Gating the catalog without fixing this turns every detail page into a silent 404.

**Fix:** an async request interceptor on **both** axios instances that, when `isServer`, dynamically imports
`next/headers`, awaits `cookies()` and forwards them. Wrapped in `try/catch` because `cookies()` throws
outside a request scope.

### 2.13 Other live bugs this work must not preserve

| Bug | Location | Handling |
|---|---|---|
| `GET /users` and `GET /users/{id}` return every profile's **plaintext passcode** (`UserSettingsModel.passcode`) | `api/users.py:45,54` + `models.py:468` | Remove `passcode` from every response model. |
| The passcode gate **never fires** — `ProfileGate` reads `s.passcode`, which `UserSettingsResponse` does not return | `ProfileGate.tsx:62,70` | Rebuild server-side (§6.5). |
| `PUT /users/{id}` 500s — returns `UserResponse(**user.to_dict())` without the required `settings` | `api/users.py:72` | Fixed in the rewrite. |
| `GET /users` 500s for the whole list if any profile has no `user_settings` row | `api/users.py:45` | Guard + auto-heal. |
| `POST /schedules` 500s (passes the CM object where a `Session` is expected) | `api/schedules.py:49-68` | Out of scope, but **do not copy that file's DB pattern**. Noted in §11. |
| CORS `allow_origins=["*"]` + `allow_credentials=True` is invalid once cookies exist | `main.py:61` | Explicit origin list from settings. |

### 2.14 Rate limiting cannot be per-IP

Every browser request reaches FastAPI from the `frontend` container's IP, and uvicorn is started with no
`proxy_headers`. A per-IP throttle collapses into one global bucket.

**Rule:** throttle on the **normalised email**, and make the response for a known and an unknown address
byte-identical (no enumeration oracle).

### 2.15 Dev/build gotchas

- Backend tests are **baked into the image**, not bind-mounted. A new `conftest.py` is invisible until
  `make build`, or run with `-v "$(pwd)/backend/tests:/opt/freeflix/tests"`.
- The frontend dev container's `/app/node_modules` is an **anonymous volume**. New npm deps need
  `docker compose up -V` (or a rebuild) or the mail route fails with `MODULE_NOT_FOUND`.
- `pydantic-settings` defaults to `extra='forbid'`. **Every new `.env` key must be declared as a field on
  `Settings`** or the backend crashes at import.
- `docker-compose.override.yml` is dev-only; `make prod` ignores it. Anything needed in production goes in
  `docker-compose.yml`.
- Only persisted backend volumes are `resume-data`, `logs`, and the `./downloads` bind mount.

---

## 3. Data model

All new models live in **`backend/app/database/models/accounts.py`** and are exported from
`app/database/models/__init__.py` (**mandatory** — `create_all` iterates `Base.metadata`).

Every model subclasses `Model` (which supplies `created_at` / `updated_at` / `deleted_at`) and uses
`id = Column(String, primary_key=True, default=generate_uuid)`.

```
Instance   (singleton, id="singleton")
  claimed_at        DateTime  NULL     -- NULL => unclaimed
  claim_code_hash   String    NULL     -- sha256 of the current boot's claim code
  owner_account_id  String    NULL  FK accounts.id ON DELETE SET NULL
  instance_name     String    NULL

Account
  email             String    NULL  UNIQUE INDEX   -- NULL for pending_email accounts
  role              String    NOT NULL 'member'    -- owner | member
  status            String    NOT NULL 'pending_email'
                                                   -- pending_email | invited | active | revoked
  display_name      String    NULL
  invited_by_id     String    NULL  FK accounts.id ON DELETE SET NULL
  last_login_at     DateTime  NULL
  profiles          -> relationship("User", back_populates="account", lazy="selectin")

Invite
  token_hash        String    NOT NULL UNIQUE INDEX
  email             String    NOT NULL INDEX
  role              String    NOT NULL 'member'
  invited_by_id     String    NULL  FK accounts.id ON DELETE SET NULL
  account_id        String    NULL  FK accounts.id ON DELETE CASCADE  -- pre-created target account
  expires_at        DateTime  NOT NULL
  accepted_at       DateTime  NULL
  revoked_at        DateTime  NULL

AuthToken          (magic links)
  token_hash        String    NOT NULL UNIQUE INDEX
  email             String    NOT NULL INDEX
  account_id        String    NULL  FK accounts.id ON DELETE CASCADE
  purpose           String    NOT NULL       -- login | claim_verify | invite
  expires_at        DateTime  NOT NULL
  consumed_at       DateTime  NULL

AuthSession
  token_hash        String    NOT NULL UNIQUE INDEX
  account_id        String    NOT NULL INDEX FK accounts.id ON DELETE CASCADE
  expires_at        DateTime  NOT NULL INDEX
  last_seen_at      DateTime  NULL
  user_agent        String    NULL
  unlocked_profiles JSON      NULL           -- list[str] of profile ids unlocked this session
  revoked_at        DateTime  NULL
```

Changes to existing models:

```python
# app/database/models/users.py  (User == Profile)
account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"),
                    nullable=True, index=True)   # nullable so sync_columns can add it
account    = relationship("Account", back_populates="profiles")

# UserSettings
passcode_hash = Column(String, nullable=True)   # pbkdf2_sha256, replaces `passcode`
passcode_len  = Column(Integer, nullable=True)  # digit count, for the keypad
```

`UserSettings.passcode` (the plaintext column) is **left in place** — `sync_columns` cannot drop it — but is
never read or written again, and never appears in any response model. The migration hashes any existing
plaintext value into `passcode_hash` and blanks the old column.

### 3.1 Per-table FK semantics after the split

| Table | FK points at | Reasoning |
|---|---|---|
| `user_settings.user_id` | **profile** | per-profile passcode + maturity restriction |
| `user_streaming_progress.user_id` | **profile** | per-profile resume is the point of "Who's watching?" |
| `user_watchlist.user_id` | **profile** | personal taste list |
| `torrents.user_id` | **account** (forward-looking) | a download is a disk/bandwidth commitment; already instance-global |
| `schedules.user_id` | **account** (forward-looking) | headless automation, no profile context |

`torrents.user_id` and `schedules.user_id` are **100% NULL today** (nothing ever writes them). They stay
nullable and NULL-means-instance-owned. This work does **not** start filtering on them, so no historical
download or schedule disappears from the UI.

**`uq_user_movie_progress(user_id, movie_id)` is unchanged.** `user_id` continues to mean *profile*.
Repointing progress at the account would make two profiles watching the same episode collide on the unique
key and silently overwrite each other's position.

### 3.2 Hand-written migration — `sync_auth_schema(engine_)`

New function in `database/session.py`, called from `init_db()` after `sync_indexes(engine)`. Every statement
existence-guarded, idempotent, Postgres+SQLite safe, `try/except` + `logger.warning`.

1. If `users` exists and `accounts` exists: `CREATE INDEX IF NOT EXISTS ix_users_account_id ON users (account_id)`.
2. Postgres only, catalog-guarded: `ALTER TABLE users ADD CONSTRAINT fk_users_account_id FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE`.
3. `CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_email ON accounts (lower(email))` — Postgres only
   (SQLite gets the declarative `unique=True` from `create_all`).

The **data backfill is not here** — see §5.1. Schema DDL runs at import time; the backfill must be explicit
and verifiable.

---

## 4. Auth mechanics

### 4.1 Tokens

All tokens are `secrets.token_urlsafe(32)`. Only `hashlib.sha256(raw.encode()).hexdigest()` is stored.
Lookup is by hash; comparison uses `hmac.compare_digest`. No new Python dependency (stdlib only).

| Token | TTL (setting) | Single use |
|---|---|---|
| Magic-link / claim-verify / invite (`auth_tokens`) | `magic_link_ttl_minutes` = 20 | yes — `consumed_at` set in the same transaction that validates |
| Invite (`invites`) | `invite_ttl_hours` = 72 | yes — `accepted_at` |
| Session (`auth_sessions`) | `session_ttl_days` = 30 | no, sliding `last_seen_at` |
| Claim code | until claimed; regenerated every boot while unclaimed | yes |

### 4.2 Session cookie

```
name      ff_session            (settings.cookie_name)
value     secrets.token_urlsafe(32)      -- sha256 stored in auth_sessions.token_hash
HttpOnly  true
SameSite  Lax                   -- Strict would block the magic-link click
Path      /                     -- must cover /_backend/* too (§2.9)
Domain    (unset)               -- any Domain makes the browser reject it through the proxy
Secure    settings.cookie_secure (default False; document "set true behind HTTPS")
Max-Age   session_ttl_days * 86400
```

### 4.3 Claim code

- Format: `XXXX-XXXX-XXXX`, Crockford-ish alphabet (no `I O 0 1`), from `secrets.choice`.
- Generated in the **startup event** (not `init_db`) when `instance.claimed_at IS NULL`.
- sha256 stored in `instance.claim_code_hash`; plaintext written to
  `settings.log_path / "claim_code.txt"` (the persisted `logs` volume) mode `0600`, and printed as a boxed
  banner at `logger.warning` level.
- Regenerated on every boot while unclaimed, so a lost code is recoverable by restarting the container.
- Cleared (`claim_code_hash = None`, file unlinked) the moment the instance is claimed.

### 4.4 Rate limiting

`app/services/auth.py::RateLimiter` — in-process dict, keyed `f"{bucket}:{normalised_email}"`, sliding
window. No dependency.

| Endpoint | Limit |
|---|---|
| `POST /auth/request-link` | 3 per email / 15 min |
| `POST /claim` | 5 per email / 15 min, **and** 10 global failures / 15 min on a wrong code |
| `POST /users/{id}/unlock` | 5 per profile / 5 min |

`POST /auth/request-link` **always** returns `{"sent": true}` — identical for known, unknown, revoked and
rate-limited addresses.

### 4.5 Dependencies — `backend/app/dependencies/auth.py`

```python
@dataclass
class AuthContext:
    account_id: str
    email: str | None
    role: str          # owner | member
    status: str
    session_id: str
    unlocked_profiles: list[str]

def require_session(request: Request) -> AuthContext            # 401 if absent/expired/revoked
def require_owner(ctx = Depends(require_session)) -> AuthContext # 403 if ctx.role != "owner"
def require_profile(user_id: str, ctx = Depends(require_session)) -> str
    # 404 if the profile does not exist
    # 403 if profile.account_id != ctx.account_id (and ctx.role != owner is irrelevant —
    #     an owner does NOT get to read other members' profiles)
    # 423 Locked if settings.require_passcode and user_id not in ctx.unlocked_profiles
```

All three open their own `with get_db() as db:` (§2.1).

`settings.auth_enabled = False` is a kill switch (mirrors `content_guard_enabled`): `require_session`
returns a synthetic owner context. Documented as **development only**.

### 4.6 Gate placement

Per-router in `main.py`:

```python
GATED = [Depends(require_session)]
app.include_router(movies.router,    prefix=..., dependencies=GATED)
...   # torrents, schedules, streaming, users, tv, watchlist, activity, rails
app.include_router(auth.router,      prefix=f"{settings.api_v1_str}/auth")      # public
app.include_router(instance.router,  prefix=f"{settings.api_v1_str}/instance")  # mixed, per-endpoint
```

`GET /` and `GET /health` are `@app.get` decorators, not router routes, so they stay public automatically.

---

## 5. Flows

### 5.1 Upgrade migration (decision 6)

`app/services/accounts.py::migrate_users_to_accounts(db) -> MigrationReport`, called **once from the startup
event**, after `init_db()` and after `settings.initialize()`. Idempotent (no-ops when every `users` row
already has an `account_id`). Loud: logs the report, and raises nothing — but writes an explicit
`logger.error` if a postcondition fails (§2.4's silent-failure trap).

```
for each users row where account_id IS NULL, ordered by (created_at ASC, id ASC):
    first row  -> Account(role="owner",  status="pending_email", display_name=user.display_name)
    others     -> Account(role="member", status="pending_email", display_name=user.display_name)
    user.account_id = account.id
    if user has no user_settings row: create one (fixes §2.13's 500)
    if user_settings.passcode is a non-empty plaintext:
        passcode_hash = pbkdf2(passcode); passcode_len = len(passcode); passcode = None
if no Instance row: create Instance(id="singleton")
if instance.owner_account_id is NULL: set it to the owner account
```

If an `owner` account already exists, no new owner is minted — later rows all become members.
The chosen owner's profile name is printed in the boot banner next to the claim code.

### 5.2 Claim

```
unclaimed instance
  └─ boot banner + logs/claim_code.txt   →  XXXX-XXXX-XXXX
/claim page:  [ claim code ] [ your email ]
  └─ POST /api/v1/claim { claim_code, email }
       verify sha256(code) == instance.claim_code_hash (hmac.compare_digest)
       attach email to the existing owner account (or create one if the DB is empty)
       mint AuthToken(purpose="claim_verify")
       send ClaimVerifyEmail
       → { "sent": true }
/auth/verify?token=…  (Next page)
  └─ POST /api/v1/auth/verify { token }
       consume token; account.status = "active"; account.email verified
       instance.claimed_at = now; claim_code_hash = None; unlink claim_code.txt
       create AuthSession; Set-Cookie
       → { "ok": true, "redirect": "/" }
```

Once `claimed_at` is set, `POST /api/v1/claim` returns **409** forever.

### 5.3 Invite

```
owner at /members
  └─ POST /api/v1/instance/invites { email }            (owner-only)
       if an account with that email exists and is active → 409
       if a pending_email account exists (from migration) → reuse it, attach the email
       else create Account(status="invited", role="member")
       mint Invite(token_hash, email, account_id, expires_at = now + 72h)
       send InviteEmail  →  {APP_PUBLIC_URL}/invite?token=<raw>
/invite?token=…  (Next page)
  └─ POST /api/v1/auth/invite/preview { token }   → { email, invited_by, expires_at, instance_name }
  └─ POST /api/v1/auth/invite/accept  { token, display_name, avatar }
       consume invite; account.status = "active"
       create the first Profile (User + UserSettings) under that account
       create AuthSession; Set-Cookie
       send WelcomeEmail
       → { "ok": true }
```

Owner actions on `/members`: **resend** (mints a fresh invite, revokes the old), **revoke invite**,
**revoke access** (`status="revoked"` + delete all that account's `auth_sessions`), **remove member**
(hard-delete the account → cascades profiles, settings, progress, watchlist; `torrents`/`schedules`
`user_id` is already NULL so nothing is orphaned), **transfer ownership**.

Revoke sends `AccessRevokedEmail`. Removal is confirmed in the UI with an explicit list of what is destroyed.

The owner can never revoke, remove or demote themselves. Transfer is a two-step: the target must be `active`.

### 5.4 Sign-in

```
/signin:  [ your email ]
  └─ POST /api/v1/auth/request-link { email }   → always { "sent": true }
       if an ACTIVE account matches: mint AuthToken(purpose="login"), send MagicLinkEmail
/auth/verify?token=…  → POST /api/v1/auth/verify { token } → session cookie → /
```

### 5.5 Sign out vs switch profile

- **Switch profile** — clears the active profile client-side only. Session cookie untouched.
  (This is what `ProfileMenu`'s existing "Switch profile" item does; it keeps that meaning.)
- **Sign out** — `POST /api/v1/auth/signout`, revokes the `AuthSession` row, clears the cookie, then clears
  local state and routes to `/signin`. New menu item.

---

## 6. Backend API surface

### 6.1 Public (no session)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/v1/instance/status` | — | `{ claimed, claimed_at, instance_name, needs_claim }`. Drives the frontend boot decision. Never leaks the claim code. |
| POST | `/api/v1/claim` | `{ claim_code, email }` | 409 once claimed. Rate-limited. |
| POST | `/api/v1/auth/request-link` | `{ email }` | Always `{sent: true}`. |
| POST | `/api/v1/auth/verify` | `{ token }` | Sets the cookie. Handles `login` and `claim_verify`. |
| POST | `/api/v1/auth/invite/preview` | `{ token }` | 410 if expired/consumed/revoked. |
| POST | `/api/v1/auth/invite/accept` | `{ token, display_name, avatar? }` | Sets the cookie. |

### 6.2 Session required

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/auth/me` | `{ account: {...}, profiles: [...] }` — the single frontend bootstrap call. |
| POST | `/api/v1/auth/signout` | Revokes the session, clears the cookie. |
| GET/POST | `/api/v1/users` | **Scoped to the caller's account.** POST creates a profile *and* its settings row. |
| GET/PUT/DELETE | `/api/v1/users/{user_id}` | `require_profile`. DELETE refuses the account's last profile. |
| GET/PUT | `/api/v1/users/{user_id}/settings` | `require_profile`. `passcode` is **write-only**; responses carry `has_passcode` + `passcode_len`. |
| POST | `/api/v1/users/{user_id}/unlock` | `{ passcode }` → `{ ok }`. Adds the id to `session.unlocked_profiles`. Rate-limited. |
| — | everything else under `/api/v1` | unchanged shape, now behind `require_session`; user-scoped paths additionally behind `require_profile`. |

### 6.3 Owner only

| Method | Path |
|---|---|
| GET | `/api/v1/instance/members` |
| POST | `/api/v1/instance/invites` |
| GET | `/api/v1/instance/invites` |
| DELETE | `/api/v1/instance/invites/{invite_id}` |
| POST | `/api/v1/instance/invites/{invite_id}/resend` |
| POST | `/api/v1/instance/members/{account_id}/revoke` |
| POST | `/api/v1/instance/members/{account_id}/restore` |
| DELETE | `/api/v1/instance/members/{account_id}` |
| POST | `/api/v1/instance/transfer` |
| PUT | `/api/v1/instance/settings` (instance_name) |

### 6.4 Status codes

`401` no/expired session · `403` wrong role or not your profile · `409` already claimed / already a member ·
`410` token expired or consumed · `423` profile locked (passcode required) · `429` rate limited.

`GET /api/v1/streaming/{id}/video` returns a **bare 401 with an empty body** (§2.11).

### 6.5 Passcode, rebuilt

- Stored as `pbkdf2_hmac('sha256', passcode, salt, 260_000)` → `pbkdf2_sha256$260000$<salt_b64>$<hash_b64>`.
  Stdlib only.
- `passcode` is accepted on `PUT /users/{id}/settings` and **never returned**.
- `UserSettingsResponse` gains `has_passcode: bool` and `passcode_len: int | None`; `passcode` is removed
  from `UserSettingsModel` and from `UserResponse.settings`.
- `POST /users/{id}/unlock` verifies server-side and records the unlock on the session row, so the lock the
  UI advertises is now real.

---

## 7. Email — Resend + React Email

### 7.1 Topology

```
FastAPI  app/services/mailer.py
   │  POST {FRONTEND_INTERNAL_URL}/api/internal/mail
   │  x-internal-mail-secret: <INTERNAL_MAIL_SECRET>
   │  { "template": "...", "to": "...", "props": {...} }
   ▼
Next.js  src/app/api/internal/mail/route.ts   (Node runtime, static path)
   ├─ timing-safe secret check  → 401 otherwise
   ├─ await render(<Template {...props} />)      ← render() is ASYNC in @react-email/render ≥1.0
   └─ resend.emails.send({ from, to, subject, html, text })
```

- The route path is **fully static** (`/api/internal/mail`). `next.config.ts` returns a plain array →
  `afterFiles` rewrites → filesystem routes win. A self-rewrite is added anyway, above the `/api/:path*`
  catch-all, matching the existing `/api/palette` precedent.
- `render()` **must be awaited**. A non-awaited call sends `[object Promise]` with a 200 from Resend.
- **No-Resend fallback:** when `RESEND_API_KEY` is unset the route renders, logs the action URL, and returns
  `{ delivered: false, reason: "no_api_key", action_url }`. The backend then logs the link at `warning`
  level, so a self-hosted instance with no email provider is still fully usable.
- `mailer.py` uses the house `httpx.AsyncClient` pattern (`app/providers/tmdb.py:54`). httpx is already a
  dependency. Send failures never 500 the caller — the endpoint returns `{ sent: true, delivered: <bool> }`.

### 7.2 Templates — `frontend/src/emails/`

| File | Trigger | Subject |
|---|---|---|
| `InviteEmail.tsx` | owner invites an email | `You're invited to FRÈ` |
| `MagicLinkEmail.tsx` | sign-in request | `Your FRÈ sign-in link` |
| `ClaimVerifyEmail.tsx` | claim submitted | `Confirm your FRÈ instance` |
| `WelcomeEmail.tsx` | invite accepted | `Welcome to FRÈ` |
| `AccessRevokedEmail.tsx` | owner revokes access | `Your FRÈ access has ended` |

Shared: `emails/components/tokens.ts`, `Layout.tsx`, `CtaButton.tsx`, `Wordmark.tsx`, `Footer.tsx`.

### 7.3 Email design spec (FRÈ Editorial Noir, email-safe)

Tokens, copied as **literal hex** (CSS custom properties do not resolve in email):

```
ink #0A0A0B · surface #111113 · surface-2 #16161A · text #F4F1EA
muted #8C8884 · hairline #26242A · gold #C9A86A · gold-lite #E7D6AE
danger #E5564B · success #7BDCA0
```

- **Body/page**: `#0A0A0B`, set both as `bgcolor` attribute and `background-color` style. Container 600px.
- **Card**: `#111113`, `1px solid #26242A`, `border-radius:16px`, padding 32px (24px < 480px). No box-shadow.
- **Inset block** (code, "what happens next"): `#16161A`, `1px solid #26242A`, radius 10px, padding 16px 20px.
- **Wordmark**: flat `#E7D6AE`, Fraunces 600, 26px, `letter-spacing:3px`, text `FR&Egrave;`.
  **Never** `background-clip:text` — it renders invisible in Outlook.
- **Eyebrow** (one per email): Inter Tight 600, 11px, uppercase, `letter-spacing:3.5px`, `#C9A86A`.
- **H1**: Fraunces 400, 34px, `line-height:40px`, `letter-spacing:-0.7px`, `#F4F1EA`. Optional italic accent
  word in `#E7D6AE` — the `Who's <em>watching?</em>` motif. Do **not** port the app's 0.92 leading; the
  Georgia fallback needs air.
- **Body**: Inter Tight 400, 16px/26px, `#F4F1EA`. Meta: 13px/20px, `#8C8884`. Never set body in Fraunces.
- **CTA**: table-based, `bgcolor="#C9A86A"` + `background-image:linear-gradient(90deg,#E7D6AE,#C9A86A)`,
  `border-radius:999px`, padding `15px 30px`, Inter Tight 600 15px, `#0A0A0B`, with a `<!--[if mso]>`
  VML `roundrect` fallback. Ink-on-gold contrast ≈ 8.8:1.
- **Plaintext fallback link** sits immediately **after the CTA**, not in the footer (Gmail clips > ~102KB).
- **Divider**: a `<td>` with `height:1px;font-size:0;line-height:1px;background:#26242A`. Never `<hr>`.
- **Footer**: outside the card on ink, Inter Tight 12px/18px `#8C8884`, centered — who invited them, the
  link's expiry, "If you weren't expecting this, you can ignore this email.", and the tagline in Fraunces
  italic 13px: *Cinema, kept close.* No unsubscribe (transactional). No second gold moment.
- **Fonts**: Google Fonts `<link>` for Fraunces + Inter Tight (honoured by Apple Mail, ignored by Gmail), with
  `Georgia, 'Times New Roman', serif` and `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`
  fallbacks. **It must look right in Georgia + Arial.**
- **Dark-mode defence**: `<meta name="color-scheme" content="dark light">` +
  `<meta name="supported-color-schemes" content="dark light">`; an explicit `color` on every text node and an
  explicit `background-color` **plus** `bgcolor` on every container; all alpha washes precomputed to opaque
  hex; `[data-ogsc]` / `[data-ogsb]` overrides restating the dark hexes; a
  `@media (prefers-color-scheme: light)` block restating the **same** dark values.
- **Gold discipline**: exactly one gold CTA and one 11px gold eyebrow per email. Everything else is
  `#F4F1EA` on `#111113` with `#26242A` hairlines.
- **Do not port**: `background-clip:text`, `backdrop-blur`, `box-shadow`, `conic-gradient`, masks, the SVG
  grain, `clamp()`, CSS variables, flexbox/grid, `aspect-ratio`.
- Avatars are **not** embedded — `public/avatars/*.svg` are SVG (stripped by Gmail) and off-palette.

---

## 8. Frontend

### 8.1 New routes (public)

`/claim`, `/signin`, `/invite`, `/auth/verify`. All are client components.

### 8.2 Shell

`AuthenticatedLayout` gains a public-path escape hatch **before** any gate:

```tsx
const PUBLIC_PREFIXES = ['/claim', '/signin', '/invite', '/auth'];
if (PUBLIC_PREFIXES.some(p => pathname?.startsWith(p))) return <>{children}</>;
```

Then the boot state machine (replacing the current 2-branch version):

```
loading           → spinner
needs_claim       → redirect /claim
no session        → redirect /signin
session, 0 profiles → first-profile creation screen
session, no active profile → <ProfileGate/>   (only this account's profiles)
otherwise         → chrome + children
```

### 8.3 `SessionContext`

New `src/context/SessionContext.tsx`, mounted **outside** `UserProvider` in `app/layout.tsx`. Owns
`{ account, instanceStatus, isLoading, signOut, refresh }` from `GET /api/v1/auth/me` +
`GET /api/v1/instance/status`.

`UserContext` keeps its name and its public API (`currentUser`, `users`, `selectUser`, …) so the 15
`useUser()` consumers and 10 test mocks keep working. Changes inside it:

- `users` now comes back already scoped to the account.
- `selectUser` calls `POST /users/{id}/unlock` when the profile is locked, instead of comparing a plaintext
  code in the browser.
- `logout()` is renamed in the UI to **Switch profile** (unchanged behaviour); `signOut()` on
  `SessionContext` is the real sign-out.

**Active-profile storage stays `localStorage['currentUserId']`**, because the server now validates ownership
on every user-scoped call. This keeps all 12 service signatures and the `{user_id}` path params unchanged —
a deliberately small blast radius.

### 8.4 `api-client.ts`

1. Async request interceptor on **both** `apiClient` and `rootClient`: when `isServer`, forward cookies from
   `next/headers` (§2.12).
2. Response interceptor on **both**: on 401, if not already on a public path, `window.location.replace('/signin?next=…')`,
   guarded by a module-level `redirecting` flag so TopNav's 15s activity poll cannot cause a redirect loop.
3. `423` is **not** a redirect — it surfaces as a lock prompt.

### 8.5 `/members` (owner)

`src/app/members/page.tsx` + `src/components/members/MembersView.tsx`, built from the `fre` primitives
(`Button`, `Field`, `Modal`, `Badge`, `Pill`). Linked from `ProfileMenu` and `SettingsView` **only when
`account.role === 'owner'`**. Invite form, pending-invite list with resend/revoke, member list with
revoke/restore/remove/transfer, each destructive action behind a `Modal` confirm that names what is deleted.

---

## 9. Configuration

New `Settings` fields (backend) — **all must be declared or `extra='forbid'` crashes the app**:

```
auth_enabled            bool = True        # dev kill switch
cookie_name             str  = "ff_session"
cookie_secure           bool = False
session_ttl_days        int  = 30
magic_link_ttl_minutes  int  = 20
invite_ttl_hours        int  = 72
app_public_url          str  = "http://localhost:3001"
frontend_internal_url   str  = "http://frontend:3000"
internal_mail_secret    Optional[str] = None
resend_api_key          Optional[str] = None
mail_from               str  = "FRÈ <onboarding@resend.dev>"
cors_origins            list[str] = ["http://localhost:3001", "http://localhost:3000"]
```

Frontend env (server-side only, via `env_file: .env` added to the `frontend` service):
`RESEND_API_KEY`, `MAIL_FROM`, `APP_PUBLIC_URL`, `INTERNAL_MAIL_SECRET`.

`docker-compose.yml`: add `env_file: .env` to `frontend`; the claim code writes into the existing `logs`
volume so **no new volume is needed**.

---

## 10. Testing

**Backend** — `backend/tests/conftest.py` is created **first** (there is none today), providing:
`db_engine`, `db_session`, an `app.dependency_overrides[require_session]` fixture yielding an owner context,
and an `anon_client` that does not override it. The 12 existing HTTP test files then keep passing by
importing the shared `client` fixture.

New: `test_auth_tokens.py`, `test_claim_flow.py`, `test_invite_flow.py`, `test_session_auth.py`,
`test_profile_scoping.py`, `test_passcode.py`, `test_accounts_migration.py`, `test_mailer.py`.

**Frontend** — update the 10 `UserContext` mocks and the 11 `WatchlistContext` mocks for any shape change,
plus new tests for `SessionContext`, the four public pages, `MembersView`, and each email template
(asserting literal hex values and the action `href` — `vitest.config.ts` has `css: false`, so only markup and
inline styles are assertable).

Remember: **new backend test files need `make build`** or an explicit tests bind-mount.

---

## 11. Explicitly out of scope

- Fixing `POST/PUT /api/v1/schedules` (already 500s because `schedules.py` passes the context-manager object
  where a `Session` is expected). Documented here so it is not misattributed to this work.
- Renaming the `users` table to `profiles`.
- A light theme for the app (emails are dark by design with defensive overrides).
- Per-IP rate limiting (structurally impossible as deployed — §2.14).
- Backfilling `torrents.user_id` / `schedules.user_id`.
- Node 19 → 20 base-image bump (flagged in `docs/ARCHITECTURE.md` follow-ups; unrelated).

---

## 12. Post-review corrections

A 7-dimension adversarial review (each finding independently verified by three skeptics
through a reachability / correctness / impact lens) surfaced 19 confirmed defects, 12
distinct after deduplication. All are fixed; each is listed with the failure it caused,
because most are non-obvious and easy to reintroduce.

### Frontend

| # | Defect | Failure | Fix |
|---|---|---|---|
| 1 | `/auth/verify` and `/invite` used `router.replace()` after the cookie was set | **The primary sign-in flow was broken.** `SessionProvider` sits in the root layout and bootstraps once per *document* load (a `booted` ref). A soft navigation keeps that tree alive, so `account` was still the `null` the public page loaded with, and `AuthenticatedLayout` bounced the freshly signed-in user straight back to `/signin` — and a freshly claimed instance to `/claim`, which then said "already claimed". | `window.location.replace()`, which is what `SessionContext.signOut()` already does for exactly this reason. The page tests now assert the hard navigation, so asserting `router.replace` can't let it back in. |
| 2 | `selectUser()` set the provider-wide `isLoading` | **A passcode-locked profile could never be opened.** `AuthenticatedLayout` renders a spinner instead of its children while that flag is set, so `ProfileGate` *unmounted* mid-selection and its `PasscodePrompt` state was destroyed before the 423 came back. | Split the boot flag from a new `isSelecting`. `isLoading` now means "still booting", nothing else. |
| 3 | The Settings passcode field accepted any string | **Permanent profile lockout.** The unlock screen is a numeric keypad, so `hunter2` could never be re-entered — and with the lock on, settings *and* delete were both behind the same 423. | Digits only, 4–8, enforced in the input *and* server-side (422). `DELETE /users/{id}` is now exempt from the lock as the recovery path; `PUT /settings` deliberately is **not**, since exempting it would let anyone holding the device switch the lock off. |
| 4 | Enabling the lock left the caller's own session locked out | Every profile-scoped call 423'd for the rest of the session with nothing asking for the code, so My List and Continue Watching silently emptied — reading as data loss. | `PUT /settings` marks the calling session unlocked; whoever just chose the code demonstrably knows it. |
| 5 | The invite page parsed a naive-UTC timestamp with `new Date()` | Per ECMAScript a zone-less string is read as **local** time, so the stated deadline drifted by the viewer's UTC offset and an invite died hours before it was advertised to. | Shared `lib/parseUtc.ts`, used by both the invite page and `MembersView`. |
| 6 | A throttled unlock (429) rendered as "Incorrect passcode" | After five fat-fingered tries the sixth is refused before the hash is checked, so a *correct* code was reported wrong for five minutes — convincing people they had forgotten their own passcode. | `SelectUserResult` gained `'throttled'`; `PasscodePrompt.onSubmit` now returns `boolean \| string` so a specific reason can be shown. |

### Backend

| # | Defect | Failure | Fix |
|---|---|---|---|
| 7 | `watchlist.py` and `rails.py`'s `user_id` had **no ownership check** | **Authorization hole.** The router-level session gate is only *authentication*; any signed-in member could read, add to, patch or delete another household member's watchlist, and pull rails derived from another profile's viewing history. Invisible, because every response was a valid 200. Found by exercising a live stack, not by the suite. | `watchlist.py` gets `require_profile` at router level; `rails.py` gets `require_optional_profile` (validates when present, stays optional). 30 regression tests in `test_profile_scoping.py`. |
| 8 | `_UNAUTHENTICATED` was a module-level `HTTPException` | Re-raising one object appends the raising frames to its `__traceback__` forever, and each retained frame pins its locals — including the `db` Session and its identity map. An internet-reachable instance leaks a session per 401 for the life of the process. | `_unauthenticated()` factory — a fresh exception per raise. |
| 9 | The 401 was raised *inside* `with get_db()` | `get_db` logs every escaping exception at ERROR level and rolls back, so an ordinary signed-out page load read as a database failure. A signed-out browser polls, so it was continuous noise burying real faults. | Resolve inside the block, raise outside it. Verified: 0 `Database error` lines across 15 unauthenticated requests. |
| 10 | `POST /claim` wrote the submitted address onto the owner account immediately | **Permanent owner lockout.** A second submission (a typo, or a race with someone else who read the boot banner) overwrote the email while the first link stayed live, so whoever clicked first took ownership under the other person's address. | `verify` binds `account.email = row.email` — the address actually *proven*. Claim-verify tokens are invalidated by `account_id`, not by the new address. `verify` also refuses a claim token once the instance is claimed. |
| 11 | `RateLimiter` keyed an unbounded dict on the raw, attacker-supplied email | Memory-exhaustion DoS on an unauthenticated endpoint: 100 requests carrying 10 MB each pin ~1 GB, OOM-killing the Raspberry Pi target along with the libtorrent session. | Keys are sha256-digested (64 bytes whatever arrives), the table is capped at `MAX_BUCKETS` with expired-bucket eviction, and it fails **closed** under a genuine flood. |
| 12 | `request-link` awaited the mail send only on the known-account branch | Email-enumeration oracle by latency — ~1s through the render-and-send pipeline versus single-digit ms, which defeats the carefully constant response body. | The send is a `BackgroundTasks` job on every branch. Measured after: 7.9ms known vs 4.5ms unknown. |

### Infrastructure (pre-existing, unblocked by this work)

`next build` resolves `rewrites()` and **bakes the destinations into
`.next/routes-manifest.json`**, but the frontend Dockerfile had no `BACKEND_INTERNAL_URL`
at build time — so the production image froze the proxy at the `localhost:8000` fallback
and every browser API call failed with `ECONNREFUSED` inside the container. `make prod`
had never proxied correctly; `make up` works because dev evaluates the config at runtime.
Fixed with an `ARG`/`ENV` pair in the Dockerfile and a compose `build.args` entry.

### Also worth knowing

`app.dependency_overrides[get_db]` **cannot** reach the auth dependencies: they call
`get_db()` directly (they must — see §2.1), and a direct call bypasses the override, so a
test with a perfectly seeded fixture database gets 401 on every request. Tests must also
`monkeypatch.setattr("app.dependencies.auth.get_db", override_get_db)`. Documented in
`backend/tests/conftest.py`.

---

## 13. Owner password

Supersedes decision 1 **for the owner only**. The instance owner signs in with a **password**;
members remain **magic-link only**. The two credentials are disjoint and neither role can use the
other's entrance. The reason is the threat model, not taste: the owner's address is the key to the
whole instance, and a magic link makes *mailbox access alone* sufficient to take it — a second,
weaker key to the one account that can invite, revoke, remove and transfer.

### 13.1 Locked decisions

| # | Decision |
|---|---|
| 1 | **The password is chosen at claim time.** `/claim` takes claim code + email + password + confirm. The verification email is still required; clicking it proves the address and signs the owner in. There is no second "now set a password" step to forget. |
| 2 | **The owner is password-ONLY.** A magic link never signs the owner in. `request-link` mints nothing for an owner address, and `/auth/verify` refuses a `login` token that belongs to one even if a stale one exists. |
| 3 | **"Forgot password" is not a back door.** It emails a `password_reset` token that lands on a set-a-new-password screen. The link alone grants **no session**; it is worthless unless a new password is chosen at the same time. `/auth/verify` refuses that purpose outright. |
| 4 | **Members are unchanged.** Invite → profile → 30-day cookie; later sign-ins request a fresh link. A member never has a `password_hash`. |
| 5 | **Every password failure returns ONE constant 401.** Unknown address, a member's address, an owner with no password set, a revoked owner, the wrong password and a throttled attempt are byte-identical — status, body and timing. |
| 6 | **Transfer swaps the credential with the role.** The incoming owner is mailed a set-your-password link; the outgoing owner's `password_hash` is cleared and they drop to magic link. |

### 13.2 The three entrances

| Route | Who | Credential | Refusals |
|---|---|---|---|
| `/signin` | members | email → magic link | constant `{sent: true}`, always |
| `/signin/owner` | the owner | email + password | one constant 401 (§13.5) |
| `/auth/reset-password?token=…` | the owner | token **+ a new password** | 410 stale/used/wrong-purpose · 422 weak |

`/signin` stays email-only and gains a quiet *"Instance owner? Sign in with a password"* link to the
separate `/signin/owner` screen. The link is public and names nobody — it is a door, not a hint about
who is behind it.

### 13.3 Flows

```
claim (owner's first credential)
  /claim:  [ claim code ] [ email ] [ password ] [ confirm ]
    └─ POST /api/v1/claim { claim_code, email, password }
         password_problem(password, email=email)  →  422 BEFORE the code is checked
         verify code; attach email to the owner account
         owner.password_hash = pbkdf2(password)       ← stored now, effective at verify
         invalidate prior claim_verify tokens BY ACCOUNT; mint a new one; send the email
    └─ /auth/verify?token=…  → account.email = the address actually PROVEN
                              → claimed_at, cookie, signed in

owner sign-in
  /signin/owner:  [ email ] [ password ]
    └─ POST /api/v1/auth/password-signin  → cookie → /

forgot password / first password
  /signin/owner → "Forgot your password?"
    └─ POST /api/v1/auth/request-password-reset { email }   → always { sent: true }
         owner + active only: invalidate prior password_reset tokens, mint one, send
    └─ /auth/reset-password?token=…   [ new password ] [ confirm ]
         └─ POST /api/v1/auth/reset-password { token, password }
              set the hash, revoke EVERY other session, open a fresh one → cookie → /
```

The weak-password check in `/claim` runs **before** the claim code is verified, and before the rate
limiter. The global wrong-code budget (10 failures per 15 minutes) is what actually protects a
12-character code and it is shared by everyone, so letting a rejected password spend one would let
anyone burn the operator's claim window with malformed submissions.

### 13.4 Endpoints

| Method | Path | Body | Responses |
|---|---|---|---|
| GET | `/api/v1/auth/capabilities` | — | `200 { password_min_length }`. Public, constant, varies by nothing. |
| POST | `/api/v1/auth/password-signin` | `{ email, password }` | `200 { ok, redirect, claimed } + Set-Cookie` · `401 { detail }` (constant) |
| POST | `/api/v1/auth/request-password-reset` | `{ email }` | `200 { sent: true, delivered, action_url }` **always**, whatever the address |
| POST | `/api/v1/auth/reset-password` | `{ token, password }` | `200 + Set-Cookie` · `410` expired/used/not-an-owner · `422` weak |
| POST | `/api/v1/claim` | `{ claim_code, email, password }` | `200 { sent, delivered, action_url }` · `403` bad code · `409` claimed · `422` weak · `429` throttled |
| POST | `/api/v1/auth/request-link` | `{ email }` | unchanged shape; now mints **nothing** for an owner address. Constant response, so it is not observable. |
| POST | `/api/v1/auth/verify` | `{ token }` | unchanged; now `410` for a `login` token belonging to an owner, and `410` for any `password_reset` token. |

`password_min_length` is published so the sign-in and reset screens render the rule instead of
hard-coding `10` in a second place that can drift from the server's.

### 13.5 Password rules

Enforced by `auth_service.password_problem()`, the single definition both `/claim` and
`/auth/reset-password` call:

- **min 10 characters**, no composition rules — those push people toward predictable substitutions.
- **max 128** — PBKDF2 cost scales with input length and both endpoints are unauthenticated, so the
  ceiling is a DoS guard, not a style rule. `password-signin` rejects an over-long password *before*
  hashing for the same reason.
- **no leading or trailing spaces** — invisible, un-retypable, and a guaranteed lockout.
- **must not equal the email**.

Hashing reuses the passcode KDF — `pbkdf2_hmac('sha256', …, 260_000)` → `pbkdf2_sha256$…`, stdlib
only. `hash_password`/`verify_password` are deliberately separate names from
`hash_passcode`/`verify_passcode`: a 4-digit household PIN and the key to the instance are different
things with different threat models, and the split keeps a future change to one from silently
changing the other.

### 13.6 Constancy is the security property

An instance-claim box is on the public internet by definition, so the question an attacker asks
first is *which address owns this machine*. Every answer must be the same answer:

- **One `_bad_credentials()` for all six failure paths** — unknown address, a member's address, an
  owner with no password, a revoked owner, a wrong password, a throttled attempt. Distinguishing any
  of them names the owner.
- **The throttle refuses with that same 401, never a 429.** A 429 on one address and a 401 on another
  is the same disclosure in a different costume.
- **A dummy PBKDF2 hash is verified against when no account matches**, so an unknown address costs
  the same ~100ms as the owner's. Without it a fast rejection marks every address that is *not* the
  owner — latency is an oracle exactly as much as a body is.
- **A successful sign-in clears the throttle**, so a forgotten-then-remembered password does not lock
  the owner out of their own instance for fifteen minutes.
- **`request-link` and `request-password-reset` are constant for every address**, and both send in a
  `BackgroundTasks` job so the response time does not depend on whether a token was minted (§12,
  backend defect 12).

The factory shape matters too: `_bad_credentials()` returns a **fresh** `HTTPException` per raise.
Re-raising one module-level instance appends the raising frames to its `__traceback__` forever and
each retained frame pins its locals — including the DB session — which on an unauthenticated
endpoint is an attacker-driven leak (§12, backend defect 8).

### 13.7 Transfer of ownership

`POST /api/v1/instance/transfer` now swaps the *credential* as well as the role:

| | Outgoing owner | Incoming owner |
|---|---|---|
| Role | → `member` | → `owner` |
| Password | `password_hash = None` | none yet → mailed a `password_reset` link (`isFirstTime: true`) |
| Session | **kept** | **kept** |
| Signs in with | magic link | that link, then the password they choose |

Neither session is revoked, deliberately. `require_session` re-reads the role from the database on
every request, so there is no stale privilege to drop, and killing the outgoing owner's cookie would
401 their very next request — which reads as a bug rather than as a handover. The incoming owner
keeps working too; the email is how they gain the password, not how they regain access.

Clearing the old hash is not tidiness: `password-signin` requires `ROLE_OWNER`, so the credential is
already inert — but a later transfer *back* would silently resurrect it.

### 13.8 The owner with no password yet

Two accounts reach this state and both are legitimate: an owner created by an ownership transfer,
and an owner whose instance was claimed before passwords existed (`password_hash` arrives via
`sync_columns` as a nullable column on an upgraded database — §2.3).

`request-password-reset` is therefore also the **first**-password path, which is why it does not
require a password to already exist. It is owner-and-active only, the response is the usual constant,
and the mailer's `is_first_time` flag switches the copy from "reset" to "set your password". Until
they follow it, such an owner simply cannot sign in with a password — and gets the same constant 401
as everyone else, which is the point.

### 13.9 Where it is enforced

| Guarantee | Enforcement point |
|---|---|
| Members cannot password-sign-in | `password_signin` requires `ROLE_OWNER` **and** `STATUS_ACTIVE` **and** a non-NULL `password_hash` |
| The owner cannot magic-link in | `request_link` mints only for `ROLE_MEMBER` **and** `verify_token` 410s a `login` token whose account is an owner |
| A reset link is not a session | `verify_token` accepts only `login` and `claim_verify`; `reset_password` is the sole consumer of `password_reset` |
| A stale reset link dies on re-request | `invalidate_tokens_for(account_id=…, purpose=password_reset)` before each mint |
| A reset kills the leaked cookies | `revoke_all_sessions_for_account()` before the new session is created |

Two enforcement points rather than one is the pattern throughout: mint-time *and* consumption-time.
A token minted before a role changed is the case a single check always misses.

Covered by `backend/tests/test_owner_password.py` (15 tests, plus 7 in `test_claim_flow.py`), which asserts
the constant-401 bodies are **byte-identical** rather than merely all-401 — that constancy is the
security property, and an assertion that only checks the status code would let a helpful `detail`
back in.
